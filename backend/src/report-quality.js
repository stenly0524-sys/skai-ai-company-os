// Internal report quality gates. Never infer verified data from model-generated assumptions.
const PLACEHOLDER_PATTERNS=[
 /(?:X{2,}|Y{2,}|Z{2,})\s*(?:萬|元|%|％|人|家|店|杯|筆|月|年)?/i,
 /(?:待填|待補數字|待補充金額|填入數字|填入金額|以實際數據代入|請自行填入|數字待定)/,
 /\[\s*(?:數字|金額|比例|價格|待填|填寫|xx|yy)[^\]]*\]/i,
 /(?:\{\s*(?:數字|金額|比例|待填|xx|yy)[^}]*\})/i
];
export function reportQualityIssues(text,roleId){
 const report=typeof text==='string'?text:'';
 const issues=[];
 if(report.trim().length<300)issues.push('report_too_short');
 if(PLACEHOLDER_PATTERNS.some(pattern=>pattern.test(report)))issues.push('contains_placeholder');
 if(roleId==='finance'){
  const hasNumber=/\d+(?:[,.]\d+)?\s*(?:元|萬|%|％|杯|筆|人|店|月|日)/.test(report);
  if(!hasNumber)issues.push('missing_quantified_assumptions');
  const mentionsCalc=/(?:試算|公式|計算|損益兩平|損益平衡|盈虧平衡|貢獻毛利|貢獻利益)/.test(report);
  if(!mentionsCalc)issues.push('missing_calculation');
  const hasUncertainty=/(?:假設|示例|情境|模擬|估算|推估|尚未驗證|待查證)/.test(report);
  if(!hasUncertainty)issues.push('missing_assumptions_label');
  const hasSources=/(?:資料來源|數據來源|待驗證|待查證|未提供|無外部資料)/.test(report);
  if(!hasSources)issues.push('missing_source_status');
 }
 return issues;
}
export function departmentReportInstructions(roleId){
 const common='請使用繁體中文，清楚區分「CEO 已提供的事實」、「用於試算的假設」、「需要後續查證的市場資訊」。禁止使用 XXX、YY%、待填金額等佔位符，禁止假稱已做市場調查、瀏覽網站或取得即時數據。若缺少事實資料，直接標記未提供；可提出可變更的示例假設，絕對不可包裝成已驗證數字。用條理清楚的小標題說明結論、依據、風險、下一步。';
 if(roleId!=='finance')return common;
 return common+'\n財務報告必須包含：①「資料與假設表」：幣別與期間明確，每項列出數值、單位、來源是 CEO/其他部門/示例假設；資料不足時標示示例數字而非留空；②「逐步可驗算的模型」：例如月營收=客單價×每日訂單量×營業天數；變動成本=營收×變動成本率；貢獻利益=營收－變動成本；營業損益=貢獻利益－每月固定成本；損益兩平營收=固定成本÷(1－變動成本率)；數字需前後一致；③至少三種情境（保守、基準、樂觀）列關鍵參數和月損益；④現金流及重要風險；⑤「資料來源與待查證」明示目前沒有外部查證及需要 CEO/現場補充的資料。若只有示例假設，不得聲稱這是實際店面預測或投資建議。';
}
