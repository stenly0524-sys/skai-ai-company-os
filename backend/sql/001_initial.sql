-- SKAI V0.5 alpha / schema 001 -- UUID identities and durable audit trail.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS projects (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(120) NOT NULL,
 goal TEXT NOT NULL DEFAULT '', stage VARCHAR(32) NOT NULL DEFAULT 'draft',
 status VARCHAR(24) NOT NULL DEFAULT 'planning', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT projects_stage CHECK (stage IN ('draft','research','preparation','pilot','operating','paused','closed')),
 CONSTRAINT projects_status CHECK (status IN ('planning','active','paused','closed'))
);
CREATE TABLE IF NOT EXISTS tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id),
 title VARCHAR(160) NOT NULL, brief TEXT NOT NULL DEFAULT '',
 assigned_role VARCHAR(32) NOT NULL DEFAULT 'chief_of_staff',
 status VARCHAR(24) NOT NULL DEFAULT 'proposed',
 result TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT tasks_status CHECK (status IN ('proposed','approved','in_progress','review','done','rejected','paused'))
);
CREATE TABLE IF NOT EXISTS approvals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID NOT NULL REFERENCES tasks(id),
 status VARCHAR(24) NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '',
 decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT approvals_status CHECK (status IN ('pending','approved','rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_per_task ON approvals(task_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS conversations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID REFERENCES projects(id),
 role_id VARCHAR(32) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id UUID NOT NULL REFERENCES conversations(id),
 speaker VARCHAR(16) NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT messages_speaker CHECK (speaker IN ('user','assistant'))
);
CREATE TABLE IF NOT EXISTS audit_log (
 id BIGSERIAL PRIMARY KEY, actor VARCHAR(48) NOT NULL,
 event VARCHAR(80) NOT NULL, target_type VARCHAR(32), target_id UUID,
 details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at,id);
COMMIT;
