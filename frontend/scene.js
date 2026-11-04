// Interactive SKAI headquarters: presentation only; live operational data comes from the API.
const faces={
 chief_of_staff:'👨🏻‍💼',admin:'👩🏻‍💼',finance:'👨🏻‍💻',brand:'👩🏻‍🎨',
 marketing:'👨🏻‍💼',operations:'👨🏻‍💼',tech:'👨🏻‍💻',hr:'👩🏻‍💼',legal:'👩🏻‍⚖️'
};
const shortNames={
 chief_of_staff:'AI 幕僚長',admin:'行政部',finance:'財務部',brand:'設計部',
 marketing:'市場部',operations:'營運部',tech:'技術部',hr:'人資部',legal:'法務部'
};
export function renderOffice(people,{office,grid,mobileGrid,onSelect}){
 function personButton(employee,mode){
  const button=document.createElement('button');
  button.type='button';
  button.className=mode==='scene'?'office-person':mode==='mobile'?'mobile-office-person':'employee-card';
  button.setAttribute('aria-label','查看 '+employee.name);
  if(mode==='scene'){
   button.style.left=employee.x+'%';
   button.style.top=employee.y+'%';
   if(employee.id==='chief_of_staff')button.classList.add('office-lead');
  }
  const face=document.createElement('span');
  face.className='person-head';
  face.textContent=faces[employee.id]||employee.symbol;
  face.style.setProperty('--person-accent',employee.color);
  const label=document.createElement(mode==='scene'?'span':'b');
  label.className=mode==='scene'?'person-label':'person-name';
  label.textContent=mode==='mobile'?shortNames[employee.id]||employee.name:employee.name;
  button.append(face,label);
  if(mode==='detail'){
   const code=document.createElement('small');
   code.textContent=employee.title;
   button.append(code);
  }
  button.addEventListener('click',()=>onSelect(employee));
  return button;
 }
 office.replaceChildren();grid.replaceChildren();
 if(mobileGrid)mobileGrid.replaceChildren();
 for(const employee of people){
  office.append(personButton(employee,'scene'));
  grid.append(personButton(employee,'detail'));
  if(mobileGrid)mobileGrid.append(personButton(employee,'mobile'));
 }
}
