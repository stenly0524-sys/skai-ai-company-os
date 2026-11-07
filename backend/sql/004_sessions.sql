BEGIN;
CREATE TABLE IF NOT EXISTS ceo_sessions (
 token_hash CHAR(64) PRIMARY KEY,
 csrf_hash CHAR(64) NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ceo_sessions_expires ON ceo_sessions(expires_at);
COMMIT;
