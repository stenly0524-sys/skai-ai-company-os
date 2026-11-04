// Standalone, device-local company workspace. Never stores passwords, tokens or API secrets.
import { STORAGE_KEY, STORAGE_VERSION } from './data.js';
const id=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const empty=()=>({version:STORAGE_VERSION,projects:[],tasks:[],approvals:[],notifications:[],documents:[],activity:[],shared:''});
function assertWorkspace(v){
 if(!v||typeof v!=='object'||v.version!==STORAGE_VERSION||
 !Array.isArray(v.projects)||!Array.isArray(v.tasks)||!Array.isArray(v.approvals)||!Array.isArray(v.notifications))throw Error('本機資料格式不相容');
 if(v.projects.length>500||v.tasks.length>5000||v.approvals.length>5000)throw Error('本機資料筆數異常');
 if(!Array.isArray(v.documents))v.documents=[];
 if(!Array.isArray(v.activity))v.activity=[];
 if(v.documents.length>2000||v.activity.length>10000)throw Error('本機資料筆數超出限制');
 return v;
}
export function readLocal(){
 try {const raw=localStorage.getItem(STORAGE_KEY);return raw?assertWorkspace(JSON.parse(raw)):empty();}
 catch(e){throw Error('本機資料無法讀取：'+e.message);}
}
function saveLocal(value){localStorage.setItem(STORAGE_KEY,JSON.stringify(assertWorkspace(value)));return value;}
function change(fn){const state=readLocal();const value=fn(state);saveLocal(state);return value;}
function log(s,project_id,kind,description){s.activity.unshift({id:id(),project_id,kind,description,created_at:new Date().toISOString()});if(s.activity.length>10000)s.activity.length=10000;}
export const localCompany={
 snapshot:()=>readLocal(),
 projects:()=>readLocal().projects,
 tasks:()=>readLocal().tasks,
 approvals:()=>readLocal().approvals.filter(a=>a.status==='pending'),
 notifications:()=>readLocal().notifications,
 documents:()=>readLocal().documents,
 activity:(projectId)=>readLocal().activity.filter(x=>!projectId||x.project_id===projectId),
 dashboard:()=>{
  const s=readLocal();
  return {projects:s.projects.filter(p=>p.status!=='closed').length,
   active:s.tasks.filter(t=>['approved','in_progress','review','paused'].includes(t.status)).length,
   pending:s.approvals.filter(a=>a.status==='pending').length};
 },
 createProject({name,goal=''}){
  if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('請輸入有效的專案名稱');
  return change(s=>{const project={id:id(),name:name.trim(),goal:String(goal).slice(0,8000),stage:'draft',status:'planning',progress:0,notes:'',updated_at:new Date().toISOString(),created_at:new Date().toISOString()};s.projects.unshift(project);log(s,project.id,'project','建立專案：'+project.name);return project;});
 },
 createTask({project_id,title,brief=''}){
  if(typeof title!=='string'||!title.trim()||title.length>160)throw Error('請輸入有效的任務名稱');
  return change(s=>{
   if(!s.projects.some(p=>p.id===project_id))throw Error('請先選擇專案');
   const task={id:id(),project_id,title:title.trim(),brief:String(brief).slice(0,8000),status:'proposed',progress:0,assigned_role:'chief_of_staff',updated_at:new Date().toISOString(),created_at:new Date().toISOString()};
   const approval={id:id(),task_id:task.id,project_id,title:task.title,status:'pending',created_at:task.created_at};
   s.tasks.unshift(task);s.approvals.unshift(approval);log(s,project_id,'task','建立任務：'+task.title);return {task,approval};
  });
 },
 decide(approvalId,decision){
  if(!['approved','rejected'].includes(decision))throw Error('無效的審批動作');
  return change(s=>{
   const approval=s.approvals.find(a=>a.id===approvalId&&a.status==='pending');
   if(!approval)throw Error('找不到待審批項目');
   const task=s.tasks.find(t=>t.id===approval.task_id);
   if(!task||task.status!=='proposed')throw Error('任務狀態不允許核准');
   approval.status=decision;approval.decided_at=new Date().toISOString();task.status=decision;task.updated_at=approval.decided_at;log(s,task.project_id,'approval',decision==='approved'?'核准任務：'+task.title:'駁回任務：'+task.title);
   return approval;
  });
 },
 updateProject(projectId,{stage,progress,notes}={}){
  const validStages=['draft','planning','active','paused','completed'];
  if(!validStages.includes(stage))throw Error('無效的專案階段');
  if(!Number.isInteger(progress)||progress<0||progress>100)throw Error('進度必須是 0–100 的整數');
  if(typeof notes!=='string'||notes.length>3000)throw Error('備註最多 3000 字');
  return change(s=>{
   const p=s.projects.find(p=>p.id===projectId);
   if(!p)throw Error('專案不存在');
   p.stage=stage;p.progress=progress;p.notes=notes;p.updated_at=new Date().toISOString();
   p.status=stage==='completed'?'closed':stage==='paused'?'paused':'planning';
   log(s,p.id,'project','更新專案：階段 '+stage+'，進度 '+progress+'%'+(notes?'｜'+notes.slice(0,160):''));return p;
  });
 },
 updateTask(taskId,{status,progress}={}){
  const valid=['approved','in_progress','review','done','paused'];
  if(!valid.includes(status))throw Error('無效的任務狀態');
  if(!Number.isInteger(progress)||progress<0||progress>100)throw Error('進度必須是 0–100 的整數');
  return change(s=>{
   const task=s.tasks.find(t=>t.id===taskId);
   if(!task)throw Error('找不到任務');
   if(['proposed','rejected'].includes(task.status))throw Error('待審批或已駁回的任務不可直接更新');
   if(status==='done'&&progress!==100)throw Error('完成任務需要設定 100%');
   task.status=status;task.progress=progress;task.updated_at=new Date().toISOString();
   log(s,task.project_id,'task','更新任務：'+task.title+'｜'+status+'｜'+progress+'%');return task;
  });
 },
 addDocument({project_id,name,url,category='link'}){
  if(typeof name!=='string'||!name.trim()||name.length>160)throw Error('請輸入有效的文件名稱');
  if(typeof url!=='string'||url.length>2000)throw Error('連結長度不正確');
  let parsed;try{parsed=new URL(url)}catch{throw Error('請輸入完整的 https 網址')}
  if(parsed.protocol!=='https:')throw Error('文件必須使用 https 連結');
  return change(s=>{
   if(!s.projects.some(p=>p.id===project_id))throw Error('請先選擇專案');
   const doc={id:id(),project_id,name:name.trim(),url:parsed.href,category:'link',created_at:new Date().toISOString()};
   s.documents.unshift(doc);log(s,project_id,'document','新增文件連結：'+doc.name);return doc;
  });
 },
 removeDocument(docId){
  return change(s=>{
   const ix=s.documents.findIndex(d=>d.id===docId);if(ix<0)throw Error('找不到文件連結');
   const [doc]=s.documents.splice(ix,1);log(s,doc.project_id,'document','移除文件連結：'+doc.name);return doc;
  });
 },
 exportJson:()=>JSON.stringify({exported_at:new Date().toISOString(),...readLocal()},null,2),
 importJson(text){
  const incoming=assertWorkspace(JSON.parse(text));
  saveLocal(incoming);
  return incoming;
 }
};
