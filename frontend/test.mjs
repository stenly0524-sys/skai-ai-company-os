import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { EMPLOYEES } from './employees.js';
import { ROLES } from '../backend/src/roles.js';

test('UI has exactly the authorized nine AI characters',()=>{
 assert.equal(EMPLOYEES.length,9);
 assert.deepEqual(new Set(EMPLOYEES.map(x=>x.id)),new Set(Object.keys(ROLES)));
 for(const e of EMPLOYEES){
  assert.ok(e.name.length>0&&e.scope.length>0);
  assert.ok(e.x>=0&&e.x<=100&&e.y>=0&&e.y<=100);
 }
});
test('Apple-style layout includes iPhone landscape compatibility and accessible character actions',async()=>{
 const html=await fs.readFile(new URL('./index.html',import.meta.url),'utf8');
 const css=await fs.readFile(new URL('./styles.css',import.meta.url),'utf8');
 assert.match(html,/viewport-fit=cover/);
 assert.match(html,/officePeople/);
 assert.match(html,/employeeDialog/);
 assert.match(html,/CEO 指揮中心/);
 assert.match(html,/loginDialog/);
 assert.match(css,/max-width:1024px/);
 assert.match(css,/orientation:landscape/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/prefers-reduced-motion/);
});
test('UI does not embed backend admin credentials or fake real KPI values',async()=>{
 const js=await fs.readFile(new URL('./app.js',import.meta.url),'utf8');
 const html=await fs.readFile(new URL('./index.html',import.meta.url),'utf8');
 assert.doesNotMatch(js,/SKAI_ADMIN_TOKEN|OPENAI_API_KEY|Authorization:\s*Bearer/);
 assert.match(html,/等待連線/);
 assert.match(html,/未連線/);
});

test('UI calls only same-origin server endpoints, with no embedded secrets',async()=>{
 const app=await fs.readFile(new URL('./app.js',import.meta.url),'utf8');
 const transport=await fs.readFile(new URL('./api.js',import.meta.url),'utf8');
 assert.match(transport,/fetch\('\/api'/);
 assert.match(transport,/credentials:'same-origin'/);
 assert.match(transport,/X-CSRF-Token/);
 assert.match(app,/\/session\/login/);
 assert.match(app,/\/dashboard/);
});

import {localCompany} from './storage.js';
import {STORAGE_KEY,STORAGE_VERSION} from './data.js';
test('local-storage app supplies backup, project, tasks and CEO approval modules',async()=>{
 const storage=await fs.readFile(new URL('./storage.js',import.meta.url),'utf8');
 const api=await fs.readFile(new URL('./api.js',import.meta.url),'utf8');
 const app=await fs.readFile(new URL('./app.js',import.meta.url),'utf8');
 assert.match(storage,/localStorage/);
 assert.match(storage,/exportJson/);
 assert.match(storage,/importJson/);
 assert.match(api,/localRequest/);
 assert.match(api,/credentials:'same-origin'/);
 assert.match(app,/useLocalWorkspace/);
 assert.match(app,/useCloudWorkspace/);
 assert.match(app,/localCompany\.exportJson/);
 assert.ok(STORAGE_KEY.includes('skai_v05'));
 assert.equal(STORAGE_VERSION,1);
});

test('local company CRUD persists independently of the backend and requires CEO decision',()=>{
 const memory=new Map();
 globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,val)=>memory.set(key,String(val)),removeItem:key=>memory.delete(key)};
 try{
  const p=localCompany.createProject({name:'真實工作專案',goal:'整理供應鏈'});
  assert.equal(localCompany.projects().length,1);
  const created=localCompany.createTask({project_id:p.id,title:'確認供應商資料'});
  assert.equal(localCompany.dashboard().pending,1);
  assert.equal(localCompany.tasks()[0].status,'proposed');
  assert.equal(localCompany.decide(created.approval.id,'approved').status,'approved');
  assert.equal(localCompany.dashboard().pending,0);
  assert.equal(localCompany.tasks()[0].status,'approved');
  const exported=localCompany.exportJson();
  memory.clear();
  assert.equal(localCompany.projects().length,0);
  localCompany.importJson(exported);
  assert.equal(localCompany.projects()[0].name,'真實工作專案');
  assert.equal(localCompany.tasks()[0].status,'approved');
 }finally{delete globalThis.localStorage;}
});


test('CEO tasks embed a chief-of-staff plan with pre-execution approval and revision',async()=>{
 const html=await fs.readFile(new URL('./index.html',import.meta.url),'utf8');
 const app=await fs.readFile(new URL('./app.js',import.meta.url),'utf8');
 const backend=await fs.readFile(new URL('../backend/src/orchestration.js',import.meta.url),'utf8');
 assert.match(html,/id="page-tasks"/);
 assert.match(html,/id="chiefPlanPanel"/);
 assert.match(html,/id="orchestrationTask"/);
 assert.doesNotMatch(html,/id="page-orchestrations"/);
 assert.doesNotMatch(html,/data-page="orchestrations"/);
 assert.match(app,/orchestrations\/plan/);
 assert.match(app,/CEO 確認並核准執行/);
 assert.match(app,/請幕僚長重新調整方案/);
 assert.match(app,/CEO 直接修改分工與資源/);
 assert.match(app,/執行下一部門任務/);
 assert.match(backend,/api\.post\('\/:id\/revise'/);
 assert.match(backend,/api\.post\('\/:id\/edit'/);
 assert.match(backend,/SELECT r\.\*,t\.title AS task_title/);
});
