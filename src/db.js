// Database layer: real PostgreSQL when DATABASE_URL is set (Railway),
// otherwise an embedded Postgres (PGlite) stored in ./data for local dev.
const fs = require('fs');
const path = require('path');

let client;
let kind;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const ssl = /localhost|127\.0\.0\.1|railway\.internal/.test(process.env.DATABASE_URL)
      ? false
      : { rejectUnauthorized: false };
    client = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 10 });
    kind = 'postgres';
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const dir = path.join(process.cwd(), 'data', 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
    kind = 'pglite';
  }
  await migrate();
  return kind;
}

async function query(sql, params = []) {
  const res = await client.query(sql, params);
  return { rows: res.rows, rowCount: res.rowCount ?? res.affectedRows ?? res.rows.length };
}

async function one(sql, params) {
  const { rows } = await query(sql, params);
  return rows[0] || null;
}

// Runs fn inside a transaction. fn receives a tx object with query/one.
async function tx(fn) {
  if (kind === 'postgres') {
    const c = await client.connect();
    try {
      await c.query('BEGIN');
      const t = {
        query: async (s, p = []) => { const r = await c.query(s, p); return { rows: r.rows, rowCount: r.rowCount }; },
        one: async (s, p = []) => (await c.query(s, p)).rows[0] || null,
      };
      const out = await fn(t);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  return client.transaction(async (c) => {
    const t = {
      query: async (s, p = []) => { const r = await c.query(s, p); return { rows: r.rows, rowCount: r.affectedRows }; },
      one: async (s, p = []) => (await c.query(s, p)).rows[0] || null,
    };
    return fn(t);
  });
}

async function migrate() {
  const statements = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'rider',
    wallet_balance INTEGER NOT NULL DEFAULT 0,
    rating_sum INTEGER NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    emergency_contact TEXT,
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS drivers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    vehicle_type TEXT NOT NULL,
    services TEXT NOT NULL,
    plate TEXT NOT NULL,
    vehicle_make TEXT,
    vehicle_color TEXT,
    license_no TEXT,
    momo_number TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    earnings_balance INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS trips (
    id SERIAL PRIMARY KEY,
    rider_id INTEGER NOT NULL REFERENCES users(id),
    driver_id INTEGER REFERENCES users(id),
    service TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    pickup_address TEXT,
    drop_lat DOUBLE PRECISION NOT NULL,
    drop_lng DOUBLE PRECISION NOT NULL,
    drop_address TEXT,
    distance_km DOUBLE PRECISION NOT NULL,
    duration_min DOUBLE PRECISION NOT NULL,
    fare INTEGER NOT NULL,
    commission INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    pin TEXT NOT NULL,
    share_token TEXT NOT NULL,
    parcel TEXT,
    notes TEXT,
    rider_rating INTEGER,
    driver_rating INTEGER,
    cancelled_by TEXT,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS trips_rider_idx ON trips(rider_id);
  CREATE INDEX IF NOT EXISTS trips_driver_idx ON trips(driver_id);
  CREATE INDEX IF NOT EXISTS trips_status_idx ON trips(status);
  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    trip_id INTEGER,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS payments (
    tx_ref TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    purpose TEXT NOT NULL,
    trip_id INTEGER,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    momo_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS sos_alerts (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER,
    user_id INTEGER NOT NULL REFERENCES users(id),
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE users ADD COLUMN IF NOT EXISTS saved_places TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_pref TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_phone TEXT;
  CREATE TABLE IF NOT EXISTS driver_docs (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, kind)
  );
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS discount INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS promo_code TEXT;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS promo_label TEXT;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS tip INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS tip_method TEXT;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS passenger TEXT;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS drop_code TEXT;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS points_earned INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime_points INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code ON users(referral_code);
  CREATE TABLE IF NOT EXISTS promos (
    code TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'percent',
    value INTEGER NOT NULL,
    max_discount INTEGER,
    min_fare INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER,
    per_user INTEGER NOT NULL DEFAULT 1,
    first_ride_only BOOLEAN NOT NULL DEFAULT FALSE,
    services TEXT,
    expires_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS otp_codes (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at BIGINT NOT NULL,
    hour_start BIGINT NOT NULL,
    sends_hour INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS app_keys (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS push_user_idx ON push_subscriptions(user_id);
  CREATE TABLE IF NOT EXISTS driver_events (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL,
    trip_id INTEGER,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS driver_events_idx ON driver_events(driver_id, created_at);
  CREATE TABLE IF NOT EXISTS bonus_payouts (
    driver_id INTEGER NOT NULL,
    bonus_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (driver_id, bonus_id, period_key)
  );
  ALTER TABLE driver_docs ADD COLUMN IF NOT EXISTS expires_on DATE;
  ALTER TABLE drivers ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION;
  ALTER TABLE drivers ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION;
  ALTER TABLE drivers ADD COLUMN IF NOT EXISTS home_address TEXT;
  ALTER TABLE drivers ADD COLUMN IF NOT EXISTS home_uses_day TEXT;
  ALTER TABLE drivers ADD COLUMN IF NOT EXISTS home_uses INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS no_show_fee INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS driver_changes (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS driver_changes_idx ON driver_changes(status, driver_id);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_lock BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_receipts BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE trips ADD COLUMN IF NOT EXISTS receipt_sent_at TIMESTAMPTZ;
  CREATE TABLE IF NOT EXISTS email_codes (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at BIGINT NOT NULL,
    hour_start BIGINT NOT NULL,
    sends_hour INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS passkeys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cred_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    transports TEXT,
    device TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys(user_id);
  CREATE TABLE IF NOT EXISTS trip_issues (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    kind TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    reply TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS trip_issues_idx ON trip_issues(status, trip_id);
  CREATE TABLE IF NOT EXISTS driver_reports (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER NOT NULL,
    driver_id INTEGER NOT NULL,
    rider_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    note TEXT,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    dismissed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trip_id, rider_id, kind)
  );
  CREATE INDEX IF NOT EXISTS driver_reports_idx ON driver_reports(driver_id, created_at)`;
  for (const s of statements.split(';').map((x) => x.trim()).filter(Boolean)) {
    await query(s);
  }
}

module.exports = { connect, query, one, tx, get kind() { return kind; } };
