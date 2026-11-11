CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bank','savings','cash','prepaid','system')),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('opening','income','expense','transfer','prepaid_topup','replenishment_repayment')),
  category TEXT,
  note TEXT,
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  idempotency_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_krw INTEGER NOT NULL CHECK (amount_krw <> 0)
);
CREATE INDEX IF NOT EXISTS idx_entries_account ON entries(account_id,transaction_id);
CREATE INDEX IF NOT EXISTS idx_entries_transaction ON entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(occurred_on DESC,created_at DESC);

CREATE TABLE IF NOT EXISTS prepaid_lots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  topup_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  face_amount INTEGER NOT NULL CHECK (face_amount > 0),
  paid_amount INTEGER NOT NULL CHECK (paid_amount >= 0 AND paid_amount <= face_amount),
  remaining_face INTEGER NOT NULL CHECK (remaining_face >= 0 AND remaining_face <= face_amount),
  remaining_paid INTEGER NOT NULL CHECK (remaining_paid >= 0 AND remaining_paid <= paid_amount),
  expires_on TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prepaid_account ON prepaid_lots(account_id,created_at);

CREATE TABLE IF NOT EXISTS prepaid_allocations (
  id TEXT PRIMARY KEY,
  spend_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  lot_id TEXT NOT NULL REFERENCES prepaid_lots(id) ON DELETE RESTRICT,
  face_used INTEGER NOT NULL CHECK (face_used > 0),
  paid_used INTEGER NOT NULL CHECK (paid_used >= 0 AND paid_used <= face_used)
);
CREATE INDEX IF NOT EXISTS idx_prepaid_allocations_spend ON prepaid_allocations(spend_transaction_id);

CREATE TABLE IF NOT EXISTS replenishments (
  id TEXT PRIMARY KEY,
  transfer_transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  protected_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  destination_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  principal_amount INTEGER NOT NULL CHECK (principal_amount > 0),
  repaid_amount INTEGER NOT NULL DEFAULT 0 CHECK (repaid_amount >= 0 AND repaid_amount <= principal_amount),
  due_on TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replenishments_due ON replenishments(due_on);

CREATE TABLE IF NOT EXISTS replenishment_payments (
  id TEXT PRIMARY KEY,
  replenishment_id TEXT NOT NULL REFERENCES replenishments(id) ON DELETE RESTRICT,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
  amount_krw INTEGER NOT NULL CHECK (amount_krw > 0)
);
CREATE INDEX IF NOT EXISTS idx_replenishment_payments_obligation ON replenishment_payments(replenishment_id);

INSERT OR IGNORE INTO accounts(id,name,type,is_system,created_at) VALUES
  ('SYS:income','수입 상계','system',1,'2026-01-01T00:00:00.000Z'),
  ('SYS:expense','소비 상계','system',1,'2026-01-01T00:00:00.000Z'),
  ('SYS:benefit','충전 혜택 상계','system',1,'2026-01-01T00:00:00.000Z'),
  ('SYS:opening','기초 잔액 상계','system',1,'2026-01-01T00:00:00.000Z');
