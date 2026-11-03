// Real PostgreSQL + HTTP integration smoke: no OpenAI requests, no external side effects.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const base='http://127.0.0.1:8787';
const env={...process.env,PORT:'8787',NODE_ENV:'development',DATABASE_SSL:'false',
 SKAI_ADMIN_TOKEN:'test_dev_token_abcdefghijklmnopqrstuvwxyz_123',
 SKAI_CEO_PASSWORD:'test_ceo_password_abcdefghijklmnopqrstuvwxyz',
 OPENAI_API_KEY:'sk-fake-ci-not-a-real-secret',
 SKAI_DAILY_AI_CALL_LIMIT:'2'};
if(!env.DATABASE_URL)throw Error('DATABASE_URL required for integration tests');
const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('../',import.meta.url),env,stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>{logs+=String(x)});child.stderr.on('data',x=>{logs+=String(x)});
async function call(path,{method='GET',body,cookie,csrf,origin}={}){
 const headers={Accept:'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(cookie)headers.Cookie=cookie;
 if(csrf)headers['X-CSRF-Token']=csrf;
 if(origin)headers.Origin=origin;
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const json=await response.json();
 return {status:response.status,headers:response.headers,body:json};
}
try{
 let ready=false;
 for(let i=0;i<45;i++){
  if(child.exitCode!==null)throw Error('server stopped: '+logs);
  try{const h=await call('/health');if(h.status===200){ready=true;break}}catch{}
  await delay(250);
 }
 assert.ok(ready,'server did not become ready: '+logs);
 const noSession=await call('/api/projects');
 assert.equal(noSession.status,401);
 const badOrigin=await call('/api/session/login',{method:'POST',origin:'https://evil.invalid',body:{password:env.SKAI_CEO_PASSWORD}});
 assert.equal(badOrigin.status,403);
 const login=await call('/api/session/login',{method:'POST',body:{password:env.SKAI_CEO_PASSWORD}});
 assert.equal(login.status,200,JSON.stringify(login.body));
 const cookie=login.headers.get('set-cookie').split(';')[0],csrf=login.body.csrf_token;
 assert.ok(cookie.includes('skai_session='));
 const missingCsrf=await call('/api/projects',{method:'POST',cookie,body:{name:'Must fail'}});
 assert.equal(missingCsrf.status,403);
 const created=await call('/api/projects',{method:'POST',cookie,csrf,body:{name:'CI 專案',goal:'測試資料保存'}});
 assert.equal(created.status,201,JSON.stringify(created.body));
 const projectId=created.body.project.id;
 const listed=await call('/api/projects',{cookie});
 assert.equal(listed.status,200);
 assert.ok(listed.body.projects.some(p=>p.id===projectId));
 const task=await call('/api/tasks',{method:'POST',cookie,csrf,body:{project_id:projectId,title:'CI 任務',brief:'經 CEO 審批'}});
 assert.equal(task.status,201,JSON.stringify(task.body));
 assert.equal(task.body.task.status,'proposed');
 const approvalId=task.body.approval.id;
 const pending=await call('/api/approvals',{cookie});
 assert.ok(pending.body.approvals.some(x=>x.id===approvalId));
 const approved=await call('/api/approvals/'+approvalId+'/decision',{method:'POST',cookie,csrf,body:{decision:'approved'}});
 assert.equal(approved.status,200);
 assert.equal(approved.body.approval.status,'approved');
 const dashboard=await call('/api/dashboard',{cookie});
 assert.equal(dashboard.status,200);
 assert.ok(dashboard.body.counts.projects>=1);
 // Saved company conversations are readable only after CEO authentication.
 const missingConversationRole=await call('/api/conversations',{cookie});
 assert.equal(missingConversationRole.status,400);
 const db=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
 let conversationId;
 try {
  const row=await db.query('INSERT INTO conversations(role_id,project_id) VALUES($1,$2) RETURNING id',['finance',projectId]);
  conversationId=row.rows[0].id;
  await db.query("INSERT INTO messages(conversation_id,speaker,body,created_at) VALUES($1,'user',$2,NOW()-INTERVAL '1 second'),($1,'assistant',$3,NOW())",[conversationId,'測試財務資料保存','測試財務建議已保存']);
  const financeHistory=await call('/api/conversations?role_id=finance',{cookie});
  assert.equal(financeHistory.status,200);
  assert.ok(financeHistory.body.conversations.some(c=>c.id===conversationId));
  const otherRole=await call('/api/conversations?role_id=marketing',{cookie});
  assert.equal(otherRole.status,200);
  assert.ok(!otherRole.body.conversations.some(c=>c.id===conversationId));
  const persisted=await call('/api/conversations/'+conversationId+'/messages',{cookie});
  assert.equal(persisted.status,200);
  assert.equal(persisted.body.conversation.role_id,'finance');
  assert.deepEqual(persisted.body.messages.map(x=>x.body),['測試財務資料保存','測試財務建議已保存']);
  const badId=await call('/api/conversations/not-uuid/messages',{cookie});
  assert.equal(badId.status,400);
  const unauthenticated=await call('/api/conversations/'+conversationId+'/messages');
  assert.equal(unauthenticated.status,401);
 } finally {await db.end();}
 const restored=await call('/api/session',{cookie});
 assert.equal(restored.status,200);
 assert.ok(restored.body.csrf_token);
 const logout=await call('/api/session/logout',{method:'POST',cookie,csrf:restored.body.csrf_token});
 assert.equal(logout.status,200);
 const invalid=await call('/api/projects',{cookie});
 assert.equal(invalid.status,401);
 console.log('PASS: PostgreSQL migrations, HTTPS-ready CEO session contract, project/task/approval and AI conversation persistence, role-scoped history, CSRF, invalid session');
}finally{
 child.kill('SIGTERM');
 await delay(250);
}
