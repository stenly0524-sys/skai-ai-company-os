CREATE TABLE IF NOT EXISTS drive_oauth_states (
 state_hash TEXT PRIMARY KEY,
 ceo_session_hash TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS drive_oauth_connection (
 slot TEXT PRIMARY KEY CHECK(slot='ceo'),
 refresh_token_ciphertext TEXT NOT NULL,
 scope TEXT NOT NULL,
 connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_drive_oauth_states_expires ON drive_oauth_states(expires_at);
