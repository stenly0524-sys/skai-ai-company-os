-- V0.17: track Drive jobs across retries, avoiding fabricated completion claims.
CREATE TABLE IF NOT EXISTS task_delivery_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 role_id VARCHAR(32) NOT NULL,
 format VARCHAR(8) NOT NULL CHECK(format IN ('pdf','docx','xlsx')),
 source_hash VARCHAR(12) NOT NULL,
 status VARCHAR(16) NOT NULL CHECK(status IN ('running','completed','failed')),
 attempts INT NOT NULL DEFAULT 1,
 deliverable_id UUID REFERENCES task_deliverables(id) ON DELETE SET NULL,
 error_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(task_id,role_id,format,source_hash)
);
CREATE INDEX IF NOT EXISTS idx_task_delivery_jobs_task ON task_delivery_jobs(task_id,updated_at DESC);
