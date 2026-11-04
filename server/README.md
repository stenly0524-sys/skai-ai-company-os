# SKAI OS cloud backend (V0.6 staging)

This backend serves the existing `v05-preview` frontend from the **same origin** and accesses the existing Neon PostgreSQL schema. The V0.4 main page is untouched.

## Before deployment
1. Back up Neon data. Inspect and apply `server/migration.sql` on the correct project/branch.
2. On Render, create a Node web service at the repository root with build `npm install` and start `npm start`.
3. Set private Render environment variables `DATABASE_URL`, `CEO_PASSWORD_SALT`, `CEO_PASSWORD_HASH`, `NODE_ENV=production`. **Never commit secrets.**
4. Generate a random salt and password hash locally using Node:
   ```bash
   node -e "const c=require('node:crypto');const salt=c.randomBytes(16).toString('hex');const p=process.env.CEO_PASSWORD; if(!p||p.length<16)throw Error('Set CEO_PASSWORD (>=16 chars)');console.log('CEO_PASSWORD_SALT='+salt);console.log('CEO_PASSWORD_HASH='+c.scryptSync(p,salt,64).toString('hex'))"
   ```
5. Use an HTTPS Render domain. Keep the database URL server-side only.

## Security and limitations
- Server checks a hashed CEO password using timing-safe comparison; session cookies are Secure/HttpOnly/SameSite=Lax with a DB-backed expiry, and writes require a CSRF token.
- No public signup, no password reset, no multi-tenant isolation. Suitable only for single-CEO staging, not public SaaS.
- File management stores **HTTPS URL references only**, not the content of files.
- AI orchestration / chat is **not** wired to provider APIs and deliberately returns unavailable.
- Local browser records are **not automatically merged** into Neon. Export JSON locally first and plan a separate authenticated migration with review/deduplication.
- Schema migration is not automatically executed by the server.

## Frontend mode selection
The public GitHub Pages preview remains local-only. On the independently deployed backend, select **切換雲端模式**, log in with the CEO password, and use the same-origin API. Switching modes does **not** automatically migrate data between browsers or storage systems.
