-- SKAI V0.16: Drive folder index and CEO-approved deliverable formats.
BEGIN;
CREATE TABLE IF NOT EXISTS project_drive_folders (
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 role_id VARCHAR(32) NOT NULL,
 folder_id TEXT NOT NULL,
 folder_url TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(project_id,role_id)
);
CREATE TABLE IF NOT EXISTS task_delivery_preferences (
 task_id UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 formats TEXT[] NOT NULL DEFAULT ARRAY['pdf']::TEXT[],
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT task_delivery_formats_valid CHECK (
  array_length(formats,1) BETWEEN 1 AND 3
  AND formats <@ ARRAY['pdf','docx','xlsx']::TEXT[]
 )
);
CREATE TABLE IF NOT EXISTS task_deliverables (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
 role_id VARCHAR(32) NOT NULL,
 format VARCHAR(8) NOT NULL CHECK (format IN ('pdf','docx','xlsx')),
 title VARCHAR(240) NOT NULL,
 drive_file_id TEXT NOT NULL,
 drive_url TEXT NOT NULL,
 review_state VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft','needs_review','approved','rejected')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(drive_file_id)
);
CREATE INDEX IF NOT EXISTS idx_deliverables_project ON task_deliverables(project_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverables_task ON task_deliverables(task_id,created_at DESC);
COMMIT;