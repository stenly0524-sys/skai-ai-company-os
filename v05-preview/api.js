// Transport layer: same UI, local-first workspace or authenticated SKAI backend.
// Offline mode is deliberately not an AI simulator.
import { localCompany } from './storage.js';
const MODE_KEY='skai_v05_workspace_mode';
let csrfToken=null;
export function workspaceMode(){return 'local';} // Public static preview: no AI backend or cloud connection.
export function useLocalWorkspace(){sessionStorage.setItem(MODE_KEY,'local');csrfToken=null;}
export function useCloudWorkspace(){throw Error('此公開預覽只提供本機模式；AI 雲端服務尚未部署');}
export function setCsrfToken(token){csrfToken=token||null;}
export function hasCsrfToken(){return Boolean(csrfToken);}
function localRequest(path,method,body){
 if(method==='GET'&&path==='/dashboard')return {counts:localCompany.dashboard(),source:'localStorage'};
 if(method==='GET'&&path==='/projects')return {projects:localCompany.projects()};
 if(method==='POST'&&path==='/projects')return {project:localCompany.createProject(body||{})};
 if(method==='PATCH'&&/^\/projects\/[^/]+$/.test(path))return {project:localCompany.updateProject(decodeURIComponent(path.split('/')[2]),body||{})};
 if(method==='GET'&&path==='/tasks')return {tasks:localCompany.tasks()};
 if(method==='POST'&&path==='/tasks')return localCompany.createTask(body||{});
 if(method==='PATCH'&&/^\/tasks\/[^/]+$/.test(path))return {task:localCompany.updateTask(decodeURIComponent(path.split('/')[2]),body||{})};
 if(method==='GET'&&path==='/approvals')return {approvals:localCompany.approvals()};
 if(method==='POST'&&/^\/approvals\/[^/]+\/decision$/.test(path))return {approval:localCompany.decide(path.split('/')[2],body?.decision)};
 if(method==='GET'&&path==='/operations/notifications')return {notifications:localCompany.notifications(),source:'localStorage'};
 throw Error('此功能需要雲端 AI 後端，無法在本機模式執行');
}
export async function api(path,{method='GET',body}={}){
 if(workspaceMode()==='local')return localRequest(path,method,body);
 const headers={Accept:'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(!['GET','HEAD'].includes(method)&&!path.endsWith('/session/login')){
  if(!csrfToken)throw Error('請先登入 CEO 帳號');
  headers['X-CSRF-Token']=csrfToken;
 }
 const response=await fetch('/api'+path,{method,headers,credentials:'same-origin',...(body===undefined?{}:{body:JSON.stringify(body)})});
 let data;
 try{data=await response.json()}catch{throw Error('SKAI API 尚未部署或回傳格式錯誤');}
 if(!response.ok)throw Error(data?.error||'系統回應失敗');
 return data;
}
