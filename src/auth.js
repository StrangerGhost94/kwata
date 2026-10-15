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

function verify(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

// Normalise Ugandan phone numbers to +2567XXXXXXXX
function normalizePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '256' + p.slice(1);
  if (p.length === 9 && p.startsWith('7')) p = '256' + p;
  if (!/^2567\d{8}$/.test(p)) return null;
  return '+' + p;
}

function requireAuth(...roles) {
  return async (req, res, next) => {
    const h = req.headers.authorization || '';
    const payload = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
    if (!payload) return res.status(401).json({ error: 'Please sign in again.' });
    const user = await db.one('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (!user) return res.status(401).json({ error: 'Account not found.' });
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

module.exports = { sign, verify, requireAuth, normalizePhone, publicUser };
