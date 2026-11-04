// SKAI's approved white/silver-blue icon system, redrawn as resolution-independent vectors.
const shapes={"home":"M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z","employees":"M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75","projects":"M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z","tasks":"M9 6h12 M9 12h12 M9 18h12 M3 6l1.5 1.5L7 4.5 M3 12l1.5 1.5L7 10.5 M3 18l1.5 1.5L7 16.5","orchestrations":"M12 4a2.5 2.5 0 1 0 0 .01 M5 20a2.5 2.5 0 1 0 0 .01 M19 20a2.5 2.5 0 1 0 0 .01 M10.8 6.3 6.6 10.6 M13.2 6.3 6.6 10.6 M8 20h8","approvals":"M7 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2 M15 3v5h5 M8 15l2.3 2.3 5-5","notifications":"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4","settings":"M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M18.4 5.6 17 7 M7 17l-1.4 1.4 M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10 M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4","chief_of_staff":"M12 2l2.8 6.8L22 12l-7.2 3.2L12 22l-2.8-6.8L2 12l7.2-3.2z M18.5 3.5l.8 1.5 1.5.8-1.5.8-.8 1.5-.8-1.5-1.5-.8 1.5-.8z","admin":"M6 3h10l4 4v14H6z M15 3v5h5 M9 11h7 M9 15h7 M9 19h5","finance":"M4 5c0-2 16-2 16 0s-16 2-16 0 M4 5v4c0 2 16 2 16 0V5 M4 9v4c0 2 16 2 16 0V9 M4 13v4c0 2 16 2 16 0v-4 M10 4v14","brand":"M12 3a9 9 0 0 0 0 18h2a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 1-2-2 2 2 0 0 1 2-2h3a4 4 0 0 0 4-4c0-4-4-6-9-6z M7 10h.1 M10 6.5h.1 M17 8h.1 M7.5 15h.1","marketing":"M3 11h4l11-6v14L7 13H3z M7 13l2 7h3 M20 8l2-1 M20 15l2 1","operations":"M12 3a9 9 0 0 1 8.2 5 M21 3v5h-5 M12 21a9 9 0 0 1-8.2-5 M3 21v-5h5 M12 9v6 M9 12h6","tech":"M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16 M3 3h18v18H3z","hr":"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a8 8 0 0 1 16 0v2z M12 12v9","legal":"M12 2l8 4v6c0 6-4.5 9-8 10-3.5-1-8-4-8-10V6z M8 12h8 M12 8v8 M6.5 16h11","knowledge":"M12 6c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V5c-3-1-7-1-10 1 M12 6v15","metrics":"M3 21h18 M6 18v-5h3v5 M11 18V9h3v9 M16 18V4h3v14 M7 8l4-4 4 2 5-4","highlights":"M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z M4 3l.7 1.5L6 5l-1.3.5L4 7l-.7-1.5L2 5l1.3-.5z","ceo":"M2 8l4 4 6-8 6 8 4-4-2 11H4z M4 21h16","progress":"M4 5h9 M4 10h15 M4 15h10 M4 20h16 M16 5h4","validation":"M7 3h10v3H7z M6 5H4v16h16V5h-2 M8 14l3 3 6-6","relationships":"M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M4 21v-3a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3 M2 10a2 2 0 1 0 0-4 M22 10a2 2 0 1 0 0-4"};
export const ICON_NAMES=Object.freeze(Object.keys(shapes));
const ns='http://www.w3.org/2000/svg';
export function makeIcon(name){
 const span=document.createElement('span');span.className='skai-icon';span.setAttribute('aria-hidden','true');
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');
 svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.65');
 svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
 const path=document.createElementNS(ns,'path');path.setAttribute('d',shapes[name]||shapes.tasks);
 svg.append(path);span.append(svg);
 return span;
}
const navPages={home:'home',employees:'employees',projects:'projects',tasks:'tasks',orchestrations:'orchestrations',approvals:'approvals',notifications:'notifications','ai-controls':'settings'};
export function applyInterfaceIcons(){
 document.querySelectorAll('.navitem[data-page],.mobileitem[data-page],.mobile-more-link[data-page]').forEach(button=>{
  const icon=navPages[button.dataset.page]||'home';
  const old=button.querySelector('span');
  if(old)old.replaceWith(makeIcon(icon));else button.prepend(makeIcon(icon));
 });
 const more=document.getElementById('mobileMore');
 if(more){const old=more.querySelector('span');if(old)old.replaceWith(makeIcon('settings'));}
 const shortcuts={statProjects:'projects',statTasks:'tasks',statApprovals:'approvals'};
 for(const [id,icon] of Object.entries(shortcuts)){const card=document.getElementById(id)?.closest('button');if(card)card.prepend(makeIcon(icon));}
 const titleIcons={chief_of_staff:'chief_of_staff',admin:'admin',finance:'finance',brand:'brand',marketing:'marketing',operations:'operations',tech:'tech',hr:'hr',legal:'legal'};
 document.querySelectorAll('#employeeGrid .employee-card,#mobileOfficeGrid .mobile-office-person').forEach(button=>{
  const label=button.getAttribute('aria-label')||'';
  const ids=['chief_of_staff','admin','finance','brand','marketing','operations','tech','hr','legal'];
  const names=['AI 幕僚長','行政管理官','財務長','品牌創意長','行銷長','營運長','技術長','人才管理長','法務風控長'];
  const id=ids[names.findIndex(name=>label.includes(name))];
  if(!id)return;
  const existing=button.querySelector('.person-head');
  if(existing)existing.replaceChildren(makeIcon(titleIcons[id]));
 });
 const face=document.getElementById('employeeFace');if(face)face.replaceChildren(makeIcon('employees'));
 const chief=document.querySelector('.mini-face');if(chief)chief.replaceChildren(makeIcon('chief_of_staff'));
 function decorateActionButton(button){
  if(button.querySelector('.skai-icon'))return;
  const name=button.textContent.trim();
  if(!name)return;
  const rules=[
   [/CEO|審核|核准|批准|待審批/, 'approvals'],
   [/驗收|完成/, 'validation'],
   [/分析|執行|協作|生成分工/, 'orchestrations'],
   [/恢復|重新整理|更新/, 'operations'],
   [/報告|查看|閱讀/, 'knowledge'],
   [/收合|進度/, 'progress'],
   [/匯出|匯入|專案/, 'projects'],
   [/通知|提醒/, 'notifications'],
   [/對話|詢問|AI/, 'chief_of_staff'],
   [/任務/, 'tasks']
  ];
  const icon=rules.find(([regexp])=>regexp.test(name))?.[1];
  if(icon)button.prepend(makeIcon(icon));
 }
 function updateActionIcons(root=document){
  root.querySelectorAll('button.outline-btn,button.text-btn,button.primary-btn').forEach(decorateActionButton);
 }
 updateActionIcons();
 for(const id of ['orchestrationList','approvalList','projectList','taskList','notificationList']){
  const root=document.getElementById(id);
  if(!root)continue;
  const observer=new MutationObserver(()=>updateActionIcons(root));
  observer.observe(root,{childList:true,subtree:true});
 }
 const other=[
  ['#ceoInfo','ceo'],['#closeEmployee','settings'],['#useLocal','settings'],['#useCloud','relationships'],
  ['#employeeChat','relationships'],['#projectForm [type="submit"]','projects'],
  ['#taskForm [type="submit"]','tasks'],['#orchestrationForm [type="submit"]','orchestrations'],
  ['#chatPreviewForm [type="submit"]','chief_of_staff'],['#loginForm [type="submit"]','validation'],['#aiControlForm [type="submit"]','settings']
 ];
 for(const [selector,icon] of other){const button=document.querySelector(selector);if(button)button.prepend(makeIcon(icon));}
}
