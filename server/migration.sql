-- V0.6 non-destructive additions for existing SKAI Neon database.
-- Apply only after reviewing backup and target branch.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100);
CREATE TABLE IF NOT EXISTS project_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name varchar(160) NOT NULL,
 url text NOT NULL,
 category varchar(24) NOT NULL DEFAULT 'link',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_documents_project_idx ON project_documents(project_id);
