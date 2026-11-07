import express from 'express';
import { askModel, AiGatewayError } from './ai.js';
import { parsePlan, summarizeOutcomes } from './planner.js';
import { validUuid, compactText } from './security.js';
import { ROLES } from './roles.js';
import { departmentReportInstructions, reportQualityIssues } from './report-quality.js';
import {validateDetailedPlan,estimateDetailedPlan,chiefPlanPrompt} from './chief-plans.js';

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
    {role:'user',content:chiefPlanPrompt(task)}
   ]});
   let plan;
   try{plan=estimateDetailedPlan(validateDetailedPlan(JSON.parse(raw)),{taskTitle:task.title,taskBrief:task.brief,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'})}catch{return res.status(502).json({error:'invalid_ai_plan'});}
   const client=await db.connect();
   try{
    await client.query('BEGIN');
    // This unique task_id constraint prevents duplicate orchestration after concurrent requests.
    const run=await client.query("INSERT INTO orchestration_runs(task_id,summary,plan_estimate) VALUES($1,$2,$3) RETURNING *",[taskId,plan.steps.length?JSON.parse(raw).summary:'',JSON.stringify(plan.estimate)]);
    for(const step of plan.steps) await client.query(
     'INSERT INTO orchestration_steps(run_id,sequence_no,role_id,instruction,estimated_minutes,estimated_input_tokens,max_output_tokens,estimated_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
     [run.rows[0].id,step.sequence_no,step.role_id,step.instruction,step.estimated_minutes,step.estimated_input_tokens,step.max_output_tokens,step.estimated_usd]
    );
    await client.query('INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
     ['chief_of_staff','plan.proposed','task',taskId,JSON.stringify({run_id:run.rows[0].id,count:plan.steps.length})]);
    await client.query('COMMIT');
    res.status(201).json({run:run.rows[0],steps:plan.steps,notice:'幕僚長已提出部門工作與預估資源；CEO 確認前不會執行。'});
   }catch(e){await client.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'plan_already_exists'});throw e}finally{client.release()}
  }catch(e){fail(res,e)}
 });
 api.get('/:id',async(req,res)=>{
  if(!validUuid(req.params.id))return res.status(400).json({error:'invalid_run_id'});
  try{const r=await read(req.params.id);if(!r)return res.status(404).json({error:'run_not_found'});res.json(r)}
  catch(e){fail(res,e)}
 });

 // CEO can edit the department assignment manually or ask the chief of staff
 // to revise for lower costs, shorter time, changed scope or department mix.
 // Both paths require a draft, an unchanged revision and explicit CEO approval.
 async function saveRevisedDraft(id,expectedVersion,proposal,feedback,eventName,res){
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query('SELECT * FROM orchestration_runs WHERE id=$1 FOR UPDATE',[id]);
   if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'run_not_found'})}
   if(q.rows[0].plan_status!=='draft'||q.rows[0].plan_version!==expectedVersion){
    await client.query('ROLLBACK');return res.status(409).json({error:'plan_changed_reload'});
   }
   const taskId=q.rows[0].task_id;
   const updated=await client.query(`UPDATE orchestration_runs
    SET summary=$2,plan_estimate=$3,ceo_feedback=$4,plan_version=plan_version+1,updated_at=NOW()
    WHERE id=$1 AND plan_status='draft' RETURNING *`,[id,proposal.summary,JSON.stringify(proposal.estimate),feedback]);
   await client.query('DELETE FROM orchestration_steps WHERE run_id=$1',[id]);
   for(const step of proposal.steps)await client.query(
    'INSERT INTO orchestration_steps(run_id,sequence_no,role_id,instruction,estimated_minutes,estimated_input_tokens,max_output_tokens,estimated_usd) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id,step.sequence_no,step.role_id,step.instruction,step.estimated_minutes,step.estimated_input_tokens,step.max_output_tokens,step.estimated_usd]
   );
   await client.query('INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
    ['ceo',eventName,'task',taskId,JSON.stringify({version:updated.rows[0].plan_version,feedback,estimated_usd:proposal.estimate.estimated_usd})]);
   await client.query('COMMIT');
   return res.json({run:updated.rows[0],steps:proposal.steps,notice:'已更新幕僚長方案，仍待 CEO 核准；尚未啟動部門執行。'});
  }catch(e){await client.query('ROLLBACK');return fail(res,e)}finally{client.release()}
 }
 api.post('/:id/revise',async(req,res)=>{
  const id=req.params.id,feedback=compactText(req.body?.feedback,2000);
  if(!validUuid(id)||!feedback)return res.status(400).json({error:'invalid_revision_request'});
  try{
   const data=await read(id);if(!data)return res.status(404).json({error:'run_not_found'});
   if(data.run.plan_status!=='draft')return res.status(409).json({error:'draft_only'});
   const taskQ=await db.query('SELECT t.*,p.goal AS project_goal FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1',[data.run.task_id]);
   if(!taskQ.rowCount)return res.status(404).json({error:'task_not_found'});
   const task=taskQ.rows[0];
   const previous={summary:data.run.summary,steps:data.steps.map(s=>({role_id:s.role_id,instruction:s.instruction,estimated_minutes:s.estimated_minutes,max_output_tokens:s.max_output_tokens}))};
   const raw=await askModel({role:'chief_of_staff',format:'json',maxTokens:1800,messages:[{role:'user',content:chiefPlanPrompt(task,{feedback,previous})}]});
   let validated;
   try{
    const plan=validateDetailedPlan(JSON.parse(raw));
    validated={...estimateDetailedPlan(plan,{taskTitle:task.title,taskBrief:task.brief,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'}),summary:plan.summary};
   }catch{return res.status(502).json({error:'invalid_ai_plan'})}
   return saveRevisedDraft(id,data.run.plan_version,validated,feedback,'plan.revised_by_ceo_instruction',res);
  }catch(e){fail(res,e)}
 });
 api.post('/:id/edit',async(req,res)=>{
  const id=req.params.id,expectedVersion=req.body?.plan_version;
  if(!validUuid(id)||!Number.isInteger(expectedVersion)||expectedVersion<1)return res.status(400).json({error:'invalid_revision_request'});
  try{
   const data=await read(id);if(!data)return res.status(404).json({error:'run_not_found'});
   if(data.run.plan_status!=='draft'||data.run.plan_version!==expectedVersion)return res.status(409).json({error:'plan_changed_reload'});
   const taskQ=await db.query('SELECT title,brief FROM tasks WHERE id=$1',[data.run.task_id]);
   if(!taskQ.rowCount)return res.status(404).json({error:'task_not_found'});
   let validated;
   try{
    const plan=validateDetailedPlan({summary:req.body?.summary,steps:req.body?.steps});
    validated={...estimateDetailedPlan(plan,{taskTitle:taskQ.rows[0].title,taskBrief:taskQ.rows[0].brief,model:process.env.OPENAI_MODEL||'gpt-4.1-mini'}),summary:plan.summary};
   }catch{return res.status(400).json({error:'invalid_department_plan'})}
   return saveRevisedDraft(id,expectedVersion,validated,'CEO 手動修改分工','plan.edited_by_ceo',res);
  }catch(e){fail(res,e)}
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
   outcome=await askModel({role:step.role_id,maxTokens:Math.min(Number(step.max_output_tokens)||2400,2400),messages:[
    {role:'user',content:departmentReportInstructions(step.role_id)+'\n任務：'+task.title+'\n說明：'+task.brief+'\n本部門工作：'+step.instruction+'\n先前部門分析摘要：'+context}
   ]});
  }catch(e){
   await db.query("UPDATE orchestration_steps SET status='failed',last_error=$2 WHERE id=$1 AND status='running'",[step.id,compactText(e?.message||'model_failed',240)]);
   await db.query("UPDATE orchestration_runs SET plan_status='failed',last_error=$2,updated_at=NOW() WHERE id=$1",[id,'AI 呼叫失敗，可由 CEO 再次執行；不會默默重試。']);
   return fail(res,e);
  }
  // One paid AI attempt only; never silently retry a substandard report.
  const qualityIssues=reportQualityIssues(outcome,step.role_id);
  if(qualityIssues.length){
   const issueSummary='report_quality_failed: '+qualityIssues.join(', ');
   try{
    await db.query("UPDATE orchestration_steps SET status='failed',last_error=$2 WHERE id=$1 AND status='running'",[step.id,issueSummary]);
    await db.query("UPDATE orchestration_runs SET plan_status='failed',last_error=$2,updated_at=NOW() WHERE id=$1",[id,'AI 報告未通過品質檢查，未納入正式成果；需 CEO 決定是否重新執行。']);
   }catch(e){console.error('report quality persistence error:',e?.message||e);return fail(res,e)}
   return res.status(422).json({error:'report_quality_failed',issues:qualityIssues,notice:'已攔截不合格報告並保留失敗紀錄；本次已使用一次 AI 額度，不會自動重試。'});
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
   const runCheck=await client.query("SELECT task_id FROM orchestration_runs WHERE id=$1 AND plan_status='review' FOR UPDATE",[id]);
   if(!runCheck.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'not_ready_for_completion'});}
   const activeSop=await client.query("SELECT policy_code,version FROM company_sops WHERE status='approved' ORDER BY effective_at DESC LIMIT 1");
   if(activeSop.rowCount){
    // SOP chapter 10: all CEO-selected deliverable formats must be saved and reviewed before final acceptance.
    const taskId=runCheck.rows[0].task_id;
    const pref=await client.query("SELECT formats FROM task_delivery_preferences WHERE task_id=$1",[taskId]);
    const required=pref.rows[0]?.formats||['pdf'];
    const artifacts=await client.query(
     "SELECT format,drive_file_id,drive_url,review_state FROM task_deliverables WHERE task_id=$1 AND review_state='approved'",[taskId]);
    const ready=new Set(artifacts.rows.filter(f=>f.drive_file_id&&f.drive_url).map(f=>f.format));
    const missing=required.filter(f=>!ready.has(f));
    if(missing.length){
     await client.query('ROLLBACK');
     return res.status(409).json({
      error:'sop_required_deliverables_missing',
      policy:activeSop.rows[0].policy_code+' '+activeSop.rows[0].version,
      missing_formats:missing,
      notice:'正式 SOP 已啟用。尚缺經審查並歸檔的必要文件；不得僅以文字報告完成任務。'
     });
    }
   }
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
