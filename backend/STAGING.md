# SKAI V0.5 — staging deployment checklist

**Status:** Source and CI test environment; not a live cloud deployment.

## Required private settings (never commit values)
- `DATABASE_URL`: PostgreSQL connection URL
- `DATABASE_SSL=true`: hosted DB using TLS and valid certificate
- `SKAI_CEO_PASSWORD`: long random test-CEO password, minimum 16 characters
- `SKAI_ADMIN_TOKEN`: 32+ random characters (developer use only; disabled in production)
- `OPENAI_API_KEY`: server-side API secret, funded separately from ChatGPT subscription
- `OPENAI_MODEL`: supported model
- `SKAI_DAILY_AI_CALL_LIMIT`: initially low (e.g. 10–20). This limits calls, **not charges**.
- `NODE_ENV=production`: secure HttpOnly cookie must be served over HTTPS
- `PUBLIC_ORIGIN=https://your-staging-domain.example`: exact external HTTPS origin
- `PORT=8787` (or host-provided port)

## Steps
1. Provision an isolated PostgreSQL database; restrict inbound access, enable backup and TLS.
2. Build Docker from repository **root** using `docker build -f backend/Dockerfile .`.
3. Set private environment variables on the cloud host (not in GitHub / JS / browser).
4. Run `npm run migrate` in the backend image as a separate one-off job with DATABASE_URL.
5. Run a backend web service behind HTTPS and a trusted reverse proxy, with `NODE_ENV=production`.
6. If daily checks are needed, run a separate background worker with `node src/worker.js`.
7. Log in through the staging URL from iPhone Safari; verify dashboard, create → approve → persist, and 9 role chat endpoints.
8. Verify rate limits, privacy, security events, budget alerts, database backups, and recovery before inviting real users.

## Automated no-secret CI
GitHub Actions starts ephemeral PostgreSQL, runs migrations, then runs `tests/integration.mjs` with dummy AI configuration. The integration test deliberately does **not** call OpenAI.

## Must not claim yet
- No public V0.5 hosting, actual API chat, real iPhone compatibility, SMS/ChatGPT push, or production-grade security is established by CI alone.

## V0.5 staging readiness gate (does not call OpenAI)

Before deploying, configure the variables **privately on the host** and run:

```bash
cd backend
npm run preflight
```

This checks the shape of the PostgreSQL URL, TLS policy, CEO password, developer token, OpenAI key presence, HTTPS origin, and a conservative initial AI-request cap. It does **not** test that credentials work, that a host exists, or that there is an OpenAI balance. Never paste secrets into a chat, repository, issue, or public workflow log.

**Hard blocker:** A GitHub repository is not a Node/PostgreSQL host. Until a real host, database, HTTPS domain and privately configured secrets exist, the V0.5 server cannot be marked deployed. Do not publish the full server by replacing the V0.4 GitHub Pages website.

## Data preservation, backups and recovery

- Formal SKAI records live in PostgreSQL: projects, tasks, CEO decisions, orchestrations, AI conversation messages and audit logs. Browser localStorage is not the production database.
- Before every schema migration, make an **independent encrypted database backup** using a provider-managed backup/snapshot or PostgreSQL `pg_dump` from a secured operator machine. Never commit dumps to GitHub or put database passwords on the command line.
- Example from a trusted operator shell with `DATABASE_URL` already available as a private environment variable:

```bash
# DATABASE_URL must be provided securely, never echoed in a terminal recording.
pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="skai-private-backup.dump"
```

- Store the dump in a restricted, encrypted location outside the application host. Test a restore to a **separate empty test database** with `pg_restore` before relying on backups. A backup file alone is not evidence of recoverability.
- Retain the original dump through a failed migration. Do not automatically restore over live production data; CEO/operator approval and a maintenance window are required.
- GitHub Actions PostgreSQL data is **ephemeral** and is never a real customer-data backup.
- AI conversation history currently returns the most recent 100 messages per conversation to the UI; older records remain in PostgreSQL and need pagination to browse.

## Real-world acceptance checklist

1. `npm run preflight` passes on the *private* staging host.
2. Schema migrations apply without destroying previously saved records.
3. `/health` returns success only when PostgreSQL is available.
4. CEO login works over HTTPS, and unauthenticated/CSRF-invalid access is rejected.
5. Create a project, propose and approve a task, refresh the page and confirm data remains.
6. With an explicitly permitted OpenAI billing balance, send **one** real chief-of-staff message and confirm it survives a new CEO session; no paid API calls happen during CI.
7. With explicit CEO approval, generate and review a multi-department plan, run one department step and verify its persisted report.
8. Check the backup and trial restore before entering real financial, HR, supplier or customer data.
