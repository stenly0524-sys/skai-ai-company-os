import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=express();
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use(express.json({limit:'80kb'}));
app.use((_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','strict-origin-when-cross-origin');res.set('X-Frame-Options','DENY');res.set('Cache-Control','no-store');next();});
const {DATABASE_URL,CEO_PASSWORD_HASH,CEO_PASSWORD_SALT}=process.env;
if(!DATABASE_URL||!CEO_PASSWORD_HASH||!CEO_PASSWORD_SALT)throw Error('DATABASE_URL / CEO_PASSWORD_HASH / CEO_PASSWORD_SALT required');
if(!/^[0-9a-f]{128}$/i.test(CEO_PASSWORD_HASH))throw Error('CEO_PASSWORD_HASH must be a 64-byte hexadecimal scrypt hash');
const pool=new pg.Pool({connectionString:DATABASE_URL,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,ssl:{rejectUnauthorized:true}});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const newToken=()=>crypto.randomBytes(32).toString('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const bad=(res,status,message)=>res.status(status).json({error:message});
const cookieValue=req=>{const pair=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('skai_session='));return pair?.slice(13)||'';};
const secureCookie=(value,maxAge)=>'skai_session='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
const sessionHours=12;
const attempts=new Map();
function rateLimit(req,res,next){
 const ip=req.ip||'unknown',now=Date.now(),v=attempts.get(ip)||{n:0,start:now};
 if(now-v.start>15*60*1000){v.n=0;v.start=now;}
 if(v.n>=10)return bad(res,429,'登入嘗試過多，請稍後再試');
 req.loginBucket=v;req.loginKey=ip;next();
}
async function withTransaction(fn){
 const c=await pool.connect();
 try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v;}
 catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function auth(req,res,next){
 try{
  const token=cookieValue(req);
  if(!/^[a-f0-9]{64}$/.test(token))return bad(res,401,'請先登入 CEO');
  const {rows}=await pool.query('select csrf_hash,expires_at from ceo_sessions where token_hash=$1 and expires_at>now()',[sha(token)]);
  if(!rows.length)return bad(res,401,'登入已過期');
  req.sessionHash=sha(token);req.sessionCsrfHash=rows[0].csrf_hash;next();
 }catch(e){next(e);}
}
function csrf(req,res,next){
 const token=req.get('X-CSRF-Token')||'';
 if(!/^[a-f0-9]{64}$/.test(token)||!crypto.timingSafeEqual(Buffer.from(sha(token),'hex'),Buffer.from(req.sessionCsrfHash,'hex')))return bad(res,403,'CSRF 驗證失敗');
 const origin=req.get('Origin');if(origin){try{if(new URL(origin).host!==req.get('Host'))return bad(res,403,'來源驗證失敗');}catch{return bad(res,403,'來源驗證失敗');}}
 next();
}
function bodyText(v,max){return typeof v==='string'&&v.length<=max?v:null;}
async function audit(c,event,targetType,targetId,details={}){
 await c.query('insert into audit_log(actor,event,target_type,target_id,details) values ($1,$2,$3,$4,$5::jsonb)',['ceo',event,targetType,targetId,JSON.stringify(details)]);
}
const route=handler=>(req,res,next)=>Promise.resolve(handler(req,res)).catch(next);
app.post('/api/session/login',rateLimit,route(async(req,res)=>{
 const password=req.body?.password;
 if(typeof password!=='string'||password.length>1024)return bad(res,400,'密碼格式錯誤');
 const actual=crypto.scryptSync(password,CEO_PASSWORD_SALT,64),expected=Buffer.from(CEO_PASSWORD_HASH,'hex');
 if(!crypto.timingSafeEqual(actual,expected)){req.loginBucket.n++;attempts.set(req.loginKey,req.loginBucket);return bad(res,401,'登入失敗');}
 attempts.delete(req.loginKey);
 const token=newToken(),csrfToken=newToken();
 await pool.query("insert into ceo_sessions(token_hash,csrf_hash,expires_at) values ($1,$2,now()+interval '12 hours')",[sha(token),sha(csrfToken)]);
 res.set('Set-Cookie',secureCookie(token,sessionHours*3600));
 res.json({csrf_token:csrfToken,expires_in_seconds:sessionHours*3600});
}));
app.get('/api/session',auth,route(async(req,res)=>{
 const csrfToken=newToken();
 await pool.query('update ceo_sessions set csrf_hash=$1,last_seen_at=now() where token_hash=$2',[sha(csrfToken),req.sessionHash]);
 res.json({csrf_token:csrfToken});
}));
app.post('/api/session/logout',auth,csrf,route(async(req,res)=>{
 await pool.query('delete from ceo_sessions where token_hash=$1',[req.sessionHash]);
 res.set('Set-Cookie',secureCookie('',0));res.json({ok:true});
}));
const api=express.Router();
api.use(auth);
api.get('/dashboard',route(async(_req,res)=>{
 const [p,t,a]=await Promise.all([
  pool.query("select count(*)::int n from projects where status<>'closed'"),
  pool.query("select count(*)::int n from tasks where status in ('approved','in_progress','review','paused')"),
  pool.query("select count(*)::int n from approvals where status='pending'")]);
 res.json({counts:{projects:p.rows[0].n,active:t.rows[0].n,pending:a.rows[0].n}});
}));
api.get('/projects',route(async(_req,res)=>res.json({projects:(await pool.query('select id,name,goal,stage,status,progress,notes,created_at,updated_at from projects order by created_at desc limit 500')).rows})));
api.get('/tasks',route(async(_req,res)=>res.json({tasks:(await pool.query('select id,project_id,title,brief,assigned_role,status,progress,created_at,updated_at from tasks order by created_at desc limit 5000')).rows})));
api.get('/approvals',route(async(_req,res)=>res.json({approvals:(await pool.query("select a.id,a.task_id,t.project_id,t.title,a.status,a.created_at from approvals a join tasks t on t.id=a.task_id where a.status='pending' order by a.created_at desc limit 1000")).rows})));
api.get('/documents',route(async(_req,res)=>res.json({documents:(await pool.query('select id,project_id,name,url,category,created_at from project_documents order by created_at desc limit 2000')).rows})));
api.get('/activity',route(async(_req,res)=>{
 const {rows}=await pool.query('select id,event,target_type,target_id,details,created_at from audit_log order by created_at desc limit 200');
 res.json({activity:rows.map(x=>({id:x.id,project_id:x.details?.project_id||((x.target_type==='project')?x.target_id:null),description:x.details?.description||x.event,created_at:x.created_at}))});
}));
api.get('/operations/notifications',route(async(_req,res)=>res.json({notifications:(await pool.query('select id,title,body,severity,status,created_at from notification_events order by created_at desc limit 100')).rows})));
api.use(csrf);
api.post('/projects',route(async(req,res)=>{
 const name=bodyText(req.body?.name,120),goal=bodyText(req.body?.goal??'',8000);
 if(!name?.trim()||goal===null)return bad(res,400,'專案內容格式錯誤');
 const result=await withTransaction(async c=>{
  const r=await c.query('insert into projects(name,goal) values($1,$2) returning *',[name.trim(),goal]);
  await audit(c,'project.created','project',r.rows[0].id,{description:'建立專案：'+name.trim(),project_id:r.rows[0].id});return r.rows[0];
 });res.status(201).json({project:result});
}));
api.patch('/projects/:id',route(async(req,res)=>{
 if(!uuid(req.params.id))return bad(res,400,'專案編號格式錯誤');
 const {stage,progress,notes}=req.body||{};
 if(!['draft','planning','active','paused','completed'].includes(stage)||!Number.isInteger(progress)||progress<0||progress>100||bodyText(notes,3000)===null)return bad(res,400,'更新資料格式錯誤');
 const p=await withTransaction(async c=>{
  const r=await c.query("update projects set stage=$2,progress=$3,notes=$4,status=case when $2='completed' then 'closed' when $2='paused' then 'paused' else 'planning' end,updated_at=now() where id=$1 returning *",[req.params.id,stage,progress,notes]);
  if(!r.rows.length)return null;
  await audit(c,'project.updated','project',req.params.id,{project_id:req.params.id,description:'更新專案進度：'+progress+'%',stage,progress});return r.rows[0];
 });if(!p)return bad(res,404,'找不到專案');res.json({project:p});
}));
api.post('/tasks',route(async(req,res)=>{
 const {project_id}=req.body||{},title=bodyText(req.body?.title,160),brief=bodyText(req.body?.brief??'',8000);
 if(!uuid(project_id)||!title?.trim()||brief===null)return bad(res,400,'任務格式錯誤');
 const created=await withTransaction(async c=>{
  const p=await c.query('select id from projects where id=$1',[project_id]);if(!p.rows.length)return null;
  const t=await c.query('insert into tasks(project_id,title,brief) values($1,$2,$3) returning *',[project_id,title.trim(),brief]);
  const a=await c.query('insert into approvals(task_id) values($1) returning *',[t.rows[0].id]);
  await audit(c,'task.created','task',t.rows[0].id,{project_id,description:'建立任務：'+title.trim()});return {task:t.rows[0],approval:a.rows[0]};
 });if(!created)return bad(res,404,'找不到專案');res.status(201).json(created);
}));
api.post('/approvals/:id/decision',route(async(req,res)=>{
 const {decision}=req.body||{};
 if(!uuid(req.params.id)||!['approved','rejected'].includes(decision))return bad(res,400,'審批格式錯誤');
 const result=await withTransaction(async c=>{
  const a=await c.query("select a.id,a.task_id,t.project_id,t.title,t.status from approvals a join tasks t on a.task_id=t.id where a.id=$1 and a.status='pending' for update of a,t",[req.params.id]);
  if(!a.rows.length||a.rows[0].status!=='proposed')return null;
  await c.query('update approvals set status=$2,decided_at=now() where id=$1',[req.params.id,decision]);
  await c.query('update tasks set status=$2,updated_at=now() where id=$1',[a.rows[0].task_id,decision]);
  await audit(c,'task.decision','task',a.rows[0].task_id,{project_id:a.rows[0].project_id,description:(decision==='approved'?'核准':'駁回')+'任務：'+a.rows[0].title});
  return {id:req.params.id,status:decision};
 });if(!result)return bad(res,409,'審批已處理或任務狀態不正確');res.json({approval:result});
}));
api.patch('/tasks/:id',route(async(req,res)=>{
 const {status,progress}=req.body||{};
 if(!uuid(req.params.id)||!['approved','in_progress','review','done','paused'].includes(status)||!Number.isInteger(progress)||progress<0||progress>100||(status==='done'&&progress!==100))return bad(res,400,'任務狀態或進度不正確');
 const result=await withTransaction(async c=>{
  const t=await c.query("update tasks set status=$2,progress=$3,updated_at=now() where id=$1 and status not in ('proposed','rejected') returning *",[req.params.id,status,progress]);
  if(!t.rows.length)return null;
  await audit(c,'task.updated','task',req.params.id,{project_id:t.rows[0].project_id,description:'更新任務：'+t.rows[0].title+'｜'+status+'｜'+progress+'%'});return t.rows[0];
 });if(!result)return bad(res,409,'任務未核准或不存在');res.json({task:result});
}));
api.post('/documents',route(async(req,res)=>{
 const {project_id}=req.body||{},name=bodyText(req.body?.name,160),url=bodyText(req.body?.url,2000);
 let parsed;try{parsed=new URL(url)}catch{return bad(res,400,'無效的文件網址');}
 if(!uuid(project_id)||!name?.trim()||parsed.protocol!=='https:')return bad(res,400,'文件資訊格式錯誤');
 const result=await withTransaction(async c=>{
  const p=await c.query('select id from projects where id=$1',[project_id]);if(!p.rows.length)return null;
  const r=await c.query('insert into project_documents(project_id,name,url) values($1,$2,$3) returning *',[project_id,name.trim(),parsed.href]);
  await audit(c,'document.created','document',r.rows[0].id,{project_id,description:'新增文件連結：'+name.trim()});return r.rows[0];
 });if(!result)return bad(res,404,'找不到專案');res.status(201).json({document:result});
}));
api.delete('/documents/:id',route(async(req,res)=>{
 if(!uuid(req.params.id))return bad(res,400,'文件編號格式錯誤');
 const result=await withTransaction(async c=>{
  const r=await c.query('delete from project_documents where id=$1 returning *',[req.params.id]);
  if(!r.rows.length)return null;
  await audit(c,'document.removed','document',r.rows[0].id,{project_id:r.rows[0].project_id,description:'移除文件連結：'+r.rows[0].name});return r.rows[0];
 });if(!result)return bad(res,404,'找不到文件');res.json({document:result});
}));
app.use('/api',api);
app.use('/api',(req,res)=>bad(res,501,'此 API 尚未啟用'));
const here=path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(here,'../v05-preview'),{index:'index.html',maxAge:0}));
app.get('/healthz',(_req,res)=>res.json({ok:true}));
app.use((err,_req,res,_next)=>{console.error('[SKAI server error]',err.code||err.name);if(!res.headersSent)bad(res,500,'伺服器發生錯誤');});
const port=Number(process.env.PORT||3000);
app.listen(port,'0.0.0.0',()=>console.log('SKAI backend listening on port '+port));
