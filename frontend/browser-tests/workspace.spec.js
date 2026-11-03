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
