import { EMPLOYEES, TASK_STATUS } from './data.js';
import { api,workspaceMode,useLocalWorkspace,useCloudWorkspace,setCsrfToken } from './api.js';
import { localCompany } from './storage.js';
import {renderOffice} from './scene.js';
import {el,listItem,renderList} from './ui.js';

const $=id=>document.getElementById(id);
const dialog=$('employeeDialog'),toast=$('toast');
let currentEmployee=EMPLOYEES[0],isSignedIn=false,toastTimer;
let projectCache=[],roleConversations=new Map();
const orchestrationStatuses={draft:'待 CEO 核准分工',ready:'已核准，待執行',running:'分析中',paused:'暫停',failed:'分析失敗',review:'待 CEO 驗收',done:'已完成'};
function showToast(message){
 toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{toast.hidden=true},4000);
}
renderOffice(EMPLOYEES,{office:$('officePeople'),grid:$('employeeGrid'),onSelect:showEmployee});
function showEmployee(employee){
 currentEmployee=employee;
 $('employeeTitle').textContent=employee.name;
 $('employeeCode').textContent=employee.title;
 $('employeeDescription').textContent=employee.scope;
 $('employeeFace').textContent=employee.symbol;
 $('employeeFace').style.background='linear-gradient(145deg,#fff,'+employee.color+')';
 dialog.showModal();
}
$('closeEmployee').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
function showPage(page){
 const target=$('page-'+page);if(!target)return;
 for(const section of document.querySelectorAll('.page'))section.classList.toggle('active',section===target);
 for(const nav of document.querySelectorAll('[data-page]')){
  const active=nav.dataset.page===page;nav.classList.toggle('active',active);
  if(active)nav.setAttribute('aria-current','page');else nav.removeAttribute('aria-current');
 }
 window.scrollTo({top:0,behavior:'auto'});
 if(history.replaceState)history.replaceState(null,'','#'+page);
 if(isSignedIn)refreshPage(page).catch(e=>showToast(e.message));
}
for(const button of document.querySelectorAll('[data-page]'))button.addEventListener('click',()=>showPage(button.dataset.page));
for(const button of document.querySelectorAll('[data-jump]'))button.addEventListener('click',()=>showPage(button.dataset.jump));
for(const button of document.querySelectorAll('[data-refresh]'))button.addEventListener('click',()=>refreshPage(button.dataset.refresh).catch(e=>showToast(e.message)));
function setConnection(connected){
 isSignedIn=connected;
 $('connectionStatus').textContent=workspaceMode()==='local'?'● 本機工作區':connected?'● 系統已登入':'● 未連線';
 $('connectionStatus').setAttribute('aria-label',connected?'後端已登入':'未連線');
 document.querySelector('.nav-footer').textContent=workspaceMode()==='local'?'SKAI V0.5 · 本機保存（非雲端同步）':connected?'SKAI V0.5 · 雲端測試環境':'SKAI V0.5 · 未連線預覽';
}
async function startSession(){
 if(workspaceMode()==='local'){setConnection(true);await refreshAll();return;}
 try{
  const data=await api('/session');
  setCsrfToken(data.csrf_token);setConnection(true);
  await refreshAll();
 }catch{
  setConnection(false);
 }
}
function openLogin(){
 if($('loginDialog').open)return;
 $('loginError').textContent='';
 $('loginDialog').showModal();
}
$('ceoInfo').addEventListener('click',()=>{
 if(workspaceMode()==='local')showToast('目前使用本機工作區，資料只在這台裝置保存。');
 else if(isSignedIn)showToast('已登入 CEO 測試帳號；請在正式版本再啟用帳號管理。');
 else openLogin();
});
$('loginForm').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button[type=submit]');
 button.disabled=true;$('loginError').textContent='';
 try{
  const password=$('ceoPassword').value;
  const data=await api('/session/login',{method:'POST',body:{password}});
  setCsrfToken(data.csrf_token);setConnection(true);
  $('ceoPassword').value='';$('loginDialog').close();
  showToast('CEO 已登入測試環境');
  await refreshAll();
 }catch(e){$('loginError').textContent='登入失敗：'+e.message;}
 finally{button.disabled=false;}
});
const statuses=TASK_STATUS;
async function loadProjects(){
 const data=await api('/projects');projectCache=data.projects||[];
 renderList($('projectList'),projectCache,'目前沒有專案。請先與幕僚長討論，再由 CEO 建立。',p=>
  listItem(p.name,p.goal||'未填寫目標',el('span','quiet-pill',p.stage||'draft')));
 const select=$('taskProject');
 const old=select.value;select.replaceChildren(new Option('選擇專案',''));
 for(const p of projectCache)select.add(new Option(p.name,p.id));
 select.value=projectCache.some(x=>x.id===old)?old:'';
}
async function loadTasks(){
 const data=await api('/tasks');
 renderList($('taskList'),data.tasks||[],'目前尚未建立任務。',t=>
  listItem(t.title,t.brief,el('span','quiet-pill',statuses[t.status]||t.status)));
}
async function loadOrchestrations(){
 const list=$('orchestrationList'),selector=$('orchestrationTask');
 if(workspaceMode()==='local'){
  selector.replaceChildren(new Option('請切換至已部署的雲端後端',''));
  renderList(list,[],'AI 跨部門協作需要真實後端、PostgreSQL 與 AI API；本機模式不會模擬 AI 工作。',()=>null);
  return;
 }
 const [tasksResult,runsResult]=await Promise.all([api('/tasks'),api('/orchestrations')]);
 const runs=runsResult.runs||[],eligible=(tasksResult.tasks||[]).filter(t=>t.status==='approved'&&!runs.some(r=>r.task_id===t.id));
 const old=selector.value;selector.replaceChildren(new Option('選擇已核准、未建立計畫的任務',''));
 for(const task of eligible)selector.add(new Option(task.title,task.id));
 selector.value=eligible.some(t=>t.id===old)?old:'';
 renderList(list,runs,'目前沒有跨部門協作計畫。請先建立任務並完成 CEO 核准。',run=>{
  const container=el('div','orchestration-entry');
  const status=orchestrationStatuses[run.plan_status]||run.plan_status;
  const info=listItem(run.task_title,run.summary||'幕僚長計畫',el('span','quiet-pill',status));
  const detail=el('div','orchestration-detail');
  const report=el('div','orchestration-report');
  const actions=el('div','inline-actions');
  const draw=async()=>{
   const data=await api('/orchestrations/'+encodeURIComponent(run.id));
   const current=data.run,steps=data.steps||[];
   detail.replaceChildren(el('p','helper','分工：'+steps.length+' 個部門 · 目前狀態：'+(orchestrationStatuses[current.plan_status]||current.plan_status)));
   for(const step of steps){
    const member=EMPLOYEES.find(e=>e.id===step.role_id);
    const description=el('p','helper',(member?.name||step.role_id)+' · '+(step.status||'pending')+' · '+step.instruction);
    detail.append(description);
    if(step.result){const result=el('p','orchestration-result',step.result);detail.append(result);}
    if(step.last_error)detail.append(el('p','helper','錯誤：'+step.last_error));
   }
   if(current.consolidated_report){
    const toggle=el('button','outline-btn','查看完整報告');toggle.type='button';
    const full=el('pre','orchestration-result',current.consolidated_report);full.hidden=true;
    toggle.addEventListener('click',()=>{full.hidden=!full.hidden;toggle.textContent=full.hidden?'查看完整報告':'收合完整報告';});
    detail.append(toggle,full);
   }
   actions.replaceChildren();
   const stepAction=(label,endpoint,confirmText)=>{
    const button=el('button','outline-btn',label);button.type='button';
    button.addEventListener('click',async()=>{
     if(!confirm(confirmText))return;
     button.disabled=true;
     try{await api('/orchestrations/'+encodeURIComponent(run.id)+'/'+endpoint,{method:'POST'});await draw();showToast('已保存：'+label);await Promise.all([loadTasks(),loadDashboard()]);}
     catch(e){showToast('未完成：'+e.message);button.disabled=false;}
    });
    actions.append(button);
   };
   if(current.plan_status==='draft')stepAction('CEO 核准分工','approve','確認核准 AI 幕僚長的部門分工？尚未執行分析。');
   if(['ready','running','failed','paused'].includes(current.plan_status)){
    stepAction('執行下一部門分析','advance','此操作將呼叫一次真實 AI API，可能產生費用。確定執行？');
    stepAction('恢復中斷步驟','recover','只在步驟中斷超過兩分鐘時使用。確認標記為待重試？');
   }
   if(current.plan_status==='review')stepAction('CEO 驗收結案','complete','已閱讀工作成果，確認僅將內部分析任務標記結案？');
  };
  const view=el('button','outline-btn','查看分工／執行');view.type='button';let open=false;
  view.addEventListener('click',async()=>{
   open=!open;detail.hidden=!open;actions.hidden=!open;view.textContent=open?'收合分工':'查看分工／執行';
   if(open){try{await draw()}catch(e){showToast('讀取失敗：'+e.message);}}
  });
  detail.hidden=true;actions.hidden=true;container.append(info,view,detail,actions,report);return container;
 });
}
$('orchestrationForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 if(workspaceMode()==='local')return showToast('AI 協作僅適用已部署的雲端後端');
 const button=event.currentTarget.querySelector('button[type=submit]');
 const taskId=$('orchestrationTask').value;if(!taskId)return;
 if(!confirm('將呼叫真實 AI API，由幕僚長產生分工計畫，可能產生費用。是否繼續？'))return;
 button.disabled=true;
 try{await api('/orchestrations/plan',{method:'POST',body:{task_id:taskId}});showToast('分工計畫已儲存，請由 CEO 核准');await loadOrchestrations();}
 catch(e){showToast('建立計畫失敗：'+e.message);}
 finally{button.disabled=false;}
});
async function loadApprovals(){
 const data=await api('/approvals');
 renderList($('approvalList'),data.approvals||[],'目前沒有待審批事項。',a=>{
  const actions=el('div','inline-actions');
  for(const [decision,label] of [['approved','核准'],['rejected','駁回']]){
   const button=el('button',decision==='approved'?'primary-btn':'outline-btn',label);
   button.type='button';
   button.addEventListener('click',async()=>{
    const message=decision==='approved'?'確認核准這項任務？':'確認駁回這項任務？';
    if(!confirm(message))return;
    button.disabled=true;
    try{await api('/approvals/'+encodeURIComponent(a.id)+'/decision',{method:'POST',body:{decision,note:'CEO 於指揮中心決策'}});showToast('決策已保存');await Promise.all([loadApprovals(),loadDashboard()]);}
    catch(e){showToast('審批失敗：'+e.message);button.disabled=false;}
   });
   actions.append(button);
  }
  return listItem(a.title,'待 CEO 決策 · '+new Date(a.created_at).toLocaleString('zh-TW'),actions);
 });
}
async function loadNotifications(){
 const data=await api('/operations/notifications');
 renderList($('notificationList'),data.notifications||[],'目前沒有內部通知。',n=>
  listItem(n.title,n.body,el('span','quiet-pill',n.status==='read'?'已讀':n.severity==='warning'?'需注意':'未讀')));
}
async function loadDashboard(){
 const data=await api('/dashboard');
 for(const [id,key] of [['statProjects','projects'],['statTasks','active'],['statApprovals','pending']])$(id).textContent=String(data.counts?.[key]??'—');
 $('projectLabel').textContent='資料庫紀錄';
 $('taskLabel').textContent='資料庫紀錄';
 $('approvalLabel').textContent='資料庫紀錄';
}
async function refreshPage(page){
 if(!isSignedIn)return;
 if(page==='home')await loadDashboard();
 if(page==='projects')await loadProjects();
 if(page==='tasks'){await loadProjects();await loadTasks();}
 if(page==='approvals')await loadApprovals();
 if(page==='orchestrations')await loadOrchestrations();
 if(page==='notifications')await loadNotifications();
}
async function refreshAll(){
 await Promise.allSettled([loadDashboard(),loadProjects(),loadTasks(),loadApprovals(),loadNotifications(),loadOrchestrations()]);
}
$('projectForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const fd=new FormData(event.currentTarget),name=String(fd.get('name')||'').trim(),goal=String(fd.get('goal')||'').trim();
 if(!name)return;
 const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/projects',{method:'POST',body:{name,goal}});event.currentTarget.reset();await Promise.all([loadProjects(),loadDashboard()]);showToast('專案已儲存');}
 catch(e){showToast(e.message)}
 finally{button.disabled=false;}
});
$('taskForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const fd=new FormData(event.currentTarget);
 const body={project_id:String(fd.get('project_id')||''),title:String(fd.get('title')||''),brief:String(fd.get('brief')||'')};
 const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/tasks',{method:'POST',body});event.currentTarget.reset();await Promise.all([loadTasks(),loadApprovals(),loadDashboard()]);showToast('任務已送至 CEO 審批');}
 catch(e){showToast(e.message)}
 finally{button.disabled=false;}
});
function chooseChat(role){
 currentEmployee=role;
 $('chatRoleName').textContent=role.name;
 const history=$('chatHistory');history.replaceChildren();
 history.append(el('p','helper','對話對象：'+role.name+'。如需查閱歷史紀錄，請待對話歷史畫面整合。'));
}
$('employeeChat').addEventListener('click',()=>{
 dialog.close();showPage('home');chooseChat(currentEmployee);$('chatText').focus();
 if(workspaceMode()==='local')showToast('目前是本機模式，AI 對話需連接雲端後端。');
 else if(!isSignedIn)showToast('請先登入，才能與 '+currentEmployee.name+' 對話');
});
$('chatPreviewForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const input=$('chatText'),content=input.value.trim();if(!content)return;
 const button=event.currentTarget.querySelector('button[type=submit]');
 const role=currentEmployee.id,history=$('chatHistory');
 history.append(el('p','chat-bubble user-bubble',content));input.value='';button.disabled=true;
 const waiting=el('p','chat-bubble ai-bubble','AI 思考中…');history.append(waiting);
 try{
  const data=await api('/chat',{method:'POST',body:{role_id:role,message:content,conversation_id:roleConversations.get(role)||undefined}});
  if(data.conversation_id)roleConversations.set(role,data.conversation_id);
  waiting.textContent=data.reply;
 }catch(e){waiting.textContent='未完成：'+e.message+'。請確認後端和 API 配置。';}
 finally{button.disabled=false;}
});
$('useLocal').addEventListener('click',async()=>{
 useLocalWorkspace();
 $('loginDialog').close();
 setConnection(true);
 await refreshAll();
 showToast('已切換本機工作區：專案、任務與核准會存在此瀏覽器。');
});
$('useCloud').addEventListener('click',async()=>{
 useCloudWorkspace();
 setCsrfToken(null);
 setConnection(false);
 await startSession();
 if(!isSignedIn)openLogin();
});
$('exportWorkspace').addEventListener('click',()=>{
 if(workspaceMode()!=='local')return showToast('請先切換到本機工作區');
 const blob=new Blob([localCompany.exportJson()],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='SKAI-V05-local-backup-'+new Date().toISOString().slice(0,10)+'.json';
 link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
});
$('importWorkspace').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(workspaceMode()!=='local')throw Error('先切換本機工作區');
  if(file.size>5e6)throw Error('備份檔案過大');
  if(!confirm('匯入將覆蓋目前裝置的本機工作區，確定嗎？'))return;
  localCompany.importJson(await file.text());
  await refreshAll();showToast('本機工作區已還原');
 }catch(error){showToast(error.message);}
 finally{e.target.value='';}
});
const initialPage=location.hash.slice(1);
if(['home','employees','projects','tasks','orchestrations','approvals','notifications'].includes(initialPage))showPage(initialPage);
startSession();
