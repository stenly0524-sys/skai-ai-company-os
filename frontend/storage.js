// Standalone, device-local company workspace. Never stores passwords, tokens or API secrets.
import { STORAGE_KEY, STORAGE_VERSION } from './data.js';
const id=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const empty=()=>({version:STORAGE_VERSION,projects:[],tasks:[],approvals:[],notifications:[],categories:[],shared:''});
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
 createTask({project_id,title,brief='',category_id=''}){
  if(typeof title!=='string'||!title.trim()||title.length>160)throw Error('請輸入有效的任務名稱');
  return change(s=>{
   if(!s.projects.some(p=>p.id===project_id))throw Error('請先選擇專案');
   const task={id:id(),project_id,category_id,title:title.trim(),brief:String(brief).slice(0,8000),status:'approved',assigned_role:'ceo',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   s.tasks.unshift(task);return {task};
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
 deletionPreview(projectId){
  const st=readLocal();if(!st.projects.some(p=>p.id===projectId))throw Error('找不到專案');
  const tasks=st.tasks.filter(t=>t.project_id===projectId);
  return {counts:{tasks:tasks.length,conversations:0,runs:0},blocked:false};
 },
 deleteProject(projectId){
  return change(st=>{
   const i=st.projects.findIndex(p=>p.id===projectId);if(i<0)throw Error('找不到專案');
   const p=st.projects.splice(i,1)[0];const taskIds=new Set(st.tasks.filter(t=>t.project_id===projectId).map(t=>t.id));
   st.tasks=st.tasks.filter(t=>!taskIds.has(t.id));st.approvals=st.approvals.filter(x=>!taskIds.has(x.task_id));return p;
  });
 },
 deleteTask(taskId){
  return change(st=>{
   const i=st.tasks.findIndex(t=>t.id===taskId);if(i<0)throw Error('找不到任務');
   const task=st.tasks.splice(i,1)[0];st.approvals=st.approvals.filter(x=>x.task_id!==taskId);return task;
  });
 },
 transitionTask(taskId,status){
  const allowed={approved:['in_progress','done'],in_progress:['review','done','paused'],review:['done','in_progress'],paused:['in_progress','done'],done:['in_progress']};
  return change(st=>{
   const task=st.tasks.find(t=>t.id===taskId);if(!task)throw Error('找不到任務');
   if(!allowed[task.status]?.includes(status))throw Error('任務狀態不允許此操作');
   task.status=status;task.updated_at=new Date().toISOString();return task;
  });
 },
 categories:(projectId)=>readLocal().categories?.filter(c=>c.project_id===projectId)||[],
 saveCategories(projectId,items){return change(s=>{s.categories=(s.categories||[]).filter(c=>c.project_id!==projectId).concat(items.map((c,i)=>({id:c.id||id(),name:String(c.name||'').slice(0,80),project_id:projectId,sort_order:i})));return s.categories.filter(c=>c.project_id===projectId);});},
 updateProject(projectId,body){return change(s=>{const p=s.projects.find(x=>x.id===projectId);if(!p)throw Error('找不到專案');Object.assign(p,body,{updated_at:new Date().toISOString()});return p;});},
 updateTask(taskId,body){return change(s=>{const t=s.tasks.find(x=>x.id===taskId);if(!t)throw Error('找不到任務');Object.assign(t,body,{updated_at:new Date().toISOString()});return t;});},
 exportJson:()=>JSON.stringify({exported_at:new Date().toISOString(),...readLocal()},null,2),
 importJson(text){
  const incoming=assertWorkspace(JSON.parse(text));
  saveLocal(incoming);
  return incoming;
 }
};
