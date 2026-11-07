import { EMPLOYEES, TASK_STATUS } from './data.js';
import { api,workspaceMode,useLocalWorkspace,useCloudWorkspace,setCsrfToken } from './api.js';
import { localCompany } from './storage.js';
import {renderOffice} from './scene.js';
import { applyInterfaceIcons, makeIcon } from './icons.js';
import {el,listItem,renderList} from './ui.js';

const $=id=>document.getElementById(id);
const dialog=$('employeeDialog'),toast=$('toast');
let currentEmployee=EMPLOYEES[0],isSignedIn=false,toastTimer;
let activeQuickProjectId=null,projectCache=[],roleConversations=new Map(),chatHistoryRequest=0,projectFilter='all',taskFilter='all',taskCache=[],selectedTaskIds=new Set(),approvalCache=[];
const orchestrationStatuses={draft:'待 CEO 審核提案',ready:'已核准，待執行',running:'分析中',paused:'暫停',failed:'分析失敗',review:'待 CEO 驗收',done:'已完成'};
function showToast(message){
 toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{toast.hidden=true},4000);
}
renderOffice(EMPLOYEES,{office:$('officePeople'),grid:$('employeeGrid'),mobileGrid:$('mobileOfficeGrid'),onSelect:showEmployee});
applyInterfaceIcons();
function showEmployee(employee){
 currentEmployee=employee;
 if(employee.id==='finance'||employee.id==='tech'){
  showPage(employee.id==='finance'?'department-finance':'department-tech');
  return;
 }
 $('employeeTitle').textContent=employee.name;
 $('employeeCode').textContent=employee.title;
 $('employeeDescription').textContent=employee.scope;
 $('employeeFace').replaceChildren(makeIcon(employee.id));
 $('employeeFace').style.background='linear-gradient(145deg,#fff,'+employee.color+')';
 dialog.showModal();
}
$('closeEmployee').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
function showPage(page,skipRefresh=false){
 const target=$('page-'+page);if(!target)return;
 for(const section of document.querySelectorAll('.page')){
  const active=section===target;
  section.classList.toggle('active',active);
  section.hidden=!active;
 }
 for(const nav of document.querySelectorAll('[data-page]')){
  const active=nav.dataset.page===page;nav.classList.toggle('active',active);
  if(active)nav.setAttribute('aria-current','page');else nav.removeAttribute('aria-current');
 }
 const more=$('mobileMore');
 if(more){more.classList.toggle('active',['employees','approvals','notifications','department-tech','department-finance'].includes(page));closeMobileMore();}
 window.scrollTo({top:0,behavior:'auto'});
 document.body.dataset.currentPage=page;
 if(history.replaceState)history.replaceState(null,'','#'+page);
 const headings={home:['總部｜早安，CEO','SKAI OS｜個人企業智慧管理中心'],employees:['部門中心','各部門虛擬主管與工作內容'],projects:['專案中心','管理所有專案、進度與里程碑'],tasks:['任務中心','管理與追蹤所有任務執行進度'],data:['資料中心','集中管理知識與工作紀錄'],assistant:['智能助理','你的專屬策略與執行助理']};
 const heading=headings[page]||['SKAI 指揮中心','管理功能'];$('pageTitle').textContent=heading[0];$('pageSubtitle').textContent=heading[1];
 if(isSignedIn&&!skipRefresh)refreshPage(page).catch(e=>showToast(e.message));
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

for(const button of document.querySelectorAll('[data-jump]'))button.addEventListener('click',()=>{showPage(button.dataset.jump);const which=button.dataset.open;if(which==='project'){$('projectCreatePanel').hidden=false;$('projectForm')?.scrollIntoView({behavior:'smooth',block:'center'});}if(which==='task')$('taskCreatePanel')?.showModal();if(button.dataset.jump==='data')$('dataSearch')?.focus();});
for(const button of document.querySelectorAll('[data-refresh]'))button.addEventListener('click',()=>refreshPage(button.dataset.refresh).catch(e=>showToast(e.message)));
function setConnection(connected){
 isSignedIn=connected;
 $('connectionStatus').textContent=workspaceMode()==='local'?'● 本機工作區':connected?'● 系統已登入':'● 未連線';
 $('connectionStatus').setAttribute('aria-label',connected?'後端已登入':'未連線');
 document.querySelector('.nav-footer').textContent=workspaceMode()==='local'?'本機工作區':'SKAI OS';
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
 renderProjectCards();
 renderList($('projectList'),projectCache,'目前沒有專案。請先與幕僚長討論，再由 CEO 建立。',p=>
  listItem(p.name,p.goal||'未填寫目標',el('span','quiet-pill',p.stage||'draft')));
 const select=$('taskProject');
 const old=select.value;select.replaceChildren(new Option('選擇專案',''));
 for(const p of projectCache)select.add(new Option(p.name,p.id));
 select.value=projectCache.some(x=>x.id===old)?old:'';
 const taskSelector=$('taskProjectFilter');if(taskSelector){const chosen=taskSelector.value;taskSelector.replaceChildren(new Option('全部專案',''));for(const p of projectCache)taskSelector.add(new Option(p.name,p.id));taskSelector.value=projectCache.some(x=>x.id===chosen)?chosen:'';renderTaskCards();}
}
async function loadTasks(){
 const data=await api('/tasks');taskCache=data.tasks||[];renderTaskCards();
 renderList($('taskList'),data.tasks||[],'目前尚未建立任務。',t=>
  listItem(t.title,t.brief||'由幕僚長規劃處理事項',el('span','quiet-pill',statuses[t.status]||t.status)));
}
async function loadOrchestrations(){
 const list=$('orchestrationList'),selector=$('orchestrationTask');
 if(workspaceMode()==='local'){
  selector.replaceChildren(new Option('需切換至雲端模式',''));
  renderList(list,[],'幕僚長規劃需使用雲端 AI。此本機工作區只保留基本專案／任務功能。',()=>null);
  return;
 }
 const [tasksResult,runsResult]=await Promise.all([api('/tasks'),api('/orchestrations')]);
 const runs=runsResult.runs||[];
 const eligible=(tasksResult.tasks||[]).filter(t=>t.status==='approved'&&!runs.some(r=>r.task_id===t.id));
 const old=selector.value;
 selector.replaceChildren(new Option('選擇尚未規劃的任務',''));
 for(const t of eligible)selector.add(new Option(t.title,t.id));
 selector.value=eligible.some(t=>t.id===old)?old:'';
 renderList(list,runs,'尚未建立幕僚長提案。建立 CEO 任務後會自動請幕僚長規劃。',run=>{
  const container=el('div','orchestration-entry');
  const status=orchestrationStatuses[run.plan_status]||run.plan_status;
  const info=listItem(run.task_title,run.summary||'幕僚長提案',el('span','quiet-pill',status));
  const detail=el('div','orchestration-detail');
  const actions=el('div','inline-actions');
  const view=el('button','outline-btn','查看幕僚長提案');
  view.type='button';
  let opened=run.plan_status==='draft';
  const apiPath='/orchestrations/'+encodeURIComponent(run.id);
  const roleOptions=EMPLOYEES.filter(e=>e.id!=='chief_of_staff');
  function editorRow(s){
   const row=el('div','chief-step-editor');
   const label=el('label','','執行部門');
   const role=document.createElement('select');role.className='chief-field';
   for(const e of roleOptions)role.add(new Option(e.name,e.id));
   role.value=s.role_id||roleOptions[0].id;
   label.append(role);
   const instructionLabel=el('label','','具體工作及交付成果');
   const instruction=document.createElement('textarea');instruction.maxLength=2000;
   instruction.rows=3;instruction.value=s.instruction||'';
   instructionLabel.append(instruction);
   const row2=el('div','chief-estimate-row');
   const timeLabel=el('label','','預估分鐘');
   const time=document.createElement('input');time.type='number';time.min='1';time.max='240';time.required=true;
   time.value=String(s.estimated_minutes||10);timeLabel.append(time);
   const tokenLabel=el('label','','輸出 Token 上限');
   const tokens=document.createElement('input');tokens.type='number';tokens.min='600';tokens.max='2400';tokens.required=true;
   tokens.value=String(s.max_output_tokens||1200);tokenLabel.append(tokens);
   const remove=el('button','outline-btn','移除部門');remove.type='button';remove.addEventListener('click',()=>row.remove());
   row2.append(timeLabel,tokenLabel,remove);row.append(label,instructionLabel,row2);
   row.getStep=()=>({role_id:role.value,instruction:instruction.value.trim(),estimated_minutes:Number(time.value),max_output_tokens:Number(tokens.value)});
   return row;
  }
  const draw=async()=>{
   const data=await api(apiPath);
   const current=data.run,steps=data.steps||[];
   detail.replaceChildren();
   const projection=current.plan_estimate||{};
   detail.append(el('p','helper','目前狀態：'+(orchestrationStatuses[current.plan_status]||current.plan_status)+' · 方案版本 V'+(current.plan_version||1)));
   const amount=Number(projection.estimated_usd)||steps.reduce((sum,s)=>sum+Number(s.estimated_usd||0),0);
   const time=Number(projection.total_minutes)||steps.reduce((sum,s)=>sum+Number(s.estimated_minutes||0),0);
   const tokens=Number(projection.total_tokens)||steps.reduce((sum,s)=>sum+Number(s.estimated_input_tokens||0)+Number(s.max_output_tokens||0),0);
   detail.append(el('div','chief-budget-summary','規劃總計：約 '+time+' 分鐘 · '+tokens.toLocaleString()+' Tokens · US$'+amount.toFixed(4)+'（估算）'));
   detail.append(el('p','helper','以下是規劃估計，非完成時間保證或正式帳單。AI 幕僚長的規劃／重提費用不包含在部門執行預算中；實際呼叫仍受每日及每月美元上限約束。'));
   for(const step of steps){
    const member=EMPLOYEES.find(e=>e.id===step.role_id);
    const name=member?.name||step.role_id;
    const card=el('div','chief-step-card');
    card.append(el('b','',name+'｜'+(step.status==='done'?'已完成':step.status==='running'?'執行中':step.status==='failed'?'執行失敗':'待執行')));
    card.append(el('p','helper',step.instruction));
    card.append(el('p','helper','約 '+(step.estimated_minutes??'—')+' 分鐘 · 輸入約 '+(step.estimated_input_tokens??'—')+' Tokens · 輸出上限 '+(step.max_output_tokens??2400)+' Tokens · US$'+Number(step.estimated_usd||0).toFixed(4)));
    if(step.result){
     const toggle=el('button','outline-btn','查看 '+name+' 成果');toggle.type='button';
     const result=el('pre','orchestration-result',step.result);result.hidden=true;
     toggle.addEventListener('click',()=>{result.hidden=!result.hidden;toggle.textContent=result.hidden?'查看 '+name+' 成果':'收合 '+name+' 成果';});
     card.append(toggle,result);
    }
    if(step.last_error)card.append(el('p','helper','錯誤：'+step.last_error));
    detail.append(card);
   }
   if(current.consolidated_report){
    const toggle=el('button','outline-btn','查看完整成果');toggle.type='button';
    const full=el('pre','orchestration-result',current.consolidated_report);full.hidden=true;
    toggle.addEventListener('click',()=>{full.hidden=!full.hidden;toggle.textContent=full.hidden?'查看完整成果':'收合完整成果';});
    detail.append(toggle,full);
   }
   actions.replaceChildren();
   const action=(label,endpoint,message,css='outline-btn')=>{
    const button=el('button',css,label);button.type='button';
    button.addEventListener('click',async()=>{
     if(!confirm(message))return;
     button.disabled=true;
     try{await api(apiPath+'/'+endpoint,{method:'POST'});await draw();showToast('操作已完成：'+label);await Promise.all([loadTasks(),loadDashboard()]);}
     catch(e){showToast('操作未完成：'+e.message);button.disabled=false;}
    });
    actions.append(button);
   };
   if(current.plan_status==='draft'){
    const feedbackForm=el('form','chief-feedback-form');
    const feedbackLabel=el('label','','向幕僚長要求修改方案');
    const feedback=document.createElement('textarea');feedback.rows=3;feedback.maxLength=2000;feedback.required=true;
    feedback.placeholder='例如：花費太高，請減少不必要部門，總預算壓在 US$0.01 以內；或時間太久，請縮短到 15 分鐘。';
    feedbackLabel.append(feedback);
    const submit=el('button','outline-btn','請幕僚長重新調整方案');submit.type='submit';
    feedbackForm.append(feedbackLabel,submit);
    feedbackForm.addEventListener('submit',async e=>{
     e.preventDefault();if(!feedback.value.trim())return;
     if(!confirm('重新生成方案會呼叫 AI 並產生費用。確定要求幕僚長修訂？'))return;
     submit.disabled=true;
     try{await api(apiPath+'/revise',{method:'POST',body:{feedback:feedback.value.trim()}});await draw();showToast('幕僚長已提出修訂版本，仍待 CEO 確認。');}
     catch(err){showToast('修訂失敗：'+err.message);submit.disabled=false;}
    });
    detail.append(feedbackForm);
    const editor=el('div','chief-edit-panel');
    const editToggle=el('button','outline-btn','CEO 直接修改分工與資源');editToggle.type='button';
    const editBody=el('div','chief-edit-body');editBody.hidden=true;
    editToggle.addEventListener('click',()=>{editBody.hidden=!editBody.hidden;});
    const summaryLabel=el('label','','計畫說明');
    const summary=document.createElement('textarea');summary.maxLength=2000;summary.rows=3;summary.value=current.summary||'';summaryLabel.append(summary);
    const rows=el('div','chief-editor-rows');
    for(const step of steps)rows.append(editorRow(step));
    const add=el('button','outline-btn','增加部門工作');add.type='button';
    add.addEventListener('click',()=>{if(rows.children.length>=8)return showToast('最多 8 個部門工作');rows.append(editorRow({}));});
    const save=el('button','primary-btn','儲存 CEO 修改後的方案');save.type='button';
    save.addEventListener('click',async()=>{
     const edited=Array.from(rows.children).map(row=>row.getStep());
     if(edited.length<1||edited.length>8||!summary.value.trim()||edited.some(x=>!x.instruction||!Number.isInteger(x.estimated_minutes)||x.estimated_minutes<1||x.estimated_minutes>240||!Number.isInteger(x.max_output_tokens)||x.max_output_tokens<600||x.max_output_tokens>2400)){
      return showToast('請確認部門數、工作說明、預估時間與 Token 上限。');
     }
     save.disabled=true;
     try{await api(apiPath+'/edit',{method:'POST',body:{plan_version:current.plan_version,summary:summary.value.trim(),steps:edited}});await draw();showToast('CEO 修正已儲存，需再次核准才可執行。');}
     catch(e){showToast('儲存失敗：'+e.message);save.disabled=false;}
    });
    editBody.append(summaryLabel,rows,add,save);editor.append(editToggle,editBody);
    detail.append(editor);
    action('CEO 確認並核准執行','approve','確定核准目前分工與時間／Token／美元估算？核准後可逐步啟動部門工作。','primary-btn');
   }else if(['ready','running','failed','paused'].includes(current.plan_status)){
    action('執行下一部門任務','advance','執行將呼叫 OpenAI API，產生實際 Token 與美元費用。確定？');
    action('恢復中斷任務','recover','僅適用中斷超過 2 分鐘的步驟，確認恢復為可重試？');
   }else if(current.plan_status==='review'){
    action('CEO 驗收並結案','complete','確認已閱讀工作成果，標記內部任務結案？');
   }
   actions.hidden=!opened;
  };
  view.addEventListener('click',async()=>{
   opened=!opened;detail.hidden=!opened;actions.hidden=!opened;
   view.textContent=opened?'收合幕僚長提案':'查看幕僚長提案';
   if(opened){try{await draw()}catch(e){showToast('讀取失敗：'+e.message);}}
  });
  detail.hidden=!opened;actions.hidden=!opened;
  view.textContent=opened?'收合幕僚長提案':'查看幕僚長提案';
  container.append(info,view,detail,actions);
  if(opened)draw().catch(e=>showToast('讀取提案失敗：'+e.message));
  return container;
 });
}
$('orchestrationForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 if(workspaceMode()==='local')return showToast('幕僚長規劃僅可在雲端模式執行');
 const button=event.currentTarget.querySelector('button[type=submit]');
 const taskId=$('orchestrationTask').value;if(!taskId)return;
 if(!confirm('產生提案會呼叫一次真實 AI API，可能產生費用。確定？'))return;
 button.disabled=true;
 try{await api('/orchestrations/plan',{method:'POST',body:{task_id:taskId}});showToast('幕僚長已提出草案，等待 CEO 確認');await loadOrchestrations();}
 catch(e){showToast('幕僚長規劃失敗：'+e.message);}
 finally{button.disabled=false;}
});
async function loadApprovals(){
 const data=await api('/approvals');
 approvalCache=data.approvals||[];
 renderList($('approvalList'),data.approvals||[],'目前沒有待審批事項。',a=>{
  const actions=el('div','inline-actions');
  for(const [decision,label] of [['approved','核准'],['rejected','駁回']]){
   const button=el('button',decision==='approved'?'primary-btn':'outline-btn',label);
   button.type='button';
   button.addEventListener('click',async()=>{
    const message=decision==='approved'?'確認核准這項任務？':'確認駁回這項任務？';
    if(!confirm(message))return;
    button.disabled=true;
    try{await api('/approvals/'+encodeURIComponent(a.id)+'/decision',{method:'POST',body:{decision,note:'CEO 於指揮中心決策'}});showToast('決策已保存');await Promise.all([loadApprovals(),loadTasks(),loadDashboard()]);}
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
 const result=await api('/dashboard');
 const data=result.counts||{};
 for(const [id,key] of [['statProjects','projects'],['statApprovals','pending']])$(id).textContent=String(data[key]??'—');
 $('projectLabel').textContent='';$('taskLabel').textContent='';$('approvalLabel').textContent='已保存審批';
 const badge=$('taskNavBadge'),bell=$('headerNotificationCount');const n=Number(data.pending)||0;
 if(badge){badge.hidden=n<=0;badge.textContent=n>99?'99+':String(n);}
 if(bell){bell.hidden=n<=0;bell.textContent=n>99?'99+':String(n);}
 $('companyDataSource').textContent='';
 const highlights=$('todayHighlights');
 highlights.replaceChildren(el('p','',String(data.pending??'—')+' 項待審批'),el('small','','使用已保存資料，非模擬數字'));
 const [p,t]=await Promise.all([api('/projects'),api('/tasks')]);
 const projects=p.projects||[],tasks=t.tasks||[];
 $('statTasks').textContent=String(tasks.filter(t=>!['done','rejected'].includes(t.status)).length);
 const snapshot=$('projectSnapshot');
 snapshot.replaceChildren(el('p','',String(data.projects??'—')+' 個未結案專案'));
 const monday=new Date();const day=(monday.getDay()+6)%7;monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-day);
 const recent=tasks.filter(x=>x.updated_at&&new Date(x.updated_at)>=monday);
 const done=recent.filter(x=>x.status==='done').length;
 $('statWeekly').textContent=recent.length?Math.round(100*done/recent.length)+'%':'—';
 $('weeklyLabel').textContent=recent.length?'本週更新的 '+recent.length+' 項任務':'本週尚無任務更新';
 renderHomeProjects(projects);renderHomeTodos(tasks,data.pending??0);
 await loadHomeAiUsage();
 $('statAiCost').textContent='—';
 $('costLabel').textContent='';
 if(workspaceMode()==='cloud'){
  try{const usage=await api('/operations/usage');const usd=Number(usage.cost?.month_usd);
   if(Number.isFinite(usd)){$('statAiCost').textContent='$'+usd.toFixed(2);$('costLabel').textContent='';}
   else $('costLabel').textContent='';
  }catch{$('costLabel').textContent='';}
 }
}
async function loadHomeAiUsage(){
 const counts=['homeAiCalls','homeAiInputTokens','homeAiOutputTokens','homeAiTotalTokens'];
 const status=$('homeAiStatus');counts.forEach(id=>$(id).textContent='—');
 if(workspaceMode()==='local'){
  status.textContent='本機模式不包含 AI API 用量，請使用雲端工作區。';
  return;
 }
 status.textContent='正在讀取今日 AI 用量…';
 try{
  const data=await api('/operations/usage'),usage=data.usage||{};
  const parsed=['reserved_calls','total_input_tokens','total_output_tokens'];
  if(parsed.some(k=>usage[k]===undefined||usage[k]===null||!Number.isFinite(Number(usage[k])))){
   status.textContent='尚無完整的 AI API 用量紀錄。';return;
  }
  const calls=Number(usage.reserved_calls),input=Number(usage.total_input_tokens),output=Number(usage.total_output_tokens);
  $('homeAiCalls').textContent=calls.toLocaleString('zh-TW');
  $('homeAiInputTokens').textContent=input.toLocaleString('zh-TW');
  $('homeAiOutputTokens').textContent=output.toLocaleString('zh-TW');
  $('homeAiTotalTokens').textContent=(input+output).toLocaleString('zh-TW');
  const ok=Number(usage.completed_calls)||0,failed=Number(usage.failed_calls)||0;
  status.textContent=(data.day?'台灣時間 '+data.day+' · ':'')+'成功 '+ok+' 次 · 失敗 '+failed+' 次'+
   (Number.isFinite(Number(data.cap))?' · 上限 '+Number(data.cap).toLocaleString('zh-TW')+' 次':'')+
   ' · 數值為後端已紀錄用量';
 }catch(e){
  status.textContent='AI API 用量暫時無法讀取：'+e.message;
 }
}
function renderHomeProjects(projects){
 const root=$('homeProjectBars');root.replaceChildren();
 const visible=projects.filter(p=>p.status!=='closed').slice(0,5);
 if(!visible.length){root.append(el('p','helper','目前沒有進行中專案。'));return;}
 for(const p of visible){
  const b=el('button','project-progress-row');b.type='button';
  const name=el('span','project-progress-name',p.name);const value=Number(p.progress),known=p.progress!==null&&p.progress!==undefined&&Number.isFinite(value);
  const percent=known?Math.max(0,Math.min(100,value)):null;
  const figure=el('b','project-progress-value',percent===null?'未設定':percent+'%');
  const bar=el('span','project-progress-track');const fill=el('i','project-progress-fill');
  fill.style.width=(percent??0)+'%';bar.append(fill);b.append(name,bar,figure);
  b.addEventListener('click',()=>showPage('projects'));root.append(b);
 }
}
function renderHomeTodos(tasks,pending){
 const root=$('homeTodoList');root.replaceChildren();
 const active=tasks.filter(t=>!['done','rejected'].includes(t.status)).slice(0,4);
 if(!active.length){root.append(el('p','helper','目前沒有未完成任務。'));return;}
 for(const t of active){
  const row=el('button','home-todo-row');row.type='button';
  const mark=el('span','todo-check',t.status==='done'?'✓':'□');
  const name=el('span','',t.title);const state=el('small','todo-status',statuses[t.status]||t.status);
  row.append(mark,name,state);row.addEventListener('click',()=>showPage('tasks'));root.append(row);
 }
}
function renderProjectCards(){
 const root=$('projectCards');if(!root)return;root.replaceChildren();
 const query=$('projectSearch')?.value.trim().toLocaleLowerCase('zh-TW')||'';
 const rows=projectCache.filter(p=>{
  const completed=p.status==='closed'||p.stage==='completed';
  const planned=['draft','planning'].includes(p.stage);
  const filter=projectFilter==='all'||(projectFilter==='closed'&&completed)||(projectFilter==='planning'&&!completed&&planned);
  return filter&&(p.name+' '+(p.goal||'')).toLocaleLowerCase('zh-TW').includes(query);
 });
 if(!rows.length){root.append(el('p','helper','沒有符合條件的專案。'));return;}
 for(const p of rows){
  const button=el('button','visual-project-row');button.type='button';button.addEventListener('click',()=>openQuickProject(p));
  const visual=p.name.match(/POS|收銀/i)?'▣':p.name.match(/AI|SKAI/i)?'✦':p.name.match(/盆栽|森林|植物/i)?'🌳':p.name.match(/FFM|品牌|食食/i)?'◈':'▤';
  const graphic=el('span','project-graphic',visual);const body=el('span','project-row-main');
  body.append(el('b','',p.name),el('small','',p.goal||'尚無專案目標'));
  const stage=el('span','status-pill',p.status==='closed'?'已完成':'規劃中');
  const amount=Number(p.progress);const known=p.progress!==undefined&&p.progress!==null&&Number.isFinite(amount);
  const meter=el('span','project-row-meter');const track=el('span','project-progress-track');const fill=el('i','project-progress-fill');fill.style.width=(known?Math.min(100,Math.max(0,amount)):0)+'%';track.append(fill);
  meter.append(track,el('b','',known?amount+'%':'未設定'));button.append(graphic,body,stage,meter,el('span','project-arrow','›'));
  const row=el('div','project-manage-row');const del=el('button','danger-outline','刪除');del.type='button';del.setAttribute('aria-label','刪除專案 '+p.name);del.addEventListener('click',()=>deleteProjectRecord(p));row.append(button,del);root.append(row);
 }
}
async function jumpToTaskDetail(taskId){
 // Avoid the page's automatic async refresh replacing task rows after expansion.
 showPage('tasks',true);
 await loadProjects();
 $('taskProjectFilter').value='';$('taskSearch').value='';taskFilter='all';
 document.querySelectorAll('[data-task-filter]').forEach(b=>b.classList.toggle('active',b.dataset.taskFilter==='all'));
 await loadTasks();
 const task=taskCache.find(t=>t.id===taskId);
 if(!task){showToast('找不到此工作任務');return;}
 if(task.is_archived){taskFilter='archived';document.querySelectorAll('[data-task-filter]').forEach(b=>b.classList.toggle('active',b.dataset.taskFilter==='archived'));}
 renderTaskCards();
 const index=filteredTasks().findIndex(t=>t.id===taskId);
 const row=$('taskCards').querySelectorAll('.actionable-task-row')[index];
 if(index<0||!row){showToast('任務不在目前清單');return;}
 const details=row.nextElementSibling;
 await openTaskDetails(task,details);
 row.scrollIntoView({behavior:'smooth',block:'center'});
}
async function openQuickProject(project){
 const panel=$('projectQuickDetail');if(!panel)return;
 panel.hidden=false;activeQuickProjectId=project.id;$('quickProjectName').textContent=project.name;
 $('quickProjectGoal').textContent='專案期限：'+(project.deadline||'尚未設定');
 const remaining=$('quickProjectRemaining');remaining.hidden=!project.deadline;
 if(project.deadline){const parts=project.deadline.split('-').map(Number);const today=new Date();const days=Math.round((Date.UTC(parts[0],parts[1]-1,parts[2])-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);remaining.textContent=days<0?'逾期 '+Math.abs(days)+' 日':days===0?'今日到期':'剩餘 '+days+' 日';remaining.classList.toggle('is-overdue',days<0);}
 const notesPanel=$('quickProjectNotesPanel');const fullNotes=$('quickProjectNotes');
 fullNotes.textContent=project.notes||'';
 notesPanel.hidden=!String(project.notes||'').trim();fullNotes.hidden=true;
 $('toggleProjectNotes').textContent='查看完整方案';$('toggleProjectNotes').setAttribute('aria-expanded','false');
 const linkHost=$('quickProjectDriveFolders');
 if(linkHost){linkHost.replaceChildren();
  if(workspaceMode()!=='local'){
   try{const folderData=await api('/projects/'+encodeURIComponent(project.id)+'/drive-folders');
    for(const item of folderData.folders||[]){
     if(!/^https:\/\/drive\.google\.com\/drive\/folders\//.test(item.folder_url))continue;
     const label=EMPLOYEES.find(x=>x.id===item.role_id)?.name||item.role_id;
     const a=el('a','project-folder-link',label+' · Google Drive');a.href=item.folder_url;a.target='_blank';a.rel='noopener noreferrer';linkHost.append(a);
    }
    if(!(folderData.folders||[]).some(x=>x.role_id==='root')){
     const status=await api('/delivery/status').catch(()=>({connected:false}));
     if(status.connected){
      const setup=el('button','outline-btn','建立此專案的 Google Drive 文件夾');
      setup.addEventListener('click',async()=>{
       if(!confirm('將在 SKAI OS總部／項目管理中建立此專案及各部門資料夾。確認建立？'))return;
       setup.disabled=true;
       try{await api('/delivery/projects/'+encodeURIComponent(project.id)+'/setup',{method:'POST',body:{confirm:true}});showToast('專案文件夾已建立並登錄');await openQuickProject(project);}
       catch(e){showToast('資料夾建立失敗：'+e.message)}finally{setup.disabled=false;}
      });linkHost.append(setup);
     }
    }
   }catch(e){linkHost.append(el('p','helper','Drive 資料夾尚未連線'));}
  }
 }
 try{
  const data=await api('/tasks');
  const linked=(data.tasks||[]).filter(t=>t.project_id===project.id&&!t.is_archived);
  const completed=linked.filter(t=>t.status==='done');
  const ongoing=linked.filter(t=>t.status!=='done');
  const stats=$('quickProjectTaskStats');stats.replaceChildren();
  for(const [cls,label] of [['total','共 '+linked.length+' 項任務'],['done','已完成 '+completed.length+' 項任務'],['ongoing','未完成 '+ongoing.length+' 項任務']])stats.append(el('span','project-task-stat project-task-stat-'+cls,label));
  const fill=(id,rows,empty)=>{
   const host=$(id);host.replaceChildren();
   if(!rows.length){host.append(el('p','helper',empty));return;}
   for(const t of rows){
    const item=el('button','project-task-entry');item.type='button';item.setAttribute('aria-label','前往任務中心查看 '+t.title);
    const info=el('span','project-task-entry-info');const titleLine=el('span','project-task-title-line');titleLine.append(el('span','project-task-entry-title',t.title));info.append(titleLine);
    if(id==='quickProjectActiveTasks'){
     const started=new Date(t.created_at),now=new Date();
     if(Number.isFinite(started.getTime()))titleLine.append(el('span','project-task-duration','已耗時 '+Math.max(1,Math.ceil((now-started)/86400000))+' 日'));
    }
    if(id==='quickProjectFinalTasks'){
     info.append(el('span','project-task-decision',t.final_decision||'尚無最終決策結果'));
     const started=new Date(t.created_at),ended=new Date(t.final_decided_at||t.updated_at);
     if(Number.isFinite(started.getTime())&&Number.isFinite(ended.getTime()))titleLine.append(el('span','project-task-duration','耗時 '+Math.max(1,Math.ceil((ended-started)/86400000))+' 日'));
    }
    item.append(info);
    
    item.addEventListener('click',()=>jumpToTaskDetail(t.id));host.append(item);
   }
  };
  fill('quickProjectFinalTasks',completed,'尚無已定案任務。');
  fill('quickProjectActiveTasks',ongoing,'目前沒有進行中任務。');
 }catch(e){$('quickProjectFinalTasks').replaceChildren(el('p','helper','讀取已定案任務失敗：'+e.message));$('quickProjectActiveTasks').replaceChildren(el('p','helper','讀取進行中任務失敗：'+e.message));}
 panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('editQuickProject')?.addEventListener('click',()=>{
 const p=projectCache.find(x=>x.id===activeQuickProjectId);if(!p)return;
 const f=$('projectEditForm');f.elements.id.value=p.id;f.elements.name.value=p.name;f.elements.goal.value=p.goal||'';f.elements.deadline.value=p.deadline||'';$('projectEditDialog').showModal();
});
$('closeProjectEdit')?.addEventListener('click',()=>$('projectEditDialog').close());
$('projectEditForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,fd=new FormData(f),id=String(fd.get('id'));
 const button=f.querySelector('[type="submit"]');button.disabled=true;
 try{await api('/projects/'+encodeURIComponent(id),{method:'PUT',body:{name:String(fd.get('name')||'').trim(),goal:String(fd.get('goal')||'').trim(),deadline:String(fd.get('deadline')||'')}});
  $('projectEditDialog').close();await loadProjects();const updated=projectCache.find(p=>p.id===id);if(updated)await openQuickProject(updated);showToast('專案內容已更新');
 }catch(err){showToast('更新專案失敗：'+err.message)}finally{button.disabled=false;}
});
$('closeQuickDetail')?.addEventListener('click',()=>{$('projectQuickDetail').hidden=true;});
$('toggleProjectNotes')?.addEventListener('click',()=>{const pre=$('quickProjectNotes');pre.hidden=!pre.hidden;const open=!pre.hidden;$('toggleProjectNotes').textContent=open?'收起完整方案':'查看完整方案';$('toggleProjectNotes').setAttribute('aria-expanded',String(open));});
function taskDeadline(task){const match=(task.brief||'').match(/^【完成期限：(\d{4}-\d{2}-\d{2})】/);return match?.[1]||null;}
function taskRemainingDays(task){const due=taskDeadline(task);if(!due)return null;const parts=due.split('-').map(Number);const deadline=Date.UTC(parts[0],parts[1]-1,parts[2]);const now=new Date();const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());return Math.round((deadline-today)/86400000);}
function filteredTasks(){
 const q=$('taskSearch')?.value.trim().toLocaleLowerCase('zh-TW')||'';
 const projectId=$('taskProjectFilter')?.value||'';
 return taskCache.filter(t=>{
  const done=t.status==='done',inProgress=!done&&(Boolean(t.has_activity)||['in_progress','review'].includes(t.status)),pending=!done&&!inProgress;
  const filter=t.is_archived?taskFilter==='archived':taskFilter==='all'||(taskFilter==='done'&&done)||(taskFilter==='today'&&pending)||(taskFilter==='in_progress'&&inProgress);
  return filter&&(!projectId||t.project_id===projectId)&&(t.title+' '+(t.brief||'')).toLocaleLowerCase('zh-TW').includes(q);
 }).sort((a,b)=>{if(!projectId){const da=taskDeadline(a)||'9999-12-31',db=taskDeadline(b)||'9999-12-31';if(da!==db)return da.localeCompare(db);}return String(b.created_at||'').localeCompare(String(a.created_at||''));});
}
function updateTaskSelection(){
 const visible=filteredTasks(),count=visible.filter(t=>selectedTaskIds.has(t.id)).length;
 $('selectedTaskCount').textContent='已選 '+selectedTaskIds.size+' 項';
 $('bulkDeleteTasks').disabled=!selectedTaskIds.size;
 $('selectAllTasks').checked=Boolean(visible.length)&&visible.every(t=>selectedTaskIds.has(t.id));
 $('selectAllTasks').indeterminate=count>0&&count<visible.length;
}
async function refreshManagement(){
 selectedTaskIds.clear();
 await Promise.all([loadProjects(),loadTasks(),loadApprovals(),loadDashboard()]);
 await Promise.allSettled([loadDataIndex(),loadOrchestrations()]);
}
async function deleteProjectRecord(project){
 let preview;
 try{preview=await api('/projects/'+encodeURIComponent(project.id)+'/deletion-preview');}
 catch(e){return showToast('無法檢查專案關聯：'+e.message);}
 const counts=preview.counts||{};
 if(preview.blocked)return showToast('此專案有正在執行的 AI 工作，不能刪除');
 const message='永久刪除專案「'+project.name+'」？\n關聯任務：'+(counts.tasks??0)+'；對話：'+(counts.conversations??0)+'；AI 工作規劃：'+(counts.runs??0)+'。\n刪除後無法復原。';
 if(!confirm(message))return;
 try{await api('/projects/'+encodeURIComponent(project.id),{method:'DELETE'});$('projectQuickDetail').hidden=true;showToast('專案已刪除');await refreshManagement();}
 catch(e){showToast('刪除失敗：'+e.message);}
}
function taskActionConfirm(message,yesLabel='確定',noLabel='取消'){
 const dlg=$('taskArchiveConfirmDialog');$('taskArchiveConfirmMessage').textContent=message;$('taskArchiveConfirmYes').textContent=yesLabel;$('taskArchiveConfirmNo').textContent=noLabel;
 return new Promise(resolve=>{let settled=false;const finish=v=>{if(settled)return;settled=true;dlg.removeEventListener('close',onClose);dlg.close();resolve(v);};const onClose=()=>{if(!settled){settled=true;resolve(false);}};dlg.addEventListener('close',onClose);$('taskArchiveConfirmNo').onclick=()=>finish(false);$('taskArchiveConfirmYes').onclick=()=>finish(true);dlg.showModal();});
}
async function restoreTaskRecord(task){
 if(!(await taskActionConfirm('是否要復原此工作任務？','確認','取消')))return;
 try{await api('/tasks/'+encodeURIComponent(task.id)+'/restore',{method:'POST'});showToast('任務已復原');await refreshManagement();}catch(e){showToast('復原失敗：'+e.message);}
}
async function deleteTaskRecord(task){
 const permanent=Boolean(task.is_archived);
 if(!(await taskActionConfirm(permanent?'是否徹底刪除此工作內容？':'是否將此工作任務移至已封存？',permanent?'是':'確認',permanent?'否':'取消')))return;
 try{await api('/tasks/'+encodeURIComponent(task.id)+(permanent?'':'/archive'),{method:permanent?'DELETE':'POST'});selectedTaskIds.delete(task.id);showToast(permanent?'任務已徹底刪除':'任務已移至已封存');await refreshManagement();}
 catch(e){showToast((permanent?'刪除':'封存')+'失敗：'+e.message);}
}
async function approveTaskRecord(task,decision='approved'){
 const approval=approvalCache.find(a=>a.task_id===task.id&&a.status==='pending');
 if(!approval)return showToast('此任務目前沒有待審批單');
 if(!confirm((decision==='approved'?'核准':'駁回')+'任務「'+task.title+'」？'))return;
 try{
  await api('/approvals/'+encodeURIComponent(approval.id)+'/decision',{method:'POST',body:{decision,note:'CEO 於任務中心決策'}});
  showToast('任務審核已儲存');await refreshManagement();
 }catch(e){showToast('審核失敗：'+e.message);}
}
function taskDetailLine(label,value){
 const line=el('div','task-detail-line');
 line.append(el('strong','',label),el('div','',value||'未提供'));
 return line;
}
async function appendTaskDeliverables(task,container){
 const section=el('section','task-drive-deliverables'),title=el('h4','','工作交付檔案／Google Drive');
 section.append(title);
 if(workspaceMode()==='local'){section.append(el('p','helper','本機工作區沒有雲端文件儲存功能。'));container.append(section);return;}
 try{
  const data=await api('/tasks/'+encodeURIComponent(task.id)+'/deliverables');
  const files=data.documents||[];
  const list=el('div','task-drive-links');
  if(!files.length)list.append(el('p','helper','尚無上傳至 Google Drive 的實際成果檔案。'));
  for(const file of files){
   if(!/^https:\/\/(drive|docs)\.google\.com\//.test(file.drive_url||''))continue;
   const entry=el('div','task-delivery-row');
   const a=el('a','task-drive-file',file.format.toUpperCase()+'｜'+file.title+'　'+(file.review_state==='approved'?'（已審閱）':file.review_state==='rejected'?'（退回）':'（待 CEO／專業複核）'));
   a.href=file.drive_url;a.target='_blank';a.rel='noopener noreferrer';entry.append(a);
   if(file.id&&file.review_state==='needs_review'){
    const approve=el('button','outline-btn','CEO 確認文件');approve.type='button';
    approve.addEventListener('click',async()=>{
     if(!confirm('請先在 Google Drive 閱讀文件，確認內容、格式與必要專業審查已完成。確定核可這份檔案？'))return;
     approve.disabled=true;
     try{await api('/delivery/deliverables/'+encodeURIComponent(file.id)+'/review',{method:'POST',body:{confirm:true,decision:'approved'}});showToast('已核可交付文件；任務仍須滿足其他結案條件');section.remove();await appendTaskDeliverables(task,container);}
     catch(e){showToast('文件核可失敗：'+e.message)}finally{approve.disabled=false;}
    });entry.append(approve);
   }
   list.append(entry);
  }
  section.append(list);
  const f=el('div','task-format-choice');
  f.append(el('strong','','CEO 選擇成果檔案格式（可複選）'));
  const checkboxList=el('div','task-format-inputs'),fields=[];
  for(const [value,label] of [['pdf','PDF'],['docx','Word'],['xlsx','Excel']]){
   const input=document.createElement('input');input.type='checkbox';input.value=value;input.checked=(data.formats||['pdf']).includes(value);
   const wrap=el('label','task-format-option');wrap.append(input,document.createTextNode(label));checkboxList.append(wrap);fields.push(input);
  }
  f.append(checkboxList);
  const save=el('button','outline-btn','儲存格式選擇');save.type='button';
  save.addEventListener('click',async()=>{
   const formats=fields.filter(x=>x.checked).map(x=>x.value);
   if(!formats.length)return showToast('請至少選擇一種交付格式');
   save.disabled=true;
   try{await api('/tasks/'+encodeURIComponent(task.id)+'/delivery-preferences',{method:'PUT',body:{formats}});showToast('已保存：'+formats.join('、'));}
   catch(e){showToast('儲存失敗：'+e.message);}finally{save.disabled=false;}
  });f.append(save);
  f.append(el('p','helper','此選擇會作為交付要求。必須具備已完成的 AI 部門報告、CEO 確認及 Google Drive 長期授權，才能產生正式檔案。'));
  section.append(f);
  if(data.auto_generation_connected){
   const controls=el('div','task-drive-generator');
   controls.append(el('strong','','將已完成的 AI 報告產生文件並歸檔'));
   const select=document.createElement('select');
   const departments=[['chief_of_staff','戰略幕僚部／整合報告'],['legal','法務部'],['finance','財務部'],['admin','行政管理部'],['operations','營運策略部'],['marketing','行銷企劃部'],['brand','視覺設計部門'],['tech','資訊技術部'],['hr','人事管理部']];
   for(const [code,name] of departments)select.add(new Option(name,code));
   controls.append(select);
   const generate=el('button','primary-btn','生成選定格式並歸檔到 Google Drive');
   generate.type='button';
   generate.addEventListener('click',async()=>{
    if(fields.some(x=>x.checked)!==true)return showToast('請先勾選成果格式並儲存');
    if(!confirm('確認使用已完成且具備部門執行紀錄的 AI 工作內容，生成實際文件並上傳至對應部門 Google Drive 資料夾？本步驟不呼叫新的 AI 模型，但會建立雲端檔案。'))return;
    generate.disabled=true;
    try{
     const result=await api('/delivery/tasks/'+encodeURIComponent(task.id)+'/generate',{method:'POST',body:{confirm:true,role_id:select.value}});
     showToast((result.documents||[]).length+' 個檔案已生成歸檔'+((result.errors||[]).length?'，部分格式失敗':'；待 CEO 審閱'));
     section.remove();await appendTaskDeliverables(task,container);
    }catch(e){showToast('無法生成：'+e.message)}
    finally{generate.disabled=false;}
   });controls.append(generate);
   controls.append(el('p','helper','僅允許有已完成部門成果的任務；上傳後預設待審閱。法律文件不可把 AI 內容視為律師正式法律意見。'));
   section.append(controls);
  }else{
   section.append(el('p','task-evidence-warning','Google Drive 尚未連接到 Render 後端；格式選擇及檔案調閱可用，自動生成和上傳尚未啟用。'));
  }
 }catch(e){section.append(el('p','helper','雲端交付紀錄讀取失敗：'+e.message));}
 container.append(section);
}
function chineseCount(n){const d='零一二三四五六七八九';if(n<10)return d[n];if(n<20)return '十'+(n%10?d[n%10]:'');if(n<100)return d[Math.floor(n/10)]+'十'+(n%10?d[n%10]:'');return String(n).split('').map(x=>d[Number(x)]).join('');}
function decisionDraftLabel(n){return n===1?'初步定案':'第'+chineseCount(n)+'次定案';}
async function reopenTaskDetail(id){const task=taskCache.find(t=>t.id===id);if(!task)return;const row=[...document.querySelectorAll('#taskCards .visual-task-row')].find(x=>x.querySelector('.task-list-title')?.textContent===task.title);const panel=row?.nextElementSibling;if(panel){panel.hidden=true;await openTaskDetails(task,panel);}}

async function openTaskDetails(task,container){
 const willOpen=container.hidden;
 document.querySelectorAll('#taskCards .task-evidence-panel').forEach(p=>p.hidden=true);
 container.hidden=!willOpen;if(!willOpen)return;
 const latest=taskCache.find(t=>t.id===task.id)||task;
 const project=projectCache.find(p=>p.id===latest.project_id);
 const heading=el('div','task-detail-heading');
 const headingLeft=el('div','task-detail-heading-left');headingLeft.append(el('h3','','工作內容'));
 const edit=el('button','outline-btn task-edit-top',latest.status==='done'?'已決議':'編輯');edit.type='button';edit.disabled=latest.status==='done';
 const closeDetails=el('button','outline-btn task-detail-close','收起');closeDetails.type='button';closeDetails.addEventListener('click',()=>{container.hidden=true;});
 const headingActions=el('div','task-detail-heading-actions');headingActions.append(edit,closeDetails);heading.append(headingLeft,headingActions);if(latest.is_archived)edit.remove();
 const body=el('div','task-detail-body');const parsed=(latest.brief||'').match(/^【完成期限：(\d{4}-\d{2}-\d{2})】\n?/);
 const plain=(latest.brief||'').replace(/^【完成期限：\d{4}-\d{2}-\d{2}】\n?/,'').trim();
 body.append(taskDetailLine('任務名稱',latest.title),taskDetailLine('所屬專案',project?.name||'未分類'));
 if(parsed)body.append(taskDetailLine('完成期限',parsed[1]));
 if((latest.status!=='done'||latest.is_archived)&&plain)body.append(taskDetailLine('工作內容',plain));
 edit.addEventListener('click',()=>{
  $('taskEditId').value=latest.id;$('taskEditTitle').value=latest.title;
  const match=(latest.brief||'').match(/^【完成期限：(\d{4}-\d{2}-\d{2})】\n?/);
  $('taskEditDeadline').value=match?.[1]||'';
  $('taskEditBrief').value=(latest.brief||'').replace(/^【完成期限：\d{4}-\d{2}-\d{2}】\n?/,'');
  $('taskEditDialog').showModal();
 });
 const drafts=el('div','task-decision-drafts');
 const records=el('div','task-records');records.append(el('h4','','執行記錄'));
 const footer=el('div','task-detail-footer');
 const history=el('button','outline-btn','執行記錄'),decide=el('button','primary-btn',latest.is_archived?'復原':latest.status==='done'?'方案重議':'決策');history.type=decide.type='button';
 history.addEventListener('click',()=>{
  const dlg=$('taskHistoryDialog'),target=$('taskHistoryBody');target.replaceChildren();
  const decisionGroup=el('section','task-history-group task-history-decisions');
  const editGroup=el('section','task-history-group task-history-edits');
  decisionGroup.append(el('h3','','定案記錄'));editGroup.append(el('h3','','編輯工作內容記錄'));
  const decisionRows=[...records.querySelectorAll('[data-record-type="decision"]')];
  const editRows=[...records.querySelectorAll('[data-record-type="edit"]')];
  for(const row of decisionRows)decisionGroup.append(row.cloneNode(true));
  for(const row of editRows)editGroup.append(row.cloneNode(true));
  if(!decisionRows.length)decisionGroup.append(el('p','helper','尚無定案記錄。'));
  if(!editRows.length)editGroup.append(el('p','helper','尚無編輯記錄。'));
  target.append(decisionGroup,editGroup);
  const error=records.querySelector('[data-record-type="error"]');if(error)target.prepend(error.cloneNode(true));
  dlg.showModal();
 });
 decide.addEventListener('click',async()=>{
  if(latest.is_archived){await restoreTaskRecord(latest);return;}
  if(latest.status==='done'){$('taskReopenId').value=latest.id;$('taskReopenDialog').showModal();return;}
  $('taskDecisionId').value=latest.id;$('taskDecisionContent').value='';
  try{const r=await api('/tasks/'+encodeURIComponent(latest.id)+'/ceo-records');$('taskDecisionContent').value=r.preliminary||'';}catch(e){showToast(e.message);}
  $('taskDecisionDialog').showModal();
 });
 footer.append(history,decide);container.replaceChildren(heading,body,drafts,footer);
 if(workspaceMode()==='local'){records.append(el('p','helper','本機模式：決策紀錄需要雲端資料庫。'));return;}
 try{
  const r=await api('/tasks/'+encodeURIComponent(latest.id)+'/ceo-records');
  const saved=(r.records||[]).filter(x=>x.event==='task.ceo_draft_decision');
  const lastFive=saved.slice(-5);
  if(latest.status!=='done'||latest.is_archived)lastFive.forEach((x,i)=>drafts.append(taskDetailLine(decisionDraftLabel(saved.length-lastFive.length+i+1),x.details?.content||'')));
  if(latest.status==='done')drafts.append(taskDetailLine('最終決策結果',r.final||'尚無最終決策內容'));
  else if(r.final)drafts.append(taskDetailLine('歷次最終決策',r.final));
  if(!(r.records||[]).length)records.append(el('p','helper','尚無編輯或決策記錄。'));
  let draftNumber=0;
  for(const x of r.records||[]){
   const label=x.event==='task.ceo_edited'?'編輯工作內容':x.event==='task.ceo_draft_decision'?decisionDraftLabel(++draftNumber):x.event==='task.ceo_reopened_decision'?'方案重議':'CEO 最終決定';
   const item=taskDetailLine(new Date(x.created_at).toLocaleString('zh-TW')+'｜'+label,x.details?.content||x.details?.title||(x.event==='task.ceo_reopened_decision'?'已重新開啟決策':'待檢視變更詳情'));item.dataset.recordType=x.event==='task.ceo_edited'?'edit':'decision';records.append(item);
  }
 }catch(e){records.append(el('p','helper','讀取執行記錄失敗：'+e.message));}
}
function renderTaskCards(){
 const root=$('taskCards');if(!root)return;root.replaceChildren();
 const rows=filteredTasks();
 if(!rows.length){root.append(el('p','helper','沒有符合條件的任務。'));updateTaskSelection();return;}
 for(const t of rows){
  const row=el('div','visual-task-row actionable-task-row');
  const label=el('label','task-select-label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selectedTaskIds.has(t.id);checkbox.setAttribute('aria-label','選取任務 '+t.title);
  checkbox.addEventListener('change',()=>{if(checkbox.checked)selectedTaskIds.add(t.id);else selectedTaskIds.delete(t.id);updateTaskSelection();});
  label.append(checkbox);
  const project=projectCache.find(p=>p.id===t.project_id);
  const titleGroup=el('div','task-title-project-group');
  titleGroup.append(el('span','task-list-title',t.title),el('span','task-project-tag','（'+(project?.name||'未分類')+'）'));
  row.append(label,titleGroup);
  const statusColumn=el('div','task-status-column');
  const days=taskRemainingDays(t);if(days!==null){const label=t.is_archived?'已封存':t.status==='done'?'已完成':days<0?'逾期 '+Math.abs(days)+' 日':days===0?'今日到期':'剩餘 '+days+' 日';statusColumn.append(el('span','task-remaining-days'+(t.status!=='done'&&days<=3?' task-deadline-urgent':''),label));}
  const actions=el('div','task-row-actions');
  const inspect=el('button','outline-btn','查看內容');inspect.type='button';actions.append(inspect);
  if(t.is_archived){const restore=el('button','outline-btn','復原');restore.type='button';restore.addEventListener('click',()=>restoreTaskRecord(t));actions.append(restore);}
  const remove=el('button','danger-outline','刪除');remove.type='button';remove.setAttribute('aria-label','刪除任務 '+t.title);remove.addEventListener('click',()=>deleteTaskRecord(t));actions.append(remove);
  row.append(actions,statusColumn);const details=el('section','task-evidence-panel');details.hidden=true;
  inspect.addEventListener('click',()=>openTaskDetails(t,details));root.append(row,details);
 }
 updateTaskSelection();
}
$('selectAllTasks')?.addEventListener('change',e=>{for(const t of filteredTasks()){if(e.target.checked)selectedTaskIds.add(t.id);else selectedTaskIds.delete(t.id);}renderTaskCards();});
$('bulkDeleteTasks')?.addEventListener('click',async()=>{
 const tasks=taskCache.filter(t=>selectedTaskIds.has(t.id));if(!tasks.length)return;
 const permanent=tasks.every(t=>t.is_archived);if(tasks.some(t=>t.is_archived)&&!permanent){showToast('請分別選取一般任務或已封存任務進行批次操作');return;}if(!(await taskActionConfirm(permanent?'是否徹底刪除已選的 '+tasks.length+' 項工作內容？':'是否將已選的 '+tasks.length+' 項任務移至已封存？',permanent?'是':'確認',permanent?'否':'取消')))return;
 let count=0,errors=[];for(const t of tasks){try{await api('/tasks/'+encodeURIComponent(t.id)+(t.is_archived?'':'/archive'),{method:t.is_archived?'DELETE':'POST'});count++;}catch(e){errors.push(e.message);}}
 showToast('已處理 '+count+' 項，失敗 '+errors.length+' 項'+(errors.length?'：'+errors[0]:''));await refreshManagement();
});
$('projectSearch')?.addEventListener('input',renderProjectCards);
$('taskSearch')?.addEventListener('input',renderTaskCards);
$('taskProjectFilter')?.addEventListener('change',renderTaskCards);
document.querySelectorAll('[data-project-filter]').forEach(b=>b.addEventListener('click',()=>{
 projectFilter=b.dataset.projectFilter;document.querySelectorAll('[data-project-filter]').forEach(x=>x.classList.toggle('active',x===b));renderProjectCards();
}));
document.querySelectorAll('[data-task-filter]').forEach(b=>b.addEventListener('click',()=>{
 taskFilter=b.dataset.taskFilter;document.querySelectorAll('[data-task-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTaskCards();
}));
$('jumpProjectCreate')?.addEventListener('click',()=>{$('projectCreatePanel').hidden=false;$('projectForm')?.scrollIntoView({behavior:'smooth',block:'center'});});
$('closeProjectCreate')?.addEventListener('click',()=>{$('projectCreatePanel').hidden=true;});
$('jumpTaskCreate')?.addEventListener('click',()=>{$('taskCreatePanel').showModal();});
$('closeTaskCreate')?.addEventListener('click',()=>{$('taskCreatePanel').close();});
$('openSettings')?.addEventListener('click',()=>{$('workspaceToggle').hidden=!$('workspaceToggle').hidden;});
$('openSettingsMobile')?.addEventListener('click',()=>{$('workspaceToggle').hidden=!$('workspaceToggle').hidden;});
$('toggleChiefPlans')?.addEventListener('click',()=>{const x=$('chiefPlanContent');x.hidden=!x.hidden;$('chiefPlanToggleIcon').textContent=x.hidden?'展開':'收合';});
async function loadDriveOAuthStatus(){
 const status=$('driveOAuthStatus'),badge=$('driveOAuthBadge'),connect=$('driveOAuthConnect'),disconnect=$('driveOAuthDisconnect');
 if(!status)return;
 if(workspaceMode()==='local'){status.textContent='本機工作區無法連接 Google Drive，請切換雲端工作區。';badge.textContent='本機模式';connect.disabled=true;disconnect.hidden=true;return;}
 if(!isSignedIn){status.textContent='請先登入 CEO。';badge.textContent='未登入';connect.disabled=true;disconnect.hidden=true;return;}
 try{
  const data=await api('/google-oauth/status');
  badge.textContent=data.connected?'已連接':data.configured?'待授權':'待設定';
  status.textContent=data.notice||'';
  connect.disabled=!data.configured;
  connect.hidden=Boolean(data.connected);
  disconnect.hidden=!data.connected;
 }catch(e){status.textContent='讀取 Google Drive 授權狀態失敗：'+e.message;badge.textContent='檢查失敗';connect.disabled=true;disconnect.hidden=true;}
}
$('driveOAuthConnect')?.addEventListener('click',async()=>{
 const button=$('driveOAuthConnect');button.disabled=true;
 try{
  const data=await api('/google-oauth/start',{method:'POST',body:{}});
  const url=new URL(data.authorization_url);
  if(url.origin!=='https://accounts.google.com')throw Error('授權連結來源無效');
  window.location.assign(url.href);
 }catch(e){showToast('無法啟動 Google 授權：'+e.message);button.disabled=false;}
});
$('driveOAuthDisconnect')?.addEventListener('click',async()=>{
 if(!confirm('確認移除 SKAI OS 已保存的 Google Drive 授權？這不會刪除 Google Drive 裡的文件。'))return;
 try{await api('/google-oauth/disconnect',{method:'POST',body:{confirm:true}});showToast('已中斷 Google Drive 授權');await loadDriveOAuthStatus();}
 catch(e){showToast('中斷授權失敗：'+e.message);}
});
const oauthResult=new URL(window.location.href).searchParams.get('drive_oauth');
if(oauthResult){
 history.replaceState(null,'',window.location.pathname+window.location.hash);
 setTimeout(()=>showToast(oauthResult==='connected'?'Google Drive 授權已保存':('Google Drive 授權未完成：'+oauthResult)),750);
}
async function refreshPage(page){
 if(!isSignedIn)return;
 if(page==='home')await loadDashboard();
 if(page==='data')await Promise.all([loadDataIndex(),loadDriveOAuthStatus()]);
 if(page==='projects')await loadProjects();
 if(page==='tasks'){await loadProjects();await loadTasks();await loadOrchestrations();}
 if(page==='approvals')await loadApprovals();
 if(page==='chief-plans')await loadOrchestrations();
 if(page==='notifications')await loadNotifications();
 if(page==='department-tech'||page==='department-finance')await loadDepartmentUsage();
}
async function loadDepartmentUsage(){
 const techStatus=$('techUsageDetails'),financeStatus=$('financeBudgetUsage');
 if(workspaceMode()==='local'){
  techStatus.textContent='本機模式無雲端 AI API 與 Token 紀錄；請切換雲端並登入 CEO。';
  financeStatus.textContent='本機模式無 AI 美元成本紀錄；請切換雲端並登入 CEO。';
  $('aiControlForm').querySelector('[type="submit"]').disabled=true;
  $('aiFinanceForm').querySelector('[type="submit"]').disabled=true;
  return;
 }
 if(!isSignedIn)return;
 try{
  const [data,usage]=await Promise.all([api('/operations/ai-settings'),api('/operations/usage')]);
  const s=data.settings,stats=usage.usage||{},usd=usage.cost||{};
  const count=Number(stats.reserved_calls)||0,completed=Number(stats.completed_calls)||0,failed=Number(stats.failed_calls)||0;
  const input=Number(stats.total_input_tokens)||0,output=Number(stats.total_output_tokens)||0;
  $('techCallCount').textContent=count.toLocaleString()+' / '+Number(usage.cap).toLocaleString();
  $('techInputTokens').textContent=input.toLocaleString();
  $('techOutputTokens').textContent=output.toLocaleString();
  $('techTotalTokens').textContent=(input+output).toLocaleString();
  techStatus.textContent='台灣時間 '+usage.day+' · 成功 '+completed+' 次 · 失敗 '+failed+' 次 · 剩餘 '+Math.max(0,Number(usage.cap)-count)+' 次 · '+(s.ai_enabled?'AI 已啟用':'AI 已暫停')+'。Token 以已回傳 API 用量統計；尚未完成的呼叫可能未計入。';
  $('aiControlEnabled').checked=Boolean(s.ai_enabled);
  $('aiControlLimit').max=String(data.deployment_ceiling);
  $('aiControlLimit').value=String(s.daily_call_limit);
  $('aiTokenWarning').value=String(s.daily_token_warning);
  $('aiControlCeiling').textContent='部署環境每日最高 '+data.deployment_ceiling+' 次，CEO 設定不得超過此上限。';
  const day=Number(usd.day_usd)||0,month=Number(usd.month_usd)||0;
  $('financeDailyUsd').textContent='US$'+day.toFixed(4);
  $('financeMonthlyUsd').textContent='US$'+month.toFixed(4);
  financeStatus.textContent='今日預算占用 US$'+day.toFixed(4)+' / US$'+Number(s.daily_budget_usd).toFixed(2)+'；本月 US$'+month.toFixed(4)+' / US$'+Number(s.monthly_budget_usd).toFixed(2)+'。';
  $('financePending').textContent='待核實 '+(Number(usd.unverified_count)||0)+' 筆請求，保留預留金額避免低估費用。';
  $('aiDailyUsd').value=Number(s.daily_budget_usd).toFixed(2);
  $('aiMonthlyUsd').value=Number(s.monthly_budget_usd).toFixed(2);
  const pricing=data.pricing;
  $('aiCostDetails').textContent='美元估算模型 '+data.pricing_model+(pricing?'：每百萬輸入 Tokens US$'+pricing.input+'，輸出 Tokens US$'+pricing.output:'：單價尚未設定')+'。使用量與保守預算占用不等於 OpenAI 官方帳單；幣別 USD。';
  $('aiControlForm').querySelector('[type="submit"]').disabled=false;
  $('aiFinanceForm').querySelector('[type="submit"]').disabled=false;
 }catch(e){
  techStatus.textContent='資訊部無法讀取 Token 用量：'+e.message;
  financeStatus.textContent='財務部無法讀取美元用量：'+e.message;
 }
}
async function saveDepartmentSettings(changes,feedbackId,button){
 if(!isSignedIn)return openLogin();
 if(workspaceMode()==='local')return showToast('請切換至雲端模式');
 button.disabled=true;
 $(feedbackId).textContent='正在儲存 CEO 控管設定…';
 try{
  // Merge server settings immediately before saving so each department
  // never overwrites the other department's latest fields from a stale form.
  const latest=await api('/operations/ai-settings');
  const s=latest.settings;
  const payload={
   ai_enabled:changes.ai_enabled??Boolean(s.ai_enabled),
   daily_call_limit:changes.daily_call_limit??Number(s.daily_call_limit),
   daily_token_warning:changes.daily_token_warning??Number(s.daily_token_warning),
   daily_budget_usd:changes.daily_budget_usd??Number(s.daily_budget_usd),
   monthly_budget_usd:changes.monthly_budget_usd??Number(s.monthly_budget_usd)
  };
  if(payload.daily_budget_usd>payload.monthly_budget_usd)throw Error('每日美元上限不得超過每月美元上限');
  await api('/operations/ai-settings',{method:'POST',body:payload});
  await loadDepartmentUsage();
  $(feedbackId).textContent='CEO 控管設定已保存，後續 AI 呼叫將依新設定執行。';
 }catch(e){$(feedbackId).textContent='儲存失敗：'+e.message;}
 finally{button.disabled=false;}
}
$('aiControlForm').addEventListener('submit',async event=>{
 event.preventDefault();
 await saveDepartmentSettings({
  ai_enabled:$('aiControlEnabled').checked,
  daily_call_limit:Number($('aiControlLimit').value),
  daily_token_warning:Number($('aiTokenWarning').value)
 },'aiControlFeedback',event.currentTarget.querySelector('[type="submit"]'));
});
$('aiFinanceForm').addEventListener('submit',async event=>{
 event.preventDefault();
 await saveDepartmentSettings({
  daily_budget_usd:Number($('aiDailyUsd').value),
  monthly_budget_usd:Number($('aiMonthlyUsd').value)
 },'aiFinanceFeedback',event.currentTarget.querySelector('[type="submit"]'));
});
async function refreshAll(){
 await Promise.allSettled([loadDashboard(),loadProjects(),loadTasks(),loadApprovals(),loadNotifications(),loadOrchestrations()]);
}
$('projectForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const form=event.currentTarget;
 const fd=new FormData(form),name=String(fd.get('name')||'').trim(),goal=String(fd.get('goal')||'').trim(),deadline=String(fd.get('deadline')||'');
 if(!name)return;
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/projects',{method:'POST',body:{name,goal,deadline}});form.reset();await Promise.all([loadProjects(),loadDashboard()]);showToast('專案已儲存');}
 catch(e){showToast(e.message)}
 finally{button.disabled=false;}
});
$('taskForm').addEventListener('submit',async event=>{
 event.preventDefault();if(!isSignedIn)return openLogin();
 const form=event.currentTarget,fd=new FormData(form);
 const dueDate=String(fd.get('due_date')||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)){showToast('請選擇完成期限');return;}
 const brief='【完成期限：'+dueDate+'】\n'+String(fd.get('brief')||'');
 const body={project_id:String(fd.get('project_id')||''),title:String(fd.get('title')||''),brief,ceo_assign_to_chief:false};
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{await api('/tasks',{method:'POST',body});form.reset();$('taskCreatePanel').close();await Promise.all([loadTasks(),loadApprovals(),loadDashboard()]);showToast('新增任務成功，已儲存至任務清單');}
 catch(e){showToast('任務建立失敗：'+e.message);}
 finally{button.disabled=false;}
});
$('closeTaskHistory')?.addEventListener('click',()=>$('taskHistoryDialog').close());
$('closeTaskEdit')?.addEventListener('click',()=>$('taskEditDialog').close());
$('closeTaskDecision')?.addEventListener('click',()=>$('taskDecisionDialog').close());
$('taskEditForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,fd=new FormData(f),id=String(fd.get('id'));
 const date=String(fd.get('due_date')||'');
 const brief=(date?'【完成期限：'+date+'】\n':'')+String(fd.get('brief')||'');
 try{await api('/tasks/'+encodeURIComponent(id)+'/ceo-edit',{method:'PUT',body:{title:String(fd.get('title')),brief}});$('taskEditDialog').close();await loadTasks();await reopenTaskDetail(id);showToast('任務內容已更新');}
 catch(err){showToast('編輯失敗：'+err.message);}
});
$('taskReopenCancel')?.addEventListener('click',()=>$('taskReopenDialog').close());
$('taskReopenConfirm')?.addEventListener('click',async()=>{
 const btn=$('taskReopenConfirm'),id=$('taskReopenId').value;btn.disabled=true;
 try{await api('/tasks/'+encodeURIComponent(id)+'/reopen-decision',{method:'POST'});$('taskReopenDialog').close();taskFilter='in_progress';document.querySelectorAll('[data-task-filter]').forEach(x=>x.classList.toggle('active',x.dataset.taskFilter==='in_progress'));await Promise.all([loadTasks(),loadDashboard()]);await reopenTaskDetail(id);showToast('任務已移至執行中，可重新決策');}
 catch(e){showToast('重新決策失敗：'+e.message);}finally{btn.disabled=false;}
});
function confirmTaskFinalDecision(){
 const dialog=$('taskFinalConfirmDialog');
 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;dialog.removeEventListener('close',onClose);dialog.close();resolve(value);};
  const onClose=()=>{if(!settled){settled=true;resolve(false);}};
  dialog.addEventListener('close',onClose);
  dialog.querySelector('[data-final-cancel]').onclick=()=>finish(false);
  dialog.querySelector('[data-final-confirm]').onclick=()=>finish(true);
  dialog.showModal();
 });
}
$('taskDecisionForm')?.addEventListener('click',async e=>{
 const btn=e.target.closest('button[data-decision-action]');if(!btn)return;
 const f=e.currentTarget;if(!f.reportValidity())return;
 const action=btn.dataset.decisionAction;
 if(action==='decide'&&!(await confirmTaskFinalDecision()))return;
 btn.disabled=true;
 try{const id=$('taskDecisionId').value;await api('/tasks/'+encodeURIComponent(id)+'/ceo-decision',{method:'POST',body:{content:$('taskDecisionContent').value,action}});$('taskDecisionDialog').close();await Promise.all([loadTasks(),loadApprovals(),loadDashboard()]);await reopenTaskDetail(id);showToast(action==='save'?'初步定案已儲存':'最終決策已儲存，任務已完成');}
 catch(err){showToast('決策失敗：'+err.message);}finally{btn.disabled=false;}
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
 dialog.close();showPage('assistant');chooseChat(currentEmployee);$('chatText').focus();
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
 $('workspaceToggle').hidden=true;
 useLocalWorkspace();
 roleConversations.clear();
 await chooseChat(currentEmployee);
 $('loginDialog').close();
 setConnection(true);
 await refreshAll();
 showToast('已切換本機工作區：專案、任務與核准會存在此瀏覽器。');
});
$('useCloud').addEventListener('click',async()=>{
 $('workspaceToggle').hidden=true;
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
async function loadDataIndex(){
 const target=$('dataResults');if(!target)return;
 if(!isSignedIn){target.replaceChildren(el('p','helper','請先登入或切換至本機工作區。'));return;}
 try{
  const [projects,tasks]=await Promise.all([api('/projects'),api('/tasks')]);
  const q=$('dataSearch').value.trim().toLocaleLowerCase('zh-TW');
  const rows=[
   ...(projects.projects||[]).map(p=>({kind:'project',name:p.name,text:p.goal||'',id:p.id})),
   ...(tasks.tasks||[]).map(t=>({kind:'task',name:t.title,text:t.brief||'',id:t.id}))
  ].filter(x=>(x.name+' '+x.text).toLocaleLowerCase('zh-TW').includes(q)).slice(0,100);
  renderList(target,rows,'找不到符合條件的資料。',x=>{
   const button=el('button','outline-btn',x.kind==='project'?'開啟專案':'開啟任務');
   button.type='button';button.addEventListener('click',()=>showPage(x.kind==='project'?'projects':'tasks'));
   return listItem((x.kind==='project'?'專案｜':'任務｜')+x.name,x.text||'無說明',button);
  });
 }catch(e){target.replaceChildren(el('p','helper','資料搜尋失敗：'+e.message));}
}
$('dataSearch').addEventListener('input',()=>loadDataIndex());
$('dataQuickSearch')?.addEventListener('input',()=>{$('dataSearch').value=$('dataQuickSearch').value;loadDataIndex();});
function updateTaipeiClock(){
 const elClock=$('todayClock');if(!elClock)return;
 const date=new Date();
 elClock.textContent='▦  '+new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
 elClock.dateTime=date.toISOString();
}
updateTaipeiClock();setInterval(updateTaipeiClock,60000);
const initialHash=location.hash.slice(1);
const initialPage=initialHash==='orchestrations'?'tasks':initialHash==='ai-controls'?'department-finance':initialHash;
if(['home','employees','projects','tasks','approvals','notifications','department-tech','department-finance','assistant','data'].includes(initialPage))showPage(initialPage);
else document.body.dataset.currentPage='home';
startSession();
