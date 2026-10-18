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

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '30d' });
}

// Short-lived proof that someone entered the SMS code for this phone (used to finish signing up).
function signPhone(phone) { return jwt.sign({ phone, purpose: 'phone' }, SECRET, { expiresIn: '30m' }); }
function verifyPhone(token, phone) { try { const p = jwt.verify(String(token || ''), SECRET); return p.purpose === 'phone' && p.phone === phone; } catch { return false; } }
// Codes are stored only as a keyed hash.
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
    if (!payload) return res.status(401).json({ error: 'Please sign in again.' });
    const user = await db.one('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (!user || user.deleted_at) return res.status(401).json({ error: 'Account not found.' });
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
  };
}

module.exports = { sign, verify, requireAuth, normalizePhone, ccOf, COUNTRIES, publicUser, signPhone, verifyPhone, hashCode };
