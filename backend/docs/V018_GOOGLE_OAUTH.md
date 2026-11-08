# SKAI V0.18｜Google Drive OAuth 安全連線（CEO 測試版）

## 正式功能
- 資料中心新增「連接 Google Drive」按鈕、授權狀態與中斷連線。
- 後端 `POST /api/google-oauth/start` 必須先登入 CEO，使用既有 CSRF 保護。
- 產生一次性、10 分鐘有效的隨機 OAuth state，綁定原 CEO session。
- Google 官方返回 `GET /api/google-oauth/callback`，不依賴跨站瀏覽器 Cookie；先核對 state 是否有效且未重複使用，再核對 CEO 原登入 session，才使用授權碼向 Google 換取 token。
- 只允許最小權限 `https://www.googleapis.com/auth/drive.file`，回呼確認授權範圍。
- Refresh Token 使用 AES-256-GCM 加密儲存 Neon，前端不接觸 token 或 client secret。資料庫只儲存加密內容。
- CEO 可主動中斷連線，移除 SKAI OS 保存的 refresh token；如需撤銷 Google 端授權，另由 Google 帳戶安全頁面取消授權。

## 唯一需要 Google Cloud 管理員操作的部分
Google Cloud → Google Auth Platform → 用戶端 → SKAI OS Web：
- 新增已授權的重新導向 URI，**必須完整相同**：
  `https://skai-v05-staging.onrender.com/api/google-oauth/callback`
- JavaScript 來源不需要新增，因為授權碼在伺服器交換。
- 此次之前曾有部分 client secret 出現在截圖。正式使用前建議輪替該 secret。**不得再將 Client Secret、JSON 憑證、Access Token 或 Refresh Token 貼在聊天中。**

Render → skai-v05-staging → Environment 安全設定：
- `GOOGLE_DRIVE_CLIENT_ID`：Google Cloud 用戶端 ID（非秘密，但仍放後端環境）。
- `GOOGLE_DRIVE_CLIENT_SECRET`：Google Cloud 正式有效的用戶端密碼（秘密，請直接存 Render）。
- `SKAI_DRIVE_ENCRYPTION_KEY`：64 個十六進位字元的隨機 256-bit 密鑰（秘密，請以安全方式產生及存 Render；不要與 CLIENT_SECRET 相同）。
- `PUBLIC_ORIGIN`：應與 `https://skai-v05-staging.onrender.com` 相同。

Render 完成設定部署後：
1. 登入 CEO → 資料中心。
2. 按「連接 Google Drive」。
3. 在 accounts.google.com 確認 SKAI OS 的授權，允許僅 drive.file 範圍。
4. 返回 SKAI OS，看見授權狀態「已連接」。
5. Google Auth Platform 外部測試模式的 refresh token 有可能在 7 天後失效；正式環境要規劃安全且合規的發布狀態。
6. 既有資料夾尚需使用 Google Picker 明確選取授權或其他適當方式處理；`drive.file` **不等於可以讀取全部現有 Drive 資料夾**。
7. 真實文件產生／上傳及資料夾權限尚未完成 Google 實機測試前，不能宣稱交付系統已全部驗收。

## 安全限制
- 請勿把 OAuth secret 當作 ChatGPT 工具輸入或存 GitHub。
- 一旦遺失 `SKAI_DRIVE_ENCRYPTION_KEY`，既有加密 refresh token 將無法解密，須重新授權。
- 目前為單一 CEO 的測試站連線，不是多使用者 OAuth 帳號管理。
- 不會代替 CEO 授權第三方或承諾 Google 驗證通過。
