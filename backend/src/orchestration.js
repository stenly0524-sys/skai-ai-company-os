import express from 'express';
import { askModel, AiGatewayError } from './ai.js';
import { parsePlan, summarizeOutcomes } from './planner.js';
import { validUuid, compactText } from './security.js';
import { ROLES } from './roles.js';

// Exposed AFTER the existing development authentication middleware.
// All orchestration effects are internal text generation; no external actions.
export function orchestrationRouter(db){
 const api=express.Router();
 const read=async(id)=>{
  const r=await db.query('SELECT * FROM orchestration_runs WHERE id=$1',[id]);
  if(!r.rowCount)return null;
  const s=await db.query('SELECT * FROM orchestration_steps WHERE run_id=$1 ORDER BY sequence_no',[id]);
  return {run:r.rows[0],steps:s.rows};
 };
 const fail=(res,e)=>{console.error('orchestration:',e?.message||e);res.status(e instanceof AiGatewayError?502:500).json({error:e instanceof AiGatewayError?'ai_unavailable':'internal_error'})};
 api.get('/',async(_req,res)=>{
  try {
   const q=await db.query(`SELECT r.*,t.title AS task_title,t.project_id
    FROM orchestration_runs r JOIN tasks t ON t.id=r.task_id
    ORDER BY r.created_at DESC LIMIT 100`);
   res.json({runs:q.rows});
  }catch(e){fail(res,e)}
 });
 api.post('/plan',async(req,res)=>{
  const taskId=req.body?.task_id;
  if(!validUuid(taskId))return res.status(400).json({error:'invalid_task_id'});
  try{
   const q=await db.query('SELECT t.*,p.goal AS project_goal FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1',[taskId]);
   if(!q.rowCount)return res.status(404).json({error:'task_not_found'});
   const task=q.rows[0];
   if(task.status!=='approved')return res.status(409).json({error:'ceo_task_approval_required'});
   const exists=await db.query('SELECT id FROM orchestration_runs WHERE task_id=$1',[taskId]);
   if(exists.rowCount)return res.status(409).json({error:'plan_already_exists',run_id:exists.rows[0].id});
   const raw=await askModel({role:'chief_of_staff',format:'json',maxTokens:1800,messages:[
    {role:'user',content:'根據以下 CEO 已核准任務提出 1 至 8 個專業部門工作，僅回傳 JSON 物件：{"summary":"整體目標","steps":[{"role_id":"finance","instruction":"具體分析項目"}]}。role_id 僅能選 admin,finance,brand,marketing,operations,tech,hr,legal。不要提出任何立即對外執行行動；分析結果須標記假設及未驗證資訊。\n專案目標：'+task.project_goal+'\n任務：'+task.title+'\n任務說明：'+task.brief}
   ]});
   let plan;
   try{plan=parsePlan(raw)}catch{return res.status(502).json({error:'invalid_ai_plan'});}
   const client=await db.connect();
   try{
    await client.query('BEGIN');
    // This unique task_id constraint prevents duplicate orchestration after concurrent requests.
    const run=await client.query("INSERT INTO orchestration_runs(task_id,summary) VALUES($1,$2) RETURNING *",[taskId,plan.summary]);
    for(const step of plan.steps) await client.query(
     'INSERT INTO orchestration_steps(run_id,sequence_no,role_id,instruction) VALUES($1,$2,$3,$4)',
     [run.rows[0].id,step.sequence_no,step.role_id,step.instruction]
    );
    await client.query('INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
     ['chief_of_staff','plan.proposed','task',taskId,JSON.stringify({run_id:run.rows[0].id,count:plan.steps.length})]);
    await client.query('COMMIT');
    res.status(201).json({run:run.rows[0],steps:plan.steps,notice:'待 CEO 審閱分工；尚未啟動部門分析。'});
   }catch(e){await client.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'plan_already_exists'});throw e}finally{client.release()}
  }catch(e){fail(res,e)}
 });
 api.get('/:id',async(req,res)=>{
  if(!validUuid(req.params.id))return res.status(400).json({error:'invalid_run_id'});
  try{const r=await read(req.params.id);if(!r)return res.status(404).json({error:'run_not_found'});res.json(r)}
  catch(e){fail(res,e)}
 });
 api.post('/:id/approve',async(req,res)=>{
  const id=req.params.id;
  if(!validUuid(id))return res.status(400).json({error:'invalid_run_id'});
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   const updated=await client.query(`UPDATE orchestration_runs r SET plan_status='ready',updated_at=NOW()
    FROM tasks t WHERE r.id=$1 AND r.task_id=t.id AND r.plan_status='draft' AND t.status='approved' RETURNING r.*`,[id]);
   if(!updated.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'plan_not_approvable'});}
   await client.query('INSERT INTO audit_log(actor,event,target_type,target_id) VALUES($1,$2,$3,$4)', ['ceo','plan.approved','task',updated.rows[0].task_id]);
   await client.query('COMMIT');res.json({run:updated.rows[0]});
  }catch(e){await client.query('ROLLBACK');fail(res,e)}finally{client.release()}
 });
 // Each call executes ONE department analysis. State is persisted before OpenAI call.
 // A crash leaves a 'running' step, which CEO can explicitly recover (never auto-retry).
 api.post('/:id/advance',async(req,res)=>{
  const id=req.params.id;if(!validUuid(id))return res.status(400).json({error:'invalid_run_id'});
  const client=await db.connect();let step,task;
  try{
   await client.query('BEGIN');
   const rr=await client.query('SELECT * FROM orchestration_runs WHERE id=$1 FOR UPDATE',[id]);
   if(!rr.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'run_not_found'});}
   const run=rr.rows[0];
   const tq=await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[run.task_id]);
   task=tq.rows[0];
   if(!task||!['approved','in_progress'].includes(task.status)||!['ready','running','failed','paused'].includes(run.plan_status)){
    await client.query('ROLLBACK');return res.status(409).json({error:'run_not_advanceable'});
   }
   const occupied=await client.query("SELECT 1 FROM orchestration_steps WHERE run_id=$1 AND status='running'",[id]);
   if(occupied.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'step_already_running_use_recover_if_stale'});}
   const sq=await client.query("SELECT * FROM orchestration_steps WHERE run_id=$1 AND status IN ('failed','pending') ORDER BY sequence_no LIMIT 1 FOR UPDATE",[id]);
   if(!sq.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'no_available_step'});}
   step=sq.rows[0];
   if(step.attempts>=3){await client.query('ROLLBACK');return res.status(409).json({error:'step_attempt_limit'});}
   await client.query("UPDATE orchestration_steps SET status='running',attempts=attempts+1,started_at=NOW(),last_error=NULL WHERE id=$1",[step.id]);
   await client.query("UPDATE orchestration_runs SET plan_status='running',last_error=NULL,updated_at=NOW() WHERE id=$1",[id]);
   await client.query("UPDATE tasks SET status='in_progress',updated_at=NOW() WHERE id=$1 AND status='approved'",[task.id]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');return fail(res,e)}finally{client.release()}
  let outcome;
  try {
   const done=await db.query("SELECT role_id,result FROM orchestration_steps WHERE run_id=$1 AND status='done' ORDER BY sequence_no",[id]);
   const context=done.rows.map(s=>s.role_id+': '+s.result?.slice(0,2000)).join('\n');
   outcome=await askModel({role:step.role_id,maxTokens:1600,messages:[
    {role:'user',content:'請針對已核准內部分析任務提出專業報告，不要假稱已搜尋外部資料或執行操作。說明結論、依據、風險、不確定性、建議及下一步。\n任務：'+task.title+'\n說明：'+task.brief+'\n本部門工作：'+step.instruction+'\n先前部門分析摘要：'+context}
   ]});
  }catch(e){
   await db.query("UPDATE orchestration_steps SET status='failed',last_error=$2 WHERE id=$1 AND status='running'",[step.id,compactText(e?.message||'model_failed',240)]);
   await db.query("UPDATE orchestration_runs SET plan_status='failed',last_error=$2,updated_at=NOW() WHERE id=$1",[id,'AI 呼叫失敗，可由 CEO 再次執行；不會默默重試。']);
   return fail(res,e);
  }
  try{
   const c=await db.connect();
   try{
    await c.query('BEGIN');
    const u=await c.query("UPDATE orchestration_steps SET status='done',result=$2,completed_at=NOW() WHERE id=$1 AND status='running' RETURNING *",[step.id,outcome]);
    if(!u.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'step_state_changed'});}
    const s=await c.query('SELECT role_id,result,status FROM orchestration_steps WHERE run_id=$1 ORDER BY sequence_no',[id]);
    const finished=s.rows.every(x=>x.status==='done');
    if(finished){
     // Conservative consolidation: original department results retained verbatim for CEO review.
     const report=summarizeOutcomes(s.rows);
     await c.query("UPDATE orchestration_runs SET plan_status='review',consolidated_report=$2,updated_at=NOW() WHERE id=$1",[id,report]);
     await c.query("UPDATE tasks SET status='review',result=$2,updated_at=NOW() WHERE id=$1",[task.id,report]);
    }else{
     await c.query('UPDATE orchestration_runs SET updated_at=NOW() WHERE id=$1',[id]);
    }
    await c.query('INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
     [step.role_id,'department.analysis.completed','task',task.id,JSON.stringify({step_id:step.id})]);
    await c.query('COMMIT');
    res.json({step:u.rows[0],awaiting_ceo_review:finished,remaining:s.rows.filter(x=>x.status!=='done').length});
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  }catch(e){fail(res,e)}
 });
 api.post('/:id/recover',async(req,res)=>{
  const id=req.params.id;if(!validUuid(id))return res.status(400).json({error:'invalid_run_id'});
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   const run=await client.query('SELECT * FROM orchestration_runs WHERE id=$1 FOR UPDATE',[id]);
   if(!run.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'run_not_found'});}
   const stale=await client.query("UPDATE orchestration_steps SET status='failed',last_error='CEO recovered interrupted step' WHERE run_id=$1 AND status='running' AND started_at<NOW()-INTERVAL '2 minutes' RETURNING id",[id]);
   if(!stale.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'no_stale_step'});}
   await client.query("UPDATE orchestration_runs SET plan_status='failed',updated_at=NOW() WHERE id=$1",[id]);
   await client.query('INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
    ['ceo','run.recovered','task',run.rows[0].task_id,JSON.stringify({step_ids:stale.rows.map(x=>x.id)})]);
   await client.query('COMMIT');res.json({recovered:stale.rows.length,notice:'已標記中斷步驟；需 CEO 再按 advance 才會重新分析。'});
  }catch(e){await client.query('ROLLBACK');fail(res,e)}finally{client.release()}
 });
 api.post('/:id/complete',async(req,res)=>{
  const id=req.params.id;if(!validUuid(id))return res.status(400).json({error:'invalid_run_id'});
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("UPDATE orchestration_runs SET plan_status='done',updated_at=NOW() WHERE id=$1 AND plan_status='review' RETURNING *",[id]);
   if(!q.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'not_ready_for_completion'});}
   await client.query("UPDATE tasks SET status='done',updated_at=NOW() WHERE id=$1 AND status='review'",[q.rows[0].task_id]);
   await client.query('INSERT INTO audit_log(actor,event,target_type,target_id) VALUES($1,$2,$3,$4)',
    ['ceo','report.accepted','task',q.rows[0].task_id]);
   await client.query('COMMIT');res.json({run:q.rows[0],notice:'CEO 已完成報告審核；僅代表內部分析結案。'});
  }catch(e){await client.query('ROLLBACK');fail(res,e)}finally{client.release()}
 });
 return api;
}
