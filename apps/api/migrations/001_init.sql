-- OverflowGo initial schema (PostgreSQL 16 + PostGIS 3.4)
-- Mirrors OverflowGo_MD_Docs/04_DATABASE_SCHEMA.md with the agreed Phase 1 additions:
--   reports.client_report_id (idempotency), reports.photo_hash (24h duplicate check),
--   ticket_reward_exclusions (multiple nearby-driver exclusions per ticket).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE ticket_status AS ENUM ('open', 'offered', 'assigned', 'completed');
CREATE TYPE report_result AS ENUM ('accepted', 'rejected', 'merged');
CREATE TYPE offer_response AS ENUM ('accepted', 'rejected', 'ignored', 'expired', 'taken_by_other');

CREATE TABLE localities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  center geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX localities_center_gix ON localities USING GIST (center);

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  phone text NOT NULL DEFAULT '',
  vehicle_no text NOT NULL DEFAULT '',
  is_online boolean NOT NULL DEFAULT false,
  last_location geography(Point, 4326),
  last_ping_at timestamptz,
  van_full boolean NOT NULL DEFAULT false,
  acceptance_score numeric(4, 2) NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX drivers_last_location_gix ON drivers USING GIST (last_location);
CREATE INDEX drivers_online_idx ON drivers (is_online, last_ping_at);

CREATE TABLE driver_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, device_id)
);

CREATE INDEX driver_devices_device_idx ON driver_devices (device_id);

CREATE TABLE route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  locality_id uuid NOT NULL REFERENCES localities(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, position),
  UNIQUE (driver_id, locality_id)
);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locality_id uuid NOT NULL REFERENCES localities(id),
  location geography(Point, 4326) NOT NULL,
  status ticket_status NOT NULL DEFAULT 'open',
  report_count integer NOT NULL DEFAULT 1 CHECK (report_count > 0),
  first_reported_at timestamptz NOT NULL DEFAULT now(),
  assigned_driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  sla_deadline timestamptz,
  completed_at timestamptz,
  reward_eligible boolean NOT NULL DEFAULT true,
  flag_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tickets_location_gix ON tickets USING GIST (location);
CREATE INDEX tickets_status_first_reported_idx ON tickets (status, first_reported_at);
CREATE INDEX tickets_locality_idx ON tickets (locality_id);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  photo_path text,
  note text,
  location geography(Point, 4326) NOT NULL,
  device_id text NOT NULL,
  ai_overflow_conf numeric(5, 4) NOT NULL DEFAULT 0,
  ai_garbage_conf numeric(5, 4) NOT NULL DEFAULT 0,
  ai_bin_conf numeric(5, 4) NOT NULL DEFAULT 0,
  ai_trigger text CHECK (ai_trigger IN ('overflow', 'garbage', 'both')),
  result report_result NOT NULL,
  reject_reason text,
  client_report_id text,
  photo_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reports_client_report_id_key
  ON reports (client_report_id)
  WHERE client_report_id IS NOT NULL;
CREATE INDEX reports_photo_hash_idx ON reports (photo_hash) WHERE photo_hash IS NOT NULL;
CREATE INDEX reports_ticket_idx ON reports (ticket_id);
CREATE INDEX reports_created_idx ON reports (created_at);
CREATE INDEX reports_location_gix ON reports USING GIST (location);

CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  response offer_response,
  responded_at timestamptz,
  UNIQUE (ticket_id, driver_id)
);

CREATE INDEX offers_driver_idx ON offers (driver_id, response);

CREATE TABLE completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id),
  after_photo_path text,
  location geography(Point, 4326) NOT NULL,
  ai_overflow_conf numeric(5, 4) NOT NULL DEFAULT 0,
  ai_garbage_conf numeric(5, 4) NOT NULL DEFAULT 0,
  ai_bin_conf numeric(5, 4) NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reward_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id),
  ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id),
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reward_ledger_driver_created_idx ON reward_ledger (driver_id, created_at);

CREATE TABLE ticket_reward_exclusions (
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, driver_id)
);
