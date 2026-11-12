-- v2: accounts can be archived (hidden, no new postings) without deleting ledger history.
ALTER TABLE accounts ADD COLUMN archived_at TEXT;
