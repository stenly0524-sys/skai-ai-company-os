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

## Stage 3: Multi-department orchestration (source code, not deployed)

**Approval-gated workflow:**
1. Create a project and task. The task begins as `proposed`.
2. CEO approves via `POST /api/approvals/:id/decision`.
3. `POST /api/orchestrations/plan` with `{"task_id":"<uuid>"}`. The Chief of Staff calls the OpenAI API to propose a JSON division of work (1–8 specialized departments); a draft plan and steps are saved.
4. CEO reviews using `GET /api/orchestrations/:run_id`, then approves by `POST /api/orchestrations/:run_id/approve`.
5. `POST /api/orchestrations/:run_id/advance` executes **one** internal department AI analysis and durably saves it. Repeat until `plan_status=review`.
6. CEO reviews the consolidated original departmental outputs and confirms by `POST /api/orchestrations/:run_id/complete`.

**Recovery:** A crashed step remains `running` until explicitly recovered after a 2-minute staleness window by `POST /api/orchestrations/:run_id/recover`. Up to three manual attempts per step; no autonomous resubmission or external side effects.

**Boundaries:** Does not execute payments, send messages, perform external web searches, or create external deliverables. Departmental text is model-generated analysis, and source claims are not automatically verified. Plan approval and task approval are separate CEO decisions. Further work needed for background workers, real CEO identity/permissions, AI cost quotas, robust concurrency tests, and end-to-end staging validation.

## Stage 4: Background checks and in-app notification outbox (source code, not deployed)

- Apply SQL migration `003_operations.sql` using `npm run migrate`.
- Run `npm run worker` on a persistently running server with the same DB and environment as the API. The worker runs a minute-level check, deduplicated across workers by day. It will catch up on that day's patrol (after 09:00 Asia/Taipei) and briefing (after 10:00 Asia/Taipei) when it starts late.
- The system calculates a factual database-only snapshot and stores `notification_events`. Inspect through `GET /api/operations/notifications` and mark seen via `POST /api/operations/notifications/:id/read`. Testing can manually start due checks using `POST /api/operations/checks/run`.
- `GET /api/operations/usage` shows a daily **OpenAI API call-count gate** configurable with `SKAI_DAILY_AI_CALL_LIMIT`. Each started request reserves one slot even on failure; this is not a token-based cost ceiling and does not report ChatGPT subscription limits.
- **Crucial:** Neither GitHub Pages nor this backend is capable of pushing directly into the ChatGPT App notifications through an external bot API. The Stage 4 messages are only a durable SKAI internal inbox. The separate ChatGPT scheduled reminders tested previously are not automatically connected to this DB.
- Production readiness still requires authenticated browser sessions, API rate limiting, alert destinations, worker monitoring, staging PostgreSQL/API tests, and cost-based quota measures.
