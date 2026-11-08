BEGIN;
ALTER TABLE ai_control_settings
 ADD COLUMN IF NOT EXISTS daily_budget_usd NUMERIC(10,2) NOT NULL DEFAULT 1.00,
 ADD COLUMN IF NOT EXISTS monthly_budget_usd NUMERIC(10,2) NOT NULL DEFAULT 10.00;
ALTER TABLE ai_control_settings
 DROP CONSTRAINT IF EXISTS ai_control_daily_budget_range;
ALTER TABLE ai_control_settings
 ADD CONSTRAINT ai_control_daily_budget_range CHECK (daily_budget_usd BETWEEN 0.01 AND 1000.00);
ALTER TABLE ai_control_settings
 DROP CONSTRAINT IF EXISTS ai_control_monthly_budget_range;
ALTER TABLE ai_control_settings
 ADD CONSTRAINT ai_control_monthly_budget_range CHECK (monthly_budget_usd BETWEEN 0.01 AND 10000.00);
CREATE TABLE IF NOT EXISTS ai_cost_ledger (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 usage_day DATE NOT NULL,
 usage_month CHAR(7) NOT NULL,
 model VARCHAR(80) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'reserved'
  CHECK (status IN ('reserved','settled','unverified')),
 reserved_usd NUMERIC(12,6) NOT NULL CHECK (reserved_usd>=0),
 estimated_usd NUMERIC(12,6) NOT NULL DEFAULT 0 CHECK (estimated_usd>=0),
 input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens>=0),
 output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_cost_ledger_day ON ai_cost_ledger(usage_day);
CREATE INDEX IF NOT EXISTS idx_ai_cost_ledger_month ON ai_cost_ledger(usage_month);
COMMIT;