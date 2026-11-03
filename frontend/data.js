// Canonical frontend entities and display labels — analogous to 全民系列 data.js.
export { EMPLOYEES } from './employees.js';
export const TASK_STATUS = Object.freeze({
 proposed:'待審批',approved:'已核准',in_progress:'執行中',
 review:'待驗收',done:'完成',paused:'暫停',rejected:'已駁回'
});
export const STORAGE_VERSION=1;
export const STORAGE_KEY='skai_v05_local_company_v1';
