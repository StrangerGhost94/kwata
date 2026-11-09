// Native push for the store apps, through Firebase Cloud Messaging (HTTP v1).
// FCM delivers to Android phones and, through Apple's push service, to iPhones. The web app keeps
// using Web Push (src/drivers.js); a user can have both, and every alert goes to all of them.
//
// Set FIREBASE_SERVICE_ACCOUNT in Railway → Variables to the service-account JSON from
// Firebase console → Project settings → Service accounts → Generate new private key
// (the whole JSON, or the same JSON base64-encoded). Without it, native alerts are simply not sent.
const jwt = require('jsonwebtoken');
const db = require('./db');

let account, accountErr = false;
function serviceAccount() {
  if (account || accountErr) return account;
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const a = JSON.parse(json);
    if (!a.project_id || !a.client_email || !a.private_key) throw new Error('missing project_id, client_email or private_key');
    account = a;
  } catch (e) { accountErr = true; console.error('FIREBASE_SERVICE_ACCOUNT is not valid:', e.message); }
  return account;
}
const configured = () => !!serviceAccount();

// Google OAuth access token from the service account, cached until shortly before it runs out.
let access = null;
async function accessToken() {
  if (access && access.until > Date.now() + 60e3) return access.token;
  const a = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 },
    a.private_key, { algorithm: 'RS256' });
  const r = await fetch(process.env.FCM_TOKEN_URL || 'https://oauth2.googleapis.com/token', {   // overridable for tests
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10000),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.access_token) throw new Error('Firebase sign-in failed: ' + (out.error_description || out.error || r.status));
  access = { token: out.access_token, until: Date.now() + (out.expires_in || 3600) * 1000 };
  return access.token;
}

// ---------- device tokens ----------
async function register(userId, token, platform, app) {
  token = String(token || '').trim();
  if (!/^[\w:.\-]{20,4096}$/.test(token)) return false;
  platform = ['ios', 'android'].includes(platform) ? platform : 'android';
  app = app === 'driver' ? 'driver' : 'rider';
  await db.query(`INSERT INTO native_push_tokens(user_id, token, platform, app) VALUES ($1,$2,$3,$4)
    ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, app = EXCLUDED.app, updated_at = NOW()`,
  [userId, token, platform, app]);
  return true;
}
async function remove(userId, token) {
  if (token) await db.query('DELETE FROM native_push_tokens WHERE user_id = $1 AND token = $2', [userId, String(token)]);
  else await db.query('DELETE FROM native_push_tokens WHERE user_id = $1', [userId]);
}
async function has(userId) {
  return !!(await db.one('SELECT 1 AS x FROM native_push_tokens WHERE user_id = $1 LIMIT 1', [userId]));
}

// The FCM message for one device. Ride requests use their own Android channel (set up by the
// driver app with a loud sound) and Apple's time-sensitive level, so they get through Focus modes.
function message(token, platform, payload, { ttl, urgency }) {
  const data = {};
  for (const [k, v] of Object.entries(payload)) if (v != null) data[k] = typeof v === 'string' ? v : JSON.stringify(v);
  const offer = payload.type === 'offer';
  const high = urgency === 'high';
  const msg = { token, data, notification: { title: String(payload.title || 'Flytte'), body: String(payload.body || '') } };
  if (platform === 'android') {
    msg.android = { priority: high ? 'HIGH' : 'NORMAL', ttl: `${Math.max(0, Math.round(ttl))}s`,
      notification: { channel_id: offer ? 'ride_requests' : 'trip_updates', tag: payload.tag || undefined, sound: 'default', default_vibrate_timings: true } };
  } else {
    msg.apns = {
      headers: { 'apns-priority': high ? '10' : '5', 'apns-expiration': String(Math.floor(Date.now() / 1000) + Math.round(ttl)), ...(payload.tag ? { 'apns-collapse-id': String(payload.tag).slice(0, 64) } : {}) },
      payload: { aps: { sound: 'default', 'thread-id': payload.tag || 'flytte', ...(offer ? { 'interruption-level': 'time-sensitive' } : {}) } },
    };
  }
  return { message: msg };
}

// Sends to every store-app install of this user. Tokens Firebase says are gone are removed.
async function send(userId, payload, { ttl = 60, urgency = 'high' } = {}) {
  if (!configured()) return 0;
  const { rows } = await db.query('SELECT id, token, platform FROM native_push_tokens WHERE user_id = $1', [userId]);
  if (!rows.length) return 0;
  let token;
  try { token = await accessToken(); } catch (e) { console.error('fcm', e.message); return 0; }
  const url = `${process.env.FCM_API_BASE || 'https://fcm.googleapis.com'}/v1/projects/${serviceAccount().project_id}/messages:send`;
  let sent = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(message(row.token, row.platform, payload, { ttl, urgency })), signal: AbortSignal.timeout(10000) });
      if (r.ok) { sent++; return; }
      const err = await r.json().catch(() => ({}));
      const code = ((err.error && err.error.details) || []).map((d) => d.errorCode).find(Boolean) || (err.error && err.error.status);
      if (r.status === 404 || code === 'UNREGISTERED') await db.query('DELETE FROM native_push_tokens WHERE id = $1', [row.id]).catch(() => {});
      else console.error('fcm send failed', r.status, code || '');
    } catch (e) { console.error('fcm send failed', e.message); }
  }));
  return sent;
}

module.exports = { configured, register, remove, has, send, message };
