-- Phase 1 integrity corrections. Previous migrations remain immutable.
-- Only one administrator may exist, even if disabled. There is no staff API.
ALTER TABLE admin_users ADD COLUMN singleton_slot INTEGER NOT NULL DEFAULT 1 CHECK (singleton_slot = 1);
CREATE UNIQUE INDEX uq_admin_users_singleton ON admin_users(singleton_slot);
CREATE TRIGGER admin_owner_only_insert BEFORE INSERT ON admin_users WHEN NEW.role <> 'owner'
BEGIN SELECT RAISE(ABORT, 'only the shop owner account is supported'); END;
CREATE TRIGGER admin_owner_only_update BEFORE UPDATE OF role ON admin_users WHEN NEW.role <> 'owner'
BEGIN SELECT RAISE(ABORT, 'only the shop owner account is supported'); END;

ALTER TABLE sessions ADD COLUMN csrf_token_hash TEXT;

CREATE TABLE auth_rate_limits (
  bucket_key TEXT PRIMARY KEY NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count >= 1),
  reset_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_auth_rate_limits_reset ON auth_rate_limits(reset_at);

-- Explicit singleton shop settings, not a generic editable key/value store.
CREATE TABLE shop_settings (
  uuid TEXT PRIMARY KEY NOT NULL,
  singleton_slot INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK(singleton_slot = 1),
  shop_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',
  gstin TEXT,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  next_invoice_number INTEGER NOT NULL DEFAULT 1 CHECK(next_invoice_number >= 1),
  invoice_number_padding INTEGER NOT NULL DEFAULT 4 CHECK(invoice_number_padding BETWEEN 1 AND 8),
  invoice_reset_policy TEXT NOT NULL DEFAULT 'never' CHECK(invoice_reset_policy IN ('never', 'financial_year')),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency = 'INR'),
  default_tax_type TEXT NOT NULL DEFAULT 'none' CHECK(default_tax_type IN ('none','cgst_sgst','igst')),
  default_tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK(default_tax_rate_basis_points BETWEEN 0 AND 10000),
  business_state TEXT NOT NULL DEFAULT '',
  footer_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE UNIQUE INDEX uq_customers_active_phone ON customers(phone) WHERE deleted_at IS NULL;
CREATE TRIGGER customers_phone_required_insert BEFORE INSERT ON customers
WHEN NEW.phone IS NULL OR length(trim(NEW.phone)) = 0
BEGIN SELECT RAISE(ABORT, 'customer phone is required'); END;
CREATE TRIGGER customers_phone_required_update BEFORE UPDATE OF phone ON customers
WHEN NEW.phone IS NULL OR length(trim(NEW.phone)) = 0
BEGIN SELECT RAISE(ABORT, 'customer phone is required'); END;

-- An issued invoice number is retained globally, including archived invoices.
DROP INDEX uq_purchases_active_invoice_number;
CREATE UNIQUE INDEX uq_purchases_invoice_number ON purchases(invoice_number) WHERE invoice_number IS NOT NULL;
CREATE TRIGGER purchases_invoice_number_immutable BEFORE UPDATE OF invoice_number ON purchases
WHEN OLD.invoice_number IS NOT NULL AND NEW.invoice_number IS NOT OLD.invoice_number
BEGIN SELECT RAISE(ABORT, 'issued invoice numbers are immutable'); END;
CREATE TRIGGER purchases_no_hard_delete BEFORE DELETE ON purchases WHEN OLD.invoice_number IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'issued invoices cannot be permanently deleted'); END;
ALTER TABLE purchases ADD COLUMN prescription_id TEXT REFERENCES prescriptions(id) ON DELETE RESTRICT;
ALTER TABLE purchases ADD COLUMN taxable_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK(taxable_amount_paise >= 0);

-- payments.customer_id was added in 0002; enforce consistency with its invoice.
CREATE TRIGGER payments_customer_matches_purchase_insert BEFORE INSERT ON payments
WHEN NEW.customer_id IS NULL OR NEW.customer_id IS NOT (SELECT customer_id FROM purchases WHERE id = NEW.purchase_id)
BEGIN SELECT RAISE(ABORT, 'payment customer must match the purchase'); END;
CREATE TRIGGER payments_customer_matches_purchase_update BEFORE UPDATE OF customer_id,purchase_id ON payments
WHEN NEW.customer_id IS NULL OR NEW.customer_id IS NOT (SELECT customer_id FROM purchases WHERE id = NEW.purchase_id)
BEGIN SELECT RAISE(ABORT, 'payment customer must match the purchase'); END;
