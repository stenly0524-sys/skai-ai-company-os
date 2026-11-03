import express from 'express';
import pg from 'pg';
import { ROLES, systemPrompt } from './roles.js';
import { tokenMatches, validOrigin, validUuid, compactText } from './security.js';
import { approvalDecision } from './workflow.js';
import { orchestrationRouter } from './orchestration.js';

const { Pool } = pg;
const required = ['DATABASE_URL', 'SKAI_ADMIN_TOKEN', 'OPENAI_API_KEY'];
for (const key of required) if (!process.env[key] || process.env[key].startsWith('replace-')) throw new Error('Missing secure configuration: ' + key);
if (process.env.SKAI_ADMIN_TOKEN.length < 32) throw new Error('SKAI_ADMIN_TOKEN must be at least 32 characters');
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true }, max: 5 });
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
app.get('/health', async (_req,res) => {
 try { await db.query('SELECT 1'); res.json({ ok: true, service: 'SKAI V0.5 alpha' }); }
 catch { res.status(503).json({ error: 'database_unavailable' }); }
});
app.use('/api', (req,res,next) => {
 const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);
 if(!validOrigin(req.get('origin'), allowedOrigins))return res.status(403).json({error:'origin_not_allowed'});
 const authorization = req.get('authorization') || '';
 if (!authorization.startsWith('Bearer ') || !sameSecret(authorization.slice(7))) return res.status(401).json({ error:'unauthorized' });
 next();
});
const sendError = (res,e) => { console.error('SKAI API error:', e?.code || e?.message || e); res.status(500).json({error:'internal_error'}); };
const txt = compactText;
const uuid = validUuid;
const record = async (client,event,type,id,details={}) => client.query(
 'INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',
 ['ceo',event,type,id,JSON.stringify(details)]
);
app.use('/api/orchestrations', orchestrationRouter(db));
app.get('/api/roles', (_req,res) => res.json({ roles: Object.entries(ROLES).map(([id, r]) => ({ id,...r })) }));
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
  // No external actions: a model reply is a proposal, not an executed task.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  let result;
  try{
   const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',temperature:0.3,max_completion_tokens:1100,messages:[{role:'system',content:systemPrompt(role)},...history,{role:'user',content:prompt}]})});
   if(!response.ok){console.error('AI upstream status:',response.status);return res.status(502).json({error:'ai_upstream_failed'});}
   result=await response.json();
  }finally{clearTimeout(timer);}
  const reply=txt(result?.choices?.[0]?.message?.content,10000);
  if(!reply)return res.status(502).json({error:'empty_ai_response'});
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   await client.query('INSERT INTO messages(conversation_id,speaker,body) VALUES($1,$2,$3),($1,$4,$5)',[conversation,'user',prompt,'assistant',reply]);
   await record(client,'chat.replied','conversation',conversation,{role});
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  res.json({conversation_id:conversation,role_id:role,reply,usage:result?.usage||null,notice:'AI 回覆僅為建議；未自動建立、核准或執行任何工作。'});
 }catch(e){sendError(res,e);}
});
app.use((_req,res)=>res.status(404).json({error:'not_found'}));
app.use((err,_req,res,_next)=>{if(err?.type==='entity.too.large')return res.status(413).json({error:'payload_too_large'});res.status(400).json({error:'invalid_json'});});
const port=Number(process.env.PORT||8787);
app.listen(port,()=>console.log('SKAI V0.5 alpha listening on '+port));
