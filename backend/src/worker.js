import pg from 'pg';
import { performChecks } from './operations.js';
// Standalone process: needs a persistent worker host; GitHub Pages cannot run this.
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL missing');
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:true},max:3});
let busy=false;
async function tick(){
 if(busy)return;
 busy=true;
 try{const generated=await performChecks(db);if(generated.length)console.log('SKAI generated checks:',generated.join(','))}
 catch(e){console.error('SKAI worker failed:',e?.code||e?.message||e)}
 finally{busy=false}
}
await tick();
const timer=setInterval(tick,60_000);
async function shutdown(){clearInterval(timer);await db.end();process.exit(0)}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
