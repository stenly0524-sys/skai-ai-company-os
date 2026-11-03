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
 assert.match(app,/fetch\('\/api'/);
 assert.match(app,/credentials:'same-origin'/);
 assert.match(app,/X-CSRF-Token/);
 assert.match(app,/\/session\/login/);
 assert.match(app,/\/dashboard/);
});
