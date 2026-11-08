import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing');
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'../sql');
const pool=new pg.Pool({
 connectionString:process.env.DATABASE_URL,
 ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:true},
 max:1
});
try {
 const files=(await fs.readdir(dir)).filter(f=>/^\d+_[a-z0-9_]+\.sql$/.test(f)).sort();
 const client=await pool.connect();
 try{
  await client.query('SELECT pg_advisory_lock(507005)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  for(const filename of files){
   const exists=await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1',[filename]);
   if(exists.rowCount){console.log('SKIP',filename);continue;}
   const sql=await fs.readFile(path.join(dir,filename),'utf8');
   // SQL files may contain BEGIN/COMMIT; the migration marker must be written only after success.
   await client.query(sql);
   await client.query('INSERT INTO schema_migrations(filename) VALUES($1)',[filename]);
   console.log('APPLIED',filename);
  }
 }finally{try{await client.query('SELECT pg_advisory_unlock(507005)')}finally{client.release();}}
}finally{await pool.end();}
