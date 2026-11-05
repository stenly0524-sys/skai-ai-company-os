// CEO-approved SKAI governance: load canonical versioned company SOP from Neon.
// A policy being approved does not imply every integration or QA automation exists.
export async function activeCompanySop(db){
 const r=await db.query("SELECT id,policy_code,version,title,approved_at,effective_at,source_text,drive_pdf_id,project_pdf_id,implementation_status FROM company_sops WHERE status='approved' ORDER BY effective_at DESC,id DESC LIMIT 1");
 return r.rows[0]||null;
}
const CHAPTERS=['第一章｜','第三章｜','第六章｜','第八章｜','第九章｜','第十章｜','第十一章｜'];
function sections(source){
 const blocks=source.split(/(?=第[一二三四五六七八九十]+章｜)/);
 return blocks;
}
export function companySopSystemRules(sop,role){
 if(!sop)return '';
 const source=String(sop.source_text||'');
 const blocks=sections(source);
 const required=blocks.filter(b=>CHAPTERS.some(prefix=>b.startsWith(prefix)));
 const selected=required.flatMap(block=>block.split('\n').filter(line=>
   /章｜|CEO|核准|不得|禁止|待確認|權限|驗收|檢查|重試|預算|Token|美元|PDF|Word|Excel|Google Drive|文件|保密|法規|假設|誤|風險|授權|成果|紀錄|證據|格式/.test(line)
 )).join('\n').slice(0,3500);
 const roleLabel={chief_of_staff:'AI 幕僚長',admin:'行政後勤部',finance:'財務部',brand:'視覺設計部',marketing:'行銷企劃部',operations:'營運策略部',tech:'資訊技術部',hr:'人事管理部',legal:'法務部'}[role]||'';
 const roleLine=blocks.find(x=>x.startsWith('第二章｜'))?.split('\n');
 let dept='';
 if(roleLabel&&roleLine){const i=roleLine.findIndex(x=>x.trim().startsWith(roleLabel));if(i>=0)dept=roleLine.slice(i,i+2).join('\n');}
 return '\n【正式公司規範：'+sop.policy_code+' '+sop.version+'｜CEO 已核准】\n'+selected+
  (dept?'\n【本部門職責】\n'+dept:'')+
  '\n技術能力邊界：文件生成／Google Drive 自動上傳／完整 QA 若未串接，必須明確標記尚未啟用。單純生成文字不等於交付完成，不得假稱執行、法規驗證或已通過 CEO 驗收。';
}
