-- ============================================================
--  Migration 002 — Ajout support Harbor (OwlPay) + Campay
--  Coller dans : Supabase → SQL Editor → Run All
-- ============================================================

-- ─── Table customers (clients diaspora avec KYC Harbor) ───────
CREATE TABLE IF NOT EXISTS customers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  harbor_uuid       VARCHAR(128) UNIQUE NOT NULL,
  email_hash        CHAR(64)    NOT NULL,
  first_name        VARCHAR(64),
  last_name         VARCHAR(64),
  kyc_status        VARCHAR(32) NOT NULL DEFAULT 'deactivated',
  -- Statuts Harbor : deactivated | verifying | onboarded | rejected | declined | revoked
  agreement_link    TEXT,
  verification_link TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_harbor_uuid
  ON customers (harbor_uuid);

CREATE INDEX IF NOT EXISTS idx_customers_email_hash
  ON customers (email_hash);

-- ─── Nouvelles colonnes dans transactions ─────────────────────
-- Harbor
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS harbor_transfer_uuid VARCHAR(128),
  ADD COLUMN IF NOT EXISTS harbor_status         VARCHAR(32);

-- Campay (remplace owlpay_reference)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS campay_reference  VARCHAR(128),
  ADD COLUMN IF NOT EXISTS campay_status     VARCHAR(32);

-- Customer Harbor lié à la transaction
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS harbor_customer_uuid VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_tx_harbor_transfer
  ON transactions (harbor_transfer_uuid)
  WHERE harbor_transfer_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tx_campay_ref
  ON transactions (campay_reference)
  WHERE campay_reference IS NOT NULL;

-- ─── Trigger updated_at sur customers ─────────────────────────
CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS customers ────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_srv_only"
  ON customers FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Vue admin (lecture seule) ────────────────────────────────
-- Utilisée par le dashboard d'administration
CREATE OR REPLACE VIEW admin_transactions AS
SELECT
  t.id,
  t.reference,
  t.type,
  t.from_currency,
  t.to_currency,
  t.from_amount,
  t.to_amount,
  t.rate,
  t.status,
  t.network,
  t.tx_hash,
  t.harbor_transfer_uuid,
  t.harbor_status,
  t.campay_reference,
  t.campay_status,
  t.error_message,
  t.created_at,
  t.updated_at,
  c.first_name || ' ' || c.last_name AS customer_name,
  c.kyc_status
FROM transactions t
LEFT JOIN customers c ON c.harbor_uuid = t.harbor_customer_uuid
ORDER BY t.created_at DESC;

-- ─── Seed statuts KYC dans audit (documentation) ─────────────
COMMENT ON COLUMN customers.kyc_status IS
  'Statuts Harbor: deactivated → verifying → onboarded | rejected | declined | revoked';
