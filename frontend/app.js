import { EMPLOYEES, TASK_STATUS } from './data.js';
import { api,workspaceMode,useLocalWorkspace,useCloudWorkspace,setCsrfToken } from './api.js';
import { localCompany } from './storage.js';
import {renderOffice} from './scene.js';
import { applyInterfaceIcons, makeIcon } from './icons.js';
import {el,listItem,renderList} from './ui.js';

const $=id=>document.getElementById(id);
const dialog=$('employeeDialog'),toast=$('toast');
let currentEmployee=EMPLOYEES[0],isSignedIn=false,toastTimer;
let projectCache=[],roleConversations=new Map(),chatHistoryRequest=0;
const orchestrationStatuses={draft:'待 CEO 核准分工',ready:'已核准，待執行',running:'分析中',paused:'暫停',failed:'分析失敗',review:'待 CEO 驗收',done:'已完成'};
function showToast(message){
 toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{toast.hidden=true},4000);
}
renderOffice(EMPLOYEES,{office:$('officePeople'),grid:$('employeeGrid'),mobileGrid:$('mobileOfficeGrid'),onSelect:showEmployee});
applyInterfaceIcons();
function showEmployee(employee){
 currentEmployee=employee;
 $('employeeTitle').textContent=employee.name;
 $('employeeCode').textContent=employee.title;
 $('employeeDescription').textContent=employee.scope;
 $('employeeFace').replaceChildren(makeIcon(employee.id));
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
 const more=$('mobileMore');
 if(more){more.classList.toggle('active',page==='employees'||page==='notifications');closeMobileMore();}
 window.scrollTo({top:0,behavior:'auto'});
 if(history.replaceState)history.replaceState(null,'','#'+page);
 if(isSignedIn)refreshPage(page).catch(e=>showToast(e.message));
}
for(const button of document.querySelectorAll('[data-page]'))button.addEventListener('click',()=>showPage(button.dataset.page));
function closeMobileMore(){
 const menu=$('mobileMoreMenu'),button=$('mobileMore');
 if(menu)menu.hidden=true;
 if(button)button.setAttribute('aria-expanded','false');
}
$('mobileMore')?.addEventListener('click',()=>{
 const menu=$('mobileMoreMenu'),button=$('mobileMore');
 menu.hidden=!menu.hidden;
 button.setAttribute('aria-expanded',String(!menu.hidden));
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMobileMore();});
document.addEventListener('click',event=>{
 if(!event.target.closest('#mobileMore')&&!event.target.closest('#mobileMoreMenu'))closeMobileMore();
});

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
  await chooseChat(currentEmployee);
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
  await chooseChat(currentEmployee);
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
    if(step.result){
     const toggle=el('button','outline-btn report-toggle','查看 '+(member?.name||step.role_id)+' 分析報告');
     toggle.type='button';toggle.setAttribute('aria-expanded','false');
     const result=el('div','orchestration-result',step.result);result.hidden=true;
     toggle.addEventListener('click',()=>{
      result.hidden=!result.hidden;
      toggle.setAttribute('aria-expanded',String(!result.hidden));
      toggle.textContent=(result.hidden?'查看 ':'收合 ')+(member?.name||step.role_id)+' 分析報告';
     });
     detail.append(toggle,result);
    }
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
 $('companyDataSource').textContent=workspaceMode()==='local'?'本機資料':'Neon 雲端資料';
 const projectCount=Number(data.counts?.projects)||0;
 const activeCount=Number(data.counts?.active)||0;
 const pendingCount=Number(data.counts?.pending)||0;
 const highlights=$('todayHighlights');
 highlights.replaceChildren(
  el('p','',pendingCount>0?'目前有 '+pendingCount+' 項待 CEO 審批':'目前沒有待 CEO 審批項目'),
  el('small','',activeCount+' 項任務進行中。資料取自 SKAI 已保存的任務與審批紀錄。')
 );
 const snapshot=$('projectSnapshot');
 snapshot.replaceChildren(
  el('p','',projectCount+' 個進行中的專案'),
  el('small','','目前統計未結案的專案；可至「專案」頁查看詳細資料。')
 );
 try{
  if(workspaceMode()==='local'){
   $('usageSummary').textContent='本機模式無雲端 AI API 用量。';
   $('usageDetails').textContent='請切換雲端模式查看真實用量。';
   return;
  }
  const usage=await api('/operations/usage');
  const stats=usage.usage||{};
  const used=Number(stats.reserved_calls)||0;
  const success=Number(stats.completed_calls)||0;
  const failed=Number(stats.failed_calls)||0;
  const input=Number(stats.total_input_tokens)||0;
  const output=Number(stats.total_output_tokens)||0;
  $('usageDay').textContent='台灣時間 · '+usage.day;
  $('usageSummary').textContent='今日已嘗試 '+used+' / '+usage.cap+' 次；剩餘 '+Math.max(0,usage.cap-used)+' 次';
  $('usageDetails').textContent='成功 '+success+' 次 · 失敗 '+failed+' 次 · 輸入 '+input.toLocaleString()+' tokens · 輸出 '+output.toLocaleString()+' tokens。失敗請求也計入防護上限，非實際費用。';
 }catch{
  $('usageSummary').textContent='目前無法讀取 AI API 用量。';
  $('usageDetails').textContent='其他公司資料不受影響。';
 }
}
async function refreshPage(page){
 if(!isSignedIn)return;
 if(page==='home')await loadDashboard();
 if(page==='projects')await loadProjects();
 if(page==='tasks'){await loadProjects();await loadTasks();}
 if(page==='approvals')await loadApprovals();
 if(page==='orchestrations')await loadOrchestrations();
 if(page==='notifications')await loadNotifications();
 if(page==='ai-controls')await loadAiControls();
}
async function loadAiControls(){
 const feedback=$('aiControlFeedback');
 if(workspaceMode()==='local'){
  $('controlStatus').textContent='本機模式不能修改雲端 AI 控制。';
  $('controlUsage').textContent='請切換雲端模式並登入 CEO。';
  $('aiControlForm').querySelector('button[type="submit"]').disabled=true;
  return;
 }
 if(!isSignedIn)return;
 try{
  const [data,usage]=await Promise.all([api('/operations/ai-settings'),api('/operations/usage')]);
  const s=data.settings;
  $('aiControlEnabled').checked=Boolean(s.ai_enabled);
  $('aiControlLimit').max=String(data.deployment_ceiling);
  $('aiControlLimit').value=String(s.daily_call_limit);
  $('aiTokenWarning').value=String(s.daily_token_warning);
  $('controlStatus').textContent=s.ai_enabled?'AI 已啟用 · 後續呼叫受 CEO 設定限制':'AI 已暫停 · 新的 AI 呼叫會被拒絕';
  const used=Number(usage.usage?.reserved_calls)||0;
  const total=Number(usage.usage?.total_input_tokens||0)+Number(usage.usage?.total_output_tokens||0);
  $('controlUsage').textContent='今日已嘗試 '+used+'／'+usage.cap+' 次，已記錄 '+total.toLocaleString()+' Tokens。';
  $('aiControlCeiling').textContent='目前部署安全上限：'+data.deployment_ceiling+' 次／日；CEO 可調低，無法超過此上限。';
  $('aiControlForm').querySelector('button[type="submit"]').disabled=false;
  feedback.textContent='以下設定僅控制 SKAI，並不代表 OpenAI 官方扣款限額。';
 }catch(e){feedback.textContent='無法讀取 AI 控制設定：'+e.message;}
}
$('aiControlForm').addEventListener('submit',async event=>{
 event.preventDefault();
 if(!isSignedIn)return openLogin();
 if(workspaceMode()==='local')return showToast('請切換至雲端模式。');
 const form=event.currentTarget,button=form.querySelector('button[type="submit"]');
 const body={
  ai_enabled:$('aiControlEnabled').checked,
  daily_call_limit:Number($('aiControlLimit').value),
  daily_token_warning:Number($('aiTokenWarning').value)
 };
 if(!Number.isSafeInteger(body.daily_call_limit)||!Number.isSafeInteger(body.daily_token_warning))return showToast('請輸入有效整數');
 button.disabled=true;
 $('aiControlFeedback').textContent='正在保存至雲端資料庫…';
 try{
  await api('/operations/ai-settings',{method:'POST',body});
  await Promise.all([loadDashboard(),loadAiControls()]);
  $('aiControlFeedback').textContent='設定已保存於雲端，後續 AI 呼叫立即依新設定執行。';
 }catch(e){$('aiControlFeedback').textContent='設定未保存：'+e.message}
 finally{button.disabled=false}
});
async function refreshAll(){
 await Promise.allSettled([loadDashboard(),loadProjects(),loadTasks(),loadApprovals(),loadNotifications(),loadOrchestrations()]);
}
$('projectForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const form=event.currentTarget;
 const fd=new FormData(form),name=String(fd.get('name')||'').trim(),goal=String(fd.get('goal')||'').trim();
 if(!name)return;
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/projects',{method:'POST',body:{name,goal}});form.reset();await Promise.all([loadProjects(),loadDashboard()]);showToast('專案已儲存');}
 catch(e){showToast(e.message)}
 finally{button.disabled=false;}
});
$('taskForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const form=event.currentTarget;
 const fd=new FormData(form);
 const body={project_id:String(fd.get('project_id')||''),title:String(fd.get('title')||''),brief:String(fd.get('brief')||'')};
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/tasks',{method:'POST',body});form.reset();await Promise.all([loadTasks(),loadApprovals(),loadDashboard()]);showToast('任務已送至 CEO 審批');}
 catch(e){showToast(e.message)}
 finally{button.disabled=false;}
});
async function chooseChat(role){
 currentEmployee=role;
 $('chatRoleName').textContent=role.name;
 const history=$('chatHistory');history.replaceChildren();
 const requestId=++chatHistoryRequest;
 if(workspaceMode()==='local'){
  history.append(el('p','helper','本機工作區不提供 AI 對話，請切換到已部署的後端。'));
  return;
 }
 if(!isSignedIn){
  history.append(el('p','helper','登入 CEO 後，將自 PostgreSQL 載入此主管已保存的對話紀錄。'));
  return;
 }
 history.append(el('p','helper','從資料庫載入對話紀錄中…'));
 try{
  const list=await api('/conversations?role_id='+encodeURIComponent(role.id));
  if(requestId!==chatHistoryRequest)return;
  const latest=list.conversations?.[0];
  if(!latest){
   roleConversations.delete(role.id);
   history.replaceChildren(el('p','helper','此主管尚未有已保存的對話紀錄。'));
   return;
  }
  const data=await api('/conversations/'+encodeURIComponent(latest.id)+'/messages');
  if(requestId!==chatHistoryRequest)return;
  roleConversations.set(role.id,latest.id);
  history.replaceChildren();
  if(data.truncated)history.append(el('p','helper','僅顯示最近 100 則訊息，完整紀錄仍保存於 PostgreSQL。'));
  for(const message of data.messages||[]){
   history.append(el('p','chat-bubble '+(message.speaker==='user'?'user-bubble':'ai-bubble'),message.body));
  }
  if(!data.messages?.length)history.append(el('p','helper','此對話目前沒有已保存的訊息。'));
  history.scrollTop=history.scrollHeight;
 }catch(e){
  if(requestId!==chatHistoryRequest)return;
  history.replaceChildren(el('p','helper','無法載入歷史紀錄：'+e.message));
 }
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
 const role=currentEmployee.id,history=$('chatHistory'),requestId=chatHistoryRequest;
 history.append(el('p','chat-bubble user-bubble',content));input.value='';button.disabled=true;
 const waiting=el('p','chat-bubble ai-bubble','AI 思考中…');history.append(waiting);
 try{
  const data=await api('/chat',{method:'POST',body:{role_id:role,message:content,conversation_id:roleConversations.get(role)||undefined}});
  if(data.conversation_id)roleConversations.set(role,data.conversation_id);
  if(requestId===chatHistoryRequest)waiting.textContent=data.reply;
 }catch(e){if(requestId===chatHistoryRequest)waiting.textContent='未完成：'+e.message+'。請確認後端和 API 配置。';}
 finally{button.disabled=false;}
});
$('useLocal').addEventListener('click',async()=>{
 useLocalWorkspace();
 roleConversations.clear();
 await chooseChat(currentEmployee);
 $('loginDialog').close();
 setConnection(true);
 await refreshAll();
 showToast('已切換本機工作區：專案、任務與核准會存在此瀏覽器。');
});
$('useCloud').addEventListener('click',async()=>{
 useCloudWorkspace();
 roleConversations.clear();
 await chooseChat(currentEmployee);
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
