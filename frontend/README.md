# SKAI V0.5 CEO Interface Preview

This is an interactive **static UI preview only**, in the development branch. It does not request credentials, call OpenAI, or modify SKAI company data.

## Interface
- Apple-inspired neutral white/gray interface, soft blur, light gradients.
- Isometric office illustration with nine individually selectable AI leadership characters.
- Employee detail dialog and CEO dashboard sections.
- iPhone 15 Pro Max portrait- and landscape-specific layouts, safe-area spacing, readable labels and bottom tabs.
- Honest offline status and blank KPI values (no fake performance or progress claims).

## Preview locally
Serve the `frontend` directory with any local static HTTP server. Example: `python3 -m http.server 8080 --directory frontend`, then visit `http://localhost:8080`. Opening `index.html` directly may block JS module imports on some browsers.

## Pending before connecting real data
- Authenticated first-party sessions, server-side secrets, anti-CSRF strategy, API throttling, and protected API gateway.
- Backend staging deployment with PostgreSQL, OpenAI API and validated policies.
- Real work queues and approved executive actions.
- Actual phone browser tests (iPhone 15 Pro Max Safari) and landscape usability verification.

Do **not** place `SKAI_ADMIN_TOKEN` or OpenAI keys into any frontend file, client-side storage or public GitHub Pages build.

## Same-origin integration
The development backend now serves this UI from `/` and connects browser actions through first-party session cookies, never a client-side API key. The interface reads real database records only when the test environment has been deployed and the CEO is authenticated; otherwise it keeps blank status indicators.

## 全民系列相同的模組化網頁架構（持續遷移）
SKAI 採 `index.html + styles.css + app.js + data.js + storage.js + api.js + employees.js + ui.js + scene.js` 的靜態網頁模組組合，不需要 Node 建置工具才能在一般靜態伺服器顯示。與《全民趕海物語》的 HTML/CSS/JS 分檔結構一致。

- **本機模式**：專案、任務、CEO 核准與備份由 `storage.js` 寫入同一瀏覽器的 `localStorage`；不需要伺服器，資料**不會**跨裝置同步，請定期匯出備份。AI 對話、背景排程與通知推播不會在本機模擬。
- **雲端模式**：原 V0.5 PostgreSQL、AI 幕僚長、8 位主管、跨部門協作、審批與排程後端保留不變；前端 `api.js` 以同源安全登入連接。
- **重要**：本機和雲端資料是獨立工作區，**不會**偷偷上傳、合併或同步，待未來明確設計資料匯入與衝突解決流程。

這次改動是第一步模組化遷移，保留現有員工、場景、Apple 風格與全部雲端路由。已抽離 `ui.js`（清單渲染）和 `scene.js`（辦公室角色互動），其餘工作流程繼續模組化。
