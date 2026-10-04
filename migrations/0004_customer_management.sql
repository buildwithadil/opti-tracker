-- Phase 2: canonical Indian phones, archive-safe uniqueness and customer API
-- names. Append only: the three previously applied migrations are unchanged.
-- Renaming the referenced key first rewrites existing prescription/purchase
-- FKs to customers(uuid). Rebuild under deferred FKs, never foreign_keys=OFF.
-- The migration runner must execute this entire migration in one transaction.
PRAGMA defer_foreign_keys = ON;

ALTER TABLE customers RENAME COLUMN id TO uuid;
ALTER TABLE customers RENAME COLUMN full_name TO name;
ALTER TABLE customers RENAME COLUMN deleted_at TO archived_at;

CREATE TABLE customers_phase_two (
  uuid TEXT PRIMARY KEY NOT NULL,
  customer_number TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  normalized_phone TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  date_of_birth TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  created_by_admin_id TEXT,
  updated_by_admin_id TEXT,
  deleted_by_admin_id TEXT,
  deletion_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  CHECK (length(uuid) > 0),
  CHECK (length(trim(name)) > 0),
  CHECK (length(normalized_phone) = 13 AND normalized_phone GLOB '+91[6-9]*'
    AND substr(normalized_phone, 4) NOT GLOB '*[^0-9]*'),
  CHECK (phone = '+91 ' || substr(normalized_phone, 4, 5) || ' ' || substr(normalized_phone, 9, 5)),
  CHECK (archived_at IS NULL OR deleted_by_admin_id IS NOT NULL),
  FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
  FOREIGN KEY (deleted_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
);

-- Stage the original rows, then insert into the replacement AFTER its rename.
-- This resolves SQLite's deferred FK counters as well as foreign_key_check;
-- copying into the new table before the rename leaves stale deferred counters.
CREATE TABLE customers_phase_two_legacy AS SELECT rowid AS legacy_rowid, * FROM customers;
DROP TABLE customers;
ALTER TABLE customers_phase_two RENAME TO customers;

-- Convert only forms accepted by the shared strict normalizer. Compacting is
-- used to identify the prefix, NOT to permit arbitrary separator placement.
-- Invalid phones deliberately become NULL and fail the NOT NULL constraint;
-- collisions fail the unique index below. No records are dropped or merged.
WITH compacted AS (
  SELECT *, trim(phone) AS entered,
    replace(replace(trim(phone), ' ', ''), '-', '') AS compact
  FROM customers_phase_two_legacy
), nationalized AS (
  SELECT *, CASE
    WHEN length(compact) = 10 THEN compact
    WHEN length(compact) = 11 AND substr(compact, 1, 1) = '0' THEN substr(compact, 2)
    WHEN length(compact) = 12 AND substr(compact, 1, 2) = '91' THEN substr(compact, 3)
    WHEN length(compact) = 13 AND substr(compact, 1, 3) = '+91' THEN substr(compact, 4)
    WHEN length(compact) = 14 AND substr(compact, 1, 4) = '0091' THEN substr(compact, 5)
    ELSE NULL END AS national
  FROM compacted
), grouped AS (
  SELECT *, substr(compact, 1, length(compact) - 10) AS prefix,
    substr(national, 1, 5) AS first_group, substr(national, 6, 5) AS last_group
  FROM nationalized
), validated AS (
  SELECT *, CASE WHEN length(phone) <= 32 AND length(national) = 10
    AND national GLOB '[6-9]*' AND national NOT GLOB '*[^0-9]*'
    AND (entered IN (
      prefix || national,
      prefix || first_group || ' ' || last_group,
      prefix || first_group || '-' || last_group
    ) OR (length(prefix) > 0 AND entered IN (
      prefix || ' ' || national, prefix || '-' || national,
      prefix || ' ' || first_group || ' ' || last_group,
      prefix || ' ' || first_group || '-' || last_group,
      prefix || '-' || first_group || ' ' || last_group,
      prefix || '-' || first_group || '-' || last_group
    ))) THEN '+91' || national ELSE NULL END AS canonical
  FROM grouped
)
INSERT INTO customers (
  rowid, uuid, customer_number, name, phone, normalized_phone, email,
  date_of_birth, address_line_1, address_line_2, city, state, postal_code,
  notes, created_at, updated_at, archived_at, created_by_admin_id,
  updated_by_admin_id, deleted_by_admin_id, deletion_reason
)
SELECT legacy_rowid, uuid, customer_number, name,
  '+91 ' || substr(canonical, 4, 5) || ' ' || substr(canonical, 9, 5), canonical,
  email, date_of_birth, address_line_1, address_line_2, city, state,
  postal_code, notes, created_at, updated_at, archived_at,
  created_by_admin_id, updated_by_admin_id, deleted_by_admin_id, deletion_reason
FROM validated;

DROP TABLE customers_phase_two_legacy;

CREATE UNIQUE INDEX uq_customers_active_number ON customers(customer_number)
  WHERE customer_number IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX uq_customers_active_normalized_phone ON customers(normalized_phone)
  WHERE archived_at IS NULL;
CREATE INDEX idx_customers_name ON customers(name COLLATE NOCASE, archived_at);
CREATE INDEX idx_customers_phone ON customers(normalized_phone, archived_at);
CREATE INDEX idx_customers_email ON customers(email, archived_at);
CREATE INDEX idx_customers_created ON customers(archived_at, created_at, uuid);
CREATE INDEX idx_customers_updated ON customers(archived_at, updated_at, uuid);

CREATE TRIGGER customers_phone_required_insert BEFORE INSERT ON customers
WHEN NEW.phone IS NULL OR length(trim(NEW.phone)) = 0
BEGIN SELECT RAISE(ABORT, 'customer phone is required'); END;
CREATE TRIGGER customers_phone_required_update BEFORE UPDATE OF phone ON customers
WHEN NEW.phone IS NULL OR length(trim(NEW.phone)) = 0
BEGIN SELECT RAISE(ABORT, 'customer phone is required'); END;
CREATE TRIGGER customers_no_hard_delete BEFORE DELETE ON customers
BEGIN SELECT RAISE(ABORT, 'customers cannot be permanently deleted'); END;
