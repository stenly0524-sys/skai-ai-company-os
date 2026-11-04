import {ROLES,systemPrompt} from './roles.js';
import {estimateReservation,pricingFor} from './cost-control.js';
// This is a planning forecast, not actual clock time, billing or a promise.
export const MIN_STEP_MINUTES=1,MAX_STEP_MINUTES=240;
export function validateDetailedPlan(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_plan');
 if(typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>2000)throw Error('invalid_plan_summary');
 if(!Array.isArray(value.steps)||value.steps.length<1||value.steps.length>8)throw Error('invalid_plan_steps');
 const steps=value.steps.map((x,i)=>{
  if(!x||!ROLES[x.role_id]||x.role_id==='chief_of_staff')throw Error('invalid_plan_role_'+i);
  if(typeof x.instruction!=='string'||!x.instruction.trim()||x.instruction.length>2000)throw Error('invalid_plan_instruction_'+i);
  if(!Number.isInteger(x.estimated_minutes)||x.estimated_minutes<MIN_STEP_MINUTES||x.estimated_minutes>MAX_STEP_MINUTES)throw Error('invalid_estimated_minutes_'+i);
  if(!Number.isInteger(x.max_output_tokens)||x.max_output_tokens<600||x.max_output_tokens>2400)throw Error('invalid_output_token_budget_'+i);
  return {sequence_no:i+1,role_id:x.role_id,instruction:x.instruction.trim(),estimated_minutes:x.estimated_minutes,max_output_tokens:x.max_output_tokens};
 });
 return {summary:value.summary.trim(),steps};
}
export function estimateDetailedPlan(plan,{taskTitle='',taskBrief='',model='gpt-4.1-mini'}={}){
 const price=pricingFor(model);
 const steps=plan.steps.map(step=>{
  const sample=systemPrompt(step.role_id)+'\n'+taskTitle+'\n'+taskBrief+'\n'+step.instruction+
  '\n先前部門分析摘要（可能存在）';
  // Same upper-bound byte estimate used by USD gateway + extra room for previous department results.
  const inputTokens=Math.ceil((Buffer.byteLength(sample,'utf8')+512+8_000)*1.2);
  const usd=Math.ceil((inputTokens*price.input+step.max_output_tokens*price.output)/1_000_000*1_000_000)/1_000_000;
  return {...step,estimated_input_tokens:inputTokens,estimated_usd:usd};
 });
 const totalMinutes=steps.reduce((n,s)=>n+s.estimated_minutes,0);
 const inputTokens=steps.reduce((n,s)=>n+s.estimated_input_tokens,0);
 const outputTokens=steps.reduce((n,s)=>n+s.max_output_tokens,0);
 const usd=Math.ceil(steps.reduce((n,s)=>n+s.estimated_usd,0)*1_000_000)/1_000_000;
 return {steps,estimate:{total_minutes:totalMinutes,total_tokens:inputTokens+outputTokens,estimated_input_tokens:inputTokens,estimated_output_tokens:outputTokens,estimated_usd:usd,currency:'USD',model,confidence:'low',method:'sequential_department_analysis',notice:'時間是各部門順序分析的規劃估計，不是系統承諾；Token／美元為保守預估，不含本次或後續幕僚長修訂費用，實際執行仍受 CEO AI 預算及呼叫次數限制。'}};
}
export function chiefPlanPrompt(task,{feedback='',previous=null}={}){
 return '你是 SKAI AI 幕僚長。分析 CEO 所建立的任務，將工作拆成 1 至 8 個必要部門的具體工作。只回傳 JSON 物件，格式：'+
 '{"summary":"整體分析與工作範圍","steps":[{"role_id":"finance","instruction":"該部門需完成的具體任務、交付物及限制","estimated_minutes":8,"max_output_tokens":1200}]}。'+
 'role_id 限 admin,finance,brand,marketing,operations,tech,hr,legal。estimated_minutes 必須是 1 至 240 的整數；max_output_tokens 必須是 600 至 2400 的整數。'+
 '估算時間是執行期間的粗估分鐘，不是人類工時或完成承諾。為降低成本，僅分派真正必要的部門、避免重工。只做已核准的內部文字分析，不操作外部系統、不假稱已取得外部即時資料。'+
 '\n專案目標：'+String(task.project_goal||'')+'\n任務：'+String(task.title||'')+'\n說明：'+String(task.brief||'')+
 (previous?'\n前一版計畫：'+JSON.stringify(previous).slice(0,7000):'')+
 (feedback?'\nCEO 的最新修訂指示（必須優先處理）：'+feedback:'');
}
