-- Phase 4: customer-scoped, append-only purchase management. Earlier
-- migrations and legacy rows remain untouched. New application purchases are
-- always customer-bound and all purchase/item snapshots are immutable.
ALTER TABLE purchases ADD COLUMN client_request_id TEXT;
-- An inserted header must reference its own newly inserted, validating audit.
-- The deferred FK is checked at batch COMMIT, preventing empty/partial purchases
-- even if a SQL writer omits the final audit. Old rows keep NULL unchanged.
ALTER TABLE purchases ADD COLUMN creation_audit_id TEXT REFERENCES audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE purchases ADD COLUMN item_count INTEGER
  CHECK (item_count IS NULL OR (typeof(item_count) = 'integer' AND item_count BETWEEN 1 AND 100));
ALTER TABLE purchase_items ADD COLUMN snapshot_position INTEGER
  CHECK (snapshot_position IS NULL OR (typeof(snapshot_position) = 'integer' AND snapshot_position BETWEEN 0 AND 99));
CREATE UNIQUE INDEX uq_purchases_customer_submission
  ON purchases(customer_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX uq_purchases_creation_audit ON purchases(creation_audit_id) WHERE creation_audit_id IS NOT NULL;
CREATE UNIQUE INDEX uq_purchase_items_snapshot_position
  ON purchase_items(purchase_id, snapshot_position) WHERE snapshot_position IS NOT NULL;

CREATE INDEX idx_purchases_customer_history
  ON purchases(customer_id, COALESCE(purchase_date,substr(created_at,1,10)) DESC, created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_order_id
  ON purchase_items(purchase_id, sort_order, id);

-- The old trigger only protected issued/numbered records. Keep it for legacy
-- error compatibility, and add guards that protect every legacy and new row
-- from mutation/deletion. D1 executes this migration once, so these names remain
-- stable for isolated test trigger restoration.
CREATE TRIGGER purchases_immutable_update BEFORE UPDATE ON purchases
BEGIN SELECT RAISE(ABORT, 'purchases are immutable'); END;
CREATE TRIGGER purchases_immutable_delete BEFORE DELETE ON purchases
BEGIN SELECT RAISE(ABORT, 'purchases are immutable'); END;
CREATE TRIGGER purchases_immutable_replace BEFORE INSERT ON purchases
WHEN EXISTS (SELECT 1 FROM purchases WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'purchases are immutable'); END;
-- SQLite REPLACE can otherwise bypass DELETE triggers for a unique-key clash.
CREATE TRIGGER purchases_invoice_number_reuse BEFORE INSERT ON purchases
WHEN NEW.invoice_number IS NOT NULL AND EXISTS (SELECT 1 FROM purchases WHERE invoice_number = NEW.invoice_number)
BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: purchases.invoice_number'); END;
CREATE TRIGGER purchase_items_immutable_update BEFORE UPDATE ON purchase_items
BEGIN SELECT RAISE(ABORT, 'purchase items are immutable'); END;
CREATE TRIGGER purchase_items_immutable_delete BEFORE DELETE ON purchase_items
BEGIN SELECT RAISE(ABORT, 'purchase items are immutable'); END;
CREATE TRIGGER purchase_items_immutable_replace BEFORE INSERT ON purchase_items
WHEN EXISTS (SELECT 1 FROM purchase_items WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'purchase items are immutable'); END;

-- Existing nullable customer_id values are retained for historical rows. All
-- future rows must provide a real customer, and a purchase-level prescription
-- must belong to that same customer. The item guard covers legacy direct SQL
-- writes as well; the Phase 4 API deliberately does not accept item Rx IDs.
CREATE TRIGGER purchases_customer_required_insert BEFORE INSERT ON purchases
WHEN NEW.customer_id IS NULL
BEGIN SELECT RAISE(ABORT, 'purchase customer is required'); END;
CREATE TRIGGER purchases_prescription_customer_insert BEFORE INSERT ON purchases
WHEN NEW.prescription_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM prescriptions
  WHERE id = NEW.prescription_id AND customer_id = NEW.customer_id
)
BEGIN SELECT RAISE(ABORT, 'purchase prescription must belong to its customer'); END;
CREATE TRIGGER purchase_items_prescription_customer_insert BEFORE INSERT ON purchase_items
WHEN NEW.prescription_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM purchases AS purchase
  JOIN prescriptions AS prescription ON prescription.id = NEW.prescription_id
  WHERE purchase.id = NEW.purchase_id AND prescription.customer_id = purchase.customer_id
)
BEGIN SELECT RAISE(ABORT, 'item prescription must belong to its purchase customer'); END;

-- Snapshot insert boundaries prevent a later writer from appending to a
-- completed purchase. A successful create audit seals its full item set;
-- audit validation is in the same atomic batch as every item/header insert.
CREATE TRIGGER purchases_creation_shape_insert BEFORE INSERT ON purchases
WHEN NEW.item_count IS NULL OR NEW.creation_audit_id IS NULL
  OR EXISTS (SELECT 1 FROM audit_logs WHERE id = NEW.creation_audit_id)
  OR typeof(NEW.subtotal_paise) <> 'integer' OR NEW.subtotal_paise > 9007199254740991
  OR typeof(NEW.discount_paise) <> 'integer' OR NEW.discount_paise > 9007199254740991
  OR typeof(NEW.tax_paise) <> 'integer' OR NEW.tax_paise > 9007199254740991
  OR typeof(NEW.total_paise) <> 'integer' OR NEW.total_paise > 9007199254740991
  OR (NEW.client_request_id IS NOT NULL AND (
  NEW.status <> 'draft' OR NEW.invoice_number IS NOT NULL
  OR NEW.issued_at IS NOT NULL OR NEW.currency_code <> 'INR'
  OR NEW.deleted_at IS NOT NULL OR NEW.purchase_date IS NULL
  OR NEW.taxable_amount_paise <> NEW.subtotal_paise - NEW.discount_paise
  OR NEW.tax_paise <> NEW.cgst_paise + NEW.sgst_paise + NEW.igst_paise
  OR NEW.tax_paise <> 0 OR NEW.tax_type <> 'none'
))
BEGIN SELECT RAISE(ABORT, 'invalid purchase creation shape'); END;
CREATE TRIGGER purchase_items_snapshot_insert BEFORE INSERT ON purchase_items
WHEN EXISTS (SELECT 1 FROM purchases AS p WHERE p.id = NEW.purchase_id)
AND (
  (SELECT creation_audit_id FROM purchases WHERE id = NEW.purchase_id) IS NULL
  OR
  NEW.snapshot_position IS NULL OR NEW.sort_order <> NEW.snapshot_position
  OR NEW.snapshot_position >= (SELECT item_count FROM purchases WHERE id = NEW.purchase_id)
  OR NEW.deleted_at IS NOT NULL
  OR typeof(NEW.quantity) <> 'integer' OR NEW.quantity > 100000
  OR typeof(NEW.unit_price_paise) <> 'integer' OR NEW.unit_price_paise > 9007199254740991
  OR typeof(NEW.discount_paise) <> 'integer' OR NEW.discount_paise > 9007199254740991
  OR typeof(NEW.tax_paise) <> 'integer' OR NEW.tax_paise > 9007199254740991
  OR typeof(NEW.line_total_paise) <> 'integer' OR NEW.line_total_paise > 9007199254740991
  OR NEW.taxable_paise <> NEW.quantity * NEW.unit_price_paise - NEW.discount_paise
  OR NEW.quantity * NEW.unit_price_paise > 9007199254740991
  OR (EXISTS (SELECT 1 FROM purchases WHERE id = NEW.purchase_id AND client_request_id IS NOT NULL) AND (
    NEW.product_category NOT IN ('spectacle_frames','prescription_lenses','contact_lenses','sunglasses','reading_glasses','optical_accessories','other')
    OR NEW.tax_paise <> 0 OR NEW.tax_rate_basis_points <> 0 OR NEW.tax_type <> 'none'
    OR NEW.line_type <> 'product' OR NEW.prescription_id IS NOT NULL
  ))
  OR EXISTS (SELECT 1 FROM audit_logs WHERE entity_type = 'purchase'
    AND entity_id = NEW.purchase_id AND action = 'create')
)
BEGIN SELECT RAISE(ABORT, 'invalid or sealed purchase item snapshot'); END;
CREATE TRIGGER purchases_create_audit_integrity BEFORE INSERT ON audit_logs
WHEN EXISTS (SELECT 1 FROM purchases WHERE creation_audit_id = NEW.id)
AND NOT EXISTS (
  SELECT 1 FROM purchases AS p WHERE p.id = NEW.entity_id AND p.creation_audit_id = NEW.id
    AND NEW.entity_type = 'purchase' AND NEW.action = 'create'
    AND p.item_count = (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id)
    AND p.subtotal_paise = (SELECT SUM(quantity * unit_price_paise) FROM purchase_items WHERE purchase_id = p.id)
    AND p.tax_paise = (SELECT SUM(tax_paise) FROM purchase_items WHERE purchase_id = p.id)
    AND p.discount_paise >= (SELECT SUM(discount_paise) FROM purchase_items WHERE purchase_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE entity_type = 'purchase' AND entity_id = p.id AND action = 'create')
)
BEGIN SELECT RAISE(ABORT, 'purchase audit requires complete item snapshots'); END;
