SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) NOT NULL PRIMARY KEY,
  display_name VARCHAR(40) NOT NULL,
  body VARCHAR(500) NOT NULL,
  source ENUM('web', 'app') NOT NULL,
  status ENUM('new', 'read', 'archived', 'quarantined', 'blocked') NOT NULL DEFAULT 'new',
  filter_reasons JSON NULL,
  sender_hash CHAR(64) NOT NULL,
  message_hash CHAR(64) NOT NULL,
  conversation_hash CHAR(64) NULL,
  user_id CHAR(36) NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  reviewed_at BIGINT UNSIGNED NULL,
  INDEX idx_messages_status_created (status, created_at),
  INDEX idx_messages_duplicate (sender_hash, message_hash, created_at),
  INDEX idx_messages_conversation (conversation_hash, created_at),
  INDEX idx_messages_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  display_name VARCHAR(40) NOT NULL,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  conversation_hash CHAR(64) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_conversation (conversation_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listener_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_listener_sessions_user (user_id),
  INDEX idx_listener_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voice_clips (
  id CHAR(36) NOT NULL PRIMARY KEY,
  message_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  storage_name VARCHAR(100) NOT NULL,
  mime_type VARCHAR(60) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  duration_seconds SMALLINT UNSIGNED NOT NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_voice_message (message_id),
  UNIQUE KEY uq_voice_storage (storage_name),
  INDEX idx_voice_user_created (user_id, created_at),
  INDEX idx_voice_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS replies (
  id CHAR(36) NOT NULL PRIMARY KEY,
  message_id CHAR(36) NOT NULL,
  conversation_hash CHAR(64) NOT NULL,
  body VARCHAR(500) NOT NULL,
  operator_name VARCHAR(40) NOT NULL DEFAULT 'Studio',
  created_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_replies_message (message_id, created_at),
  INDEX idx_replies_conversation (conversation_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key CHAR(64) NOT NULL,
  bucket VARCHAR(40) NOT NULL,
  request_count INT UNSIGNED NOT NULL,
  reset_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (rate_key, bucket),
  INDEX idx_rate_limits_expiry (reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS studio_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  operator_name VARCHAR(40) NOT NULL DEFAULT 'Studio',
  created_at BIGINT UNSIGNED NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS studio_push_subscriptions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  expo_token VARCHAR(255) NOT NULL,
  platform ENUM('android', 'ios') NOT NULL DEFAULT 'android',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_studio_push_token (expo_token),
  INDEX idx_studio_push_enabled (enabled, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listener_push_subscriptions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expo_token VARCHAR(255) NOT NULL,
  platform ENUM('android', 'ios') NOT NULL DEFAULT 'android',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_listener_push_token (expo_token),
  INDEX idx_listener_push_user (user_id, enabled, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS studio_claims (
  conversation_key_hash CHAR(64) NOT NULL PRIMARY KEY,
  conversation_key VARCHAR(191) NOT NULL,
  session_token_hash CHAR(64) NOT NULL,
  operator_name VARCHAR(40) NOT NULL,
  claimed_at BIGINT UNSIGNED NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY uq_studio_claim_conversation (conversation_key),
  INDEX idx_studio_claim_session (session_token_hash),
  INDEX idx_studio_claim_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blocked_senders (
  sender_hash CHAR(64) NOT NULL PRIMARY KEY,
  created_at BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(40) NOT NULL DEFAULT 'studio',
  INDEX idx_blocked_senders_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(80) NOT NULL,
  message_id CHAR(36) NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
