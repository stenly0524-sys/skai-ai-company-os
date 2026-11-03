import crypto from 'node:crypto';
export function tokenMatches(supplied,expected){
 if(typeof supplied!=='string'||typeof expected!=='string'||!supplied||!expected) return false;
 const a=Buffer.from(supplied),b=Buffer.from(expected);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export function validOrigin(origin, allowed){
 if(!origin)return true; // Non-browser tools may omit Origin, but must authenticate.
 return allowed.includes(origin);
}
export function validUuid(value){
 return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function compactText(value,maxLength){
 return typeof value==='string'?value.trim().slice(0,maxLength):'';
}
