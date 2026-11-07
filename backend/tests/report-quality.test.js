import test from 'node:test';
import assert from 'node:assert/strict';
import {departmentReportInstructions,reportQualityIssues} from '../src/report-quality.js';

const valid=[
 '## 一、資料與假設表',
 '本案為示例模型，並非經查證的實際門店財務。資料來源：CEO 尚未提供真實門店營收、租金與產品成本，以下均為示例假設，必須待查證。',
 '幣別為新臺幣，期間為每月。假設客單價 100 元、每日 200 杯、營業 30 日，每月固定成本 300000 元，變動成本率 40%。',
 '## 二、公式與試算',
 '月營收＝100 元 × 200 杯 × 30 日＝600000 元；變動成本＝600000 元 × 40%＝240000 元；貢獻利益＝600000 元－240000 元＝360000 元；營業損益＝360000 元－300000 元＝60000 元；損益兩平營收＝300000 元 ÷ (1－40%)＝500000 元。',
 '## 三、情境分析',
 '保守：150 杯／日，月營收 450000 元，營業損益 -30000 元；基準：200 杯／日，月營收 600000 元，營業損益 60000 元；樂觀：250 杯／日，月營收 750000 元，營業損益 150000 元。',
 '## 四、風險、現金流與待驗證事項',
 '未提供真實租約、裝修費用、薪資、原物料價格與稅額，此模型忽略稅費及融資成本，不可作投資承諾。需由 CEO 補上實際數據，並以 POS 日銷與真實成本驗證。'
].join('\n');

test('rejects unresolved finance placeholders',()=>{
 const x=valid.replace('300000 元','XXX萬元');
 assert.ok(reportQualityIssues(x,'finance').includes('contains_placeholder'));
 assert.ok(reportQualityIssues('固定成本 YY%，其餘未提供','finance').includes('contains_placeholder'));
 assert.ok(reportQualityIssues('成本 [填入金額]，仍待驗證','finance').includes('contains_placeholder'));
});
test('finance requires transparent numerical basis, formulas, and source status',()=>{
 const short='結論：有風險';
 assert.ok(reportQualityIssues(short,'finance').includes('report_too_short'));
 const noNumbers='成本分析。'.repeat(130)+'本文僅提供假設；資料來源尚待查證。損益兩平公式有待提供。';
 assert.ok(reportQualityIssues(noNumbers,'finance').includes('missing_quantified_assumptions'));
 const noCalculation='月租 30000 元、每日 100 杯，屬於假設，數據來源未提供。'.repeat(14);
 assert.ok(reportQualityIssues(noCalculation,'finance').includes('missing_calculation'));
 const noSources='初步試算：客單 100 元，每日 200 杯；假設固定成本 300000 元。'.repeat(13);
 assert.ok(reportQualityIssues(noSources,'finance').includes('missing_source_status'));
});
test('credible, clearly marked scenario model passes report quality gate',()=>{
 assert.deepEqual(reportQualityIssues(valid,'finance'),[]);
 assert.deepEqual(reportQualityIssues(valid,'marketing'),[]);
});
test('marketing can present analysis without invented numerical market figures',()=>{
 const report='競爭定位與客群洞察，需蒐集在地門店資料並查證。'.repeat(18);
 assert.deepEqual(reportQualityIssues(report,'marketing'),[]);
});
test('prompts state verified-vs-illustrative distinction and no fabricated research',()=>{
 const prompt=departmentReportInstructions('finance');
 assert.match(prompt,/示例假設/);
 assert.match(prompt,/損益兩平/);
 assert.match(prompt,/三種情境/);
 assert.match(prompt,/來源/);
 assert.doesNotMatch(departmentReportInstructions('marketing'),/財務報告必須包含/);
});
