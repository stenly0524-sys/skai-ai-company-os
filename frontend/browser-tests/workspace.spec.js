import {test,expect,devices} from '@playwright/test';

test('iPhone portrait: create project, propose and approve task, preserve across reload',async({browser})=>{
 const ctx=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const page=await ctx.newPage();
 await page.goto('/');
 await page.getByRole('button',{name:'本機模式'}).click();
 await expect(page.locator('#connectionStatus')).toContainText('本機工作區');
 await page.locator('.mobile-nav [data-page="projects"]').click();
 await page.locator('#projectForm [name="name"]').fill('埔里潮流盆栽專案');
 await page.locator('#projectForm [name="goal"]').fill('籌備供應鏈和營運計畫');
 await page.locator('#projectForm [type="submit"]').click();
 await expect(page.locator('#projectList')).toContainText('埔里潮流盆栽專案');
 await page.locator('.mobile-nav [data-page="tasks"]').click();
 await page.locator('#taskProject').selectOption({label:'埔里潮流盆栽專案'});
 await page.locator('#taskForm [name="title"]').fill('整理供應商名單');
 await page.locator('#taskForm [type="submit"]').click();
 await expect(page.locator('#taskList')).toContainText('整理供應商名單');
 await page.locator('.mobile-nav [data-page="approvals"]').click();
 await expect(page.locator('#approvalList')).toContainText('整理供應商名單');
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#approvalList .primary-btn').click();
 await expect(page.locator('#approvalList')).toContainText('目前沒有待審批事項');
 await page.reload();
 await expect(page.locator('#connectionStatus')).toContainText('本機工作區');
 await page.locator('.mobile-nav [data-page="tasks"]').click();
 await expect(page.locator('#taskList')).toContainText('已核准');
 await page.locator('.mobile-nav [data-page="home"]').click();
 await expect(page.locator('#statProjects')).toHaveText('1');
 await ctx.close();
});

test('local backup export and import restores saved projects',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'本機模式'}).click();
 await page.locator('.desktop-nav [data-page="projects"]').click();
 await page.locator('#projectForm [name="name"]').fill('備份專案');
 await page.locator('#projectForm [type="submit"]').click();
 await expect(page.locator('#projectList')).toContainText('備份專案');
 const downloadPromise=page.waitForEvent('download');
 await page.locator('#exportWorkspace').click();
 const download=await downloadPromise;
 expect(download.suggestedFilename()).toMatch(/SKAI-V05-local-backup/);
 const filePath=await download.path();
 await page.evaluate(()=>localStorage.clear());
 await page.reload();
 await expect(page.locator('#projectList')).not.toContainText('備份專案');
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#importWorkspace').setInputFiles(filePath);
 await expect(page.locator('#projectList')).toContainText('備份專案');
});

test('iPhone landscape: navigation and content remain accessible without horizontal overflow',async({browser})=>{
 const context=await browser.newContext({viewport:{width:932,height:430},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 await page.goto('/');
 await page.getByRole('button',{name:'本機模式'}).click();
 await expect(page.locator('.mobile-nav')).toBeVisible();
 await expect(page.locator('.desktop-nav')).toBeHidden();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(2);
 await page.locator('.mobile-nav [data-page="employees"]').click();
 await page.locator('#employeeGrid .employee-card').first().click();
 await expect(page.locator('#employeeDialog')).toBeVisible();
 await page.locator('#closeEmployee').click();
 await context.close();
});

test('offline workspace never fabricates AI response',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'本機模式'}).click();
 await page.locator('#chatText').fill('請完成真實市場研究');
 await page.locator('#chatPreviewForm [type="submit"]').click();
 await expect(page.locator('#chatHistory')).toContainText('此功能需要雲端 AI 後端');
});

test('CEO cloud chat restores saved chief-of-staff messages after page reload (mock API)',async({page})=>{
 const conversationId='11111111-1111-4111-8111-111111111111';
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  let body={};
  if(path==='/api/session')body={authenticated:true,csrf_token:'test-csrf-token'};
  else if(path==='/api/dashboard')body={counts:{projects:0,active:0,pending:0}};
  else if(path==='/api/projects')body={projects:[]};
  else if(path==='/api/tasks')body={tasks:[]};
  else if(path==='/api/approvals')body={approvals:[]};
  else if(path==='/api/operations/notifications')body={notifications:[]};
  else if(path==='/api/orchestrations')body={runs:[]};
  else if(path==='/api/conversations')body={conversations:url.searchParams.get('role_id')==='chief_of_staff'?[{id:conversationId,role_id:'chief_of_staff'}]:[]};
  else if(path==='/api/conversations/'+conversationId+'/messages')body={
   conversation:{id:conversationId,role_id:'chief_of_staff'},
   messages:[{speaker:'user',body:'請整理市場策略'},{speaker:'assistant',body:'已保存的市場策略建議'}],
   truncated:false
  };
  else return route.fulfill({status:404,json:{error:'not_found'}});
  return route.fulfill({status:200,json:body});
 });
 await page.goto('/');
 await expect(page.locator('#connectionStatus')).toContainText('系統已登入');
 await expect(page.locator('#chatHistory')).toContainText('已保存的市場策略建議');
 await page.reload();
 await expect(page.locator('#chatHistory')).toContainText('請整理市場策略');
 await expect(page.locator('#chatHistory')).toContainText('已保存的市場策略建議');
});


test('CEO cloud project and task creation reset forms only after async API saves (mock PostgreSQL)',async({page})=>{
 const projectId='11111111-1111-4111-8111-111111111112';
 const taskId='11111111-1111-4111-8111-111111111113';
 const approvalsId='11111111-1111-4111-8111-111111111114';
 const projects=[],tasks=[],approvals=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  let body={};
  if(path==='/api/session')body={authenticated:true,csrf_token:'test-csrf-token'};
  else if(path==='/api/dashboard')body={counts:{projects:projects.length,active:0,pending:approvals.length}};
  else if(path==='/api/projects'&&method==='POST'){
   const {name,goal}=request.postDataJSON();
   const project={id:projectId,name,goal,stage:'draft'};projects.push(project);
   return route.fulfill({status:201,json:{project}});
  }
  else if(path==='/api/projects')body={projects};
  else if(path==='/api/tasks'&&method==='POST'){
   const {project_id,title,brief}=request.postDataJSON();
   const task={id:taskId,project_id,title,brief,status:'proposed'};tasks.push(task);
   approvals.push({id:approvalsId,task_id:taskId,title,created_at:new Date().toISOString()});
   return route.fulfill({status:201,json:{task,approval:approvals[0]}});
  }
  else if(path==='/api/tasks')body={tasks};
  else if(path==='/api/approvals')body={approvals};
  else if(path==='/api/operations/notifications')body={notifications:[]};
  else if(path==='/api/orchestrations')body={runs:[]};
  else if(path==='/api/conversations')body={conversations:[]};
  else return route.fulfill({status:404,json:{error:'not_found'}});
  return route.fulfill({status:200,json:body});
 });
 await page.goto('/');
 await expect(page.locator('#connectionStatus')).toContainText('系統已登入');
 await page.locator('.desktop-nav [data-page="projects"]').click();
 await page.locator('#projectForm [name="name"]').fill('SKAI 系統測試');
 await page.locator('#projectForm [name="goal"]').fill('驗證儲存與重新登入');
 await page.locator('#projectForm [type="submit"]').click();
 await expect(page.locator('#projectList')).toContainText('SKAI 系統測試');
 await expect(page.locator('#projectForm [name="name"]')).toHaveValue('');
 expect(projects).toHaveLength(1);
 await page.locator('.desktop-nav [data-page="tasks"]').click();
 await page.locator('#taskProject').selectOption(projectId);
 await page.locator('#taskForm [name="title"]').fill('核准第一項任務');
 await page.locator('#taskForm [type="submit"]').click();
 await expect(page.locator('#taskList')).toContainText('核准第一項任務');
 await expect(page.locator('#taskForm [name="title"]')).toHaveValue('');
 expect(tasks).toHaveLength(1);
 expect(errors).toEqual([]);
 await page.reload();
 await page.locator('.desktop-nav [data-page="projects"]').click();
 await expect(page.locator('#projectList')).toContainText('SKAI 系統測試');
 expect(errors).toEqual([]);
});


test('SKAI V0.6 mobile navigation keeps five primary pages and accessible More menu',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 await page.goto('/');
 await expect(page.locator('.mobile-nav [data-page]')).toHaveCount(5);
 const more=page.locator('#mobileMore'),menu=page.locator('#mobileMoreMenu');
 await expect(menu).toBeHidden();
 await more.click();
 await expect(menu).toBeVisible();
 await expect(more).toHaveAttribute('aria-expanded','true');
 await menu.locator('[data-page="employees"]').click();
 await expect(page.locator('#page-employees')).toHaveClass(/active/);
 await expect(menu).toBeHidden();
 await expect(more).toHaveClass(/active/);
 await more.click();
 await menu.locator('[data-page="notifications"]').click();
 await expect(page.locator('#page-notifications')).toHaveClass(/active/);
 await more.click();
 await page.keyboard.press('Escape');
 await expect(menu).toBeHidden();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(2);
 await context.close();
});
