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
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`;
  for (const s of statements.split(';').map((x) => x.trim()).filter(Boolean)) {
    await query(s);
  }
}

module.exports = { connect, query, one, tx, get kind() { return kind; } };
