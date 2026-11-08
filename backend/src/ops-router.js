import express from 'express';
import { performChecks, taipeiParts,capFromEnv,readAiControls,effectiveCallLimit,validateAiControls } from './operations.js';
import { validUuid } from './security.js';
import {costUsage,MODEL_PRICES} from './cost-control.js';
export function operationsRouter(db){
 const api=express.Router();
 api.get('/notifications',async(req,res)=>{
  try{
   const q=await db.query("SELECT * FROM notification_events ORDER BY created_at DESC LIMIT 100");
   res.json({notifications:q.rows,notice:'SKAI 內部收件匣，尚未串接 ChatGPT App 推播'});
  }catch{res.status(500).json({error:'internal_error'})}
 });
 api.post('/notifications/:id/read',async(req,res)=>{
  if(!validUuid(req.params.id))return res.status(400).json({error:'invalid_id'});
  try{
   const q=await db.query("UPDATE notification_events SET status='read',read_at=NOW() WHERE id=$1 RETURNING id,status",[req.params.id]);
   if(!q.rowCount)return res.status(404).json({error:'not_found'});
   res.json({notification:q.rows[0]});
  }catch{res.status(500).json({error:'internal_error'})}
 });
 api.get('/usage',async(req,res)=>{
  try{
   const day=taipeiParts().day;
   const [q,settings,cost]=await Promise.all([
    db.query('SELECT * FROM ai_daily_usage WHERE usage_day=$1',[day]),readAiControls(db),costUsage(db,day)
   ]);
   res.json({day,cap:effectiveCallLimit(settings),ai_enabled:settings.ai_enabled,
    daily_token_warning:settings.daily_token_warning,cost,
    daily_budget_usd:Number(settings.daily_budget_usd),
    monthly_budget_usd:Number(settings.monthly_budget_usd),
    pricing_model:process.env.OPENAI_MODEL||'gpt-4.1-mini',
    usage:q.rows[0]||{reserved_calls:0,completed_calls:0,failed_calls:0,total_input_tokens:0,total_output_tokens:0},
    notice:'Token 警示僅作提醒，不代表美元費用上限或硬性 Token 封鎖。所有呼叫限制由 SKAI 自訂。'});
  }catch{res.status(500).json({error:'internal_error'})}
 });
 api.get('/ai-settings',async(req,res)=>{
  if(!req.ceoSession)return res.status(403).json({error:'ceo_session_required'});
  try{
   const settings=await readAiControls(db);
   res.json({settings,effective_daily_limit:effectiveCallLimit(settings),pricing_model:process.env.OPENAI_MODEL||'gpt-4.1-mini',pricing:MODEL_PRICES[process.env.OPENAI_MODEL||'gpt-4.1-mini']||null,
    deployment_ceiling:capFromEnv(process.env.SKAI_DAILY_AI_CALL_LIMIT),
    notice:'每日呼叫上限是硬性防護。Token 門檻僅提醒，並非美元預算或硬性 Token 限制。'});
  }catch{res.status(500).json({error:'internal_error'})}
 });
 api.post('/ai-settings',async(req,res)=>{
  if(!req.ceoSession)return res.status(403).json({error:'ceo_session_required'});
  let settings;
  try{settings=validateAiControls(req.body)}catch{return res.status(400).json({error:'invalid_ai_settings'})}
  const ceiling=capFromEnv(process.env.SKAI_DAILY_AI_CALL_LIMIT);
  if(settings.daily_call_limit>ceiling)return res.status(400).json({error:'over_deployment_ai_ceiling',deployment_ceiling:ceiling});
  const client=await db.connect();
  try{
   await client.query('BEGIN');
   const old=await client.query('SELECT ai_enabled,daily_call_limit,daily_token_warning,daily_budget_usd,monthly_budget_usd FROM ai_control_settings WHERE id=1 FOR UPDATE');
   const changed=await client.query(`UPDATE ai_control_settings SET ai_enabled=$1,daily_call_limit=$2,daily_token_warning=$3,daily_budget_usd=$4,monthly_budget_usd=$5,updated_at=NOW()
    WHERE id=1 RETURNING ai_enabled,daily_call_limit,daily_token_warning,daily_budget_usd,monthly_budget_usd,updated_at`,[
    settings.ai_enabled,settings.daily_call_limit,settings.daily_token_warning,settings.daily_budget_usd,settings.monthly_budget_usd
   ]);
   if(!changed.rowCount)throw Error('ai_settings_missing');
   await client.query(`INSERT INTO audit_log(actor,event,target_type,details) VALUES('ceo','ai.settings.updated','settings',$1)`,[
    JSON.stringify({old:old.rows[0],new:settings})
   ]);
   await client.query('COMMIT');
   res.json({settings:changed.rows[0],effective_daily_limit:effectiveCallLimit(settings)});
  }catch(e){await client.query('ROLLBACK');console.error('ai setting save error:',e?.message);res.status(500).json({error:'internal_error'})}
  finally{client.release()}
 });
 api.post('/checks/run',async(_req,res)=>{
  try{const created=await performChecks(db);res.json({created,notice:'僅建立內部通知紀錄；不會推播到 ChatGPT App'})}
  catch{res.status(500).json({error:'internal_error'})}
 });
 return api;
}
