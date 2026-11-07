import { ROLES } from './roles.js';

// Model output is *untrusted input*. Reject free-form authority or executable instructions.
export function validatePlan(value){
 if(!value||typeof value!=='object'||Array.isArray(value)) throw Error('invalid_plan');
 if(typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>2000)throw Error('invalid_plan_summary');
 if(!Array.isArray(value.steps)||value.steps.length<1||value.steps.length>8)throw Error('invalid_plan_steps');
 const steps=value.steps.map((s,i)=>{
  if(!s||typeof s!=='object'||!Object.hasOwn(ROLES,s.role_id)||s.role_id==='chief_of_staff')throw Error('invalid_plan_role_'+i);
  if(typeof s.instruction!=='string'||!s.instruction.trim()||s.instruction.length>2000)throw Error('invalid_plan_instruction_'+i);
  return {sequence_no:i+1,role_id:s.role_id,instruction:s.instruction.trim()};
 });
 return {summary:value.summary.trim(),steps};
}
export function nextStep(steps){
 if(!Array.isArray(steps))throw Error('invalid_steps');
 if(steps.some(s=>s.status==='running')) return null;
 return steps.find(s=>s.status==='failed'||s.status==='pending')||null;
}
export function canAdvance(run,task,steps){
 return Boolean(task?.status==='approved'||task?.status==='in_progress')
   && ['ready','running','paused','failed'].includes(run?.plan_status)
   && Boolean(nextStep(steps));
}
export function summarizeOutcomes(steps){
 if(!steps.length||steps.some(s=>s.status!=='done'))throw Error('steps_incomplete');
 return steps.map(s=>`【${ROLES[s.role_id].title}】\n${s.result}`).join('\n\n');
}
export function parsePlan(text){
 let raw;
 try{raw=JSON.parse(text)}catch{throw Error('invalid_model_json')}
 return validatePlan(raw);
}
