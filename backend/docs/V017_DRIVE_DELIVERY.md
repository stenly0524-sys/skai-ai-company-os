# SKAI OS V0.17｜Google Drive 成果交付

## 目前功能
- CEO 在任務中心選擇 PDF／Word／Excel，可多選並存入 Neon。
- 只使用 **已完成的 AI 部門工作內容** 及其真實記錄生成檔案；缺少工作成果會拒絕。
- PDF／Word：文字經 Google Drive 匯入為 Google 文件，輸出實際 PDF／DOCX。
- Excel：以原始報告逐行整理為試算表，再由 Google 試算表匯出真正 XLSX。此為文字資料表，**不是已驗證公式的財務模型**。
- 檔案依專案／部門 Drive 資料夾對應上傳；讀回 Drive 檔案 metadata，核對 MIME 與父目錄。
- 記錄來源文字 fingerprint、每個格式的工作狀態及檔案 ID、Drive URL。
- 上傳完仍保持 `needs_review`，不會冒稱已通過三層 QA。CEO 須檢閱原始檔案並確認後才變成 `approved`；其他 SOP 結案規則仍生效。
- 專案資料夾新建步驟可從上次成功位置恢復，避免半途中斷後整組重建。

## Google OAuth 授權配置（Render）
**ChatGPT 已連接的 Google Drive 不會自動授權給 Render。**

須由有權限的管理員在 Google Cloud 啟用 Drive API，建立 OAuth2 用戶端，使用包含 Drive 檔案讀寫權限的適當授權流程，於 Render 後端環境設定以下**秘密環境變數**，不要放進 GitHub：
```
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
```
另設非秘密的資料夾 ID：
```
SKAI_DRIVE_PROJECTS_FOLDER_ID=1jLY6sClsQkcraFdJjDqv3X_9RXUPupfx
```
這是目前經 CEO 設置並已驗證的「SKAI OS總部／項目管理」資料夾。

後端 `GET /api/delivery/status` 透過原本 CEO 登入驗證返回配置狀態。未授權時僅顯示未連接，絕不聲稱檔案已生成。**本系統不會在聊天對話或 GitHub 原始碼中索取或保存 refresh token。**

如果 Google 連線或寫入權限不足，回傳錯誤並保留可追蹤的失敗紀錄；不會以文字模擬成功。

## 操作順序
1. CEO 審批 AI 計畫、按部門順序執行並確認存在完整報告。
2. 在任務詳情選擇 PDF／Word／Excel，按「儲存格式選擇」。
3. 選擇對應部門，點「生成選定格式並歸檔到 Google Drive」，明確確認外部寫入。
4. 專案資料夾尚未設定時，可在專案詳情按「建立此專案的 Google Drive 文件夾」，需 CEO 二次確認。
5. 成果預設「待 CEO／專業複核」，先在 Drive 開啟逐項查看，再按「CEO 確認文件」。
6. 所選格式都已有審閱成功的檔案後，才可走原本的任務結案流程。

## 尚未啟用的能力
- 自動生成經法務驗證的合法合約或具計算公式的財務 Excel 模型（本版僅將已完成的文字成果轉成檔案）。
- 真正獨立跨部門品質三層自動審查。
- Render 後端 OAuth 授權尚未設定時，**自動產生／上傳實際不可執行**。
- 尚未建立全自動背景佇列與重複成果比對；每次由 CEO 明確觸發。
