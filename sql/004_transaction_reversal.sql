-- v4: cancel/correct transactions by reversal instead of deletion.
-- A reversal is a transaction of the same kind with every entry negated, pointing at the
-- original. The unique index means a transaction can be reversed at most once.
ALTER TABLE transactions ADD COLUMN reverses_transaction_id TEXT REFERENCES transactions(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reverses
  ON transactions(reverses_transaction_id) WHERE reverses_transaction_id IS NOT NULL;

-- Cancelling a temporary-withdrawal transfer cancels its replenishment obligation.
ALTER TABLE replenishments ADD COLUMN cancelled_at TEXT;
