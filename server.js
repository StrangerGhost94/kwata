require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./src/db');
const rt = require('./src/realtime');
const auth = require('./src/auth');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, db: db.kind }));
app.use('/api', require('./src/routes'));
app.get('/t/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules', 'leaflet', 'dist'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const DEFAULT_ADMIN_PHONE = '+256700000000';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

async function seedAdmin() {
  const live = !!process.env.DATABASE_URL;
  const envPhone = process.env.ADMIN_PHONE && auth.normalizePhone(process.env.ADMIN_PHONE);
  const envPass = process.env.ADMIN_PASSWORD;

  if (envPhone && envPass) {
    // The admin in Railway's variables is the source of truth: create it, or
    // update its password if you change ADMIN_PASSWORD later.
    const hash = await bcrypt.hash(envPass, 10);
    const existing = await db.one('SELECT id FROM users WHERE phone = $1', [envPhone]);
    if (existing) await db.query("UPDATE users SET role = 'admin', password_hash = $1, blocked = FALSE WHERE id = $2", [hash, existing.id]);
    else await db.query("INSERT INTO users(name, phone, password_hash, role) VALUES ('Kwata Admin', $1, $2, 'admin')", [envPhone, hash]);
    console.log(`Admin account ready for ${envPhone}`);
  } else if (live) {
    console.warn('⚠️  ADMIN_PHONE and ADMIN_PASSWORD are not set, so no admin account was created.');
  }

  // Remove the public test admin from any live database.
  if (live || envPhone) {
    const def = await db.one("SELECT id, password_hash FROM users WHERE phone = $1 AND role = 'admin'", [DEFAULT_ADMIN_PHONE]);
    if (def && def.id && (!envPhone || envPhone !== DEFAULT_ADMIN_PHONE) && await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, def.password_hash)) {
      try { await db.query('DELETE FROM users WHERE id = $1', [def.id]); }
      catch { await db.query("UPDATE users SET blocked = TRUE, role = 'rider' WHERE id = $1", [def.id]); }
      console.log('Removed the default test admin account.');
    }
    return;
  }

  // Local development only: a known test admin so you can try the console.
  const existing = await db.one('SELECT id FROM users WHERE phone = $1', [DEFAULT_ADMIN_PHONE]);
  if (!existing) {
    await db.query("INSERT INTO users(name, phone, password_hash, role) VALUES ('Kwata Admin', $1, $2, 'admin')",
      [DEFAULT_ADMIN_PHONE, await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10)]);
    console.log('Local test admin: 0700000000 / admin123');
  }
}

async function resumeDispatch() {
  // After a restart: retry waiting requests, expire stale ones.
  await db.query("UPDATE trips SET status = 'no_drivers' WHERE status = 'requested' AND created_at < NOW() - INTERVAL '3 minutes'");
  const { rows } = await db.query("SELECT id FROM trips WHERE status = 'requested'");
  for (const r of rows) setTimeout(() => rt.dispatch(r.id).catch(console.error), 5000);
}

(async () => {
  const kind = await db.connect();
  await seedAdmin();
  const server = http.createServer(app);
  rt.init(server);
  await resumeDispatch();
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`🚀 Kwata running on http://localhost:${port} (database: ${kind})`));
})().catch((e) => { console.error(e); process.exit(1); });
