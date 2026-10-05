-- Shop-wide reports cannot use the customer-leading history index. The initial
-- purchase-date index does not cover NULL legacy-date fallback or report ordering.
-- Index only: no business records, audits, settings or old migrations are changed.
CREATE INDEX idx_purchases_report_date ON purchases (
  COALESCE(purchase_date,date(created_at,'+330 minutes')) DESC,id
) WHERE deleted_at IS NULL AND status NOT IN ('void','refunded') AND currency_code = 'INR';
