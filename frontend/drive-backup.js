// Browser-side Google Drive backup for the local workspace.
// OAuth access tokens are kept in memory only. No API secrets are shipped.
import {localCompany} from './storage.js';
const $=id=>document.getElementById(id);
const FILENAME='SKAI-OS-local-workspace-backup.json';
const CLIENT_KEY='skai_local_drive_client_id';
const LAST_KEY='skai_local_drive_last_backup';
let token=null,client=null;
function status(msg){if($('driveLocalMessage'))$('driveLocalMessage').textContent=msg;}
function backupStatus(){if($('localBackupStatus'))$('localBackupStatus').textContent=localStorage.getItem(LAST_KEY)||'尚未備份';}
function exportBackup(){
 const blob=new Blob([localCompany.exportJson()],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='SKAI-OS-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function importBackup(file,refresh){
 if(!file)return;
 if(file.size>5e6)throw Error('備份檔超過 5 MB');
 const raw=await file.text(),parsed=JSON.parse(raw);
 if(!Array.isArray(parsed.projects)||!Array.isArray(parsed.tasks))throw Error('備份格式不正確');
 if(!confirm('將以備份覆蓋此裝置所有本機專案與任務，確定繼續？'))return;
 exportBackup(); // local safety copy before overwriting
 localCompany.importJson(raw);
 await refresh();
 status('本機資料已還原；覆蓋前已下載安全備份。');
}
async function authorize(){
 const id=$('driveClientId')?.value.trim()||'';
 if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id))throw Error('請先填入有效的 Google OAuth 網頁用戶端 ID');
 localStorage.setItem(CLIENT_KEY,id);
 if(!window.google?.accounts?.oauth2)throw Error('Google 授權元件尚未載入，請確認網路');
 return new Promise((resolve,reject)=>{
  client=window.google.accounts.oauth2.initTokenClient({
   client_id:id,scope:'https://www.googleapis.com/auth/drive.file',
   callback:r=>{if(r.error){reject(Error(r.error));return;}token=r.access_token;resolve(token);}
  });
  client.requestAccessToken({prompt:token?'':'consent'});
 });
}
async function request(url,options={}){
 if(!token)throw Error('請先按「授權 Google Drive」');
 const res=await fetch(url,{...options,headers:{Authorization:'Bearer '+token,...options.headers}});
 if(!res.ok){if(res.status===401)token=null;throw Error('Google Drive 回應 '+res.status+'，請檢查授權與 API 設定');}
 return res.json();
}
async function existing(){
 const q=encodeURIComponent("name = '"+FILENAME+"' and trashed = false");
 const data=await request('https://www.googleapis.com/drive/v3/files?q='+q+'&fields=files(id,name,modifiedTime),nextPageToken&pageSize=100&orderBy=modifiedTime%20desc');
 return data.files?.[0]||null;
}
async function saveDrive(){
 const data=localCompany.exportJson(),old=await existing();
 if(old&&!confirm('Drive 已有備份，將覆蓋該備份。建議先下載 JSON 備份。確定繼續？'))return;
 const boundary='skai'+Date.now(),metadata=JSON.stringify({name:FILENAME,mimeType:'application/json'});
 const body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+metadata+'\r\n--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+data+'\r\n--'+boundary+'--';
 const url='https://www.googleapis.com/upload/drive/v3/files'+(old?'/'+encodeURIComponent(old.id):'')+'?uploadType=multipart&fields=id';
 await request(url,{method:old?'PATCH':'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
 const time=new Date().toLocaleString('zh-TW');
 localStorage.setItem(LAST_KEY,time);backupStatus();status('Google Drive 備份成功：'+time);
}
async function restoreDrive(refresh){
 const file=await existing();if(!file)throw Error('找不到此應用建立的備份');
 const data=await request('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media');
 if(!Array.isArray(data.projects)||!Array.isArray(data.tasks))throw Error('Drive 備份格式不正確');
 const raw=JSON.stringify(data);
 if(!confirm('將使用 Drive 備份覆蓋本機資料，確定嗎？'))return;
 exportBackup();
 localCompany.importJson(raw);
 await refresh();status('已從 Google Drive 還原，覆蓋前已下載本機安全備份');
}
export function setupDriveBackup(refresh){
 if(!$('driveLocalConnect'))return;
 $('driveClientId').value=localStorage.getItem(CLIENT_KEY)||'';
 backupStatus();
 $('dataExportWorkspace').addEventListener('click',exportBackup);
 $('dataImportWorkspace').addEventListener('change',async e=>{
  try{await importBackup(e.target.files?.[0],refresh)}catch(err){status('匯入失敗：'+err.message)}finally{e.target.value=''}
 });
 $('driveLocalConnect').addEventListener('click',async()=>{
  try{await authorize();status('Google Drive 已授權，現在可以備份或還原')}catch(err){status('授權失敗：'+err.message)}
 });
 $('driveLocalBackup').addEventListener('click',async()=>{
  try{await saveDrive()}catch(err){status('備份失敗：'+err.message)}
 });
 $('driveLocalRestore').addEventListener('click',async()=>{
  try{await restoreDrive(refresh)}catch(err){status('還原失敗：'+err.message)}
 });
}
