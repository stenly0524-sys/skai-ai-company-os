import { EMPLOYEES, TASK_STATUS } from './data.js';
import { api,workspaceMode,useLocalWorkspace,useCloudWorkspace,setCsrfToken } from './api.js';
import { localCompany } from './storage.js';
import {renderOffice} from './scene.js';
import {el,listItem,renderList} from './ui.js';

const $=id=>document.getElementById(id);
const dialog=$('employeeDialog'),toast=$('toast');
let currentEmployee=EMPLOYEES[0],isSignedIn=false,toastTimer;
let projectCache=[],roleConversations=new Map();
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
 renderList($('projectList'),projectCache,'目前沒有專案。請先建立第一個專案。',p=>{
  const tools=el('div','inline-actions');
  tools.append(el('span','quiet-pill',String(p.progress??0)+'%'));
  const edit=el('button','outline-btn','更新進度');edit.type='button';
  edit.addEventListener('click',()=>openProjectEditor(p));tools.append(edit);
  return listItem(p.name,p.notes||p.goal||'尚無專案描述',tools);
 });
 const select=$('taskProject');
 const old=select.value;select.replaceChildren(new Option('選擇專案',''));
 for(const p of projectCache)select.add(new Option(p.name,p.id));
 select.value=projectCache.some(x=>x.id===old)?old:'';
}
async function loadTasks(){
 const data=await api('/tasks');
 renderList($('taskList'),data.tasks||[],'目前尚未建立任務。',t=>{
  const actions=el('div','inline-actions');
  actions.append(el('span','quiet-pill',(statuses[t.status]||t.status)+' · '+String(t.progress??0)+'%'));
  if(!['proposed','rejected'].includes(t.status)){
   const edit=el('button','outline-btn','更新狀態');edit.type='button';
   edit.addEventListener('click',()=>openTaskEditor(t));actions.append(edit);
  }
  return listItem(t.title,t.brief||'未填寫說明',actions);
 });
}
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
    try{await api('/approvals/'+encodeURIComponent(a.id)+'/decision',{method:'POST',body:{decision,note:'CEO 於指揮中心決策'}});showToast('決策已保存');await Promise.all([loadApprovals(),loadDashboard(),loadTasks(),loadHomeSummary()]);}
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
 if(page==='home')await Promise.all([loadDashboard(),loadHomeSummary()]);
 if(page==='data')await loadDataIndex();
 if(page==='projects')await loadProjects();
 if(page==='tasks'){await loadProjects();await loadTasks();}
 if(page==='approvals')await loadApprovals();
 if(page==='notifications')await loadNotifications();
}
async function refreshAll(){
 await Promise.allSettled([loadDashboard(),loadProjects(),loadTasks(),loadApprovals(),loadNotifications(),loadHomeSummary(),loadDataIndex()]);
}
$('projectForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const fd=new FormData(event.currentTarget),name=String(fd.get('name')||'').trim(),goal=String(fd.get('goal')||'').trim();
 if(!name)return;
 const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/projects',{method:'POST',body:{name,goal}});event.currentTarget.reset();await Promise.all([loadProjects(),loadDashboard(),loadHomeSummary(),loadDataIndex()]);showToast('專案已儲存');}
 catch(e){showToast(e.message)}
 finally{button.disabled=false;}
});
$('taskForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const fd=new FormData(event.currentTarget);
 const body={project_id:String(fd.get('project_id')||''),title:String(fd.get('title')||''),brief:String(fd.get('brief')||'')};
 const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/tasks',{method:'POST',body});event.currentTarget.reset();await Promise.all([loadTasks(),loadApprovals(),loadDashboard(),loadHomeSummary(),loadDataIndex()]);showToast('任務已送至 CEO 審批');}
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
 dialog.close();showPage('assistant');chooseChat(currentEmployee);$('chatText').focus();
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
 try{useCloudWorkspace()}catch(e){showToast(e.message);return;}
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
async function loadHomeSummary(){
 try{
  const [p,t,a]=await Promise.all([api('/projects'),api('/tasks'),api('/approvals')]);
  const projects=(p.projects||[]).slice(0,4),tasks=(t.tasks||[]).filter(x=>x.status!=='approved'&&x.status!=='rejected').slice(0,3),approvals=(a.approvals||[]).slice(0,2);
  renderList($('homeProjects'),projects,'尚無專案。可從「專案」建立。',x=>listItem(x.name,(x.notes||x.goal||'尚無簡介'),el('span','quiet-pill',String(x.progress??0)+'%')));
  renderList($('homeHighlights'),[...approvals.map(x=>({title:'待審批：'+x.title,brief:'需要 CEO 核准'})),...tasks.map(x=>({title:x.title,brief:'任務進度：'+(statuses[x.status]||x.status)}))],'目前沒有待處理事項。',x=>listItem(x.title,x.brief));
 }catch(e){$('homeHighlights').textContent='目前無法讀取任務摘要';$('homeProjects').textContent='目前無法讀取專案摘要';}
}
async function loadDataIndex(){
 const target=$('dataResults');if(!target)return;
 try{
  const [p,t]=await Promise.all([api('/projects'),api('/tasks')]);
  const q=$('dataSearch').value.trim().toLocaleLowerCase('zh-TW');
  const all=[...(p.projects||[]).map(x=>({title:'專案｜'+x.name,body:x.goal||'未填寫目標'})),...(t.tasks||[]).map(x=>({title:'任務｜'+x.title,body:x.brief||'無任務說明'}))];
  const matched=all.filter(x=>(x.title+' '+x.body).toLocaleLowerCase('zh-TW').includes(q)).slice(0,100);
  renderList(target,matched,'找不到符合的專案或任務紀錄。',x=>listItem(x.title,x.body));
 }catch(e){target.textContent='無法讀取資料：'+e.message;}
}
$('dataSearch').addEventListener('input',()=>loadDataIndex());
function openProjectEditor(p){
 const panel=$('projectEditor'),form=$('projectEditForm');
 panel.hidden=false;form.elements.id.value=p.id;
 $('projectEditName').value=p.name;
 form.elements.stage.value=['draft','planning','active','paused','completed'].includes(p.stage)?p.stage:'planning';
 form.elements.progress.value=Number(p.progress??0);
 form.elements.notes.value=p.notes||'';
 panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function openTaskEditor(t){
 const panel=$('taskEditor'),form=$('taskEditForm');
 panel.hidden=false;form.elements.id.value=t.id;$('taskEditName').value=t.title;
 form.elements.status.value=['approved','in_progress','review','done','paused'].includes(t.status)?t.status:'approved';
 form.elements.progress.value=Number(t.progress??0);
 panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('projectEditForm').addEventListener('submit',async event=>{
 event.preventDefault();const f=event.currentTarget;
 const body={stage:f.elements.stage.value,progress:Number(f.elements.progress.value),notes:f.elements.notes.value};
 try{await api('/projects/'+encodeURIComponent(f.elements.id.value),{method:'PATCH',body});
  $('projectEditor').hidden=true;
  await Promise.all([loadProjects(),loadDashboard(),loadHomeSummary(),loadDataIndex()]);
  showToast('專案進度已更新');
 }catch(e){showToast('無法更新專案：'+e.message);}
});
$('taskEditForm').addEventListener('submit',async event=>{
 event.preventDefault();const f=event.currentTarget;
 const body={status:f.elements.status.value,progress:Number(f.elements.progress.value)};
 try{await api('/tasks/'+encodeURIComponent(f.elements.id.value),{method:'PATCH',body});
  $('taskEditor').hidden=true;
  await Promise.all([loadTasks(),loadDashboard(),loadHomeSummary(),loadDataIndex()]);
  showToast('任務狀態已更新');
 }catch(e){showToast('無法更新任務：'+e.message);}
});
const initialPage=location.hash.slice(1);
if(['home','employees','projects','tasks','approvals','notifications','data','assistant'].includes(initialPage))showPage(initialPage);
startSession();
