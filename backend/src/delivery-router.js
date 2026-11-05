import express from 'express';
import {createHash} from 'node:crypto';
import {driveClient,driveDeliveryReady,DriveDeliveryError,safeFileName,exportDeliverable} from './drive-delivery.js';
import {validUuid} from './security.js';
import {ROLES} from './roles.js';
import {driveClientForCompany,savedDriveConnection} from './google-oauth.js';
const allowedFormats=['pdf','docx','xlsx'];
const resultError=(res,e)=>{if(e instanceof DriveDeliveryError)return res.status(e.status).json({error:e.message});console.error('delivery:',e?.code||e?.message||e);return res.status(500).json({error:'delivery_internal_error'});};
const record=async(db,event,type,id,data)=>db.query(
 'INSERT INTO audit_log(actor,event,target_type,target_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',
 ['ceo',event,type,id,JSON.stringify(data)]
);
export function deliveryRouter(db,{clientFactory=()=>driveClientForCompany(db)}={}){
 const router=express.Router();
 router.get('/status',async(_req,res)=>{
  try{
   const connected=Boolean((await savedDriveConnection(db))||driveDeliveryReady());
   res.json({connected,mode:connected?'oauth_configured':'not_connected',notice:connected?'OAuth 授權已保存；仍須確認資料夾權限。':'尚未連接 Google Drive，不能自動生成或上傳。'});
  }catch(e){resultError(res,e)}
 });
 router.post('/projects/:id/setup',async(req,res)=>{
  const projectId=req.params.id;
  if(!validUuid(projectId))return res.status(400).json({error:'invalid_project_id'});
  if(!req.ceoSession||req.body?.confirm!==true)return res.status(403).json({error:'ceo_confirmation_required'});
  if(!(await savedDriveConnection(db))&&!driveDeliveryReady())return res.status(409).json({error:'drive_not_connected'});
  try{
   const project=await db.query('SELECT id,name FROM projects WHERE id=$1',[projectId]);
   if(!project.rowCount)return res.status(404).json({error:'project_not_found'});
   const pre=await db.query("SELECT role_id,folder_id,folder_url FROM project_drive_folders WHERE project_id=$1",[projectId]);
   const existing=new Map(pre.rows.map(row=>[row.role_id,row]));
   const parent=process.env.SKAI_DRIVE_PROJECTS_FOLDER_ID;
   if(!parent)return res.status(409).json({error:'drive_projects_parent_not_configured'});
   const drive=await clientFactory();
   let root=existing.get('root');
   if(root){await drive.validateFolder(root.folder_id);root={id:root.folder_id,url:root.folder_url};}
   else{
    await drive.validateFolder(parent);
    root=await drive.createFolder(project.rows[0].name,parent);
    // Save the root immediately: partial failures must be resumable, not duplicate the project.
    await db.query('INSERT INTO project_drive_folders(project_id,role_id,folder_id,folder_url) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,role_id) DO NOTHING',
     [projectId,'root',root.id,root.url]);
   }
   const names={chief_of_staff:'戰略幕僚部',admin:'行政管理部',operations:'營運策略部',finance:'財務部',hr:'人事管理部',marketing:'行銷企劃部',brand:'視覺設計部門',tech:'資訊技術部',legal:'法務部'};
   const created=[];
   for(const [role,name] of Object.entries(names)){
    if(existing.has(role))continue;
    const folder=await drive.createFolder(name,root.id);
    await db.query('INSERT INTO project_drive_folders(project_id,role_id,folder_id,folder_url) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,role_id) DO NOTHING',
     [projectId,role,folder.id,folder.url]);
    created.push(role);
   }
   await record(db,'drive.project_folder_mapping_verified','project',projectId,{folder_id:root.id,created_roles:created});
   res.status(created.length||!pre.rowCount?201:200).json({folder:root,created_roles:created,reused:pre.rowCount>0});
  }catch(e){resultError(res,e)}
 });
 router.post('/tasks/:id/generate',async(req,res)=>{
  const id=req.params.id;
  if(!validUuid(id))return res.status(400).json({error:'invalid_task_id'});
  if(!req.ceoSession||req.body?.confirm!==true)return res.status(403).json({error:'ceo_confirmation_required'});
  if(!(await savedDriveConnection(db))&&!driveDeliveryReady())return res.status(409).json({error:'drive_not_connected'});
  const role=req.body?.role_id||'chief_of_staff';
  if(!ROLES[role])return res.status(400).json({error:'invalid_department'});
  try{
   const taskQuery=await db.query('SELECT t.*,p.name AS project_name FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1',[id]);
   if(!taskQuery.rowCount)return res.status(404).json({error:'task_not_found'});
   const task=taskQuery.rows[0];
   const runQuery=await db.query("SELECT id,plan_status,consolidated_report FROM orchestration_runs WHERE task_id=$1 AND plan_status IN ('review','done') ORDER BY created_at DESC LIMIT 1",[id]);
   if(!runQuery.rowCount)return res.status(409).json({error:'ai_verified_report_required'});
   const run=runQuery.rows[0];
   const stepQuery=await db.query('SELECT role_id,status,result FROM orchestration_steps WHERE run_id=$1 ORDER BY sequence_no',[run.id]);
   const steps=stepQuery.rows;
   if(!steps.length||steps.some(s=>s.status!=='done'||!s.result)||!run.consolidated_report||run.consolidated_report.length<300)
    return res.status(409).json({error:'department_outputs_incomplete'});
   const text=role==='chief_of_staff'?run.consolidated_report:steps.filter(s=>s.role_id===role).map(s=>s.result).join('\n\n');
   if(text.length<300)return res.status(409).json({error:'requested_department_has_no_completed_report'});
   const pref=await db.query('SELECT formats FROM task_delivery_preferences WHERE task_id=$1',[id]);
   const formats=pref.rows[0]?.formats||['pdf'];
   if(!formats.length||formats.some(x=>!allowedFormats.includes(x)))return res.status(409).json({error:'invalid_saved_delivery_preference'});
   const folderQ=await db.query('SELECT folder_id,folder_url FROM project_drive_folders WHERE project_id=$1 AND role_id=$2',[task.project_id,role]);
   if(!folderQ.rowCount)return res.status(409).json({error:'project_department_folder_not_mapped'});
   const folder=folderQ.rows[0],drive=await clientFactory();
   await drive.validateFolder(folder.folder_id);
   const digest=createHash('sha256').update(task.id+'|'+role+'|'+text).digest('hex').slice(0,12);
   const results=[],errors=[];
   let reusableDocId=null;
   const title=safeFileName(task.project_name+'_'+task.title+'_'+role+'_'+digest);
   for(const format of formats){
    // DB job + source fingerprint makes retried requests idempotent for successful deliveries.
    const claim=await db.query(`INSERT INTO task_delivery_jobs(task_id,role_id,format,source_hash,status)
      VALUES($1,$2,$3,$4,'running') ON CONFLICT(task_id,role_id,format,source_hash) DO NOTHING RETURNING id`,[id,role,format,digest]);
    let jobId=claim.rows[0]?.id;
    if(!jobId){
     const existing=await db.query('SELECT id,status,deliverable_id FROM task_delivery_jobs WHERE task_id=$1 AND role_id=$2 AND format=$3 AND source_hash=$4',[id,role,format,digest]);
     const job=existing.rows[0];
     if(job?.status==='completed'&&job.deliverable_id){
      const old=await db.query('SELECT * FROM task_deliverables WHERE id=$1',[job.deliverable_id]);
      if(old.rowCount){results.push({...old.rows[0],reused:true});continue;}
     }
     if(job?.status==='running')return res.status(409).json({error:'delivery_already_running',completed:results});
     // A failed job must be manually retried; same report digest and format are reused.
     const retry=await db.query("UPDATE task_delivery_jobs SET status='running',error_code=NULL,attempts=attempts+1,updated_at=NOW() WHERE id=$1 AND status='failed' AND attempts<3 RETURNING id",[job.id]);
     if(!retry.rowCount)return res.status(409).json({error:'delivery_retry_limit_or_in_progress',completed:results});
     jobId=retry.rows[0].id;
    }
    try{
     const result=await exportDeliverable(drive,{format,title,report:text,folderId:folder.folder_id,sourceDocId:format==='xlsx'?null:reusableDocId});
     if(format!=='xlsx')reusableDocId=result.sourceId;
     const save=await db.query(`INSERT INTO task_deliverables(project_id,task_id,role_id,format,title,drive_file_id,drive_url,review_state)
      VALUES($1,$2,$3,$4,$5,$6,$7,'needs_review') ON CONFLICT(drive_file_id) DO UPDATE SET drive_url=EXCLUDED.drive_url RETURNING *`,
      [task.project_id,id,role,format,title,result.id,result.url]);
     await db.query("UPDATE task_delivery_jobs SET status='completed',deliverable_id=$2,updated_at=NOW() WHERE id=$1",[jobId,save.rows[0].id]);
     await record(db,'deliverable.generated_uploaded_verified','task',id,{role,format,drive_file_id:result.id,review_state:'needs_review'});
     results.push(save.rows[0]);
    }catch(e){
     errors.push({format,error:e instanceof DriveDeliveryError?e.message:'delivery_failed'});
     await db.query("UPDATE task_delivery_jobs SET status='failed',error_code=$2,updated_at=NOW() WHERE id=$1",[jobId,e instanceof DriveDeliveryError?e.message:'delivery_failed']).catch(()=>{});
    }
   }
   res.status(errors.length?207:201).json({documents:results,errors,notice:'檔案完成歸檔驗證，但仍須 CEO 及必要專業人員複核，未自動核准。'});
  }catch(e){resultError(res,e)}
 });
 router.post('/deliverables/:id/review',async(req,res)=>{
  if(!validUuid(req.params.id))return res.status(400).json({error:'invalid_deliverable_id'});
  if(!req.ceoSession||req.body?.confirm!==true)return res.status(403).json({error:'ceo_confirmation_required'});
  const state=req.body?.decision;
  if(!['approved','rejected'].includes(state))return res.status(400).json({error:'invalid_review_decision'});
  try{
   const q=await db.query('SELECT * FROM task_deliverables WHERE id=$1',[req.params.id]);
   if(!q.rowCount)return res.status(404).json({error:'deliverable_not_found'});
   const file=q.rows[0];
   if(state==='approved'){
    if(!(await savedDriveConnection(db))&&!driveDeliveryReady())return res.status(409).json({error:'drive_not_connected'});
    const folder=await db.query('SELECT folder_id FROM project_drive_folders WHERE project_id=$1 AND role_id=$2',[file.project_id,file.role_id]);
    if(!folder.rowCount)return res.status(409).json({error:'folder_mapping_missing'});
    const drive=await clientFactory();
    const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    await drive.verify(file.drive_file_id,folder.rows[0].folder_id,types[file.format]);
   }
   const upd=await db.query("UPDATE task_deliverables SET review_state=$2 WHERE id=$1 AND review_state IN ('needs_review','draft','rejected') RETURNING *",[file.id,state]);
   if(!upd.rowCount)return res.status(409).json({error:'deliverable_already_reviewed'});
   await record(db,'deliverable.ceo_reviewed','task',file.task_id,{deliverable_id:file.id,decision:state});
   res.json({document:upd.rows[0],notice:state==='approved'?'CEO 已審閱並確認該文件，其他必要驗收仍需完成。':'已退回修正'});
  }catch(e){resultError(res,e)}
 });
 return router;
}
