-- Phase 3: append-only, customer-linked prescription versions. Keep the
-- original table, stable IDs, clinical payloads and downstream foreign keys.
-- Existing timestamps/status/deletion metadata are intentionally untouched.
ALTER TABLE prescriptions ADD COLUMN root_id TEXT REFERENCES prescriptions(id) ON DELETE RESTRICT;
ALTER TABLE prescriptions ADD COLUMN supersedes_id TEXT REFERENCES prescriptions(id) ON DELETE RESTRICT;
ALTER TABLE prescriptions ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(revision_number) = 'integer' AND revision_number >= 1);
ALTER TABLE prescriptions ADD COLUMN revision_reason TEXT
  CHECK (revision_reason IS NULL OR length(trim(revision_reason)) BETWEEN 1 AND 500);
ALTER TABLE prescriptions ADD COLUMN near_pd TEXT;

UPDATE prescriptions SET root_id = id;

CREATE UNIQUE INDEX uq_prescriptions_successor ON prescriptions(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX uq_prescriptions_root_revision ON prescriptions(root_id, revision_number);
CREATE INDEX idx_prescriptions_history ON prescriptions(customer_id, root_id, revision_number DESC);
CREATE INDEX idx_prescriptions_customer_history ON prescriptions(customer_id, prescribed_on DESC, created_at DESC, id);

-- A root owns its ID. A child can only follow the current, active, undeleted
-- version of that same customer's root, exactly one revision later. Together
-- with the unique indexes this prevents branches, skips and cycles, including
-- competing writers which both read the same current version before saving.
CREATE TRIGGER prescriptions_lineage_insert BEFORE INSERT ON prescriptions
WHEN NEW.root_id IS NULL
  OR (NEW.supersedes_id IS NULL AND (
    NEW.root_id IS NOT NEW.id OR NEW.revision_number <> 1 OR NEW.revision_reason IS NOT NULL
  ))
  OR (NEW.supersedes_id IS NOT NULL AND (
    NEW.id = NEW.supersedes_id OR NEW.id = NEW.root_id
    OR NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL
    OR NEW.revision_reason IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM prescriptions AS parent
      WHERE parent.id = NEW.supersedes_id
        AND parent.customer_id = NEW.customer_id
        AND parent.root_id = NEW.root_id
        AND NEW.revision_number = parent.revision_number + 1
        AND parent.status = 'active' AND parent.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM prescriptions AS child WHERE child.supersedes_id = parent.id)
    )
  ))
BEGIN SELECT RAISE(ABORT, 'invalid prescription lineage'); END;

-- Superseding never changes the old row: successor/status/time are derived
-- from the linked replacement. This also preserves referenced invoice data.
CREATE TRIGGER prescriptions_immutable_update BEFORE UPDATE ON prescriptions
BEGIN SELECT RAISE(ABORT, 'prescriptions are immutable'); END;
CREATE TRIGGER prescriptions_immutable_delete BEFORE DELETE ON prescriptions
BEGIN SELECT RAISE(ABORT, 'prescriptions are immutable'); END;
