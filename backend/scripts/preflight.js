// Validate staging configuration without leaking any credential or contacting paid APIs.
// Usage: npm run preflight (in backend). Requires environment variables to be configured.
import { pathToFileURL } from 'node:url';

export function checkStagingEnvironment(env){
 const results=[];
 const add=(name,ok,message)=>results.push({name,ok,message});
 const db=env.DATABASE_URL||'';
 let pgUrl=null;
 try { pgUrl=new URL(db) } catch {}
 add('DATABASE_URL',Boolean(pgUrl&&['postgresql:','postgres:'].includes(pgUrl.protocol)&&pgUrl.hostname&&pgUrl.username),'必須設定有效 PostgreSQL 連線字串（不回顯內容）');
 add('DATABASE_SSL',env.DATABASE_SSL!=='false','測試雲端資料庫應使用有效 TLS 憑證');
 add('SKAI_CEO_PASSWORD',typeof env.SKAI_CEO_PASSWORD==='string'&&env.SKAI_CEO_PASSWORD.length>=16&&!env.SKAI_CEO_PASSWORD.startsWith('replace-'),'CEO 登入密碼至少 16 字元');
 add('SKAI_ADMIN_TOKEN',typeof env.SKAI_ADMIN_TOKEN==='string'&&env.SKAI_ADMIN_TOKEN.length>=32&&!env.SKAI_ADMIN_TOKEN.startsWith('replace-'),'管理權杖至少 32 字元；正式環境僅供設定驗證，不開放開發者旁路');
 add('OPENAI_API_KEY',typeof env.OPENAI_API_KEY==='string'&&env.OPENAI_API_KEY.length>=15&&!env.OPENAI_API_KEY.startsWith('replace-'),'伺服器端 API Key 必須存在，切勿提交至 GitHub；不驗證額度');
 add('NODE_ENV',env.NODE_ENV==='production','HTTPS 測試環境應設 production');
 add('PUBLIC_ORIGIN',/^https:\/\/[^/]+$/.test(env.PUBLIC_ORIGIN||'')&&!/your-staging-domain|example/.test(env.PUBLIC_ORIGIN||''),'應設定實際的 HTTPS 完整來源網址（不得含路徑）');
 const limit=Number(env.SKAI_DAILY_AI_CALL_LIMIT||20);
 add('SKAI_DAILY_AI_CALL_LIMIT',Number.isSafeInteger(limit)&&limit>=1&&limit<=20,'初期限制為每天最多 20 次 AI 請求；呼叫次數不是金額上限');
 return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const results=checkStagingEnvironment(process.env);
 for(const item of results)console.log((item.ok?'PASS':'FAIL')+' '+item.name+(item.ok?'':' — '+item.message));
 const failed=results.filter(x=>!x.ok);
 console.log(failed.length?'Staging NOT ready ('+failed.length+' failed checks).':'Staging config format passed. Still verify DB, AI billing, HTTPS and backups manually.');
 if(failed.length)process.exitCode=1;
}
