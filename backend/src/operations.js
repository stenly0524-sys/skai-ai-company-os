// All times are in Asia/Taipei. This is an inbox/event producer, NOT a ChatGPT push bridge.
export const ZONE='Asia/Taipei';
export function taipeiParts(date=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',minute:'2-digit'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return {day:parts.year+'-'+parts.month+'-'+parts.day,hour:Number(parts.hour),minute:Number(parts.minute)};
}
export function dueWindows(now=new Date()){
 const {day,hour}=taipeiParts(now);
 return [{name:'patrol',key:'patrol:'+day,due:hour>=9},{name:'briefing',key:'briefing:'+day,due:hour>=10}].filter(x=>x.due);
}
export function capFromEnv(value){
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<1||n>100000)return 20;
 return n;
}
export function briefText({projects=0,pending=0,active=0,failed=0}){
 return '【SKAI 10:00 管理摘要】\n專案：'+projects+'；待審批：'+pending+'；執行中：'+active+'；異常步驟：'+failed+'。\n此摘要僅根據已接入資料庫的紀錄；未連接的資料不列入。';
}
export async function emitEvent(db,{key,severity='info',title,body}){
 const q=await db.query('INSERT INTO notification_events(event_key,severity,title,body) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING RETURNING id',[key,severity,title,body]);
 return q.rowCount===1;
}
export async function performChecks(db,now=new Date()){
 const due=dueWindows(now);
 const created=[];
 for(const task of due){
  const client=await db.connect();
  try {
   await client.query('BEGIN');
   // Claim the day once, even when several worker instances race.
   const claimed=await client.query('INSERT INTO scheduled_checks(check_key,check_type) VALUES($1,$2) ON CONFLICT(check_key) DO NOTHING RETURNING check_key',[task.key,task.name]);
   if(!claimed.rowCount){await client.query('ROLLBACK');continue}
   const q=await client.query(`SELECT
    (SELECT COUNT(*) FROM projects WHERE status!='closed')::int AS projects,
    (SELECT COUNT(*) FROM approvals WHERE status='pending')::int AS pending,
    (SELECT COUNT(*) FROM tasks WHERE status='in_progress')::int AS active,
    (SELECT COUNT(*) FROM orchestration_steps WHERE status='failed')::int AS failed`);
   const totals=q.rows[0];
   const key='notice:'+task.key;
   const important=totals.failed>0||totals.pending>0;
   const title=task.name==='patrol'?'09:00 AI 營運巡檢':'10:00 CEO 管理摘要';
   const body=task.name==='patrol'
    ?'【SKAI 巡檢】待審批 '+totals.pending+' 項；執行中 '+totals.active+' 項；分析異常 '+totals.failed+' 項。'
    :briefText(totals);
   await client.query('INSERT INTO notification_events(event_key,severity,title,body) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING',[key,important?'warning':'info',title,body]);
   await client.query('COMMIT');
   created.push(task.name);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 }
 return created;
}
export const DEFAULT_AI_CONTROLS=Object.freeze({ai_enabled:true,daily_call_limit:50,daily_token_warning:100000,daily_budget_usd:1,monthly_budget_usd:10});
export function validateAiControls(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid_ai_settings');
 const allowed=['ai_enabled','daily_call_limit','daily_token_warning','daily_budget_usd','monthly_budget_usd'];
 if(Object.keys(input).length!==allowed.length||Object.keys(input).some(key=>!allowed.includes(key)))throw Error('invalid_ai_settings');
 const {ai_enabled,daily_call_limit,daily_token_warning,daily_budget_usd,monthly_budget_usd}=input;
 if(typeof ai_enabled!=='boolean'||!Number.isSafeInteger(daily_call_limit)||daily_call_limit<1||daily_call_limit>500||
 !Number.isSafeInteger(daily_token_warning)||daily_token_warning<1000||daily_token_warning>10000000||
 typeof daily_budget_usd!=='number'||!Number.isFinite(daily_budget_usd)||daily_budget_usd<0.01||daily_budget_usd>1000||
 typeof monthly_budget_usd!=='number'||!Number.isFinite(monthly_budget_usd)||monthly_budget_usd<0.01||monthly_budget_usd>10000||
 Math.abs(Math.round(daily_budget_usd*100)-daily_budget_usd*100)>1e-8||
 Math.abs(Math.round(monthly_budget_usd*100)-monthly_budget_usd*100)>1e-8||
 daily_budget_usd>monthly_budget_usd)throw Error('invalid_ai_settings');
 return {ai_enabled,daily_call_limit,daily_token_warning,daily_budget_usd,monthly_budget_usd};
}
export async function readAiControls(db){
 const q=await db.query('SELECT ai_enabled,daily_call_limit,daily_token_warning,daily_budget_usd,monthly_budget_usd,updated_at FROM ai_control_settings WHERE id=1');
 if(!q.rowCount)throw Error('ai_settings_missing');
 return q.rows[0];
}
export function effectiveCallLimit(settings){return Math.min(capFromEnv(process.env.SKAI_DAILY_AI_CALL_LIMIT),Number(settings.daily_call_limit));}
export async function reserveAiCall(db){
 const {day}=taipeiParts();
 const settings=await readAiControls(db);
 if(!settings.ai_enabled)throw new Error('ai_disabled_by_ceo');
 const cap=effectiveCallLimit(settings);
 const q=await db.query(`INSERT INTO ai_daily_usage(usage_day,reserved_calls) VALUES($1,1)
 ON CONFLICT(usage_day) DO UPDATE SET reserved_calls=ai_daily_usage.reserved_calls+1
 WHERE ai_daily_usage.reserved_calls < $2 RETURNING usage_day,reserved_calls`,[day,cap]);
 if(!q.rowCount)throw new Error('ai_daily_limit_reached');
 return day;
}
export async function finalizeAiCall(db,day,usage,success){
 const completed=await db.query(`UPDATE ai_daily_usage SET completed_calls=completed_calls+$2,failed_calls=failed_calls+$3,
 total_input_tokens=total_input_tokens+$4,total_output_tokens=total_output_tokens+$5 WHERE usage_day=$1
 RETURNING total_input_tokens,total_output_tokens`,[
 day,success?1:0,success?0:1,
 Number(usage?.prompt_tokens)||0,Number(usage?.completion_tokens)||0
 ]);
 if(completed.rowCount){
  const settings=await readAiControls(db);
  const used=Number(completed.rows[0].total_input_tokens)+Number(completed.rows[0].total_output_tokens);
  if(used>=Number(settings.daily_token_warning)){
   // Alert only: current tokens are recorded after the API has returned.
   await db.query(`INSERT INTO notification_events(event_key,severity,title,body)
    VALUES($1,'warning','AI Token 使用警示',$2)
    ON CONFLICT(event_key) DO NOTHING`,[
     'ai-token-warning:'+day,'今日已記錄 '+used+' tokens，達到 CEO 設定的提醒門檻 '+settings.daily_token_warning+' tokens。此提醒非美元費用或硬性 Token 上限。'
   ]);
  }
 }
}
