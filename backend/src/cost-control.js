// USD figures are conservative *internal estimates*, NOT official OpenAI invoices.
// Prices: OpenAI GPT-4.1 mini standard Chat Completions text (USD per million tokens).
// Non-cached input is assumed even if some input may be cached and cheaper.
// Unsupported model IDs fail closed; update published prices before switching models.
import {taipeiParts} from './operations.js';
export const MODEL_PRICES=Object.freeze({
 'gpt-4.1-mini':Object.freeze({input:0.40,output:1.60}),
 'gpt-4.1-mini-2025-04-14':Object.freeze({input:0.40,output:1.60})
});
export function pricingFor(model){
 if(!Object.hasOwn(MODEL_PRICES,model))throw Error('ai_model_pricing_unconfigured');
 return MODEL_PRICES[model];
}
function usdMicro(value){return Math.ceil((value-1e-12)*1_000_000)/1_000_000}
export function estimateReservation({model,messages,maxOutputTokens}){
 const p=pricingFor(model);
 if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>32768)throw Error('invalid_max_output_tokens');
 // In this text-only chat path, UTF-8 bytes upper-bound the tokenized
 // content in common BPE encodings. Add 512 token overhead plus 20% headroom.
 const bytes=Buffer.byteLength(JSON.stringify(messages||[]),'utf8');
 const conservativeInputTokens=Math.ceil((bytes+512)*1.20);
 return usdMicro((conservativeInputTokens*p.input+maxOutputTokens*p.output)/1_000_000);
}
export function estimatedActualUsd(model,usage){
 const p=pricingFor(model);
 const input=Number(usage?.prompt_tokens),output=Number(usage?.completion_tokens);
 if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)throw Error('invalid_cost_usage');
 return usdMicro((input*p.input+output*p.output)/1_000_000);
}
export async function reserveCost(db,{model,messages,maxOutputTokens}){
 const reservationUsd=estimateReservation({model,messages,maxOutputTokens});
 const day=taipeiParts().day,month=day.slice(0,7);
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  // Serialize budgeting on the singleton CEO settings record, even across workers.
  const q=await client.query('SELECT ai_enabled,daily_budget_usd,monthly_budget_usd FROM ai_control_settings WHERE id=1 FOR UPDATE');
  if(!q.rowCount)throw Error('ai_settings_missing');
  const settings=q.rows[0];
  if(!settings.ai_enabled)throw Error('ai_disabled_by_ceo');
  const totals=await client.query(`
   SELECT
    COALESCE(SUM(CASE WHEN usage_day=$1::date THEN
     CASE WHEN status='settled' THEN estimated_usd ELSE reserved_usd END ELSE 0 END),0) AS daily_usd,
    COALESCE(SUM(CASE WHEN status='settled' THEN estimated_usd ELSE reserved_usd END),0) AS monthly_usd
   FROM ai_cost_ledger WHERE usage_month=$2`,[day,month]);
  const totalDay=Number(totals.rows[0].daily_usd),totalMonth=Number(totals.rows[0].monthly_usd);
  if(totalDay+reservationUsd>Number(settings.daily_budget_usd)+1e-10)throw Error('ai_daily_usd_budget_reached');
  if(totalMonth+reservationUsd>Number(settings.monthly_budget_usd)+1e-10)throw Error('ai_monthly_usd_budget_reached');
  const ledger=await client.query(`INSERT INTO ai_cost_ledger(usage_day,usage_month,model,reserved_usd)
   VALUES($1,$2,$3,$4) RETURNING id`,[day,month,model,reservationUsd]);
  await client.query('COMMIT');
  return {id:ledger.rows[0].id,model,reservation_usd:reservationUsd};
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
export async function settleCost(db,reservation,{usage,notSent=false}={}){
 if(!reservation?.id)return;
 // If a request may have reached OpenAI but usage is unknown, retain the
 // reserved dollar allowance as 'unverified' (fail closed, not false $0).
 const known=Number.isSafeInteger(Number(usage?.prompt_tokens))&&
  Number.isSafeInteger(Number(usage?.completion_tokens))&&usage!=null;
 const status=notSent||known?'settled':'unverified';
 const actual=known?estimatedActualUsd(reservation.model,usage):0;
 await db.query(`UPDATE ai_cost_ledger SET status=$2,estimated_usd=$3,
   input_tokens=$4,output_tokens=$5,settled_at=NOW()
   WHERE id=$1 AND status='reserved'`,[
   reservation.id,status,actual,
   known?Number(usage.prompt_tokens):0,known?Number(usage.completion_tokens):0
 ]);
}
export async function costUsage(db,day=taipeiParts().day){
 const month=day.slice(0,7);
 const q=await db.query(`
 SELECT COALESCE(SUM(CASE WHEN usage_day=$1::date THEN
   CASE WHEN status='settled' THEN estimated_usd ELSE reserved_usd END ELSE 0 END),0) AS day_usd,
  COALESCE(SUM(CASE WHEN status='settled' THEN estimated_usd ELSE reserved_usd END),0) AS month_usd,
  COUNT(*) FILTER(WHERE status='unverified')::int AS unverified_count
 FROM ai_cost_ledger WHERE usage_month=$2`,[day,month]);
 return {day_usd:Number(q.rows[0].day_usd),month_usd:Number(q.rows[0].month_usd),
  unverified_count:Number(q.rows[0].unverified_count)};
}
