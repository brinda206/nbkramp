-- ============================================================
--  NBK Ramp v2 — Migration 001 (version corrigée)
--  Coller dans : Supabase → SQL Editor → Run All
--
--  Changements vs version originale :
--    - 'mumbai' remplacé par 'amoy' dans tx_network
--    - 'completing' ajouté dans tx_status (anti-replay webhook)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ⚠ Si vous migrez depuis une version existante avec mumbai, exécutez d'abord :
-- ALTER TYPE tx_network RENAME VALUE 'mumbai' TO 'amoy';
-- ALTER TYPE tx_status ADD VALUE IF NOT EXISTS 'completing';
-- Puis ignorez les CREATE TYPE ci-dessous.

CREATE TYPE tx_status  AS ENUM ('pending', 'processing', 'completing', 'completed', 'failed', 'expired');
CREATE TYPE tx_type    AS ENUM ('on-ramp', 'off-ramp', 'swap');
-- Amoy (80002) remplace Mumbai (80001) — déprécié mars 2024
CREATE TYPE tx_network AS ENUM ('polygon', 'ethereum', 'amoy');

-- ─── Transactions ─────────────────────────────────────────────
CREATE TABLE transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        VARCHAR(16) UNIQUE NOT NULL,
  phone_hash       CHAR(64),
  wallet_address   VARCHAR(42),
  type             tx_type     NOT NULL,
  from_currency    VARCHAR(10) NOT NULL,
  to_currency      VARCHAR(10) NOT NULL,
  from_amount      NUMERIC(24, 8) NOT NULL CHECK (from_amount > 0),
  to_amount        NUMERIC(24, 8) NOT NULL CHECK (to_amount > 0),
  rate             NUMERIC(24, 8) NOT NULL,
  status           tx_status   NOT NULL DEFAULT 'pending',
  error_message    TEXT,
  network          tx_network,
  tx_hash          VARCHAR(66),
  owlpay_reference VARCHAR(128),
  owlpay_status    VARCHAR(32),
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_identity CHECK (phone_hash IS NOT NULL OR wallet_address IS NOT NULL)
);

-- ─── Rates cache ──────────────────────────────────────────────
CREATE TABLE rates (
  pair        VARCHAR(20) PRIMARY KEY,
  value       NUMERIC(24, 10) NOT NULL,
  source      VARCHAR(32) NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit log ────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reference   VARCHAR(16),
  event       VARCHAR(64) NOT NULL,
  old_status  tx_status,
  new_status  tx_status,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_tx_phone_hash   ON transactions (phone_hash)       WHERE phone_hash IS NOT NULL;
CREATE INDEX idx_tx_wallet       ON transactions (wallet_address)    WHERE wallet_address IS NOT NULL;
CREATE INDEX idx_tx_status       ON transactions (status);
CREATE INDEX idx_tx_owlpay_ref   ON transactions (owlpay_reference)  WHERE owlpay_reference IS NOT NULL;
CREATE INDEX idx_tx_created_at   ON transactions (created_at DESC);
CREATE INDEX idx_tx_reference    ON transactions (reference);
CREATE INDEX idx_audit_reference ON audit_logs (reference);

-- ─── Auto updated_at ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Auto audit on status change ──────────────────────────────
CREATE OR REPLACE FUNCTION log_status_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_logs (reference, event, old_status, new_status, payload)
    VALUES (
      NEW.reference, 'status_change', OLD.status, NEW.status,
      jsonb_build_object('owlpay_reference', NEW.owlpay_reference, 'tx_hash', NEW.tx_hash)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_status
AFTER UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION log_status_change();

-- ─── Row Level Security ───────────────────────────────────────
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rates_public_read"       ON rates        FOR SELECT USING (true);
CREATE POLICY "transactions_read"       ON transactions  FOR SELECT USING (true);
CREATE POLICY "audit_server_only"       ON audit_logs    FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "transactions_srv_write"  ON transactions  FOR ALL    USING (auth.role() = 'service_role');
CREATE POLICY "rates_server_write"      ON rates         FOR ALL    USING (auth.role() = 'service_role');

-- ─── Seed rates (écrasés au 1er refresh serveur) ──────────────
INSERT INTO rates (pair, value, source) VALUES
  ('USDC_FCFA', 610,           'init'),
  ('USDT_FCFA', 610,           'init'),
  ('USD_FCFA',  606,           'init'),
  ('USD_USDC',  1.000500,     'init'),
  ('USD_USDT',  1.000700,     'init'),
  ('USDC_USD',  0.9995,        'init'),
  ('USDT_USD',  0.9993,        'init'),
  ('FCFA_USDC', 0.001639344,   'init'),
  ('FCFA_USDT', 0.001639344,   'init'),
  ('FCFA_USD',  0.001650165,   'init')
ON CONFLICT (pair) DO UPDATE
  SET value = EXCLUDED.value, source = EXCLUDED.source, fetched_at = NOW();
