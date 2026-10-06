-- Phase 5 extends the existing ledger; no purchase row/total or legacy payment
-- is rewritten. Nullable additions grandfather old rows without inventing audits.
ALTER TABLE payments ADD COLUMN client_request_id TEXT;
ALTER TABLE payments ADD COLUMN creation_audit_id TEXT REFERENCES audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX uq_payments_customer_submission ON payments(customer_id,client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX uq_payments_creation_audit ON payments(creation_audit_id) WHERE creation_audit_id IS NOT NULL;
CREATE INDEX idx_payments_purchase_history ON payments(purchase_id,received_at,created_at,id);
CREATE INDEX idx_payments_settled_purchase ON payments(purchase_id,amount_paise) WHERE status = 'settled' AND deleted_at IS NULL;

-- Authoritative read model, never a mutable purchase status or balance cache.
-- Existing non-settled/deleted rows do not reduce credit. Unsupported legacy
-- reversals/inconsistent money are flagged, not silently rounded or clamped.
CREATE VIEW purchase_payment_balances AS
SELECT purchase_uuid,customer_uuid,total_paise,amount_paid_paise,
  total_paise - amount_paid_paise AS outstanding_paise,
  CASE WHEN amount_paid_paise = total_paise THEN 'paid'
    WHEN amount_paid_paise = 0 THEN 'unpaid' ELSE 'partially_paid' END AS payment_status,
  invalid_payment,legacy_reversal
FROM (
  SELECT p.id AS purchase_uuid,p.customer_id AS customer_uuid,p.total_paise,
    COALESCE((SELECT SUM(m.amount_paise) FROM payments AS m
      WHERE m.purchase_id = p.id AND m.status = 'settled' AND m.deleted_at IS NULL),0) AS amount_paid_paise,
    EXISTS(SELECT 1 FROM payments AS m WHERE m.purchase_id = p.id AND m.status = 'settled' AND m.deleted_at IS NULL
      AND (typeof(m.amount_paise) <> 'integer' OR m.amount_paise > 9007199254740991 OR m.amount_paise <= 0)) AS invalid_payment,
    EXISTS(SELECT 1 FROM payment_reversals AS r JOIN payments AS m ON m.id = r.payment_id
      WHERE m.purchase_id = p.id AND r.status = 'posted') AS legacy_reversal
  FROM purchases AS p
);

CREATE TRIGGER payments_immutable_update BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;
CREATE TRIGGER payments_immutable_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'payments are immutable'); END;

-- D1/SQLite serializes writes. The outstanding check executes inside the INSERT
-- transaction and observes all earlier committed (and same-batch) payments.
-- Check duplicate keys FIRST: a retry after full settlement is still a duplicate.
CREATE TRIGGER payments_creation_insert BEFORE INSERT ON payments
BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM payments WHERE id = NEW.id)
    THEN RAISE(ABORT, 'payments are immutable') END);
  SELECT (CASE WHEN NEW.client_request_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM payments WHERE customer_id = NEW.customer_id AND client_request_id = NEW.client_request_id)
    THEN RAISE(ABORT, 'duplicate payment submission') END);
  SELECT (CASE WHEN NEW.customer_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM purchases WHERE id = NEW.purchase_id AND customer_id = NEW.customer_id)
    THEN RAISE(ABORT, 'payment customer must match the purchase') END);
  SELECT (CASE WHEN typeof(NEW.amount_paise) <> 'integer' OR NEW.amount_paise <= 0 OR NEW.amount_paise > 9007199254740991
    OR NEW.payment_method NOT IN ('cash','upi','card') OR NEW.status <> 'settled' OR NEW.deleted_at IS NOT NULL
    OR NEW.client_request_id IS NULL OR length(NEW.client_request_id) <> 36
    OR NEW.creation_audit_id IS NULL OR NEW.created_by_admin_id IS NULL
    OR EXISTS(SELECT 1 FROM audit_logs WHERE id = NEW.creation_audit_id)
    THEN RAISE(ABORT, 'invalid payment creation shape') END);
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM customers WHERE uuid = NEW.customer_id AND archived_at IS NULL)
    THEN RAISE(ABORT, 'payment customer is archived') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM purchases WHERE id = NEW.purchase_id
    AND (deleted_at IS NOT NULL OR status IN ('void','refunded') OR currency_code <> 'INR'))
    THEN RAISE(ABORT, 'purchase cannot receive payments') END);
  SELECT (CASE WHEN length(NEW.received_at) <> 24 OR substr(NEW.received_at,1,4) < '0001'
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.received_at,'+0 seconds') IS NOT NEW.received_at
    OR NEW.received_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR NEW.received_at < (SELECT COALESCE(purchase_date,substr(created_at,1,10)) || 'T00:00:00.000Z' FROM purchases WHERE id = NEW.purchase_id)
    THEN RAISE(ABORT, 'invalid payment date') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM purchase_payment_balances WHERE purchase_uuid = NEW.purchase_id
    AND (invalid_payment = 1 OR legacy_reversal = 1 OR amount_paid_paise > total_paise OR typeof(total_paise) <> 'integer' OR total_paise > 9007199254740991))
    THEN RAISE(ABORT, 'invalid existing payment balance') END);
  SELECT (CASE WHEN NEW.amount_paise > (SELECT outstanding_paise FROM purchase_payment_balances WHERE purchase_uuid = NEW.purchase_id)
    THEN RAISE(ABORT, 'payment exceeds outstanding balance') END);
END;

CREATE TRIGGER payments_create_audit_integrity BEFORE INSERT ON audit_logs
WHEN EXISTS(SELECT 1 FROM payments WHERE creation_audit_id = NEW.id)
AND NOT EXISTS(SELECT 1 FROM payments AS m WHERE m.creation_audit_id = NEW.id AND m.id = NEW.entity_id
  AND NEW.entity_type = 'payment' AND NEW.action = 'create'
  AND NEW.actor_admin_user_id = m.created_by_admin_id AND NEW.created_at = m.created_at)
BEGIN SELECT RAISE(ABORT, 'payment requires its own creation audit'); END;

-- The legacy reversal table is preserved but is not an enabled write workflow.
CREATE TRIGGER payment_reversals_not_supported BEFORE INSERT ON payment_reversals
BEGIN SELECT RAISE(ABORT, 'payment reversals are not supported'); END;
CREATE TRIGGER payment_reversals_immutable_update BEFORE UPDATE ON payment_reversals
BEGIN SELECT RAISE(ABORT, 'payment reversals are immutable'); END;
CREATE TRIGGER payment_reversals_immutable_delete BEFORE DELETE ON payment_reversals
BEGIN SELECT RAISE(ABORT, 'payment reversals are immutable'); END;
