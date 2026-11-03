// Standalone, device-local company workspace. Never stores passwords, tokens or API secrets.
import { STORAGE_KEY, STORAGE_VERSION } from './data.js';
const id=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const empty=()=>({version:STORAGE_VERSION,projects:[],tasks:[],approvals:[],notifications:[],shared:''});
function assertWorkspace(v){
 if(!v||typeof v!=='object'||v.version!==STORAGE_VERSION||
 !Array.isArray(v.projects)||!Array.isArray(v.tasks)||!Array.isArray(v.approvals)||!Array.isArray(v.notifications))throw Error('本機資料格式不相容');
 if(v.projects.length>500||v.tasks.length>5000||v.approvals.length>5000)throw Error('本機資料筆數異常');
 return v;
}
export function readLocal(){
 try {const raw=localStorage.getItem(STORAGE_KEY);return raw?assertWorkspace(JSON.parse(raw)):empty();}
 catch(e){throw Error('本機資料無法讀取：'+e.message);}
}
function saveLocal(value){localStorage.setItem(STORAGE_KEY,JSON.stringify(assertWorkspace(value)));return value;}
function change(fn){const state=readLocal();const value=fn(state);saveLocal(state);return value;}
export const localCompany={
 snapshot:()=>readLocal(),
 projects:()=>readLocal().projects,
 tasks:()=>readLocal().tasks,
 approvals:()=>readLocal().approvals.filter(a=>a.status==='pending'),
 notifications:()=>readLocal().notifications,
 dashboard:()=>{
  const s=readLocal();
  return {projects:s.projects.filter(p=>p.status!=='closed').length,
   active:s.tasks.filter(t=>t.status==='in_progress').length,
   pending:s.approvals.filter(a=>a.status==='pending').length};
 },
 createProject({name,goal=''}){
  if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('請輸入有效的專案名稱');
  return change(s=>{const project={id:id(),name:name.trim(),goal:String(goal).slice(0,8000),stage:'draft',status:'planning',created_at:new Date().toISOString()};s.projects.unshift(project);return project;});
 },
 createTask({project_id,title,brief=''}){
  if(typeof title!=='string'||!title.trim()||title.length>160)throw Error('請輸入有效的任務名稱');
  return change(s=>{
   if(!s.projects.some(p=>p.id===project_id))throw Error('請先選擇專案');
   const task={id:id(),project_id,title:title.trim(),brief:String(brief).slice(0,8000),status:'proposed',assigned_role:'chief_of_staff',created_at:new Date().toISOString()};
   const approval={id:id(),task_id:task.id,project_id,title:task.title,status:'pending',created_at:task.created_at};
   s.tasks.unshift(task);s.approvals.unshift(approval);return {task,approval};
  });
 },
 decide(approvalId,decision){
  if(!['approved','rejected'].includes(decision))throw Error('無效的審批動作');
  return change(s=>{
   const approval=s.approvals.find(a=>a.id===approvalId&&a.status==='pending');
   if(!approval)throw Error('找不到待審批項目');
   const task=s.tasks.find(t=>t.id===approval.task_id);
   if(!task||task.status!=='proposed')throw Error('任務狀態不允許核准');
   approval.status=decision;approval.decided_at=new Date().toISOString();task.status=decision;
   return approval;
  });
 },
 exportJson:()=>JSON.stringify({exported_at:new Date().toISOString(),...readLocal()},null,2),
 importJson(text){
  const incoming=assertWorkspace(JSON.parse(text));
  saveLocal(incoming);
  return incoming;
 }
};
