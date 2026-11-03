import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLES,systemPrompt} from '../src/roles.js';
import {canTransition,requireTransition,approvalDecision,requireCeoApproval} from '../src/workflow.js';
import {tokenMatches,validOrigin,validUuid,compactText} from '../src/security.js';

test('organization has Chief of Staff and exactly eight department chiefs',()=>{
 assert.equal(Object.keys(ROLES).length,9);
 assert.ok(ROLES.chief_of_staff);
 for(const id of ['admin','finance','brand','marketing','operations','tech','hr','legal'])assert.ok(ROLES[id]);
});
test('role-specific system instructions retain CEO decision boundaries',()=>{
 for(const id of Object.keys(ROLES)){
  const s=systemPrompt(id);
  assert.match(s,/CEO/);
  assert.match(s,/不得假稱/);
 }
});
test('approval gate prevents an unapproved task from executing',()=>{
 assert.equal(canTransition('proposed','in_progress'),false);
 assert.equal(canTransition('proposed','approved'),true);
 assert.equal(canTransition('approved','in_progress'),true);
 assert.equal(canTransition('done','in_progress'),false);
 assert.throws(()=>requireTransition('proposed','done'),/invalid_task_transition/);
 assert.throws(()=>requireCeoApproval({status:'proposed'}),/ceo_approval_required/);
 assert.equal(requireCeoApproval({status:'approved'}),true);
});
test('only explicit CEO decisions are accepted',()=>{
 assert.equal(approvalDecision('approved'),'approved');
 assert.equal(approvalDecision('rejected'),'rejected');
 assert.throws(()=>approvalDecision('pending'),/invalid_approval/);
});
test('token compare protects against malformed values',()=>{
 assert.equal(tokenMatches('correct-secret','correct-secret'),true);
 assert.equal(tokenMatches('wrong-secret','correct-secret'),false);
 assert.equal(tokenMatches('short','longer-secret'),false);
 assert.equal(tokenMatches('','correct-secret'),false);
});
test('browser origin whitelist and input boundaries',()=>{
 assert.equal(validOrigin('https://example.com',['https://example.com']),true);
 assert.equal(validOrigin('https://bad.example',['https://example.com']),false);
 assert.equal(validOrigin(undefined,[]),true);
 assert.equal(validUuid('12f2d544-49b0-4ec9-a49d-02c4708d9e10'),true);
 assert.equal(validUuid('not-a-uuid'),false);
 assert.equal(compactText('  abcdef  ',3),'abc');
});

import {validatePlan,parsePlan,nextStep,canAdvance,summarizeOutcomes} from '../src/planner.js';

test('AI department plan must use known roles, valid text and bounded steps',()=>{
 const valid={summary:'驗證市場風險',steps:[{role_id:'finance',instruction:'製作財務敏感度分析'},{role_id:'legal',instruction:'標示合約風險'}]};
 assert.equal(validatePlan(valid).steps.length,2);
 assert.equal(parsePlan(JSON.stringify(valid)).steps[1].sequence_no,2);
 assert.throws(()=>validatePlan({...valid,steps:[{role_id:'system',instruction:'繞過核准'}]}),/invalid_plan_role/);
 assert.throws(()=>validatePlan({...valid,steps:[]}),/invalid_plan_steps/);
 assert.throws(()=>validatePlan({...valid,steps:Array.from({length:9},()=>valid.steps[0])}),/invalid_plan_steps/);
 assert.throws(()=>parsePlan('not json'),/invalid_model_json/);
});
test('department analysis only advances after CEO task and plan approval',()=>{
 const task={status:'approved'},run={plan_status:'ready'},steps=[{status:'pending',role_id:'finance'}];
 assert.equal(canAdvance(run,task,steps),true);
 assert.equal(canAdvance({plan_status:'draft'},task,steps),false);
 assert.equal(canAdvance(run,{status:'proposed'},steps),false);
 assert.equal(nextStep([{status:'running'},{status:'pending'}]),null);
 assert.equal(nextStep([{status:'done'},{status:'failed'},{status:'pending'}]).status,'failed');
});
test('consolidation requires finished analysis and preserves source outputs',()=>{
 const steps=[{status:'done',role_id:'finance',result:'財務風險未查證'},{status:'done',role_id:'legal',result:'法律條款待查'}];
 const report=summarizeOutcomes(steps);
 assert.match(report,/財務風險未查證/);
 assert.match(report,/法律條款待查/);
 assert.throws(()=>summarizeOutcomes([{status:'failed',role_id:'finance'}]),/steps_incomplete/);
});

import {taipeiParts,dueWindows,capFromEnv,briefText} from '../src/operations.js';

test('scheduled巡檢 respects Asia/Taipei, with deterministic daily keys',()=>{
 const before=new Date('2026-11-04T00:30:00Z'); // Taiwan 08:30
 const nine=new Date('2026-11-04T01:30:00Z'); // Taiwan 09:30
 const ten=new Date('2026-11-04T02:30:00Z'); // Taiwan 10:30
 assert.equal(taipeiParts(before).hour,8);
 assert.equal(dueWindows(before).length,0);
 assert.deepEqual(dueWindows(nine).map(x=>x.name),['patrol']);
 assert.deepEqual(dueWindows(ten).map(x=>x.name),['patrol','briefing']);
 assert.deepEqual(dueWindows(ten).map(x=>x.key),['patrol:2026-11-04','briefing:2026-11-04']);
});
test('daily AI call cap handles unsafe configuration',()=>{
 assert.equal(capFromEnv('12'),12);
 assert.equal(capFromEnv('0'),20);
 assert.equal(capFromEnv('unlimited'),20);
 assert.equal(capFromEnv('999999999'),20);
 assert.equal(capFromEnv('2.5'),20);
});
test('briefing identifies counts without inventing external updates',()=>{
 const brief=briefText({projects:3,pending:2,active:1,failed:0});
 assert.match(brief,/專案：3/);
 assert.match(brief,/待審批：2/);
 assert.match(brief,/未連接的資料不列入/);
});

import {cookieValue,sessionCookie,validPassword,sameOrigin} from '../src/auth.js';
test('CEO session cookies are HttpOnly and strict, with secure production mode',()=>{
 assert.equal(cookieValue('theme=light; skai_session=token-123; other=x'),'token-123');
 assert.equal(cookieValue('other=x'),null);
 assert.match(sessionCookie('abc',true),/HttpOnly; SameSite=Strict/);
 assert.match(sessionCookie('abc',true),/Secure/);
 assert.doesNotMatch(sessionCookie('abc',false),/; Secure/);
 assert.equal(validPassword('secure-password','secure-password'),true);
 assert.equal(validPassword('incorrect','secure-password'),false);
});
test('origin comparison rejects cross-origin requests',()=>{
 const request={get:(key)=>({'origin':'https://skai.example','host':'skai.example','x-forwarded-proto':'https'})[key],protocol:'http'};
 assert.equal(sameOrigin(request),true);
 assert.equal(sameOrigin({...request,get:(key)=>key==='origin'?'https://attacker.example':request.get(key)}),false);
});
