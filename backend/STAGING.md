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
