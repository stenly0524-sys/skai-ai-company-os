// Pure workflow guards: proposals never run without an explicit CEO decision.
export const TASK_STATES=Object.freeze(['proposed','approved','in_progress','review','done','rejected','paused']);
const ALLOWED=Object.freeze({
 proposed:['approved','rejected'],
 approved:['in_progress','paused'],
 in_progress:['review','paused'],
 review:['done','in_progress','paused'],
 paused:['approved','in_progress','rejected'],
 rejected:[],
 done:[]
});
export function canTransition(from,to){
 return typeof from==='string'&&typeof to==='string'&&Boolean(ALLOWED[from]?.includes(to));
}
export function requireTransition(from,to){
 if(!canTransition(from,to)) throw new Error('invalid_task_transition:'+from+'->'+to);
 return to;
}
export function approvalDecision(value){
 if(value!=='approved'&&value!=='rejected')throw new Error('invalid_approval_decision');
 return value;
}
export function requireCeoApproval(task){
 if(!task || task.status!=='approved') throw new Error('ceo_approval_required');
 return true;
}
