PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('web', 'app')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'archived', 'quarantined', 'blocked')),
  filter_reasons TEXT,
  sender_hash TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_messages_status_created
  ON messages(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_duplicate
  ON messages(sender_hash, message_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  PRIMARY KEY (rate_key, bucket)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry
  ON rate_limits(reset_at);

CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry
  ON studio_sessions(expires_at);

CREATE TABLE IF NOT EXISTS blocked_senders (
  sender_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'studio'
);

CREATE INDEX IF NOT EXISTS idx_blocked_senders_created
  ON blocked_senders(created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  message_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created
  ON audit_log(created_at DESC);
