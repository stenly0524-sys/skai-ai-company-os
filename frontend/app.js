import { EMPLOYEES } from './employees.js';

const $=id=>document.getElementById(id);
const office=$('officePeople'),grid=$('employeeGrid'),dialog=$('employeeDialog'),toast=$('toast');
let currentEmployee=EMPLOYEES[0],csrfToken=null,isSignedIn=false,toastTimer;
let projectCache=[],roleConversations=new Map();
function showToast(message){
 toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{toast.hidden=true},4000);
}
function el(tag,cls,text){
 const e=document.createElement(tag);
 if(cls)e.className=cls;
 if(text!==undefined)e.textContent=String(text);
 return e;
}
function employeeButton(employee,small=false){
 const button=el('button',small?'office-person':'employee-card');
 button.type='button';
 if(small){button.style.left=employee.x+'%';button.style.top=employee.y+'%';}
 else button.setAttribute('aria-label','查看 '+employee.name);
 const face=el('span','person-head',employee.symbol);
 face.style.background='linear-gradient(145deg,#fff,'+employee.color+')';
 const label=el(small?'span':'b',small?'person-label':'',employee.name);
 button.append(face,label);
 if(!small)button.append(el('small','',employee.title));
 button.addEventListener('click',()=>showEmployee(employee));
 return button;
}
for(const employee of EMPLOYEES){office.append(employeeButton(employee,true));grid.append(employeeButton(employee,false));}
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
 $('connectionStatus').textContent=connected?'● 系統已登入':'● 未連線';
 $('connectionStatus').setAttribute('aria-label',connected?'後端已登入':'未連線');
 document.querySelector('.nav-footer').textContent=connected?'SKAI V0.5 · 測試環境':'SKAI V0.5 · 未連線預覽';
}
async function api(path,{method='GET',body}={}){
 const headers={Accept:'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 if(!['GET','HEAD'].includes(method) && !path.endsWith('/session/login')){
  if(!csrfToken)throw Error('請先登入 CEO 帳號');
  headers['X-CSRF-Token']=csrfToken;
 }
 const response=await fetch('/api'+path,{
  method,headers,credentials:'same-origin',
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 let data;
 try{data=await response.json()}catch{throw Error('SKAI API 尚未部署或回傳格式錯誤');}
 if(!response.ok){
  if(response.status===401){setConnection(false);csrfToken=null;}
  throw Error(data?.error||'系統回應失敗');
 }
 return data;
}
async function startSession(){
 try{
  const data=await api('/session');
  csrfToken=data.csrf_token;setConnection(true);
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
 if(isSignedIn)showToast('已登入 CEO 測試帳號；請在正式版本再啟用帳號管理。');
 else openLogin();
});
$('loginForm').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button[type=submit]');
 button.disabled=true;$('loginError').textContent='';
 try{
  const password=$('ceoPassword').value;
  const data=await api('/session/login',{method:'POST',body:{password}});
  csrfToken=data.csrf_token;setConnection(true);
  $('ceoPassword').value='';$('loginDialog').close();
  showToast('CEO 已登入測試環境');
  await refreshAll();
 }catch(e){$('loginError').textContent='登入失敗：'+e.message;}
 finally{button.disabled=false;}
});
const statuses={proposed:'待審批',approved:'已核准',in_progress:'執行中',review:'待驗收',done:'完成',paused:'暫停',rejected:'已駁回'};
function listItem(title,description,extra){
 const item=el('article','data-item');
 item.append(el('b','',title));
 if(description)item.append(el('p','helper',description));
 if(extra)item.append(extra);
 return item;
}
function renderList(id,rows,empty,mapper){
 const root=$(id);root.replaceChildren();
 if(!rows.length){root.append(el('p','helper',empty));return;}
 for(const row of rows)root.append(mapper(row));
}
async function loadProjects(){
 const data=await api('/projects');projectCache=data.projects||[];
 renderList('projectList',projectCache,'目前沒有專案。請先與幕僚長討論，再由 CEO 建立。',p=>
  listItem(p.name,p.goal||'未填寫目標',el('span','quiet-pill',p.stage||'draft')));
 const select=$('taskProject');
 const old=select.value;select.replaceChildren(new Option('選擇專案',''));
 for(const p of projectCache)select.add(new Option(p.name,p.id));
 select.value=projectCache.some(x=>x.id===old)?old:'';
}
async function loadTasks(){
 const data=await api('/tasks');
 renderList('taskList',data.tasks||[],'目前尚未建立任務。',t=>
  listItem(t.title,t.brief,el('span','quiet-pill',statuses[t.status]||t.status)));
}
async function loadApprovals(){
 const data=await api('/approvals');
 renderList('approvalList',data.approvals||[],'目前沒有待審批事項。',a=>{
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
 renderList('notificationList',data.notifications||[],'目前沒有內部通知。',n=>
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
 if(page==='notifications')await loadNotifications();
}
async function refreshAll(){
 await Promise.allSettled([loadDashboard(),loadProjects(),loadTasks(),loadApprovals(),loadNotifications()]);
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
 if(!isSignedIn)showToast('請先登入，才能與 '+currentEmployee.name+' 對話');
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
const initialPage=location.hash.slice(1);
if(['home','employees','projects','tasks','approvals','notifications'].includes(initialPage))showPage(initialPage);
startSession();
