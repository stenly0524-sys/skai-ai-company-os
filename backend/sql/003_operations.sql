BEGIN;
CREATE TABLE IF NOT EXISTS ai_daily_usage (
 usage_day DATE PRIMARY KEY,
 reserved_calls INTEGER NOT NULL DEFAULT 0,
 completed_calls INTEGER NOT NULL DEFAULT 0,
 failed_calls INTEGER NOT NULL DEFAULT 0,
 total_input_tokens BIGINT NOT NULL DEFAULT 0,
 total_output_tokens BIGINT NOT NULL DEFAULT 0,
 CONSTRAINT nonnegative_calls CHECK (reserved_calls>=0 AND completed_calls>=0 AND failed_calls>=0)
);
CREATE TABLE IF NOT EXISTS notification_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 event_key TEXT NOT NULL UNIQUE,
 severity VARCHAR(12) NOT NULL DEFAULT 'info',
 title VARCHAR(160) NOT NULL,
 body TEXT NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'unread',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 read_at TIMESTAMPTZ,
 CONSTRAINT notification_severity CHECK (severity IN ('info','warning','critical')),
 CONSTRAINT notification_status CHECK (status IN ('unread','read'))
);
CREATE INDEX IF NOT EXISTS idx_notification_unread ON notification_events(created_at DESC) WHERE status='unread';
CREATE TABLE IF NOT EXISTS scheduled_checks (
 check_key TEXT PRIMARY KEY,
 check_type VARCHAR(32) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'finished',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT scheduled_checks_status CHECK (status IN ('finished','failed'))
);
COMMIT;
