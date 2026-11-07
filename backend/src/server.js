import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES, systemPrompt } from './roles.js';
import { tokenMatches, validOrigin, validUuid, compactText } from './security.js';
import { approvalDecision, requireTransition } from './workflow.js';
import { orchestrationRouter } from './orchestration.js';
import {deliveryRouter} from './delivery-router.js';
import {driveDeliveryReady} from './drive-delivery.js';
import { activeCompanySop } from './governance.js';
import { operationsRouter } from './ops-router.js';
import { askModel, configureAiUsage, AiGatewayError } from './ai.js';
import { authRouter } from './auth.js';
import {googleOAuthRouter} from './google-oauth.js';

const { Pool } = pg;
const required = ['DATABASE_URL', 'SKAI_ADMIN_TOKEN', 'OPENAI_API_KEY', 'SKAI_CEO_PASSWORD'];
for (const key of required) if (!process.env[key] || process.env[key].startsWith('replace-')) throw new Error('Missing secure configuration: ' + key);
if (process.env.SKAI_ADMIN_TOKEN.length < 32) throw new Error('SKAI_ADMIN_TOKEN must be at least 32 characters');
if (process.env.SKAI_CEO_PASSWORD.length < 16) throw new Error('SKAI_CEO_PASSWORD must be at least 16 characters');
if (process.env.NODE_ENV==='production' && !/^https:\/\/[^/]+$/.test(process.env.PUBLIC_ORIGIN||'')) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin in production');
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true }, max: 5 });
configureAiUsage(db);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
 res.set('Cache-Control', 'no-store');
 res.set('X-Content-Type-Options', 'nosniff');
 const origin = req.get('origin');
 const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
 if (origin && allowed.includes(origin)) {
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
 }
 if (req.method === 'OPTIONS') return res.sendStatus(origin && allowed.includes(origin) ? 204 : 403);
 next();
});
const sameSecret = token => tokenMatches(token, process.env.SKAI_ADMIN_TOKEN);
const sessionAuth=authRouter(db);
const oauth=googleOAuthRouter(db);
// Google callback accepts Google's navigation without CEO cookie, but validates one-time state and the initiating session.
app.use('/api/google-oauth',oauth.publicCallback);
app.get('/health', async (_req,res) => {
 try { await db.query('SELECT 1'); res.json({ ok: true, service: 'SKAI V0.5 alpha' }); }
 catch { res.status(503).json({ error: 'database_unavailable' }); }
});
app.post('/api/session/login',sessionAuth.login);
app.use('/api', (req,res,next) => {
 const authorization = req.get('authorization') || '';
 if (process.env.NODE_ENV!=='production' && !req.get('origin') && authorization.startsWith('Bearer ') && sameSecret(authorization.slice(7))) {
  req.isDeveloperToken = true;
  return next();
 }
 sessionAuth.authenticate(req,res,next);
});
app.get('/api/session',sessionAuth.session);
app.post('/api/session/logout',sessionAuth.logout);
const sendError = (res,e) => { console.error('SKAI API error:', e?.code || e?.message || e); res.status(500).json({error:'internal_error'}); };
const txt = compactText;
const uuid = validUuid;
const record = async (client,event,type,id,details={}) => client.query(
 'INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
 ['ceo',event,type,id,JSON.stringify(details)]
);
app.use('/api/orchestrations', orchestrationRouter(db));
app.use('/api/delivery',deliveryRouter(db));
app.use('/api/google-oauth',oauth.protectedApi);
app.use('/api/operations', operationsRouter(db));
app.get('/api/roles', (_req,res) => res.json({ roles: Object.entries(ROLES).map(([id, r]) => ({ id,...r })) }));
app.get('/api/governance/active',async(_req,res)=>{
 try{
  const sop=await activeCompanySop(db);
  if(!sop)return res.json({status:'not_activated',sop:null});
  res.json({status:'approved',sop:{
   code:sop.policy_code,version:sop.version,title:sop.title,
   approved_at:sop.approved_at,effective_at:sop.effective_at,
   pdf_file_id:sop.drive_pdf_id,project_pdf_file_id:sop.project_pdf_id,
   implementation_status:sop.implementation_status,
   document_text:sop.source_text
  }});
 }catch(e){sendError(res,e)}
});

app.get('/api/dashboard', async (_req,res) => {
 try {
  const q=await db.query(`SELECT
   (SELECT COUNT(*) FROM projects WHERE status!='closed')::int AS projects,
   (SELECT COUNT(*) FROM tasks WHERE status='in_progress')::int AS active,
   (SELECT COUNT(*) FROM approvals WHERE status='pending')::int AS pending`);
  res.json({counts:q.rows[0],source:'postgresql',notice:'僅統計 SKAI 已保存資料'});
 }catch(e){sendError(res,e)}
});
app.get('/api/projects', async (_req,res) => {
 try { const q=await db.query(`SELECT p.*, (SELECT a.details->>'deadline' FROM audit_log a WHERE a.target_type='project' AND a.target_id=p.id AND a.event IN ('project.created','project.updated') ORDER BY a.created_at DESC,a.id DESC LIMIT 1) AS deadline FROM projects p ORDER BY p.created_at DESC LIMIT 200`);res.json({projects:q.rows}); }
 catch(e){sendError(res,e);}
});
app.post('/api/projects', async(req,res) => {
 const name=txt(req.body?.name,120),goal=txt(req.body?.goal,8000),deadline=txt(req.body?.deadline,10);
 if(deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(deadline))return res.status(400).json({error:'invalid_project_deadline'});
 if(!name) return res.status(400).json({error:'name_required'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query('INSERT INTO projects(name,goal) VALUES($1,$2) RETURNING *',[name,goal]);
  await record(client,'project.created','project',q.rows[0].id,{deadline});
  await client.query('COMMIT');res.status(201).json({project:q.rows[0]});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.put('/api/projects/:id',async(req,res)=>{
 const id=req.params.id,name=txt(req.body?.name,120),goal=txt(req.body?.goal,8000),deadline=txt(req.body?.deadline,10);
 if(!uuid(id)||!name||!/^\\d{4}-\\d{2}-\\d{2}$/.test(deadline)&&deadline)return res.status(400).json({error:'invalid_project_update'});
 const client=await db.connect();
 try{await client.query('BEGIN');
  const q=await client.query('UPDATE projects SET name=$2,goal=$3 WHERE id=$1 RETURNING *',[id,name,goal]);
  if(!q.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'project_not_found'});}
  await record(client,'project.updated','project',id,{name,goal,deadline});
  await client.query('COMMIT');res.json({project:{...q.rows[0],deadline}});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
// CEO-only deletion endpoints. Existing session authentication and CSRF middleware apply.
app.get('/api/projects/:id/deletion-preview', async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_project_id'});
 try{
  const project=await db.query('SELECT id,name FROM projects WHERE id=$1',[id]);
  if(!project.rowCount)return res.status(404).json({error:'project_not_found'});
  const r=await db.query(`SELECT
   (SELECT COUNT(*) FROM tasks WHERE project_id=$1)::int tasks,
   (SELECT COUNT(*) FROM conversations WHERE project_id=$1)::int conversations,
   (SELECT COUNT(*) FROM orchestration_runs WHERE task_id IN (SELECT id FROM tasks WHERE project_id=$1))::int runs,
   (SELECT COUNT(*) FROM orchestration_runs WHERE task_id IN (SELECT id FROM tasks WHERE project_id=$1) AND plan_status='running')::int running`,[id]);
  res.json({counts:r.rows[0],blocked:r.rows[0].running>0});
 }catch(e){sendError(res,e);}
});
app.delete('/api/projects/:id',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_project_id'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const p=await client.query('SELECT id,name FROM projects WHERE id=$1 FOR UPDATE',[id]);
  if(!p.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'project_not_found'});}
  const active=await client.query("SELECT r.id FROM orchestration_runs r JOIN tasks t ON t.id=r.task_id WHERE t.project_id=$1 AND r.plan_status='running' LIMIT 1 FOR UPDATE OF r",[id]);
  if(active.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'project_has_running_ai_jobs'});}
  const count=await client.query('SELECT COUNT(*)::int n FROM tasks WHERE project_id=$1',[id]);
  await client.query('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=$1)',[id]);
  await client.query('DELETE FROM conversations WHERE project_id=$1',[id]);
  await client.query('DELETE FROM approvals WHERE task_id IN (SELECT id FROM tasks WHERE project_id=$1)',[id]);
  await client.query('DELETE FROM orchestration_runs WHERE task_id IN (SELECT id FROM tasks WHERE project_id=$1)',[id]);
  await client.query('DELETE FROM tasks WHERE project_id=$1',[id]);
  // Preserve immutable audit evidence; no user data is silently repurposed.
  await record(client,'project.deleted','project',id,{name:p.rows[0].name,task_count:count.rows[0].n});
  await client.query('DELETE FROM projects WHERE id=$1',[id]);
  await client.query('COMMIT');
  res.json({ok:true,deleted_project:id,deleted_tasks:count.rows[0].n});
 }catch(e){await client.query('ROLLBACK');if(e.code==='23503')return res.status(409).json({error:'project_has_other_dependencies'});sendError(res,e);}
 finally{client.release();}
});
app.post('/api/tasks/:id/archive',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_task_id'});
 const client=await db.connect();try{await client.query('BEGIN');
 const t=await client.query('SELECT id,title FROM tasks WHERE id=$1 FOR UPDATE',[id]);if(!t.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
 const active=await client.query("SELECT id FROM orchestration_runs WHERE task_id=$1 AND plan_status='running' LIMIT 1",[id]);if(active.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'task_has_running_ai_job'});}
 const latest=await client.query("SELECT event FROM audit_log WHERE target_type='task' AND target_id=$1 AND event IN ('task.archived','task.restored') ORDER BY created_at DESC LIMIT 1",[id]);if(latest.rows[0]?.event==='task.archived'){await client.query('ROLLBACK');return res.status(409).json({error:'already_archived'});}
 await record(client,'task.archived','task',id,{title:t.rows[0].title});await client.query('COMMIT');res.json({ok:true});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.post('/api/tasks/:id/restore',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_task_id'});
 const client=await db.connect();try{await client.query('BEGIN');
 const t=await client.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[id]);if(!t.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
 const latest=await client.query("SELECT event FROM audit_log WHERE target_type='task' AND target_id=$1 AND event IN ('task.archived','task.restored') ORDER BY created_at DESC LIMIT 1",[id]);if(latest.rows[0]?.event!=='task.archived'){await client.query('ROLLBACK');return res.status(409).json({error:'task_not_archived'});}
 await record(client,'task.restored','task',id,{});await client.query('COMMIT');res.json({ok:true});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.delete('/api/tasks/:id',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_task_id'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const t=await client.query('SELECT id,title,project_id FROM tasks WHERE id=$1 FOR UPDATE',[id]);
  if(!t.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
  const archived=await client.query("SELECT event FROM audit_log WHERE target_type='task' AND target_id=$1 AND event IN ('task.archived','task.restored') ORDER BY created_at DESC LIMIT 1",[id]);
  if(archived.rows[0]?.event!=='task.archived'){await client.query('ROLLBACK');return res.status(409).json({error:'archive_before_permanent_delete'});}
  const active=await client.query("SELECT id FROM orchestration_runs WHERE task_id=$1 AND plan_status='running' LIMIT 1 FOR UPDATE",[id]);
  if(active.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'task_has_running_ai_job'});}
  await client.query('DELETE FROM approvals WHERE task_id=$1',[id]);
  await client.query('DELETE FROM orchestration_runs WHERE task_id=$1',[id]);
  await record(client,'task.deleted','task',id,{title:t.rows[0].title,project_id:t.rows[0].project_id});
  await client.query('DELETE FROM tasks WHERE id=$1',[id]);
  await client.query('COMMIT');res.json({ok:true,deleted_task:id});
 }catch(e){await client.query('ROLLBACK');if(e.code==='23503')return res.status(409).json({error:'task_has_other_dependencies'});sendError(res,e);}finally{client.release();}
});
// CEO task notes and decisions are recorded in the existing audit log, preserving history.
app.get('/api/tasks/:id/ceo-records',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_task_id'});
 try{
  const t=await db.query('SELECT id FROM tasks WHERE id=$1',[id]);
  if(!t.rowCount)return res.status(404).json({error:'task_not_found'});
  const q=await db.query("SELECT event,details,created_at FROM audit_log WHERE target_type='task' AND target_id=$1 AND event IN ('task.ceo_edited','task.ceo_draft_decision','task.ceo_final_decision') ORDER BY created_at ASC",[id]);
  res.json({records:q.rows,preliminary:q.rows.filter(x=>x.event==='task.ceo_draft_decision').at(-1)?.details?.content||null,final:q.rows.filter(x=>x.event==='task.ceo_final_decision').at(-1)?.details?.content||null});
 }catch(e){sendError(res,e);}
});
app.put('/api/tasks/:id/ceo-edit',async(req,res)=>{
 const id=req.params.id,title=txt(req.body?.title,160),brief=txt(req.body?.brief,8000);
 if(!uuid(id)||!title||typeof req.body?.brief!=='string'||req.body.brief.length>8000)return res.status(400).json({error:'invalid_task_edit'});
 const client=await db.connect();
 try{await client.query('BEGIN');
  const prev=await client.query('SELECT title,brief,status FROM tasks WHERE id=$1 FOR UPDATE',[id]);
  if(!prev.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
  if(prev.rows[0].status==='done'){await client.query('ROLLBACK');return res.status(409).json({error:'completed_task_read_only'});}
  const q=await client.query("UPDATE tasks SET title=$2,brief=$3,status='in_progress',updated_at=NOW() WHERE id=$1 RETURNING *",[id,title,brief]);
  await record(client,'task.ceo_edited','task',id,{previous:prev.rows[0],title,brief});
  await client.query('COMMIT');res.json({task:q.rows[0]});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.post('/api/tasks/:id/reopen-decision',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_task_id'});
 const client=await db.connect();
 try{await client.query('BEGIN');
  const previous=await client.query('SELECT status FROM tasks WHERE id=$1 FOR UPDATE',[id]);
  if(!previous.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
  if(previous.rows[0].status!=='done'){await client.query('ROLLBACK');return res.status(409).json({error:'task_not_completed'});}
  const updated=await client.query("UPDATE tasks SET status='in_progress',progress=0,updated_at=NOW() WHERE id=$1 RETURNING *",[id]);
  await record(client,'task.ceo_reopened_decision','task',id,{from:'done',to:'in_progress'});
  await client.query('COMMIT');res.json({task:updated.rows[0]});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.post('/api/tasks/:id/ceo-decision',async(req,res)=>{
 const id=req.params.id,content=txt(req.body?.content,6000),action=req.body?.action;
 if(!uuid(id)||!content||!['save','decide'].includes(action))return res.status(400).json({error:'invalid_ceo_decision'});
 const client=await db.connect();
 try{await client.query('BEGIN');
  const prev=await client.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[id]);
  if(!prev.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
  if(prev.rows[0].status==='done'){await client.query('ROLLBACK');return res.status(409).json({error:'task_already_completed'});}
  await record(client,action==='save'?'task.ceo_draft_decision':'task.ceo_final_decision','task',id,{content});
  if(action==='save')await client.query("UPDATE tasks SET status='in_progress',updated_at=NOW() WHERE id=$1",[id]);
  let task=action==='save'?(await client.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0]:prev.rows[0];
  if(action==='decide'){
   const q=await client.query("UPDATE tasks SET status='done',progress=100,updated_at=NOW() WHERE id=$1 RETURNING *",[id]);task=q.rows[0];
   await client.query("UPDATE approvals SET status='rejected',note='CEO 已直接決策結案',decided_at=NOW() WHERE task_id=$1 AND status='pending'",[id]);
  }
  await client.query('COMMIT');res.json({task,action});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.post('/api/tasks/:id/transition',async(req,res)=>{
 const id=req.params.id,status=req.body?.status;
 if(!uuid(id)||typeof status!=='string')return res.status(400).json({error:'invalid_task_transition'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const t=await client.query('SELECT id,status FROM tasks WHERE id=$1 FOR UPDATE',[id]);
  if(!t.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
  try{requireTransition(t.rows[0].status,status);}catch{await client.query('ROLLBACK');return res.status(409).json({error:'invalid_task_transition'});}
  // AI work must use /api/orchestrations routes so it always produces an auditable plan, outputs, and CEO acceptance.
  if(['in_progress','review','done'].includes(status)){
   await client.query('ROLLBACK');return res.status(409).json({error:'ai_execution_requires_orchestration',notice:'請先在任務詳情建立智能助理方案；核准預算後由部門執行並產生成果，才能驗收。'});
  }
  const updated=await client.query('UPDATE tasks SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status]);
  await record(client,'task.transition','task',id,{from:t.rows[0].status,to:status});
  await client.query('COMMIT');res.json({task:updated.rows[0]});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
// Drive archive: CEO can choose one or several deliverable formats and open existing files.
// Generation/upload requires a separate Google Drive OAuth/Service Account connection.
app.get('/api/projects/:id/drive-folders',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_project_id'});
 try{const q=await db.query('SELECT role_id,folder_id,folder_url FROM project_drive_folders WHERE project_id=$1 ORDER BY role_id',[id]);res.json({folders:q.rows});}
 catch(e){sendError(res,e)}
});
app.get('/api/tasks/:id/deliverables',async(req,res)=>{
 const id=req.params.id;if(!uuid(id))return res.status(400).json({error:'invalid_task_id'});
 try{
  const q=await db.query('SELECT id,role_id,format,title,drive_url,review_state,created_at FROM task_deliverables WHERE task_id=$1 ORDER BY created_at DESC',[id]);
  const p=await db.query('SELECT formats FROM task_delivery_preferences WHERE task_id=$1',[id]);
  res.json({documents:q.rows,formats:p.rows[0]?.formats||['pdf'],auto_generation_connected:driveDeliveryReady(),
   notice:driveDeliveryReady()?'Google Drive 授權已設定；正式歸檔仍需要已完成的 AI 報告、部門資料夾及 CEO 確認。':'Render 尚未設定 Google Drive 長期授權，暫時不能執行自動文件產生及上傳。'});
 }catch(e){sendError(res,e)}
});
app.put('/api/tasks/:id/delivery-preferences',async(req,res)=>{
 const id=req.params.id,formats=req.body?.formats;
 if(!uuid(id)||!Array.isArray(formats)||formats.length<1||formats.length>3||
  new Set(formats).size!==formats.length||formats.some(x=>!['pdf','docx','xlsx'].includes(x)))
  return res.status(400).json({error:'invalid_delivery_formats'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const exists=await client.query('SELECT id FROM tasks WHERE id=$1',[id]);
  if(!exists.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'task_not_found'});}
  await client.query('INSERT INTO task_delivery_preferences(task_id,formats) VALUES($1,$2::TEXT[]) ON CONFLICT(task_id) DO UPDATE SET formats=$2::TEXT[],updated_at=NOW()',[id,formats]);
  await record(client,'task.delivery_formats_selected','task',id,{formats});
  await client.query('COMMIT');
  res.json({formats,notice:'交付格式已保存。檔案不會在尚未完成的 AI 任務中憑空生成。'});
 }catch(e){await client.query('ROLLBACK');sendError(res,e)}finally{client.release()}
});
app.get('/api/tasks', async(req,res) => {
 const projectId=req.query.project_id;
 if(projectId && !uuid(projectId))return res.status(400).json({error:'invalid_project_id'});
 try {const q=projectId ? await db.query('SELECT * FROM tasks WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200',[projectId])
 : await db.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200');
 const tasks=await Promise.all(q.rows.map(async t=>{const a=await db.query("SELECT EXISTS(SELECT 1 FROM audit_log WHERE target_type='task' AND target_id=$1 AND event IN ('task.ceo_edited','task.ceo_draft_decision','task.ceo_final_decision','task.ceo_reopened_decision')) AS has_activity",[t.id]);const archive=await db.query("SELECT event FROM audit_log WHERE target_type='task' AND target_id=$1 AND event IN ('task.archived','task.restored') ORDER BY created_at DESC LIMIT 1",[t.id]);const final=await db.query("SELECT details->>'content' AS content,created_at FROM audit_log WHERE target_type='task' AND target_id=$1 AND event='task.ceo_final_decision' ORDER BY created_at DESC LIMIT 1",[t.id]);return {...t,has_activity:Boolean(a.rows[0]?.has_activity),is_archived:archive.rows[0]?.event==='task.archived',final_decision:final.rows[0]?.content||null,final_decided_at:final.rows[0]?.created_at||null};}));res.json({tasks});}
 catch(e){sendError(res,e);}
});
app.post('/api/tasks', async(req,res) => {
 const projectId=req.body?.project_id,title=txt(req.body?.title,160),brief=txt(req.body?.brief,8000),role=txt(req.body?.assigned_role,32)||'chief_of_staff';
 if(!uuid(projectId)||!title||!ROLES[role])return res.status(400).json({error:'invalid_task'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const p=await client.query('SELECT id FROM projects WHERE id=$1',[projectId]);
  if(!p.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'project_not_found'});}
  const direct=Boolean(req.body?.ceo_assign_to_chief)&&Boolean(req.ceoSession);
  const q=await client.query('INSERT INTO tasks(project_id,title,brief,assigned_role,status) VALUES($1,$2,$3,$4,$5) RETURNING *',
   [projectId,title,brief,'chief_of_staff',direct?'approved':'proposed']);
  let approval=null;
  if(!direct)approval=(await client.query('INSERT INTO approvals(task_id) VALUES($1) RETURNING *',[q.rows[0].id])).rows[0];
  await record(client,direct?'task.ceo_assigned_to_chief':'task.proposed','task',q.rows[0].id);
  await client.query('COMMIT');
  res.status(201).json({task:q.rows[0],approval,chief_plan_required:direct,notice:direct?'CEO 任務已交付幕僚長，待提出規劃方案；尚未啟動部門執行。':'待 CEO 審批'});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.get('/api/approvals', async (_req,res)=>{
 try{const q=await db.query(`SELECT a.*, t.title, t.project_id FROM approvals a JOIN tasks t ON t.id=a.task_id WHERE a.status='pending' ORDER BY a.created_at LIMIT 200`);res.json({approvals:q.rows});}
 catch(e){sendError(res,e);}
});
app.post('/api/approvals/:id/decision',async(req,res)=>{
 const id=req.params.id,status=req.body?.decision,note=txt(req.body?.note,2000);
 if(!uuid(id))return res.status(400).json({error:'invalid_decision'});
 try{approvalDecision(status)}catch{return res.status(400).json({error:'invalid_decision'});}
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const a=await client.query("UPDATE approvals SET status=$1,note=$2,decided_at=NOW() WHERE id=$3 AND status='pending' RETURNING *",[status,note,id]);
  if(!a.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'pending_approval_not_found'});}
  await client.query('UPDATE tasks SET status=$1,updated_at=NOW() WHERE id=$2',[status,a.rows[0].task_id]);
  await record(client,'approval.'+status,'task',a.rows[0].task_id,{approval_id:id});
  await client.query('COMMIT');res.json({approval:a.rows[0]});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
// Durable, CEO-authenticated conversation retrieval. Only saved PostgreSQL records are returned.
app.get('/api/conversations',async(req,res)=>{
 const role=txt(req.query.role_id,32);
 if(!ROLES[role])return res.status(400).json({error:'invalid_role'});
 try{
  const q=await db.query(`SELECT c.id,c.role_id,c.project_id,c.created_at,
   (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id=c.id) AS last_message_at
   FROM conversations c WHERE c.role_id=$1
   ORDER BY COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id=c.id),c.created_at) DESC,c.id DESC
   LIMIT 50`,[role]);
  res.json({conversations:q.rows,source:'postgresql'});
 }catch(e){sendError(res,e)}
});
app.get('/api/conversations/:id/messages',async(req,res)=>{
 const id=req.params.id;
 if(!uuid(id))return res.status(400).json({error:'invalid_conversation_id'});
 try{
  const c=await db.query('SELECT id,role_id,project_id,created_at FROM conversations WHERE id=$1',[id]);
  if(!c.rowCount)return res.status(404).json({error:'conversation_not_found'});
  const q=await db.query(`SELECT id,speaker,body,created_at FROM (
    SELECT id,speaker,body,created_at FROM messages WHERE conversation_id=$1
    ORDER BY created_at DESC,id DESC LIMIT 100
   ) recent ORDER BY created_at,id`,[id]);
  res.json({conversation:c.rows[0],messages:q.rows,source:'postgresql',truncated:q.rows.length===100});
 }catch(e){sendError(res,e)}
});
app.post('/api/chat',async(req,res)=>{
 const role=txt(req.body?.role_id,32)||'chief_of_staff',prompt=txt(req.body?.message,4000);
 const conversationId=req.body?.conversation_id||null,projectId=req.body?.project_id||null;
 if(!ROLES[role]||!prompt|| (conversationId&&!uuid(conversationId))||(projectId&&!uuid(projectId))) return res.status(400).json({error:'invalid_chat_request'});
 try {
  let conversation=conversationId;
  let history=[];
  if(conversation){
   const c=await db.query('SELECT id,role_id,project_id FROM conversations WHERE id=$1',[conversation]);
   if(!c.rowCount || c.rows[0].role_id!==role || (projectId&&c.rows[0].project_id!==projectId)) return res.status(404).json({error:'conversation_not_found'});
   const q=await db.query('SELECT speaker,body FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 16',[conversation]);
   history=q.rows.reverse().map(row=>({role:row.speaker,content:row.body}));
  } else {
   if(projectId){const p=await db.query('SELECT id FROM projects WHERE id=$1',[projectId]);if(!p.rowCount)return res.status(404).json({error:'project_not_found'});}
   const c=await db.query('INSERT INTO conversations(project_id,role_id) VALUES($1,$2) RETURNING id',[projectId,role]);conversation=c.rows[0].id;
  }
  // A reply remains advice; the shared durable daily-call quota applies here too.
  let reply;
  try{
   reply=await askModel({role,maxTokens:1100,messages:[...history,{role:'user',content:prompt}]});
  }catch(e){
   if(e instanceof AiGatewayError && e.message==='ai_daily_limit_reached')return res.status(429).json({error:'ai_daily_limit_reached'});
   if(e instanceof AiGatewayError && e.message==='ai_disabled_by_ceo')return res.status(503).json({error:'ai_disabled_by_ceo'});
   if(e instanceof AiGatewayError && ['ai_daily_usd_budget_reached','ai_monthly_usd_budget_reached'].includes(e.message))return res.status(429).json({error:e.message});
   if(e instanceof AiGatewayError && e.message==='ai_model_pricing_unconfigured')return res.status(503).json({error:'ai_model_pricing_unconfigured'});
   if(e instanceof AiGatewayError){
    // Only share safe categories; never expose private model response or API credentials.
    const upstream=/^ai_upstream_http_(\d{3})$/.exec(e.message);
    const status=upstream?Number(upstream[1]):null;
    if(status===401)return res.status(502).json({error:'ai_key_invalid'});
    if(status===403)return res.status(502).json({error:'ai_permission_denied'});
    if(status===429)return res.status(502).json({error:'ai_quota_or_rate_limit'});
    if(status===400||status===404)return res.status(502).json({error:'ai_model_or_request_invalid'});
    if(e.message==='ai_timeout')return res.status(504).json({error:'ai_timeout'});
    return res.status(502).json({error:'ai_unavailable'});
   }
   throw e;
  }
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   await client.query('INSERT INTO messages(conversation_id,speaker,body) VALUES($1,$2,$3),($1,$4,$5)',[conversation,'user',prompt,'assistant',reply]);
   await record(client,'chat.replied','conversation',conversation,{role});
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  res.json({conversation_id:conversation,role_id:role,reply,usage:null,notice:'AI 回覆僅為建議；未自動建立、核准或執行任何工作。'});
 }catch(e){sendError(res,e);}
});
app.use('/api',(_req,res)=>res.status(404).json({error:'not_found'}));
const frontendRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../frontend');
app.use(express.static(frontendRoot,{index:false,etag:true,maxAge:'5m'}));
app.get('/',(_req,res)=>res.sendFile(path.join(frontendRoot,'index.html')));
app.use((_req,res)=>res.status(404).send('Not Found'));
app.use((err,_req,res,_next)=>{if(err?.type==='entity.too.large')return res.status(413).json({error:'payload_too_large'});res.status(400).json({error:'invalid_json'});});
const port=Number(process.env.PORT||8787);
app.listen(port,()=>console.log('SKAI V0.5 alpha listening on '+port));
