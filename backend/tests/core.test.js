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
