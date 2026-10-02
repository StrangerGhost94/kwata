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

async function seedAdmin() {
  const phone = auth.normalizePhone(process.env.ADMIN_PHONE || '0700000000');
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  if (!process.env.ADMIN_PASSWORD) console.warn('⚠️  Using default admin login 0700000000 / admin123 — set ADMIN_PHONE and ADMIN_PASSWORD.');
  const existing = await db.one('SELECT id FROM users WHERE phone = $1', [phone]);
  if (!existing) {
    await db.query("INSERT INTO users(name, phone, password_hash, role) VALUES ('Kwata Admin', $1, $2, 'admin')",
      [phone, await bcrypt.hash(password, 10)]);
    console.log(`Admin account created for ${phone}`);
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
