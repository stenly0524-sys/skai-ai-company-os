import { systemPrompt } from './roles.js';
import { reserveAiCall, finalizeAiCall } from './operations.js';
import { activeCompanySop,companySopSystemRules } from './governance.js';
import {reserveCost,settleCost} from './cost-control.js';
let usageDb=null;
export function configureAiUsage(db){usageDb=db;}
export class AiGatewayError extends Error{
 constructor(message){super(message);this.name='AiGatewayError'}
}
export async function askModel({role,messages,maxTokens=1400,format}){
 if(!usageDb)throw new AiGatewayError('ai_usage_db_not_configured');
 let sop;
 try{sop=await activeCompanySop(usageDb);}
 catch(e){throw new AiGatewayError('approved_sop_unavailable');}
 const request={
  model:process.env.OPENAI_MODEL||'gpt-4.1-mini',
  messages:[{role:'system',content:systemPrompt(role)+companySopSystemRules(sop,role)},...messages],
  max_completion_tokens:maxTokens
 };
 if(format==='json')request.response_format={type:'json_object'};
 let costReservation;
 try{costReservation=await reserveCost(usageDb,{model:request.model,messages:request.messages,maxOutputTokens:maxTokens})}
 catch(e){
  const known=['ai_disabled_by_ceo','ai_daily_usd_budget_reached','ai_monthly_usd_budget_reached','ai_model_pricing_unconfigured'];
  throw new AiGatewayError(known.includes(e.message)?e.message:'ai_budget_unavailable');
 }
 let usageDay;
 try{usageDay=await reserveAiCall(usageDb)}
 catch(e){
  try{await settleCost(usageDb,costReservation,{notSent:true})}
  catch(err){console.error('AI reserved cost release error:',err?.message||err)}
  throw new AiGatewayError(['ai_daily_limit_reached','ai_disabled_by_ceo'].includes(e.message)?e.message:'ai_budget_unavailable');
 }
 let succeeded=false,usage=null;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),30000);
 try{
  const response=await fetch('https://api.openai.com/v1/chat/completions',{
   method:'POST',signal:controller.signal,
   headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify(request)
  });
  if(!response.ok)throw new AiGatewayError('ai_upstream_http_'+response.status);
  const payload=await response.json();
  usage=payload.usage;
  const output=payload?.choices?.[0]?.message?.content;
  if(typeof output!=='string'||!output.trim())throw new AiGatewayError('empty_ai_response');
  succeeded=true;
  return output.trim();
 }catch(e){if(e.name==='AbortError')throw new AiGatewayError('ai_timeout');throw e}
 finally{
  clearTimeout(timeout);
  try{await settleCost(usageDb,costReservation,{usage})}
  catch(e){console.error('AI USD budget settlement error:',e?.message||e)}
  try{await finalizeAiCall(usageDb,usageDay,usage,succeeded)}
  catch(e){console.error('AI usage finalization error:',e?.message||e)}
 }
}
