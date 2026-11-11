-- Phase 3 dispatch bookkeeping.
-- offer_round: 0 = never offered, 1 = initial 3 km round, 2 = expanded 5 km round.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS offer_round integer NOT NULL DEFAULT 0;

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS distance_meters numeric(10, 2);

CREATE INDEX IF NOT EXISTS offers_pending_idx
  ON offers (expires_at)
  WHERE response IS NULL;

CREATE INDEX IF NOT EXISTS tickets_assigned_sla_idx
  ON tickets (sla_deadline)
  WHERE status = 'assigned';
