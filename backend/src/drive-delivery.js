// Drive delivery adapter. The credentials of a user-connected ChatGPT app are NOT available
// to this standalone Render process. A separately authorized OAuth refresh token is required.
const API='https://www.googleapis.com';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const formats=Object.freeze({
 pdf:{mime:'application/pdf',exportMime:'application/pdf',ext:'pdf'},
 docx:{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',exportMime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ext:'docx'},
 xlsx:{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',exportMime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ext:'xlsx'}
});
export const driveDeliveryReady=()=>['GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN'].every(k=>Boolean(process.env[k]?.trim()));
export function safeFileName(name){return String(name||'SKAI成果').replace(/[\\/:*?"<>|\r\n\t]/g,'_').slice(0,100).trim()||'SKAI成果';}
export function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function reportHtml(title,report){
 const lines=String(report||'').split(/\r?\n/);
 const paragraphs=lines.map(line=>line.trim()?'<p>'+escapeHtml(line)+'</p>':'<p>&nbsp;</p>').join('\n');
 return '<!doctype html><html><head><meta charset="UTF-8"><style>@page{size:A4;margin:2.5cm}body{font-family:Arial,"Noto Sans CJK TC",sans-serif;font-size:11pt;line-height:1.5;color:#162c4f}h1{font-size:16pt;text-align:center}p{white-space:pre-wrap;overflow-wrap:break-word;margin:5pt 0}</style></head><body><h1>'+escapeHtml(title)+'</h1>'+paragraphs+'</body></html>';
}
export function reportCsv(title,report){
 // Real Excel workbook via Sheets conversion. This is a traceable SOURCE TEXT ledger,
 // not an invented financial model with unvalidated formulas.
 const q=t=>'"'+String(t||'').replace(/"/g,'""').replace(/^[=+@\-\t\r]/,'\u2019$&')+'"';
 const lines=String(report||'').split(/\r?\n/).filter(x=>x.trim()).slice(0,1500);
 return '\uFEFF'+['章節/項目,內容',...lines.map((line,i)=>q(i===0?title:'第 '+(i+1)+' 行')+','+q(line))].join('\r\n');
}
export class DriveDeliveryError extends Error{
 constructor(code,status=502){super(code);this.name='DriveDeliveryError';this.status=status;}
}
async function response(res,label){
 if(res.ok)return res;
 const msg=(await res.text().catch(()=>''))?.slice(0,250);
 throw new DriveDeliveryError(label+'_'+res.status+(res.status===403?'_access_denied':''),res.status===401||res.status===403?409:502);
}
export async function driveClient(fetchImpl=fetch){
 if(!driveDeliveryReady())throw new DriveDeliveryError('drive_not_connected',409);
 const form=new URLSearchParams({client_id:process.env.GOOGLE_DRIVE_CLIENT_ID,client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_DRIVE_REFRESH_TOKEN,grant_type:'refresh_token'});
 const r=await response(await fetchImpl(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form}), 'drive_oauth');
 const auth=await r.json();
 if(!auth.access_token)throw new DriveDeliveryError('drive_token_missing',409);
 const headers={Authorization:'Bearer '+auth.access_token};
 async function req(url,opts={},name='drive_request'){
  return response(await fetchImpl(url,{...opts,headers:{...headers,...opts.headers}}),name);
 }
 async function createConverted(filename,body,mime,targetMime,folder){
  const boundary='skai_'+Math.random().toString(16).slice(2);
  const metadata={name:filename,mimeType:targetMime,parents:[folder]};
  const buffer=Buffer.concat([
   Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: '+mime+'; charset=UTF-8\r\n\r\n'),
   Buffer.from(body,'utf8'),Buffer.from('\r\n--'+boundary+'--\r\n')
  ]);
  const r=await req(API+'/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents,webViewLink',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:buffer},'drive_create');
  return r.json();
 }
 async function uploadBinary(filename,bytes,mime,folder){
  const boundary='skai_'+Math.random().toString(16).slice(2);
  const metadata={name:filename,mimeType:mime,parents:[folder]};
  const buffer=Buffer.concat([
   Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: '+mime+'\r\n\r\n'),
   Buffer.from(bytes),Buffer.from('\r\n--'+boundary+'--\r\n')
  ]);
  const r=await req(API+'/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents,webViewLink',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:buffer},'drive_upload');
  return r.json();
 }
 async function exportFile(id,mime){
  const r=await req(API+'/drive/v3/files/'+encodeURIComponent(id)+'/export?mimeType='+encodeURIComponent(mime),{},'drive_export');
  const bytes=Buffer.from(await r.arrayBuffer());
  if(!bytes.length||bytes.length>10*1024*1024)throw new DriveDeliveryError('drive_export_invalid_size',409);
  return bytes;
 }
 async function verify(id,folder,mime){
  const r=await req(API+'/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,parents,mimeType,webViewLink,trashed',{},'drive_verify');
  const file=await r.json();
  if(file.trashed||file.mimeType!==mime||!file.parents?.includes(folder))throw new DriveDeliveryError('drive_upload_verification_failed',409);
  return {id:file.id,url:file.webViewLink||'https://drive.google.com/file/d/'+encodeURIComponent(file.id)+'/view'};
 }
 async function createFolder(name,parentId){
  await validateFolder(parentId);
  const r=await req(API+'/drive/v3/files?fields=id,name,parents,mimeType,webViewLink',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name:safeFileName(name),mimeType:'application/vnd.google-apps.folder',parents:[parentId]})
  },'drive_create_folder');
  const f=await r.json();
  if(!f.id)throw new DriveDeliveryError('drive_folder_creation_unverified',502);
  return {id:f.id,url:f.webViewLink||'https://drive.google.com/drive/folders/'+f.id};
 }
 async function validateFolder(id){
  if(!/^[a-zA-Z0-9_-]{20,}$/.test(id||''))throw new DriveDeliveryError('invalid_drive_folder_id',400);
  const r=await req(API+'/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,mimeType,trashed,capabilities(canAddChildren)',{},'drive_folder');
  const f=await r.json();
  if(f.trashed||f.mimeType!=='application/vnd.google-apps.folder'||!f.capabilities?.canAddChildren)throw new DriveDeliveryError('drive_folder_not_writable',409);
  return true;
 }
 return {createConverted,uploadBinary,exportFile,verify,validateFolder,createFolder};
}
export async function exportDeliverable(client,{format,title,report,folderId,sourceDocId=null}){
 if(!formats[format])throw new DriveDeliveryError('unsupported_format',400);
 const file=sourceDocId||await (async()=>{
  const source= format==='xlsx'
   ?await client.createConverted(title+'｜資料整理',''+reportCsv(title,report),'text/csv','application/vnd.google-apps.spreadsheet',folderId)
   :await client.createConverted(title+'｜編輯來源',reportHtml(title,report),'text/html','application/vnd.google-apps.document',folderId);
  return source.id;
 })();
 const bytes=await client.exportFile(file,formats[format].exportMime);
 const saved=await client.uploadBinary(title+'.'+format,bytes,formats[format].mime,folderId);
 return {...await client.verify(saved.id,folderId,formats[format].mime),sourceId:file};
}
