import test from 'node:test';
import assert from 'node:assert/strict';
import {companySopSystemRules} from '../src/governance.js';
test('no approved SOP does not create imaginary rules',()=>{
 assert.equal(companySopSystemRules(null,'legal'),'');
});
test('approved SOP only supplies sourced rules and explicit non-enabled abilities',()=>{
 const sop={policy_code:'SKAI-CORP-SOP-001',version:'V1.0',
  source_text:'第一章｜公司管理原則\n• 未經 CEO 核准不得執行重大變更。\n第二章｜組織\n9. 法務部\n負責契約審查。\n第三章｜任務執行\nCEO 核准後部門執行。\n第十章｜完成\n所有交付物須驗收。'};
 const result=companySopSystemRules(sop,'legal');
 assert.match(result,/SKAI-CORP-SOP-001 V1.0/);
 assert.match(result,/未經 CEO 核准/);
 assert.match(result,/法務部/);
 assert.match(result,/Google Drive 自動上傳/);
 assert.doesNotMatch(result,/法律審查已通過/);
});
