import { EMPLOYEES } from './employees.js';

const $=(id)=>document.getElementById(id);
const office=$('officePeople'),grid=$('employeeGrid'),dialog=$('employeeDialog'),toast=$('toast');
let currentEmployee=null;
let toastTimer;
function showToast(message){
 toast.textContent=message;
 toast.hidden=false;
 clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{toast.hidden=true},3200);
}
function employeeButton(employee,small=false){
 const button=document.createElement('button');
 button.type='button';
 button.className=small?'office-person':'employee-card';
 if(small){
  button.style.left=employee.x+'%';
  button.style.top=employee.y+'%';
 }else{
  button.setAttribute('aria-label','查看 '+employee.name);
 }
 const face=document.createElement('span');
 face.className='person-head';
 face.textContent=employee.symbol;
 face.style.background='linear-gradient(145deg,#fff,'+employee.color+')';
 const label=document.createElement(small?'span':'b');
 label.className=small?'person-label':'';
 label.textContent=employee.name;
 button.append(face,label);
 if(!small){
  const code=document.createElement('small');
  code.textContent=employee.title;
  button.append(code);
 }
 button.addEventListener('click',()=>showEmployee(employee));
 return button;
}
for(const employee of EMPLOYEES){
 office.append(employeeButton(employee,true));
 grid.append(employeeButton(employee,false));
}
function showEmployee(employee){
 currentEmployee=employee;
 $('employeeTitle').textContent=employee.name;
 $('employeeCode').textContent=employee.title;
 $('employeeDescription').textContent=employee.scope;
 $('employeeFace').textContent=employee.symbol;
 $('employeeFace').style.background='linear-gradient(145deg,#fff,'+employee.color+')';
 if(typeof dialog.showModal==='function')dialog.showModal();
 else dialog.setAttribute('open','');
}
$('closeEmployee').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{
 if(event.target===dialog)dialog.close();
});
function showPage(page){
 const target=$('page-'+page);
 if(!target)return;
 for(const section of document.querySelectorAll('.page'))section.classList.toggle('active',section===target);
 for(const nav of document.querySelectorAll('[data-page]')){
  const active=nav.dataset.page===page;
  nav.classList.toggle('active',active);
  if(active)nav.setAttribute('aria-current','page');
  else nav.removeAttribute('aria-current');
 }
 window.scrollTo({top:0,behavior:'instant'});
}
for(const button of document.querySelectorAll('[data-page]'))button.addEventListener('click',()=>showPage(button.dataset.page));
for(const button of document.querySelectorAll('[data-jump]'))button.addEventListener('click',()=>showPage(button.dataset.jump));
$('ceoInfo').addEventListener('click',()=>showToast('CEO 介面預覽中，尚未連線至正式帳號系統。'));
$('employeeChat').addEventListener('click',()=>{
 dialog.close();
 showPage('home');
 $('chatText').focus();
 showToast(currentEmployee.name+'：AI 對話尚未啟用，待後端安全連線。');
});
$('chatPreviewForm').addEventListener('submit',event=>{
 event.preventDefault();
 const content=$('chatText').value.trim();
 if(!content)return;
 showToast('尚未連線：目前沒有向 AI 發送訊息，也沒有產生任務。');
});
const initialPage=location.hash.slice(1);
if(['home','employees','projects','tasks','approvals','notifications'].includes(initialPage))showPage(initialPage);
