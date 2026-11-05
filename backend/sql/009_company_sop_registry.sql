-- Approved company-wide SOP registry. Application refuses to invent unimplemented integrations.
CREATE TABLE IF NOT EXISTS public.company_sops (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 policy_code text NOT NULL,
 version text NOT NULL,
 title text NOT NULL,
 status text NOT NULL CHECK (status IN ('draft','approved','retired')),
 approved_by text,
 approved_at timestamptz,
 effective_at timestamptz,
 source_text text NOT NULL,
 drive_document_id text,
 drive_pdf_id text,
 project_pdf_id text,
 implementation_status jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_code,version)
);
CREATE INDEX IF NOT EXISTS idx_company_sops_active
 ON public.company_sops(status,effective_at DESC);
