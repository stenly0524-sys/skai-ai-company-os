import {makeIcon} from './icons.js';
// SKAI interactive office uses the approved user-provided 3D reference artwork.
// Clickable HTML hotspots are aligned to staff shown in the picture; other roles remain in the 9-role mobile grid.
const visualPositions={
 chief_of_staff:[54,33],operations:[23,56],finance:[51,56],marketing:[80,56],
 tech:[23,80],hr:[51,80],brand:[80,80]
};
const names={chief_of_staff:'幕僚戰略部',operations:'營運策略部',finance:'財務部',marketing:'行銷企劃部',
 tech:'資訊技術部',hr:'人事管理部',brand:'視覺設計部',admin:'行政後勤部',legal:'法務部'};
const symbols={chief_of_staff:'✦',operations:'⚙',finance:'◈',marketing:'◉',tech:'⌘',hr:'♙',brand:'✿',admin:'▤',legal:'◇'};
export function renderOffice(people,{office,grid,mobileGrid,onSelect}){
 function makeButton(employee,kind){
  const b=document.createElement('button');b.type='button';
  b.setAttribute('aria-label','查看 '+employee.name);
  if(kind==='scene'){
   b.className='office-person office-hotspot';
   const [x,y]=visualPositions[employee.id];
   b.style.left=x+'%';b.style.top=y+'%';
   b.title='查看 '+employee.name;
   b.append(document.createElement('span'));
   b.firstChild.className='office-hotspot-hint';
   b.firstChild.textContent='查看 '+(names[employee.id]||employee.name);
   const visualLabel=document.createElement('span');
   visualLabel.className='office-position-label';
   visualLabel.append(makeIcon(employee.id),document.createTextNode(names[employee.id]||employee.name));
   b.append(visualLabel);
  } else {
   b.className=kind==='mobile'?'mobile-office-person':'employee-card';
   const face=document.createElement('span');face.className='person-head';
   face.textContent=symbols[employee.id]||employee.symbol;
   face.style.setProperty('--person-accent',employee.color);
   const label=document.createElement('b');label.className='person-name';
   label.textContent=kind==='mobile'?(names[employee.id]||employee.name):employee.name;
   b.append(face,label);
   if(kind==='detail'){
    const code=document.createElement('small');code.textContent=employee.title;b.append(code);
   }
  }
  b.addEventListener('click',()=>onSelect(employee));
  return b;
 }
 office.replaceChildren();grid.replaceChildren();
 if(mobileGrid)mobileGrid.replaceChildren();
 for(const employee of people){
  if(visualPositions[employee.id])office.append(makeButton(employee,'scene'));
  grid.append(makeButton(employee,'detail'));
  if(mobileGrid)mobileGrid.append(makeButton(employee,'mobile'));
 }
}
