// Scene module adapted from 全民系列 scene.js: interactive office presentation only.
export function renderOffice(people,{office,grid,onSelect}){
 function personButton(employee,mini){
  const button=document.createElement('button');
  button.type='button';button.className=mini?'office-person':'employee-card';
  if(mini){button.style.left=employee.x+'%';button.style.top=employee.y+'%';}
  else button.setAttribute('aria-label','查看 '+employee.name);
  const face=document.createElement('span');
  face.className='person-head';face.textContent=employee.symbol;
  face.style.background='linear-gradient(145deg,#fff,'+employee.color+')';
  const label=document.createElement(mini?'span':'b');
  if(mini)label.className='person-label';
  label.textContent=employee.name;
  button.append(face,label);
  if(!mini){const code=document.createElement('small');code.textContent=employee.title;button.append(code);}
  button.addEventListener('click',()=>onSelect(employee));
  return button;
 }
 office.replaceChildren();grid.replaceChildren();
 for(const employee of people){
  office.append(personButton(employee,true));
  grid.append(personButton(employee,false));
 }
}
