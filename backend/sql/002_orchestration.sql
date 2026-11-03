-- SKAI V0.5 stage 3: approval-gated, resumable multi-role analysis.
BEGIN;
CREATE TABLE IF NOT EXISTS orchestration_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
 plan_status VARCHAR(20) NOT NULL DEFAULT 'draft',
 summary TEXT NOT NULL DEFAULT '',
 consolidated_report TEXT,
 last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT orchestration_runs_status CHECK (plan_status IN ('draft','ready','running','review','done','paused','failed'))
);
CREATE TABLE IF NOT EXISTS orchestration_steps (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
 sequence_no INTEGER NOT NULL,
 role_id VARCHAR(32) NOT NULL,
 instruction TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending',
 result TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 last_error TEXT,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 CONSTRAINT orchestration_steps_sequence UNIQUE(run_id,sequence_no),
 CONSTRAINT orchestration_steps_state CHECK (status IN ('pending','running','done','failed'))
);
CREATE INDEX IF NOT EXISTS idx_orchestration_steps_run ON orchestration_steps(run_id,sequence_no);
COMMIT;
