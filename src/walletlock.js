// Wallet security. Money only leaves a rider's Flytte Wallet after they prove it's them, every
// time, like mobile money:
//   - a 4-digit Wallet PIN (everyone; it can't be switched off), or
//   - their fingerprint / face on a phone they've set up (passkeys on the web, the phone's secure
//     storage in the store apps). Setting that up needs the PIN first.
// The server checks the proof and hands back a short-lived "wallet pass" that the paying request
// must carry, so the lock can't be skipped by changing the app. Five wrong PINs lock the wallet
// for 15 minutes. A forgotten PIN is reset with a code sent to the phone; a code alone never pays.
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

// ---------- Store apps: the phone's own biometric secure storage ----------
// Passkeys don't work in every app web view, so the store app keeps a random secret in the phone's
// Keychain / Keystore that only opens after a live fingerprint or face check (public/js/native.js).
// The server keeps only a hash of it. Each install is its own "device".
const hashSecret = (s) => require('crypto').createHash('sha256').update(String(s)).digest('hex');
const validDevice = (b) => /^[0-9a-f]{32,64}$/.test(String(b.deviceId || '')) && /^[0-9a-f]{64}$/.test(String(b.secret || ''));
async function registerDevice(req) {
  const u = req.user, b = req.body || {};
  if (!validDevice(b)) throw Object.assign(new Error('This phone couldn’t be set up. Try again.'), { status: 400 });
  const device = String(b.device || '').slice(0, 60) || null;
  await db.query(`INSERT INTO wallet_devices(user_id, device_id, secret_hash, device) VALUES ($1,$2,$3,$4)
    ON CONFLICT (device_id) DO UPDATE SET user_id = $1, secret_hash = $3, device = $4, created_at = NOW()`, [u.id, b.deviceId, hashSecret(b.secret), device]);
  await db.query('UPDATE users SET wallet_lock = TRUE WHERE id = $1', [u.id]);
  return { ok: true, pass: auth.signWalletPass(u.id) };
}
async function unlockDevice(req) {
  const u = req.user, b = req.body || {};
  const row = validDevice(b) && await db.one('SELECT * FROM wallet_devices WHERE user_id = $1 AND device_id = $2', [u.id, b.deviceId]);
  if (!row) throw Object.assign(new Error('This phone isn’t set up for your wallet lock. Use a code instead.'), { status: 400, code: 'NO_DEVICE' });
  const a = Buffer.from(hashSecret(b.secret)), c = Buffer.from(row.secret_hash);
  if (a.length !== c.length || !require('crypto').timingSafeEqual(a, c)) throw Object.assign(new Error('Your phone couldn’t confirm it’s you. Use a code instead.'), { status: 400 });
  await db.query('UPDATE wallet_devices SET last_used_at = NOW() WHERE id = $1', [row.id]);
  return { ok: true, pass: auth.signWalletPass(u.id) };
}

async function status(userId) {
  const u = await db.one('SELECT wallet_lock, wallet_pin_hash, wallet_pin_locked_until, wallet_pin_set_at FROM users WHERE id = $1', [userId]);
  const { rows } = await db.query('SELECT id, device, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY id', [userId]);
  const { rows: apps } = await db.query('SELECT id, device, created_at, last_used_at FROM wallet_devices WHERE user_id = $1 ORDER BY id', [userId]);
  return { pinSet: !!(u && u.wallet_pin_hash), pinSetAt: u && u.wallet_pin_set_at, lockedMinutes: u ? lockedFor(u) : 0,
    enabled: !!(u && u.wallet_lock), devices: [...rows, ...apps].map((r) => ({ id: r.id, device: r.device, addedAt: r.created_at, lastUsedAt: r.last_used_at })) };
}

// Turns fingerprint / face off on every phone. The PIN stays: it can't be switched off.
const turnOff = clearBiometrics;

// ---------- Wallet PIN ----------
const bcrypt = require('bcryptjs');
const PIN_TRIES = 5, PIN_LOCK_MS = 15 * 60e3, NEW_ACCOUNT_MS = 30 * 60e3;
const err = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
// PINs anyone would try first: all the same digit, straight runs, and the usual suspects.
function weakPin(pin) {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  if ('0123456789012'.includes(pin) || '9876543210987'.includes(pin)) return true;
  if (/^(19[4-9]\d|20[0-2]\d)$/.test(pin)) return true;   // a year, most often a birth year
  return ['1212', '2580', '1004', '2000', '1122', '6969', '1313', '2001', '2020', '2024', '2025', '2026'].includes(pin);
}
const lockedFor = (u) => (u.wallet_pin_locked_until && new Date(u.wallet_pin_locked_until).getTime() > Date.now()
  ? Math.ceil((new Date(u.wallet_pin_locked_until).getTime() - Date.now()) / 60000) : 0);

// Create, change or reset the PIN. { pin, pass?, codeOk? }:
//  - no PIN yet: allowed for a brand-new account, otherwise needs the code sent to the phone
//  - changing: needs a wallet pass (the current PIN or fingerprint), or the code (forgotten PIN)
// `codeOk` is true when the route has already checked a one-time code for this phone.
async function setPin(user, { pin, pass, codeOk }) {
  pin = String(pin || '');
  if (!/^\d{4}$/.test(pin)) throw err('Choose a 4-digit PIN.');
  if (weakPin(pin)) throw err('That PIN is too easy to guess. Choose another.');
  const had = !!user.wallet_pin_hash;
  const fresh = !had && Date.now() - new Date(user.created_at).getTime() < NEW_ACCOUNT_MS;
  if (!codeOk && !fresh && !(had && auth.verifyWalletPass(pass, user.id))) throw err('Confirm it’s you with the code we send to your phone.', 403, 'NEED_CODE');
  if (had && await bcrypt.compare(pin, user.wallet_pin_hash)) throw err('That’s your current PIN. Choose a different one.');
  await db.query('UPDATE users SET wallet_pin_hash = $1, wallet_pin_fails = 0, wallet_pin_locked_until = NULL, wallet_pin_set_at = NOW() WHERE id = $2', [await bcrypt.hash(pin, 10), user.id]);
  // A reset by code also clears fingerprint set-ups: whoever reset it starts clean on this phone.
  if (had && codeOk) await clearBiometrics(user.id);
  return { ok: true, pass: auth.signWalletPass(user.id), changed: had };
}

// Checks the PIN and gives a wallet pass. Wrong PINs count; five lock the wallet for 15 minutes.
async function unlockPin(user, pin) {
  if (!user.wallet_pin_hash) throw err('Create your Wallet PIN first.', 403, 'WALLET_SETUP');
  const mins = lockedFor(user);
  if (mins) throw err(`Too many wrong PINs. Your wallet is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`, 429, 'PIN_LOCKED');
  if (!/^\d{4}$/.test(String(pin || '')) || !(await bcrypt.compare(String(pin), user.wallet_pin_hash))) {
    const fails = (user.wallet_pin_fails || 0) + 1, lock = fails >= PIN_TRIES;
    await db.query('UPDATE users SET wallet_pin_fails = $1, wallet_pin_locked_until = $2 WHERE id = $3', [lock ? 0 : fails, lock ? new Date(Date.now() + PIN_LOCK_MS) : null, user.id]);
    if (lock) throw err('Too many wrong PINs. Your wallet is locked for 15 minutes.', 429, 'PIN_LOCKED');
    const left = PIN_TRIES - fails;
    throw err(`Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 400, 'PIN_WRONG');
  }
  if (user.wallet_pin_fails) await db.query('UPDATE users SET wallet_pin_fails = 0, wallet_pin_locked_until = NULL WHERE id = $1', [user.id]);
  return { ok: true, pass: auth.signWalletPass(user.id) };
}

async function clearBiometrics(userId) {
  await db.query('DELETE FROM passkeys WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM wallet_devices WHERE user_id = $1', [userId]);
  await db.query('UPDATE users SET wallet_lock = FALSE WHERE id = $1', [userId]);
}

// Everything that spends wallet money calls this: a fresh wallet pass is always needed.
function needsPass(user, pass) { return !auth.verifyWalletPass(pass, user.id); }

module.exports = { registrationOptions, register, authOptions, authenticate, registerDevice, unlockDevice, status, turnOff, needsPass, setPin, unlockPin, weakPin, _challenges: challenges };
