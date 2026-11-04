import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES, systemPrompt } from './roles.js';
import { tokenMatches, validOrigin, validUuid, compactText } from './security.js';
import { approvalDecision } from './workflow.js';
import { orchestrationRouter } from './orchestration.js';
import { operationsRouter } from './ops-router.js';
import { askModel, configureAiUsage, AiGatewayError } from './ai.js';
import { authRouter } from './auth.js';

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
app.use('/api/operations', operationsRouter(db));
app.get('/api/roles', (_req,res) => res.json({ roles: Object.entries(ROLES).map(([id, r]) => ({ id,...r })) }));
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
 try { const q=await db.query('SELECT * FROM projects ORDER BY created_at DESC LIMIT 200');res.json({projects:q.rows}); }
 catch(e){sendError(res,e);}
});
app.post('/api/projects', async(req,res) => {
 const name=txt(req.body?.name,120),goal=txt(req.body?.goal,8000);
 if(!name) return res.status(400).json({error:'name_required'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query('INSERT INTO projects(name,goal) VALUES($1,$2) RETURNING *',[name,goal]);
  await record(client,'project.created','project',q.rows[0].id);
  await client.query('COMMIT');res.status(201).json({project:q.rows[0]});
 }catch(e){await client.query('ROLLBACK');sendError(res,e);}finally{client.release();}
});
app.get('/api/tasks', async(req,res) => {
 const projectId=req.query.project_id;
 if(projectId && !uuid(projectId))return res.status(400).json({error:'invalid_project_id'});
 try {const q=projectId ? await db.query('SELECT * FROM tasks WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200',[projectId])
 : await db.query('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200');res.json({tasks:q.rows});}
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
  const q=await client.query('INSERT INTO tasks(project_id,title,brief,assigned_role) VALUES($1,$2,$3,$4) RETURNING *',[projectId,title,brief,role]);
  const approval=await client.query('INSERT INTO approvals(task_id) VALUES($1) RETURNING *',[q.rows[0].id]);
  await record(client,'task.proposed','task',q.rows[0].id);
  await client.query('COMMIT');res.status(201).json({task:q.rows[0],approval:approval.rows[0]});
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
