const jwt = require('jsonwebtoken');
const db = require('./db');

const DEV_SECRET = 'dev-only-secret-change-me';
const SECRET = process.env.JWT_SECRET || DEV_SECRET;
const LIVE = !!process.env.DATABASE_URL || process.env.NODE_ENV === 'production';
// Anyone who knows the development secret could sign themselves in as an admin,
// so a live server refuses to start without a real one.
if (LIVE && SECRET === DEV_SECRET) {
  throw new Error('JWT_SECRET is not set. Add a long random value in the server environment (Railway → Variables).');
}
if (LIVE && SECRET.length < 24) console.warn('⚠️  JWT_SECRET is short. Use 32+ random characters.');

// Sessions stay signed in until the person logs out: a token lasts 180 days and is renewed
// (sliding) whenever the app is used, so an active rider or driver is never signed out.
const SESSION_DAYS = 180;
// `sid` names the session (one per signed-in phone), so the rider can see and sign out their devices.
function sign(user, sid) {
  return jwt.sign({ id: user.id, role: user.role, ...(sid ? { sid } : {}) }, SECRET, { expiresIn: SESSION_DAYS + 'd' });
}
// "Android phone · Chrome", "iPhone · Safari": enough to recognise a device, nothing more.
function deviceName(ua = '') {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : /Linux/.test(ua) ? 'Linux computer' : 'Device';
  const br = /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /OPR\/|Opera/.test(ua) ? 'Opera' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}
// A copy of the session in an HttpOnly cookie, so the app can sign back in by itself if the
// phone clears the app's saved data (iOS does this to web apps). One per app role.
const cookieName = (role) => 'fs_' + (['rider', 'driver', 'admin'].includes(role) ? role : 'rider');
function readCookie(req, name) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setSessionCookie(req, res, user, token) {
  const secure = (req.headers['x-forwarded-proto'] || req.protocol) === 'https';
  res.append('Set-Cookie', `${cookieName(user.role)}=${encodeURIComponent(token)}; Path=/api/auth; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}
function clearSessionCookie(req, res, role) {
  res.append('Set-Cookie', `${cookieName(role)}=; Path=/api/auth; Max-Age=0; HttpOnly; SameSite=Lax`);
}
// Issue a session: the token for the app, plus the cookie copy.
function issue(req, res, user) {
  const sid = require('crypto').randomBytes(12).toString('base64url');
  db.query('INSERT INTO sessions(id, user_id, device) VALUES ($1,$2,$3)', [sid, user.id, deviceName(String(req.headers['user-agent'] || ''))]).catch(() => {});
  const token = sign(user, sid); setSessionCookie(req, res, user, token); return token;
}

// Short-lived proof that someone entered the SMS code for this phone (used to finish signing up).
function signPhone(phone) { return jwt.sign({ phone, purpose: 'phone' }, SECRET, { expiresIn: '30m' }); }
function verifyPhone(token, phone) { try { const p = jwt.verify(String(token || ''), SECRET); return p.purpose === 'phone' && p.phone === phone; } catch { return false; } }
// Codes are stored only as a keyed hash.
// Wallet pass: proof the rider unlocked the wallet (fingerprint, face, or a code) in the last 2 minutes.
function signWalletPass(userId) { return jwt.sign({ id: userId, purpose: 'wallet' }, SECRET, { expiresIn: '2m' }); }
function verifyWalletPass(token, userId) { try { const p = jwt.verify(String(token || ''), SECRET); return p.purpose === 'wallet' && p.id === userId; } catch { return false; } }
function hashCode(phone, code) { return require('crypto').createHmac('sha256', SECRET).update(phone + ':' + code).digest('hex'); }

function verify(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

// Countries Flytte serves. Numbers are stored as +<country code><9-digit national number>.
// Uganda also accepts fixed lines (020x Airtel, 031x/039x MTN, 041x UTL, other area codes).
const COUNTRIES = {
  256: { id: 'UG', re: /^(7\d{8}|[234]\d{8})$/ },
  254: { id: 'KE', re: /^[17]\d{8}$/ },
  255: { id: 'TZ', re: /^[67]\d{8}$/ },
  250: { id: 'RW', re: /^7[2389]\d{7}$/ },
};
// The country code of a stored number (Uganda for anything unknown).
function ccOf(phone) { const d = String(phone || '').replace(/\D/g, ''); return Object.keys(COUNTRIES).find((c) => d.startsWith(c) && d.length === c.length + 9) || '256'; }
// Accepts +254712345678, 254712345678, 00254…, or a local number (0712 345 678) in defaultCc's country.
function normalizePhone(raw, defaultCc = '256') {
  const s = String(raw || '').trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (s.startsWith('00')) d = d.slice(2);
  let cc = Object.keys(COUNTRIES).find((c) => d.startsWith(c) && d.length === c.length + 9);
  let nsn;
  if (cc) nsn = d.slice(cc.length);
  else { cc = COUNTRIES[defaultCc] ? String(defaultCc) : '256'; nsn = d.startsWith('0') ? d.slice(1) : d; }
  if (!COUNTRIES[cc].re.test(nsn)) return null;
  return '+' + cc + nsn;
}

function requireAuth(...roles) {
  return async (req, res, next) => {
    const h = req.headers.authorization || '';
    const payload = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
    // code SESSION tells the app the sign-in itself is no longer valid (only then does it sign out).
    if (!payload || payload.purpose) return res.status(401).json({ error: 'Please sign in again.', code: 'SESSION' });
    const user = await db.one('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (!user || user.deleted_at) return res.status(401).json({ error: 'Account not found.', code: 'SESSION' });
    // Signed out from another device: a revoked session, or an older sign-in without a session id.
    if (payload.sid) {
      const s = await db.one('SELECT revoked, last_seen, device FROM sessions WHERE id = $1', [payload.sid]);
      if (s && s.revoked) return res.status(401).json({ error: 'You were signed out on this phone. Sign in again.', code: 'SESSION' });
      if (s && Date.now() - new Date(s.last_seen).getTime() > 10 * 60e3) db.query('UPDATE sessions SET last_seen = NOW() WHERE id = $1', [payload.sid]).catch(() => {});
      // Signed in where the device couldn't be told (e.g. a restored session): name it once it's known.
      if (s && s.device === 'Device') { const dn = deviceName(String(req.headers['user-agent'] || '')); if (dn !== 'Device') db.query('UPDATE sessions SET device = $1 WHERE id = $2', [dn, payload.sid]).catch(() => {}); }
    } else if (user.signed_out_before && payload.iat * 1000 < new Date(user.signed_out_before).getTime()) {
      return res.status(401).json({ error: 'You were signed out on this phone. Sign in again.', code: 'SESSION' });
    }
    req.sid = payload.sid || null;
    // Renew a session that's more than a day old, so it never runs out while the app is in use.
    if (payload.iat && Date.now() / 1000 - payload.iat > 86400) {
      const token = sign(user, payload.sid);
      res.set('X-Session-Token', token);
      setSessionCookie(req, res, user, token);
    }
    if (user.blocked) return res.status(403).json({ error: 'This account is suspended. Contact support.' });
    if (roles.length && !roles.includes(user.role)) return res.status(403).json({ error: 'Not allowed.' });
    req.user = user;
    next();
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role,
    walletBalance: u.wallet_balance,
    rating: u.rating_count ? Math.round((u.rating_sum / u.rating_count) * 10) / 10 : null,
    emergencyContact: u.emergency_contact,
    savedPlaces: (() => { try { return JSON.parse(u.saved_places || '{}'); } catch { return {}; } })(),
    payPref: u.pay_pref || 'cash', payPhone: u.pay_phone || u.phone,
    walletLock: !!u.wallet_lock,
    emailVerified: !!u.email_verified, emailReceipts: u.email_receipts !== false,
    photo: u.photo || null,
    ridePrefs: (() => { try { return JSON.parse(u.ride_prefs || '{}'); } catch { return {}; } })(),
    nightShare: (() => { try { return JSON.parse(u.night_share || 'null') || { on: false, from: '21:00' }; } catch { return { on: false, from: '21:00' }; } })(),
    memberSince: u.created_at,
  };
}

module.exports = { deviceName, sign, issue, readCookie, cookieName, clearSessionCookie, verify, requireAuth, normalizePhone, ccOf, COUNTRIES, publicUser, signPhone, verifyPhone, hashCode, signWalletPass, verifyWalletPass };
