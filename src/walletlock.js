// Wallet lock: riders can require their fingerprint or face (the phone's own screen lock, via
// passkeys / WebAuthn) before money leaves their Flytte Wallet. The server checks the signature,
// so the lock can't be skipped by changing the app. A code sent to the phone is the fallback
// (new phone, or the fingerprint sensor isn't available).
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const db = require('./db');
const auth = require('./auth');

const challenges = new Map(); // userId -> { challenge, kind, at }
const CH_TTL = 5 * 60e3;
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// The site the passkey belongs to: this app's own address (passkeys are tied to the domain).
function site(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  const origin = `${proto}://${host}`;
  return { origin, rpID: host.replace(/:\d+$/, '') };
}
function takeChallenge(userId, kind) {
  const c = challenges.get(userId);
  challenges.delete(userId);
  return c && c.kind === kind && Date.now() - c.at < CH_TTL ? c.challenge : null;
}

async function registrationOptions(req) {
  const u = req.user, { rpID } = site(req);
  const { rows } = await db.query('SELECT cred_id, transports FROM passkeys WHERE user_id = $1', [u.id]);
  const opts = await generateRegistrationOptions({
    rpName: 'Flytte', rpID,
    userID: new TextEncoder().encode(`flytte-${u.id}`),
    userName: u.phone, userDisplayName: u.name || u.phone,
    attestationType: 'none',
    excludeCredentials: rows.map((r) => ({ id: r.cred_id, transports: r.transports ? r.transports.split(',') : undefined })),
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
  });
  challenges.set(u.id, { challenge: opts.challenge, kind: 'reg', at: Date.now() });
  return opts;
}

async function register(req) {
  const u = req.user, { origin, rpID } = site(req);
  const expectedChallenge = takeChallenge(u.id, 'reg');
  if (!expectedChallenge) throw Object.assign(new Error('That took too long. Try again.'), { status: 400 });
  const v = await verifyRegistrationResponse({ response: (req.body || {}).credential, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  if (!v.verified || !v.registrationInfo) throw Object.assign(new Error('Your phone couldn’t confirm it’s you. Try again.'), { status: 400 });
  const c = v.registrationInfo.credential;
  const device = String((req.body || {}).device || '').slice(0, 60) || null;
  await db.query(`INSERT INTO passkeys(user_id, cred_id, public_key, counter, transports, device) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (cred_id) DO UPDATE SET user_id = $1, public_key = $3, counter = $4`,
  [u.id, c.id, b64u(c.publicKey), c.counter || 0, (c.transports || []).join(',') || null, device]);
  await db.query('UPDATE users SET wallet_lock = TRUE WHERE id = $1', [u.id]);
  return { ok: true, pass: auth.signWalletPass(u.id) };
}

async function authOptions(req) {
  const u = req.user, { rpID } = site(req);
  const { rows } = await db.query('SELECT cred_id, transports FROM passkeys WHERE user_id = $1', [u.id]);
  if (!rows.length) return { none: true };
  const opts = await generateAuthenticationOptions({
    rpID, userVerification: 'required',
    allowCredentials: rows.map((r) => ({ id: r.cred_id, transports: r.transports ? r.transports.split(',') : undefined })),
  });
  challenges.set(u.id, { challenge: opts.challenge, kind: 'auth', at: Date.now() });
  return opts;
}

async function authenticate(req) {
  const u = req.user, { origin, rpID } = site(req);
  const cred = (req.body || {}).credential || {};
  const expectedChallenge = takeChallenge(u.id, 'auth');
  if (!expectedChallenge) throw Object.assign(new Error('That took too long. Try again.'), { status: 400 });
  const row = await db.one('SELECT * FROM passkeys WHERE user_id = $1 AND cred_id = $2', [u.id, String(cred.id || '')]);
  if (!row) throw Object.assign(new Error('This phone isn’t set up for your wallet lock. Use a code instead.'), { status: 400, code: 'NO_PASSKEY' });
  const v = await verifyAuthenticationResponse({
    response: cred, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    credential: { id: row.cred_id, publicKey: Buffer.from(row.public_key, 'base64url'), counter: Number(row.counter) || 0, transports: row.transports ? row.transports.split(',') : undefined },
  });
  if (!v.verified) throw Object.assign(new Error('Your phone couldn’t confirm it’s you. Try again.'), { status: 400 });
  await db.query('UPDATE passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2', [v.authenticationInfo.newCounter || 0, row.id]);
  return { ok: true, pass: auth.signWalletPass(u.id) };
}

async function status(userId) {
  const u = await db.one('SELECT wallet_lock FROM users WHERE id = $1', [userId]);
  const { rows } = await db.query('SELECT id, device, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY id', [userId]);
  return { enabled: !!(u && u.wallet_lock), devices: rows.map((r) => ({ id: r.id, device: r.device, addedAt: r.created_at, lastUsedAt: r.last_used_at })) };
}

async function turnOff(userId) {
  await db.query('DELETE FROM passkeys WHERE user_id = $1', [userId]);
  await db.query('UPDATE users SET wallet_lock = FALSE WHERE id = $1', [userId]);
}

// Rider actions that spend wallet money call this. Locked wallets need a fresh pass.
function needsPass(user, pass) { return !!user.wallet_lock && !auth.verifyWalletPass(pass, user.id); }

module.exports = { registrationOptions, register, authOptions, authenticate, status, turnOff, needsPass, _challenges: challenges };
