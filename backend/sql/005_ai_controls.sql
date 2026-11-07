BEGIN;
CREATE TABLE IF NOT EXISTS ai_control_settings (
 id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
 daily_call_limit INTEGER NOT NULL DEFAULT 50 CHECK (daily_call_limit BETWEEN 1 AND 500),
 daily_token_warning BIGINT NOT NULL DEFAULT 100000 CHECK (daily_token_warning BETWEEN 1000 AND 10000000),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ai_control_settings(id,ai_enabled,daily_call_limit,daily_token_warning)
VALUES (1,TRUE,50,100000)
ON CONFLICT (id) DO NOTHING;
COMMIT;
