import { EMPLOYEES, TASK_STATUS } from './data.js';
import { api,workspaceMode,useLocalWorkspace,useCloudWorkspace,setCsrfToken } from './api.js';
import { localCompany } from './storage.js';
import {renderOffice} from './scene.js';
import { applyInterfaceIcons, makeIcon } from './icons.js';
import {el,listItem,renderList} from './ui.js';

const $=id=>document.getElementById(id);
const dialog=$('employeeDialog'),toast=$('toast');
let currentEmployee=EMPLOYEES[0],isSignedIn=false,toastTimer;
let projectCache=[],roleConversations=new Map(),chatHistoryRequest=0,projectFilter='all',taskFilter='all',taskCache=[],selectedTaskIds=new Set(),approvalCache=[];
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
function showPage(page){
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

for(const button of document.querySelectorAll('[data-jump]'))button.addEventListener('click',()=>{showPage(button.dataset.jump);const which=button.dataset.open;if(which==='project'){$('projectCreatePanel').hidden=false;$('projectForm')?.scrollIntoView({behavior:'smooth',block:'center'});}if(which==='task'){$('taskCreatePanel').hidden=false;$('taskForm')?.scrollIntoView({behavior:'smooth',block:'center'});}if(button.dataset.jump==='data')$('dataSearch')?.focus();});
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
  const filter=projectFilter==='all'||(projectFilter==='closed'&&completed)||(projectFilter==='planning'&&!completed&&planned)||(projectFilter==='active'&&!completed&&!planned);
  return filter&&(p.name+' '+(p.goal||'')).toLocaleLowerCase('zh-TW').includes(query);
 });
 if(!rows.length){root.append(el('p','helper','沒有符合條件的專案。'));return;}
 for(const p of rows){
  const button=el('button','visual-project-row');button.type='button';button.addEventListener('click',()=>openQuickProject(p));
  const visual=p.name.match(/POS|收銀/i)?'▣':p.name.match(/AI|SKAI/i)?'✦':p.name.match(/盆栽|森林|植物/i)?'🌳':p.name.match(/FFM|品牌|食食/i)?'◈':'▤';
  const graphic=el('span','project-graphic',visual);const body=el('span','project-row-main');
  body.append(el('b','',p.name),el('small','',p.goal||'尚無專案目標'));
  const stage=el('span','status-pill',p.status==='closed'?'已完成':p.stage==='active'?'進行中':'規劃中');
  const amount=Number(p.progress);const known=p.progress!==undefined&&p.progress!==null&&Number.isFinite(amount);
  const meter=el('span','project-row-meter');const track=el('span','project-progress-track');const fill=el('i','project-progress-fill');fill.style.width=(known?Math.min(100,Math.max(0,amount)):0)+'%';track.append(fill);
  meter.append(track,el('b','',known?amount+'%':'未設定'));button.append(graphic,body,stage,meter,el('span','project-arrow','›'));
  const row=el('div','project-manage-row');const del=el('button','danger-outline','刪除');del.type='button';del.setAttribute('aria-label','刪除專案 '+p.name);del.addEventListener('click',()=>deleteProjectRecord(p));row.append(button,del);root.append(row);
 }
}
async function openQuickProject(project){
 const panel=$('projectQuickDetail');if(!panel)return;
 panel.hidden=false;$('quickProjectName').textContent=project.name;
 $('quickProjectGoal').textContent=project.goal||'尚未設定專案目標';
 const notesPanel=$('quickProjectNotesPanel');const fullNotes=$('quickProjectNotes');
 fullNotes.textContent=project.notes||'';
 notesPanel.hidden=!String(project.notes||'').trim();fullNotes.hidden=true;
 $('toggleProjectNotes').textContent='查看完整方案';$('toggleProjectNotes').setAttribute('aria-expanded','false');
 $('quickProjectStatus').textContent='階段：'+(project.stage||'未設定')+'｜進度：'+(project.progress===undefined||project.progress===null?'未設定':project.progress+'%');
 try{
  const data=await api('/tasks');
  const linked=(data.tasks||[]).filter(t=>t.project_id===project.id);
  renderList($('quickProjectTasks'),linked,'這個專案尚無已保存任務。',t=>listItem(t.title,((statuses[t.status]||t.status)+' · '+(t.brief||''))));
 }catch(e){$('quickProjectTasks').replaceChildren(el('p','helper','讀取相關任務失敗：'+e.message));}
 panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
$('closeQuickDetail')?.addEventListener('click',()=>{$('projectQuickDetail').hidden=true;});
$('toggleProjectNotes')?.addEventListener('click',()=>{const pre=$('quickProjectNotes');pre.hidden=!pre.hidden;const open=!pre.hidden;$('toggleProjectNotes').textContent=open?'收起完整方案':'查看完整方案';$('toggleProjectNotes').setAttribute('aria-expanded',String(open));});
function filteredTasks(){
 const q=$('taskSearch')?.value.trim().toLocaleLowerCase('zh-TW')||'';
 return taskCache.filter(t=>{
  const done=t.status==='done',inProgress=['in_progress','approved','review'].includes(t.status);
  const filter=taskFilter==='all'||(taskFilter==='done'&&done)||(taskFilter==='today'&&!done)||(taskFilter==='in_progress'&&inProgress);
  return filter&&(t.title+' '+(t.brief||'')).toLocaleLowerCase('zh-TW').includes(q);
 });
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
async function deleteTaskRecord(task){
 if(!confirm('永久刪除任務「'+task.title+'」？其審批及 AI 規劃將一併刪除，無法復原。'))return;
 try{await api('/tasks/'+encodeURIComponent(task.id),{method:'DELETE'});selectedTaskIds.delete(task.id);showToast('任務已刪除');await refreshManagement();}
 catch(e){showToast('刪除失敗：'+e.message);}
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
async function openTaskDetails(task,container){
 const willOpen=container.hidden;
 document.querySelectorAll('#taskCards .task-evidence-panel').forEach(p=>p.hidden=true);
 container.hidden=!willOpen;
 if(!willOpen)return;
 container.replaceChildren(el('p','helper','正在讀取任務與 AI 執行紀錄…'));
 const project=projectCache.find(p=>p.id===task.project_id);
 const title=el('h3','','任務內容與執行紀錄'),heading=el('div','task-detail-heading');
 heading.append(title,el('span','status-pill',statuses[task.status]||task.status));
 const body=el('div','task-detail-body');
 body.append(taskDetailLine('所屬專案',project?.name||'未分類'),taskDetailLine('工作說明與交付要求',task.brief||'尚未輸入工作說明，請先補齊要求。'));
 container.replaceChildren(heading,body);
 if(workspaceMode()==='local'){
  container.append(el('p','task-evidence-warning','本機模式沒有 AI 規劃及成果紀錄，不能執行或驗收。切換雲端並登入 CEO 才能開始正式 AI 工作。'));
  return;
 }
 let runs;
 try{runs=(await api('/orchestrations')).runs||[];}
 catch(e){container.append(el('p','task-evidence-warning','無法取得 AI 紀錄：'+e.message));return;}
 const item=runs.find(r=>r.task_id===task.id);
 if(!item){
  container.append(el('p','task-evidence-warning',task.status==='done'?'此任務雖標示已完成，但沒有 AI 方案或交付成果：尚未完成實質驗收。':'目前沒有 AI 工作方案或執行成果，單純核准任務不會啟動分析。'));
  if(task.status==='approved'){
   const planBtn=el('button','primary-btn','請智能助理產生執行方案');
   planBtn.type='button';planBtn.addEventListener('click',async()=>{
    if(!confirm('這會呼叫真實 AI API 並可能產生費用。只產生工作分配、時間／Token／美元估算；不會開始部門執行。確定？'))return;
    planBtn.disabled=true;
    try{await api('/orchestrations/plan',{method:'POST',body:{task_id:task.id}});showToast('智能助理提案已建立，等待 CEO 第二次核准');await openTaskDetails(task,container);}
    catch(e){showToast('無法產生方案：'+e.message);}
    finally{planBtn.disabled=false;}
   });container.append(planBtn);
  }
  return;
 }
 let detail;
 try{detail=await api('/orchestrations/'+encodeURIComponent(item.id));}
 catch(e){container.append(el('p','task-evidence-warning','方案詳情讀取失敗：'+e.message));return;}
 const run=detail.run,steps=detail.steps||[];
 const status=el('p','task-plan-state','AI 方案：'+(orchestrationStatuses[run.plan_status]||run.plan_status));
 container.append(status);
 const estimate=run.plan_estimate||{};
 const amount=Number(estimate.estimated_usd);
 const mins=Number(estimate.total_minutes);
 const tokens=Number(estimate.total_tokens);
 container.append(taskDetailLine('幕僚長工作規劃',run.summary||'尚未提供方案摘要'));
 container.append(taskDetailLine('時間／Tokens／成本估算',[
  Number.isFinite(mins)&&mins>0?mins+' 分鐘':'時間未提供',
  Number.isFinite(tokens)&&tokens>0?tokens.toLocaleString()+' Tokens':'Token 未提供',
  Number.isFinite(amount)?'US$'+amount.toFixed(4)+'（預估）':'成本未提供'
 ].join(' · ')));
 const section=el('div','task-step-list');section.append(el('h4','','部門分工與實際交付'));
 if(!steps.length)section.append(el('p','helper','沒有可查閱的部門工作項目'));
 steps.forEach(step=>{
  const card=el('div','task-step-card');
  const dept=EMPLOYEES.find(e=>e.id===step.role_id)?.name||step.role_id;
  card.append(el('strong','',String(step.sequence_no||'')+'｜'+dept+'　'+(step.status==='done'?'已產出成果':step.status==='pending'?'待執行':step.status||'')),
   taskDetailLine('工作指示',step.instruction||'未提供'));
  if(step.result)card.append(taskDetailLine('交付內容',step.result));
  else card.append(el('p','helper','尚未有可驗收的工作成果'));
  if(step.last_error)card.append(el('p','task-evidence-warning','異常：'+step.last_error));
  section.append(card);
 });
 container.append(section);
 if(run.consolidated_report){
  container.append(el('h4','','整合成果報告'),el('pre','task-result-report',run.consolidated_report));
 }
 const actions=el('div','task-detail-actions');
 if(run.plan_status==='draft'){
  const btn=el('button','primary-btn','CEO 核准分工與預估成本');
  btn.addEventListener('click',async()=>{
   if(!confirm('確認接受目前 AI 方案及預估費用？核准方案不會立刻執行付費的部門工作。'))return;
   btn.disabled=true;
   try{await api('/orchestrations/'+encodeURIComponent(run.id)+'/approve',{method:'POST'});showToast('方案已核准，可以逐步執行');container.hidden=true;await openTaskDetails(task,container);}
   catch(e){showToast('核准方案失敗：'+e.message);}finally{btn.disabled=false;}
  });actions.append(btn);
 }
 if(['ready','running','failed','paused'].includes(run.plan_status)){
  const btn=el('button','primary-btn',run.plan_status==='ready'?'開始執行第一個部門工作':'執行下一個／重試部門工作');
  btn.addEventListener('click',async()=>{
   if(!confirm('每次只執行一項 AI 部門工作，會呼叫真實 API 並可能產生費用。確定執行？'))return;
   btn.disabled=true;
   try{await api('/orchestrations/'+encodeURIComponent(run.id)+'/advance',{method:'POST'});showToast('部門工作已產出結果，請重新查看任務詳情');await refreshManagement();}
   catch(e){showToast('部門執行失敗：'+e.message);}finally{btn.disabled=false;}
  });actions.append(btn);
 }
 if(run.plan_status==='review'&&run.consolidated_report&&steps.length&&steps.every(s=>s.status==='done'&&s.result)){
  const btn=el('button','primary-btn','確認已閱讀成果並驗收完成');
  btn.addEventListener('click',async()=>{
   if(!confirm('確認已檢視各部門成果與整合報告，驗收此任務？'))return;
   btn.disabled=true;
   try{await api('/orchestrations/'+encodeURIComponent(run.id)+'/complete',{method:'POST'});showToast('成果已完成 CEO 驗收');await refreshManagement();}
   catch(e){showToast('驗收失敗：'+e.message);}finally{btn.disabled=false;}
  });actions.append(btn);
 }
 if(actions.children.length)container.append(actions);
 if(run.plan_status==='done'&&!run.consolidated_report)container.append(el('p','task-evidence-warning','此任務缺少整合報告，請檢查執行紀錄。'));
}
function renderTaskCards(){
 const root=$('taskCards');if(!root)return;root.replaceChildren();
 const rows=filteredTasks();
 if(!rows.length){root.append(el('p','helper','沒有符合條件的任務。'));updateTaskSelection();return;}
 for(const t of rows){
  const row=el('div','visual-task-row actionable-task-row');
  const label=el('label','task-select-label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selectedTaskIds.has(t.id);checkbox.setAttribute('aria-label','選取任務 '+t.title);
  checkbox.addEventListener('change',()=>{if(checkbox.checked)selectedTaskIds.add(t.id);else selectedTaskIds.delete(t.id);updateTaskSelection();});
  label.append(checkbox);row.append(label,el('span','task-list-title',t.title),el('span','status-pill',statuses[t.status]||t.status));
  const project=projectCache.find(p=>p.id===t.project_id);
  row.append(el('small','task-project-name',project?.name||'未分類'));
  const actions=el('div','task-row-actions');
  if(t.status==='proposed'){
   for(const [decision,label] of [['approved','核准'],['rejected','駁回']]){
    const btn=el('button','outline-btn',label);btn.type='button';btn.addEventListener('click',()=>approveTaskRecord(t,decision));actions.append(btn);
   }
  }
  const inspect=el('button','outline-btn','查看內容');inspect.type='button';actions.append(inspect);
  const remove=el('button','danger-outline','刪除');remove.type='button';remove.setAttribute('aria-label','刪除任務 '+t.title);remove.addEventListener('click',()=>deleteTaskRecord(t));actions.append(remove);
  row.append(actions);const details=el('section','task-evidence-panel');details.hidden=true;
  inspect.addEventListener('click',()=>openTaskDetails(t,details));root.append(row,details);
 }
 updateTaskSelection();
}
$('selectAllTasks')?.addEventListener('change',e=>{for(const t of filteredTasks()){if(e.target.checked)selectedTaskIds.add(t.id);else selectedTaskIds.delete(t.id);}renderTaskCards();});
$('bulkDeleteTasks')?.addEventListener('click',async()=>{
 const ids=[...selectedTaskIds],names=taskCache.filter(t=>selectedTaskIds.has(t.id)).map(t=>t.title);
 if(!ids.length)return;
 if(!confirm('永久刪除 '+ids.length+' 項任務？\n'+names.slice(0,5).join('、')+'\n無法復原。'))return;
 let done=0,errors=[];
 for(const id of ids){try{await api('/tasks/'+encodeURIComponent(id),{method:'DELETE'});done++;selectedTaskIds.delete(id);}catch(e){errors.push(e.message);}}
 showToast('刪除 '+done+' 項，失敗 '+errors.length+' 項'+(errors.length?'：'+errors[0]:''));
 await refreshManagement();
});
$('projectSearch')?.addEventListener('input',renderProjectCards);
$('taskSearch')?.addEventListener('input',renderTaskCards);
document.querySelectorAll('[data-project-filter]').forEach(b=>b.addEventListener('click',()=>{
 projectFilter=b.dataset.projectFilter;document.querySelectorAll('[data-project-filter]').forEach(x=>x.classList.toggle('active',x===b));renderProjectCards();
}));
document.querySelectorAll('[data-task-filter]').forEach(b=>b.addEventListener('click',()=>{
 taskFilter=b.dataset.taskFilter;document.querySelectorAll('[data-task-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTaskCards();
}));
$('jumpProjectCreate')?.addEventListener('click',()=>{$('projectCreatePanel').hidden=false;$('projectForm')?.scrollIntoView({behavior:'smooth',block:'center'});});
$('closeProjectCreate')?.addEventListener('click',()=>{$('projectCreatePanel').hidden=true;});
$('jumpTaskCreate')?.addEventListener('click',()=>{$('taskCreatePanel').hidden=false;$('taskForm')?.scrollIntoView({behavior:'smooth',block:'center'});});
$('closeTaskCreate')?.addEventListener('click',()=>{$('taskCreatePanel').hidden=true;});
$('openSettings')?.addEventListener('click',()=>{$('workspaceToggle').hidden=!$('workspaceToggle').hidden;});
$('openSettingsMobile')?.addEventListener('click',()=>{$('workspaceToggle').hidden=!$('workspaceToggle').hidden;});
$('toggleChiefPlans')?.addEventListener('click',()=>{const x=$('chiefPlanContent');x.hidden=!x.hidden;$('chiefPlanToggleIcon').textContent=x.hidden?'展開':'收合';});
async function refreshPage(page){
 if(!isSignedIn)return;
 if(page==='home')await loadDashboard();
 if(page==='data')await loadDataIndex();
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
 const body={project_id:String(fd.get('project_id')||''),title:String(fd.get('title')||''),brief:String(fd.get('brief')||''),ceo_assign_to_chief:workspaceMode()==='cloud'};
 const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{
  const created=await api('/tasks',{method:'POST',body});form.reset();
  if(workspaceMode()==='cloud'&&created.chief_plan_required){
   showToast('CEO 任務已建立；正在請幕僚長提出分析與成本預估。');
   try{await api('/orchestrations/plan',{method:'POST',body:{task_id:created.task.id}});showToast('幕僚長已提出分工方案，等待 CEO 確認');}
   catch(e){showToast('任務已保存，幕僚長規劃未成功：'+e.message+'。可從下方重新產生。');}
  }else showToast('本機已保存任務；AI 幕僚長需要雲端模式');
  await Promise.all([loadTasks(),loadApprovals(),loadDashboard(),loadOrchestrations()]);
 }catch(e){showToast('任務建立失敗：'+e.message)}
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
