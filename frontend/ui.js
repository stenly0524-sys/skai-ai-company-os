// UI module adapted from 全民系列 ui.js: data-to-DOM, never hard-coded business results.
export function el(tag,cls,text){
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text!==undefined)node.textContent=String(text);
 return node;
}
export function listItem(title,description,extra){
 const item=el('article','data-item');
 item.append(el('b','',title));
 if(description)item.append(el('p','helper',description));
 if(extra)item.append(extra);
 return item;
}
export function renderList(root,rows,empty,mapper){
 root.replaceChildren();
 if(!rows.length){root.append(el('p','helper',empty));return;}
 for(const row of rows)root.append(mapper(row));
}
