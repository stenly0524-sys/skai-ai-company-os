# SKAI V0.5 — Core Foundation (Alpha)

This is the first **backend foundation**, isolated from the published V0.4 `index.html`. **Not deployed.**

## Implemented
- 9 AI roles: Chief of Staff + 8 department heads.
- OpenAI API conversation endpoint with PostgreSQL history and explicit non-execution boundary.
- Project creation/listing; task proposals; CEO approve/reject endpoints.
- Audit log for important writes; authentication gate; CORS allowlist.
- SQL schema for durable project/task/approval/chat records.

## Not implemented yet
- Frontend connection, end-user login/real role-based access, migrations automation, background workers, tasks execution, agent orchestration, notifications, file/knowledge ingestion, 3D office.
- A single bearer token is **development-only**. Never put this token in a public GitHub Pages browser client. Production needs secure login, server sessions, rate limiting, CSRF strategy, audit review, secret management, backups and tests.

## Local setup
1. Create a PostgreSQL database. Run `npm run migrate` (idempotent migration ledger).
2. Set environment values from `.env.example` **in your host or shell**; do not commit your real values.
3. Run `npm install` in the `backend` directory, then `npm start`.
4. Run `npm test` for deterministic policy and security tests, or `npm run check` for syntax. `GET /health` checks DB readiness. Protected `/api/*` routes require `Authorization: Bearer <SKAI_ADMIN_TOKEN>`.

## Sample API
- `GET /api/roles`
- `GET /api/projects`; `POST /api/projects` with `{"name":"專案","goal":"目標"}`
- `GET /api/tasks`; `POST /api/tasks` with `{"project_id":"<uuid>","title":"工作","brief":"內容","assigned_role":"finance"}`
- `GET /api/approvals`; `POST /api/approvals/<uuid>/decision` with `{"decision":"approved","note":"同意"}`
- `POST /api/chat` with `{"role_id":"chief_of_staff","message":"請先釐清我的專案需求"}`, then pass the returned `conversation_id` for follow-up turns.

## Business rules
A chat answer is only a proposal. Tasks must be created explicitly and start as `proposed`, with a pending CEO approval. An approval changes task status but does not launch a background job. AI-generated information can be uncertain and must be independently checked for high-risk decisions.

## Safe rollout
Use a separate test environment, verify DB+API integration, add authentication and test suites, then review changes via PR before ever replacing the public page.

## Safety and test status
- Pure workflow/security unit tests are configured in GitHub Actions on the development branch.
- Only the CEO API approval endpoint updates approval state. The role assistant cannot secretly promote a task into execution.
- No live AI, database, webhook, or production end-to-end tests are claimed until credentials and staging services are configured.
