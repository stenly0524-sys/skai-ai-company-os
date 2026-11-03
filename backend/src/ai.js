import { systemPrompt } from './roles.js';
import { reserveAiCall, finalizeAiCall } from './operations.js';
let usageDb=null;
export function configureAiUsage(db){usageDb=db;}
export class AiGatewayError extends Error{
 constructor(message){super(message);this.name='AiGatewayError'}
}
export async function askModel({role,messages,maxTokens=1400,format}){
 if(!usageDb)throw new AiGatewayError('ai_usage_db_not_configured');
 let usageDay;
 try{usageDay=await reserveAiCall(usageDb)}catch(e){throw new AiGatewayError(e.message==='ai_daily_limit_reached'?'ai_daily_limit_reached':'ai_budget_unavailable')}
 let succeeded=false, usage=null;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),30000);
 try{
  const request={
   model:process.env.OPENAI_MODEL||'gpt-4.1-mini',
   messages:[{role:'system',content:systemPrompt(role)},...messages],
   max_completion_tokens:maxTokens
  };
  if(format==='json')request.response_format={type:'json_object'};
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
 finally{clearTimeout(timeout);try{await finalizeAiCall(usageDb,usageDay,usage,succeeded)}catch(e){console.error('AI budget finalization error:',e?.message||e)}}
}
