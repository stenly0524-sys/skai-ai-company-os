import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDetailedPlan,estimateDetailedPlan,chiefPlanPrompt} from '../src/chief-plans.js';
const valid={summary:'優先評估門店經濟性與現金流',steps:[
 {role_id:'finance',instruction:'建立有來源標記的營收及損益試算',estimated_minutes:12,max_output_tokens:1800},
 {role_id:'operations',instruction:'提出現場日常營運 SOP 及配置',estimated_minutes:8,max_output_tokens:1000}
]};
test('chief must assign executable concrete instructions, departments, time and token caps',()=>{
 assert.deepEqual(validateDetailedPlan(valid).steps.map(x=>x.role_id),['finance','operations']);
 assert.throws(()=>validateDetailedPlan({...valid,steps:[{...valid.steps[0],role_id:'chief_of_staff'}]}),/invalid_plan_role/);
 assert.throws(()=>validateDetailedPlan({...valid,steps:[{...valid.steps[0],estimated_minutes:'15'}]}),/invalid_estimated_minutes/);
 assert.throws(()=>validateDetailedPlan({...valid,steps:[{...valid.steps[0],max_output_tokens:9999}]}),/invalid_output_token_budget/);
 assert.throws(()=>validateDetailedPlan({...valid,steps:[]}),/invalid_plan_steps/);
});
test('forecast totals are deterministic, calculated from output caps and known price, not invented AI spend',()=>{
 const forecast=estimateDetailedPlan(validateDetailedPlan(valid),{taskTitle:'埔里店',taskBrief:'預估財務風險'});
 assert.equal(forecast.estimate.total_minutes,20);
 assert.equal(forecast.estimate.estimated_output_tokens,2800);
 assert.equal(forecast.estimate.total_tokens,forecast.estimate.estimated_input_tokens+2800);
 assert.ok(forecast.estimate.estimated_usd>0);
 assert.equal(forecast.estimate.currency,'USD');
 assert.equal(forecast.estimate.confidence,'low');
 assert.equal(forecast.steps.length,2);
 assert.throws(()=>estimateDetailedPlan(validateDetailedPlan(valid),{model:'unpriced-model'}),/ai_model_pricing_unconfigured/);
});
test('chief revision prompt communicates prior plan, CEO time and budget constraints without approval',()=>{
 const text=chiefPlanPrompt({title:'研究咖啡市場',brief:'只做內部規劃',project_goal:'建立健康品牌'},{
  feedback:'太貴，請省下 50% Token 和時間',
  previous:valid
 });
 assert.match(text,/太貴/);
 assert.match(text,/前一版計畫/);
 assert.match(text,/max_output_tokens/);
 assert.match(text,/不操作外部系統/);
});
