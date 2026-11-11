-- Phase 4 hardening: Web Push subscriptions, optional retraining samples and
-- faster duplicate-photo lookups.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_driver_idx
  ON push_subscriptions (driver_id);

CREATE TABLE IF NOT EXISTS retraining_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_path text NOT NULL,
  overflow_conf numeric(5, 4) NOT NULL,
  garbage_conf numeric(5, 4) NOT NULL,
  bin_conf numeric(5, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retraining_samples_created_idx
  ON retraining_samples (created_at);

CREATE INDEX IF NOT EXISTS reports_photo_hash_idx
  ON reports (photo_hash)
  WHERE photo_hash IS NOT NULL;
