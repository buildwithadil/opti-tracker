-- Add business fields that preserve invoice and prescription detail without
-- rewriting the already-applied initial schema.
PRAGMA foreign_keys = ON;

ALTER TABLE purchases ADD COLUMN purchase_date TEXT;
ALTER TABLE purchases ADD COLUMN cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0);
ALTER TABLE purchases ADD COLUMN sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0);
ALTER TABLE purchases ADD COLUMN igst_paise INTEGER NOT NULL DEFAULT 0 CHECK (igst_paise >= 0);
ALTER TABLE purchases ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'none' CHECK (tax_type IN ('none', 'cgst_sgst', 'igst'));
ALTER TABLE purchases ADD COLUMN invoice_snapshot_json TEXT;

ALTER TABLE purchase_items ADD COLUMN product_category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE purchase_items ADD COLUMN taxable_paise INTEGER NOT NULL DEFAULT 0 CHECK (taxable_paise >= 0);
ALTER TABLE purchase_items ADD COLUMN tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000);
ALTER TABLE purchase_items ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'none' CHECK (tax_type IN ('none', 'cgst_sgst', 'igst'));
ALTER TABLE purchase_items ADD COLUMN hsn_sac_code TEXT;

ALTER TABLE prescriptions ADD COLUMN right_pd TEXT;
ALTER TABLE prescriptions ADD COLUMN left_pd TEXT;

ALTER TABLE payments ADD COLUMN customer_id TEXT;
ALTER TABLE payments ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_purchases_purchase_date
  ON purchases (purchase_date DESC, deleted_at);

CREATE INDEX IF NOT EXISTS idx_payments_customer_date
  ON payments (customer_id, received_at DESC, deleted_at);
