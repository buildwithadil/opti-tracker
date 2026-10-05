-- Phase 6: existing financial tables and applied migrations remain unchanged.
-- A committed reservation consumes the existing singleton counter permanently,
-- even if the later invoice transaction fails. Gaps are intentional and audited.
CREATE TABLE invoice_number_reservations (
  uuid TEXT PRIMARY KEY NOT NULL,
  purchase_uuid TEXT NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  customer_uuid TEXT NOT NULL REFERENCES customers(uuid) ON DELETE RESTRICT,
  shop_uuid TEXT NOT NULL REFERENCES shop_settings(uuid) ON DELETE RESTRICT,
  client_request_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL UNIQUE CHECK(sequence_number BETWEEN 1 AND 9007199254740990),
  invoice_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by_admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  creation_audit_id TEXT NOT NULL UNIQUE REFERENCES audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(customer_uuid,client_request_id)
) STRICT;
CREATE INDEX idx_invoice_reservations_purchase ON invoice_number_reservations(purchase_uuid);

CREATE TABLE invoices (
  uuid TEXT PRIMARY KEY NOT NULL,
  purchase_uuid TEXT NOT NULL UNIQUE REFERENCES purchases(id) ON DELETE RESTRICT,
  customer_uuid TEXT NOT NULL REFERENCES customers(uuid) ON DELETE RESTRICT,
  reservation_uuid TEXT NOT NULL UNIQUE REFERENCES invoice_number_reservations(uuid) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_by_admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  creation_audit_id TEXT NOT NULL UNIQUE REFERENCES audit_logs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX idx_invoices_customer_purchase ON invoices(customer_uuid,purchase_uuid);

-- Minimal versioned document data. Prices/taxes/totals are copied, never
-- recalculated. No clinical measurements, notes, customer address or payment refs.
CREATE VIEW invoice_source_snapshots AS
SELECT p.id AS purchase_uuid,p.customer_id AS customer_uuid,
  json_object('version',1,
    'shop',json_object('shop_name',s.shop_name,'address',s.address,'contact_number',s.contact_number,'gstin',s.gstin,'footer_text',s.footer_text),
    'customer',json_object('name',c.name,'phone',c.phone),
    'purchase',json_object('uuid',p.id,'purchase_date',COALESCE(p.purchase_date,substr(p.created_at,1,10)),
      'prescription_uuid',p.prescription_id,'currency_code',p.currency_code,'subtotal_paise',p.subtotal_paise,
      'discount_paise',p.discount_paise,'taxable_amount_paise',p.taxable_amount_paise,'tax_paise',p.tax_paise,
      'cgst_paise',p.cgst_paise,'sgst_paise',p.sgst_paise,'igst_paise',p.igst_paise,'tax_type',p.tax_type,'total_paise',p.total_paise),
    'items',json((SELECT json_group_array(json_object('uuid',id,'description',description,'product_category',product_category,
      'quantity',quantity,'unit_price_paise',unit_price_paise,'discount_paise',discount_paise,'line_total_paise',line_total_paise,
      'taxable_paise',taxable_paise,'tax_rate_basis_points',tax_rate_basis_points,'tax_type',tax_type,'tax_paise',tax_paise,'hsn_sac_code',hsn_sac_code))
      FROM (SELECT * FROM purchase_items WHERE purchase_id=p.id ORDER BY sort_order,id))),
    'payment_summary',json_object('total_paise',b.total_paise,'amount_paid_paise',b.amount_paid_paise,
      'outstanding_paise',b.outstanding_paise,'payment_status',b.payment_status),
    'payment_methods',json((SELECT json_group_array(json_object('payment_method',payment_method,'amount_paise',amount_paise))
      FROM (SELECT payment_method,SUM(amount_paise) AS amount_paise FROM payments
        WHERE purchase_id=p.id AND status='settled' AND deleted_at IS NULL GROUP BY payment_method ORDER BY payment_method))),
    'payment_count',(SELECT count(*) FROM payments WHERE purchase_id=p.id AND status='settled' AND deleted_at IS NULL)) AS snapshot_json
FROM purchases AS p JOIN customers AS c ON c.uuid=p.customer_id
JOIN purchase_payment_balances AS b ON b.purchase_uuid=p.id
JOIN shop_settings AS s ON s.singleton_slot=1;

CREATE TRIGGER invoice_reservations_immutable_update BEFORE UPDATE ON invoice_number_reservations
BEGIN SELECT RAISE(ABORT,'invoice number reservations are immutable'); END;
CREATE TRIGGER invoice_reservations_immutable_delete BEFORE DELETE ON invoice_number_reservations
BEGIN SELECT RAISE(ABORT,'invoice number reservations are immutable'); END;
CREATE TRIGGER invoice_reservations_insert BEFORE INSERT ON invoice_number_reservations
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invoice_number_reservations WHERE uuid=NEW.uuid OR invoice_number=NEW.invoice_number
      OR sequence_number=NEW.sequence_number OR (customer_uuid=NEW.customer_uuid AND client_request_id=NEW.client_request_id))
    THEN RAISE(ABORT,'invoice number reservation already exists') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM purchases WHERE invoice_number=NEW.invoice_number)
    THEN RAISE(ABORT,'invoice number conflicts with legacy invoice; reconcile sequence') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM purchases AS p JOIN customers AS c ON c.uuid=p.customer_id
    WHERE p.id=NEW.purchase_uuid AND c.uuid=NEW.customer_uuid AND c.archived_at IS NULL
      AND p.deleted_at IS NULL AND p.status NOT IN ('void','refunded') AND p.currency_code='INR'
      AND p.invoice_number IS NULL)
    THEN RAISE(ABORT,'purchase cannot receive an invoice') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM shop_settings WHERE uuid=NEW.shop_uuid AND singleton_slot=1
    AND length(trim(shop_name)) BETWEEN 1 AND 200 AND length(trim(address)) BETWEEN 1 AND 2000
    AND length(trim(contact_number)) BETWEEN 1 AND 32 AND length(footer_text)<=2000
    AND invoice_reset_policy='never' AND length(invoice_prefix) BETWEEN 1 AND 20
    AND invoice_prefix NOT GLOB '*[^A-Z0-9-]*'
    AND next_invoice_number=NEW.sequence_number
    AND NEW.invoice_number=invoice_prefix || '-' || printf('%0*d',invoice_number_padding,next_invoice_number))
    THEN RAISE(ABORT,'invoice shop configuration or sequence is invalid') END;
  SELECT CASE WHEN length(NEW.client_request_id)<>36 OR EXISTS(SELECT 1 FROM audit_logs WHERE id=NEW.creation_audit_id)
    THEN RAISE(ABORT,'invoice reservation requires a new audit') END;
END;
CREATE TRIGGER invoice_reservations_advance AFTER INSERT ON invoice_number_reservations
BEGIN UPDATE shop_settings SET next_invoice_number=NEW.sequence_number+1 WHERE uuid=NEW.shop_uuid; END;
CREATE TRIGGER invoice_sequence_monotonic BEFORE UPDATE OF next_invoice_number ON shop_settings
WHEN NEW.next_invoice_number<OLD.next_invoice_number OR NEW.next_invoice_number>9007199254740991
  OR NEW.next_invoice_number<=COALESCE((SELECT MAX(sequence_number) FROM invoice_number_reservations),0)
BEGIN SELECT RAISE(ABORT,'invoice sequence cannot go backwards or reuse reserved numbers'); END;
CREATE TRIGGER purchases_reserved_invoice_number BEFORE INSERT ON purchases
WHEN NEW.invoice_number IS NOT NULL AND EXISTS(SELECT 1 FROM invoice_number_reservations WHERE invoice_number=NEW.invoice_number)
BEGIN SELECT RAISE(ABORT,'invoice number is already reserved'); END;

CREATE TRIGGER invoices_immutable_update BEFORE UPDATE ON invoices
BEGIN SELECT RAISE(ABORT,'invoices are immutable'); END;
CREATE TRIGGER invoices_immutable_delete BEFORE DELETE ON invoices
BEGIN SELECT RAISE(ABORT,'invoices are immutable'); END;
CREATE TRIGGER invoices_insert BEFORE INSERT ON invoices
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM invoices WHERE uuid=NEW.uuid OR purchase_uuid=NEW.purchase_uuid
    OR invoice_number=NEW.invoice_number OR reservation_uuid=NEW.reservation_uuid)
    THEN RAISE(ABORT,'invoice already exists') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM invoice_number_reservations AS r JOIN audit_logs AS a ON a.id=r.creation_audit_id
    JOIN purchases AS p ON p.id=r.purchase_uuid JOIN customers AS c ON c.uuid=p.customer_id
    WHERE r.uuid=NEW.reservation_uuid AND r.purchase_uuid=NEW.purchase_uuid AND r.customer_uuid=NEW.customer_uuid
      AND r.invoice_number=NEW.invoice_number AND r.created_by_admin_id=NEW.created_by_admin_id
      AND c.archived_at IS NULL AND p.deleted_at IS NULL AND p.status NOT IN ('void','refunded') AND p.currency_code='INR')
    THEN RAISE(ABORT,'invalid invoice reservation or purchase') END;
  SELECT CASE WHEN NEW.snapshot_json IS NOT (SELECT snapshot_json FROM invoice_source_snapshots WHERE purchase_uuid=NEW.purchase_uuid AND customer_uuid=NEW.customer_uuid)
    OR EXISTS(SELECT 1 FROM audit_logs WHERE id=NEW.creation_audit_id)
    OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.issued_at,'+0 seconds') IS NOT NEW.issued_at
    THEN RAISE(ABORT,'invalid invoice snapshot or creation audit') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM purchase_payment_balances WHERE purchase_uuid=NEW.purchase_uuid
      AND (invalid_payment OR legacy_reversal OR outstanding_paise<0))
    OR json_array_length(NEW.snapshot_json,'$.items') NOT BETWEEN 1 AND 100
    OR EXISTS(SELECT 1 FROM purchase_items WHERE purchase_id=NEW.purchase_uuid AND deleted_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM json_tree(NEW.snapshot_json) WHERE key IN ('subtotal_paise','discount_paise','taxable_amount_paise',
      'tax_paise','cgst_paise','sgst_paise','igst_paise','total_paise','unit_price_paise','line_total_paise','taxable_paise',
      'amount_paid_paise','outstanding_paise','amount_paise','quantity','tax_rate_basis_points','payment_count')
      AND (type<>'integer' OR atom<0 OR atom>9007199254740991))
    THEN RAISE(ABORT,'invalid invoice financial data') END;
END;
CREATE TRIGGER invoice_audit_integrity BEFORE INSERT ON audit_logs
WHEN (EXISTS(SELECT 1 FROM invoices WHERE creation_audit_id=NEW.id) AND NOT EXISTS(
  SELECT 1 FROM invoices WHERE creation_audit_id=NEW.id AND uuid=NEW.entity_id AND NEW.entity_type='invoice'
    AND NEW.action='create' AND created_by_admin_id=NEW.actor_admin_user_id AND issued_at=NEW.created_at))
OR (EXISTS(SELECT 1 FROM invoice_number_reservations WHERE creation_audit_id=NEW.id) AND NOT EXISTS(
  SELECT 1 FROM invoice_number_reservations WHERE creation_audit_id=NEW.id AND uuid=NEW.entity_id AND NEW.entity_type='invoice_number'
    AND NEW.action='reserve' AND created_by_admin_id=NEW.actor_admin_user_id AND created_at=NEW.created_at))
BEGIN SELECT RAISE(ABORT,'invoice requires its own creation audit'); END;
