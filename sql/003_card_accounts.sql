-- v3: allow 'card' (credit card) accounts. SQLite cannot alter a CHECK constraint, so the
-- table is rebuilt; migrations.mjs turns foreign keys off around this step and runs
-- foreign_key_check before committing.
CREATE TABLE accounts_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bank','savings','cash','prepaid','card','system')),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  created_at TEXT NOT NULL,
  archived_at TEXT
);
INSERT INTO accounts_new(id,name,type,is_system,created_at,archived_at)
  SELECT id,name,type,is_system,created_at,archived_at FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;
