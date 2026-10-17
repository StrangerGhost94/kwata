const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const auth = require('./auth');
const rt = require('./realtime');
const ledger = require('./ledger');
const payments = require('./payments');
const growth = require('./growth');
const dtools = require('./drivers');
const { getSettings, updateSettings, quote } = require('./pricing');
const surge = require('./surge');
const { haversineKm: haversine } = require('./pricing');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
function point(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = Number(p.lat), lng = Number(p.lng);
  // Rough bounding box for East Africa — keeps junk coordinates out.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -12 || lat > 6 || lng < 28 || lng > 42) return null;
  return { lat, lng, address: clean(p.address, 200) || 'Pinned location' };
}
// Pickup and destination must be real, different places.
function route(body, res) {
  const pickup = point(body.pickup), drop = point(body.drop);
  if (!pickup) { bad(res, 'Set your pickup point first.'); return null; }
  if (!drop) { bad(res, 'Choose where you’re going.'); return null; }
  if (haversine(pickup, drop) < 0.05) { bad(res, 'Your pickup and destination are the same place. Choose a different destination.'); return null; }
  return { pickup, drop };
}

// Tiny in-memory rate limiter for login / register
const hits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, arr] of hits) if (!arr.length || now - arr[arr.length - 1] > 30 * 60e3) hits.delete(k); }, 10 * 60e3).unref();
function limit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now); hits.set(key, arr);
    if (arr.length > max) return bad(res, 'Too many attempts. Wait a few minutes.', 429);
    next();
  };
}

// The support line comes from SUPPORT_PHONE or Admin → Pricing. The old built-in
// placeholder (+256 700 000000) is not a real line, so it counts as "not set".
function supportPhone(s) {
  const env = String(process.env.SUPPORT_PHONE || '').trim();
  const v = (env && /^\+?[0-9][0-9 ]{7,17}$/.test(env) ? env : String(s.supportPhone || '')).trim();
  const digits = v.replace(/\D/g, '').replace(/^256/, '').replace(/^0/, '');
  return !v || digits === '700000000' ? null : v;
}

// ---------- Public ----------
r.get('/config', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({
    services: Object.entries(s.services).filter(([, v]) => v.enabled).map(([id, v]) => ({ id, name: v.name, icon: v.icon, vehicle: v.vehicle, seats: v.seats, blurb: v.blurb })),
    paymentsLive: payments.enabled(),            // real Flutterwave payments
    paymentsAvailable: payments.available(),     // Mobile Money / card / top-ups can be used (live or local demo)
    paymentsDemo: payments.demo(),
    commissionPct: s.commissionPct,
    supportPhone: supportPhone(s),
    minWithdrawal: s.minWithdrawal,
    growth: { firstRide: s.growth.firstRide, referral: s.growth.referral, rewards: s.growth.rewards },
    drivers: { freeWaitMin: s.drivers.freeWaitMin, noShowFee: s.drivers.noShowFee, cashDebtLimit: s.drivers.cashDebtLimit, headingHomePerDay: s.drivers.headingHomePerDay },
  });
}));

r.get('/track/:token', wrap(async (req, res) => {
  const t = await db.one('SELECT id FROM trips WHERE share_token = $1', [req.params.token]);
  if (!t) return bad(res, 'Trip not found', 404);
  res.json(rt.view(await rt.loadTrip(t.id), 'public'));
}));

// ---------- Auth ----------
// Builds a user (and driver profile) from a form. Returns { error } or { user }.
async function createAccount(body, role, { approved = false } = {}) {
  const { name, phone, password, email } = body || {};
  const p = auth.normalizePhone(phone);
  if (clean(name, 80).length < 2) return { error: 'Enter the full name.' };
  if (!p) return { error: 'Enter a valid Ugandan phone number, e.g. 0772 123456.' };
  if (!password || String(password).length < 6) return { error: 'Password must be at least 6 characters.' };
  if (String(password).length > 72) return { error: 'Password must be 72 characters or fewer.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return { error: 'Enter a valid email address, or leave it empty.' };
  if (await db.one('SELECT id FROM users WHERE phone = $1', [p])) return { error: 'This phone number already has an account.' };

  let driverInfo = null;
  if (role === 'driver') {
    const { vehicleType, plate, vehicleMake, vehicleColor, licenseNo, momoNumber } = body;
    if (!['boda', 'car'].includes(vehicleType)) return { error: 'Choose boda or car.' };
    if (!plate || String(plate).trim().length < 4) return { error: 'Enter the number plate.' };
    if (!licenseNo) return { error: 'Enter the driving permit number.' };
    const s = await getSettings();
    const services = Object.entries(s.services).filter(([, v]) => v.vehicle === vehicleType).map(([id]) => id);
    if (momoNumber && !auth.normalizePhone(momoNumber)) return { error: 'Enter a valid Mobile Money number, or leave it empty to use your phone number.' };
    driverInfo = {
      vehicleType, services: services.join(','), plate: clean(plate, 12).toUpperCase(),
      vehicleMake: clean(vehicleMake, 60), vehicleColor: clean(vehicleColor, 30),
      licenseNo: clean(licenseNo, 40), momo: auth.normalizePhone(momoNumber) || p,
    };
  }

  const hash = await bcrypt.hash(String(password), 10);
  const user = await db.tx(async (t) => {
    const u = await t.one('INSERT INTO users(name, phone, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [clean(name, 80), p, email ? String(email).trim().slice(0, 120) : null, hash, role]);
    if (driverInfo) {
      await t.query(`INSERT INTO drivers(user_id, vehicle_type, services, plate, vehicle_make, vehicle_color, license_no, momo_number, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, driverInfo.vehicleType, driverInfo.services, driverInfo.plate, driverInfo.vehicleMake, driverInfo.vehicleColor, driverInfo.licenseNo, driverInfo.momo, approved ? 'approved' : 'pending']);
    }
    return u;
  });
  return { user };
}

// Riders sign up and ride straight away. Drivers can apply from the driver app,
// but stay 'pending' (can't go online) until the Flytte team checks their
// documents and approves them. The team can also add drivers directly.
r.post('/auth/register', limit(10, 10 * 60e3), wrap(async (req, res) => {
  const role = (req.body || {}).role || 'rider';
  if (!['rider', 'driver'].includes(role)) return bad(res, 'Invalid account type.');
  let referrer = null;
  if (role === 'rider' && req.body.inviteCode) {
    referrer = await growth.userByReferral(req.body.inviteCode);
    if (!referrer) return bad(res, 'That invite code isn’t valid. Check it, or leave it empty.');
  }
  const out = await createAccount(req.body, role);
  if (out.error) return bad(res, out.error);
  if (role === 'rider') {
    if (referrer) await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [referrer.id, out.user.id]);
    out.user.referral_code = await growth.ensureReferralCode(out.user);
  }
  if (role === 'driver') rt.io.to('admin').emit('admin:new_driver', { id: out.user.id, name: out.user.name });
  res.json({ token: auth.sign(out.user), user: auth.publicUser(out.user) });
}));

// ---------- Driver documents ----------
const DOC_KINDS = { national_id: 'National ID', license: 'Driving permit', vehicle: 'Vehicle photo', photo: 'Profile photo' };
const OPTIONAL_DOCS = { insurance: 'Insurance sticker' };
const ALL_DOCS = { ...DOC_KINDS, ...OPTIONAL_DOCS };
// Expiry dates (YYYY-MM-DD) for the documents that run out.
function expiryDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const t = Date.parse(m[0] + 'T00:00:00Z');
  if (!Number.isFinite(t) || +m[1] < 2000 || +m[1] > 2100) return null;
  return m[0];
}
r.post('/driver/documents/expiry', auth.requireAuth('driver'), wrap(async (req, res) => {
  const { kind } = req.body || {};
  if (!dtools.EXPIRING_KINDS.includes(kind)) return bad(res, 'That document has no expiry date.');
  const exp = expiryDate((req.body || {}).expiresOn);
  if (!exp) return bad(res, 'Choose the expiry date.');
  const row = await db.one('UPDATE driver_docs SET expires_on = $1 WHERE user_id = $2 AND kind = $3 RETURNING kind', [exp, req.user.id, kind]);
  if (!row) return bad(res, 'Upload the document first.');
  res.json({ ok: true });
}));
r.post('/driver/documents', auth.requireAuth('driver'), wrap(async (req, res) => {
  const { kind, image } = req.body || {};
  if (!ALL_DOCS[kind]) return bad(res, 'Unknown document.');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
  if (!m) return bad(res, 'Upload a photo (JPG or PNG).');
  if (m[2].length > 2.8e6) return bad(res, 'That photo is too large. Try again.');
  const dv = await db.one('SELECT status FROM drivers WHERE user_id = $1', [req.user.id]);
  if (kind === 'photo') {
    // Every profile photo, at sign-up too, is checked by the team against the ID before riders see it.
    // A driver who already has an approved photo keeps it until the new one is approved.
    await db.query("UPDATE driver_changes SET status = 'replaced', decided_at = NOW() WHERE driver_id = $1 AND kind = 'photo' AND status = 'pending'", [req.user.id]);
    await db.query("INSERT INTO driver_changes(driver_id, kind, data) VALUES ($1,'photo',$2)", [req.user.id, JSON.stringify({ mime: m[1], data: m[2] })]);
    rt.io.to('admin').emit('admin:change', { id: req.user.id, name: req.user.name, kind: 'photo' });
    return res.json({ ok: true, pending: true });
  }
  if (dv && dv.status === 'approved' && kind === 'vehicle') return bad(res, 'To change your vehicle photo, use “Change vehicle or number plate” on your profile. The Flytte team checks it first.');
  const exp = dtools.EXPIRING_KINDS.includes(kind) ? expiryDate((req.body || {}).expiresOn) : null;
  await db.query(`INSERT INTO driver_docs(user_id, kind, mime, data, expires_on) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (user_id, kind) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, created_at = NOW(), expires_on = COALESCE(EXCLUDED.expires_on, driver_docs.expires_on)`, [req.user.id, kind, m[1], m[2], exp]);
  rt.io.to('admin').emit('admin:new_driver', { id: req.user.id, name: req.user.name });
  res.json({ ok: true });
}));
r.get('/driver/documents', auth.requireAuth('driver'), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT kind, created_at, expires_on FROM driver_docs WHERE user_id = $1', [req.user.id]);
  // A photo waiting for the team's check counts as uploaded, so sign-up can continue.
  if (!rows.some((x) => x.kind === 'photo')) {
    const pend = await db.one("SELECT created_at FROM driver_changes WHERE driver_id = $1 AND kind = 'photo' AND status = 'pending' ORDER BY id DESC LIMIT 1", [req.user.id]);
    if (pend) rows.push({ kind: 'photo', created_at: pend.created_at });
  }
  const day = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
  res.json({ kinds: DOC_KINDS, optional: OPTIONAL_DOCS, expiring: dtools.EXPIRING_KINDS,
    uploaded: Object.fromEntries(rows.map((x) => [x.kind, x.created_at])),
    expires: Object.fromEntries(rows.filter((x) => x.expires_on).map((x) => [x.kind, day(x.expires_on)])) });
}));
// Driver profile photos are shown to riders on the trip screen.
// Only approved drivers' photos are public; applicants' photos stay private.
r.get('/drivers/:id/photo', wrap(async (req, res) => {
  const d = await db.one(`SELECT dd.mime, dd.data FROM driver_docs dd JOIN drivers dr ON dr.user_id = dd.user_id
    WHERE dd.user_id = $1 AND dd.kind = 'photo' AND dr.status = 'approved'`, [Number(req.params.id)]);
  if (!d) return res.status(404).end();
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(Buffer.from(d.data, 'base64'));
}));

r.get('/driver/photo', auth.requireAuth('driver'), wrap(async (req, res) => {
  const d = await db.one("SELECT mime, data FROM driver_docs WHERE user_id = $1 AND kind = 'photo'", [req.user.id]);
  if (d) return res.json({ url: `data:${d.mime};base64,${d.data}`, approved: true });
  // Before the first photo is approved, drivers see the one they sent.
  const p = await db.one("SELECT data FROM driver_changes WHERE driver_id = $1 AND kind = 'photo' AND status = 'pending' ORDER BY id DESC LIMIT 1", [req.user.id]);
  if (!p) return res.json({ url: null });
  const x = JSON.parse(p.data);
  res.json({ url: `data:${x.mime};base64,${x.data}`, approved: false });
}));

// Photo and vehicle changes waiting for the team, or decided in the last two weeks.
r.get('/driver/changes', auth.requireAuth('driver'), wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT id, kind, data, status, note, created_at, decided_at FROM driver_changes
    WHERE driver_id = $1 AND (status = 'pending' OR (status IN ('approved','rejected') AND decided_at > NOW() - INTERVAL '14 days'))
    ORDER BY id DESC`, [req.user.id]);
  const out = {};
  for (const r0 of rows) {
    if (out[r0.kind]) continue; // newest per kind
    const d = JSON.parse(r0.data);
    out[r0.kind] = { id: r0.id, status: r0.status, note: r0.note, at: r0.created_at, decidedAt: r0.decided_at,
      ...(r0.kind === 'photo' ? { url: r0.status === 'pending' ? `data:${d.mime};base64,${d.data}` : undefined } : { plate: d.plate, vehicleMake: d.make, vehicleColor: d.color }) };
  }
  res.json(out);
}));

// Plate (and make/colour) changes go to the team with a live photo of the vehicle showing the plate.
const normPlate = (v) => clean(v, 12).toUpperCase().replace(/\s+/g, ' ');
r.post('/driver/vehicle-change', auth.requireAuth('driver'), wrap(async (req, res) => {
  const b = req.body || {};
  const plate = normPlate(b.plate);
  if (!/^[A-Z0-9 ]{4,12}$/.test(plate) || !/[A-Z]/.test(plate) || !/[0-9]/.test(plate)) return bad(res, 'Enter the number plate exactly as it is on the vehicle, e.g. UFB 123X.');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo || ''));
  if (!m) return bad(res, 'Take a photo of the vehicle with the number plate showing.');
  if (m[2].length > 2.8e6) return bad(res, 'That photo is too large. Try again.');
  const cur = await db.one('SELECT plate, vehicle_make, vehicle_color FROM drivers WHERE user_id = $1', [req.user.id]);
  const make = clean(b.vehicleMake, 40) || cur.vehicle_make || '', color = clean(b.vehicleColor, 20) || cur.vehicle_color || '';
  if (plate === cur.plate && make === (cur.vehicle_make || '') && color === (cur.vehicle_color || '')) return bad(res, 'Nothing has changed.');
  await db.query("UPDATE driver_changes SET status = 'replaced', decided_at = NOW() WHERE driver_id = $1 AND kind = 'vehicle' AND status = 'pending'", [req.user.id]);
  const row = await db.one("INSERT INTO driver_changes(driver_id, kind, data) VALUES ($1,'vehicle',$2) RETURNING id",
    [req.user.id, JSON.stringify({ plate, make, color, mime: m[1], photo: m[2] })]);
  rt.io.to('admin').emit('admin:change', { id: req.user.id, name: req.user.name, kind: 'vehicle' });
  res.json({ ok: true, id: row.id });
}));

r.post('/me/password', auth.requireAuth(), wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await bcrypt.compare(String(current || ''), req.user.password_hash))) return bad(res, 'Your current password is wrong.');
  if (!next || String(next).length < 6) return bad(res, 'New password must be at least 6 characters.');
  if (String(next).length > 72) return bad(res, 'New password must be 72 characters or fewer.');
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(String(next), 10), req.user.id]);
  res.json({ ok: true });
}));

// Phone-first sign in: tells the app whether to ask for a password or show sign-up.
r.post('/auth/check', limit(30, 10 * 60e3), wrap(async (req, res) => {
  const p = auth.normalizePhone((req.body || {}).phone);
  if (!p) return bad(res, 'Enter a valid Ugandan mobile number, e.g. 0772 123456.');
  const u = await db.one('SELECT role FROM users WHERE phone = $1', [p]);
  res.json({ phone: p, exists: !!u, role: u ? u.role : null });
}));

r.post('/auth/login', limit(15, 10 * 60e3), wrap(async (req, res) => {
  const { phone, password } = req.body || {};
  const p = auth.normalizePhone(phone);
  const u = p && await db.one('SELECT * FROM users WHERE phone = $1', [p]);
  if (!u || !(await bcrypt.compare(String(password || ''), u.password_hash))) return bad(res, 'Wrong phone number or password.', 401);
  if (u.blocked) return bad(res, 'This account is suspended. Contact support.', 403);
  res.json({ token: auth.sign(u), user: auth.publicUser(u) });
}));

r.get('/me', auth.requireAuth(), wrap(async (req, res) => {
  const out = { user: auth.publicUser(req.user) };
  if (req.user.role === 'driver') {
    const d = await db.one('SELECT * FROM drivers WHERE user_id = $1', [req.user.id]);
    out.driver = d && {
      status: d.status, vehicleType: d.vehicle_type, services: d.services.split(','), plate: d.plate,
      vehicleMake: d.vehicle_make, vehicleColor: d.vehicle_color, momoNumber: d.momo_number, earningsBalance: d.earnings_balance,
    };
  }
  res.json(out);
}));

r.patch('/me', auth.requireAuth(), wrap(async (req, res) => {
  const { name, email, emergencyContact, savedPlaces, payPref, payPhone } = req.body || {};
  if (payPref !== undefined) {
    if (!['mtn', 'airtel', 'card', 'cash', 'wallet'].includes(payPref)) return bad(res, 'Choose a payment method.');
    await db.query('UPDATE users SET pay_pref = $1 WHERE id = $2', [payPref, req.user.id]);
  }
  if (payPhone !== undefined) {
    const pp = auth.normalizePhone(payPhone);
    if (!pp) return bad(res, 'Enter a valid Mobile Money number.');
    await db.query('UPDATE users SET pay_phone = $1 WHERE id = $2', [pp, req.user.id]);
  }
  if (name !== undefined && clean(name, 80).length < 2) return bad(res, 'Enter your full name.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return bad(res, 'Enter a valid email address.');
  const ec = emergencyContact ? auth.normalizePhone(emergencyContact) : null;
  if (emergencyContact && !ec) return bad(res, 'Emergency contact must be a valid Ugandan number.');
  if (savedPlaces && typeof savedPlaces === 'object') {
    let current = {};
    try { current = JSON.parse(req.user.saved_places || '{}'); } catch {}
    for (const key of ['home', 'work']) {
      if (savedPlaces[key] === null) delete current[key];
      else if (savedPlaces[key]) {
        const pt = point(savedPlaces[key]);
        if (!pt) return bad(res, 'That place is outside our service area.');
        current[key] = pt;
      }
    }
    await db.query('UPDATE users SET saved_places = $1 WHERE id = $2', [JSON.stringify(current), req.user.id]);
  }
  const u = await db.one(
    'UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), emergency_contact = COALESCE($3, emergency_contact) WHERE id = $4 RETURNING *',
    [name ? clean(name, 80) : null, email ? String(email).trim().slice(0, 120) : null, ec, req.user.id]);
  res.json({ user: auth.publicUser(u) });
}));

// ---------- Rider ----------
r.post('/fare/estimate', auth.requireAuth(), wrap(async (req, res) => {
  const rt0 = route(req.body || {}, res);
  if (!rt0) return;
  const { pickup, drop } = rt0;
  surge.recordLook(req.user.id, pickup.lat, pickup.lng);   // someone checking prices = demand signal
  const q = await quote(pickup, drop, req.body.distanceKm, req.body.durationMin);
  // How far is the nearest free driver for each ride type?
  for (const o of q.options) {
    const near = rt.nearbyDrivers(pickup.lat, pickup.lng, o.id)[0];
    o.etaMin = near ? Math.max(2, Math.round(((near.km * 1.3) / 20) * 60)) : null;
  }
  // Discounts (first ride or promo code). Flytte pays them; the driver still earns on the full fare.
  const code = req.body.promoCode ? String(req.body.promoCode).trim().toUpperCase() : null;
  for (const o of q.options) {
    const d = await growth.discountFor(req.user.id, o.id, o.fare, code);
    o.discount = d.discount || 0; o.payable = o.fare - o.discount; o.promoLabel = d.label || null; o.promoCode = d.code || null;
    if (d.error || d.promoError) q.promoError = q.promoError || d.error || d.promoError;
  }
  q.promoCode = code;
  // Lock these prices for 2 minutes: booking within that time pays exactly this.
  q.quoteId = surge.saveQuote({ userId: req.user.id, pickup, drop, km: q.distanceKm, promoCode: code, options: q.options.map((o) => ({ id: o.id, fare: o.fare, regularFare: o.regularFare, durationMin: o.durationMin, surge: o.surge })) });
  q.lockedForSec = 120;
  res.json(q);
}));

// Drivers see how busy their area is (like Uber/Bolt "high demand" alerts).
r.get('/drivers/demand', auth.requireAuth('driver'), wrap(async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return bad(res, 'Location needed.');
  const s = await getSettings();
  const c = await surge.conditions(lat, lng, s.dynamic);
  res.json({ boda: c.boda, car: c.car, raining: c.raining, traffic: c.traffic });
}));

// Admin: see live pricing conditions, and switch "it's raining" on for testing or when the weather feed is off.
r.get('/admin/pricing/live', auth.requireAuth('admin'), wrap(async (req, res) => {
  const s = await getSettings();
  const lat = Number(req.query.lat) || 0.3136, lng = Number(req.query.lng) || 32.5811;
  res.json(await surge.conditions(lat, lng, s.dynamic));
}));
r.post('/admin/pricing/rain', auth.requireAuth('admin'), wrap(async (req, res) => {
  const mm = req.body && req.body.mm;
  surge.setRainOverride(mm === null || mm === undefined || mm === '' ? null : Number(mm));
  res.json({ ok: true });
}));

r.get('/drivers/nearby', auth.requireAuth(), wrap(async (req, res) => {
  const p = point({ lat: req.query.lat, lng: req.query.lng });
  if (!p) return bad(res, 'A location inside our service area is needed.');
  res.json(rt.nearbyDrivers(p.lat, p.lng, req.query.service ? String(req.query.service) : undefined));
}));

r.post('/trips', auth.requireAuth('rider'), wrap(async (req, res) => {
  const { service, paymentMethod = 'cash', distanceKm, durationMin, parcel, notes } = req.body || {};
  const rt0 = route(req.body || {}, res);
  if (!rt0) return;
  const { pickup, drop } = rt0;
  const s = await getSettings();
  const svc = typeof service === 'string' && Object.prototype.hasOwnProperty.call(s.services, service) ? s.services[service] : null;
  if (!svc || !svc.enabled) return bad(res, 'That ride type is not available.');
  if (!['cash', 'wallet', 'momo', 'card'].includes(paymentMethod)) return bad(res, 'Choose a payment method.');
  if (['momo', 'card'].includes(paymentMethod) && !payments.available()) return bad(res, 'Mobile Money and card payments aren’t available yet. Choose cash or your Flytte wallet.');

  // Scheduled ride: between 20 minutes and 7 days ahead.
  let scheduledFor = null;
  if (req.body.scheduledFor) {
    const when = new Date(req.body.scheduledFor);
    const ahead = when.getTime() - Date.now();
    if (!Number.isFinite(ahead) || ahead < 19 * 60e3 || ahead > 7 * 86400e3) return bad(res, 'Schedule between 20 minutes and 7 days from now.');
    scheduledFor = when;
  }
  if (!scheduledFor) {
    const busy = await db.one(
      "SELECT id FROM trips WHERE rider_id = $1 AND status IN ('requested','accepted','arrived','in_progress')", [req.user.id]);
    if (busy) return bad(res, 'You already have a trip in progress.');
  } else {
    const n = await db.one("SELECT COUNT(*)::int AS n FROM trips WHERE rider_id = $1 AND status = 'scheduled'", [req.user.id]);
    if (n.n >= 3) return bad(res, 'You can have up to 3 scheduled rides.');
  }
  // Booking for someone else
  let passengerJson = null;
  if (req.body.passenger && req.body.passenger.name) {
    const pp = auth.normalizePhone(req.body.passenger.phone);
    if (clean(req.body.passenger.name, 60).length < 2) return bad(res, 'Enter the passenger’s name.');
    if (!pp) return bad(res, 'Enter the passenger’s phone number so the driver can call them.');
    passengerJson = JSON.stringify({ name: clean(req.body.passenger.name, 60), phone: pp });
  }

  // Upfront, locked price: use the quote the rider saw if it is still valid,
  // otherwise price it now and make sure the rider isn't surprised by a jump.
  let km, min, fare;
  const locked = surge.getQuote(req.body.quoteId, req.user.id);
  const lockedOpt = locked && haversine(locked.pickup, pickup) < 0.15 && haversine(locked.drop, drop) < 0.15 && locked.options.find((o) => o.id === service);
  if (lockedOpt) { km = locked.km; min = lockedOpt.durationMin; fare = scheduledFor ? lockedOpt.regularFare : lockedOpt.fare; }
  else {
    const q = await quote(pickup, drop, distanceKm, durationMin);
    const o = q.options.find((x) => x.id === service);
    km = q.distanceKm; min = o.durationMin; fare = scheduledFor ? o.regularFare : o.fare; // scheduled rides never surge
    const expected = Number(req.body.expectedFare);
    if (expected > 0 && fare > expected * 1.05 + 100) {
      return res.status(409).json({ error: `Prices have just changed. ${svc.name.replace('Flytte ', '')} is now UGX ${fare.toLocaleString()}.`, code: 'PRICE_CHANGED', fare });
    }
  }
  const promo = await growth.discountFor(req.user.id, service, fare, req.body.promoCode || (locked && locked.promoCode));
  const discount = promo.discount || 0;
  if (paymentMethod === 'wallet' && req.user.wallet_balance < fare - discount) {
    return bad(res, `Your wallet has UGX ${req.user.wallet_balance.toLocaleString()}. Top up or choose another payment method.`);
  }

  let parcelJson = null;
  if (service === 'parcel') {
    const pc = parcel || {};
    const rp = auth.normalizePhone(pc.recipientPhone);
    if (clean(pc.recipientName, 80).length < 2 || !rp || !clean(pc.item, 120)) return bad(res, 'Add the recipient name, phone and what you are sending.');
    parcelJson = JSON.stringify({ recipientName: clean(pc.recipientName, 80), recipientPhone: rp, item: clean(pc.item, 120) });
  }

  const pin = String(crypto.randomInt(1000, 10000));
  const share = crypto.randomBytes(12).toString('base64url');
  const dropCode = service === 'parcel' ? String(crypto.randomInt(1000, 10000)) : null; // recipient gives this to the rider
  const t = await db.one(`
    INSERT INTO trips(rider_id, service, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address,
      distance_km, duration_min, fare, payment_method, pin, share_token, parcel, notes,
      discount, promo_code, promo_label, scheduled_for, passenger, drop_code, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
  [req.user.id, service, pickup.lat, pickup.lng, pickup.address, drop.lat, drop.lng, drop.address,
    km, min, fare, paymentMethod, pin, share, parcelJson, notes ? clean(notes, 200) || null : null,
    discount, promo.code || null, discount ? promo.label : null, scheduledFor, passengerJson, dropCode, scheduledFor ? 'scheduled' : 'requested']);

  if (req.body.quoteId) surge.dropQuote(req.body.quoteId);
  if (!scheduledFor) { surge.recordRequest(service, pickup.lat, pickup.lng); rt.dispatch(t.id).catch(console.error); }
  const full = await rt.loadTrip(t.id);
  rt.io.to('admin').emit('admin:trip', rt.view(full, 'admin'));
  res.json(rt.view(full, 'rider'));
}));

r.get('/trips/active', auth.requireAuth(), wrap(async (req, res) => {
  const col = req.user.role === 'driver' ? 'driver_id' : 'rider_id';
  const driver = req.user.role === 'driver';
  // Also return a just-finished trip that still needs rating or payment. For drivers the trip
  // under way comes first; a lined-up next trip is returned alongside it.
  const { rows } = await db.query(`
    SELECT id, status FROM trips WHERE ${col} = $1 AND (
      status IN ('requested','accepted','arrived','in_progress')
      OR (status = 'completed' AND completed_at > NOW() - INTERVAL '2 hours' AND (
        ${driver ? 'driver_rating IS NULL' : "rider_rating IS NULL OR payment_status = 'pending'"}))
    ) ORDER BY ${driver ? "CASE status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 WHEN 'accepted' THEN 2 ELSE 3 END, id" : 'id DESC'} LIMIT 2`, [req.user.id]);
  if (!rows.length) return res.json(null);
  const out = rt.view(await rt.loadTrip(rows[0].id), driver ? 'driver' : 'rider');
  if (driver && rows[1] && rows[0].status !== 'completed' && rows[1].status === 'accepted') out.next = rt.view(await rt.loadTrip(rows[1].id), 'driver');
  res.json(out);
}));

r.get('/trips/history', auth.requireAuth(), wrap(async (req, res) => {
  const col = req.user.role === 'driver' ? 'driver_id' : 'rider_id';
  const { rows } = await db.query(`SELECT id FROM trips WHERE ${col} = $1 ORDER BY id DESC LIMIT 30`, [req.user.id]);
  const out = [];
  for (const row of rows) out.push(rt.view(await rt.loadTrip(row.id), req.user.role === 'driver' ? 'driver' : 'rider'));
  res.json(out);
}));

async function ownTrip(req, res, role) {
  const t = await db.one('SELECT * FROM trips WHERE id = $1', [Number(req.params.id)]);
  if (!t) { bad(res, 'Trip not found.', 404); return null; }
  const mine = role === 'driver' ? t.driver_id === req.user.id : t.rider_id === req.user.id;
  if (!mine) { bad(res, 'Not your trip.', 403); return null; }
  return t;
}

r.post('/trips/:id/cancel', auth.requireAuth('rider', 'driver'), wrap(async (req, res) => {
  const role = req.user.role;
  const t = await ownTrip(req, res, role);
  if (!t) return;
  const allowed = role === 'rider' ? ['scheduled', 'requested', 'accepted', 'arrived'] : ['accepted', 'arrived'];
  if (!allowed.includes(t.status)) return bad(res, 'This trip can no longer be cancelled.');
  if (role === 'driver') {
    // Don't strand the rider: put the request back and find another driver.
    await db.query("UPDATE trips SET status = 'requested', driver_id = NULL, accepted_at = NULL, arrived_at = NULL WHERE id = $1", [t.id]);
    rt.setDriverFree(req.user.id, t.id);
    dtools.logEvent(req.user.id, t.id, 'driver_cancelled');
    rt.io.in(`user:${req.user.id}`).socketsLeave(`trip:${t.id}`);
    rt.notify(t.rider_id, 'toast', { text: 'Your driver cancelled. Finding you another one…' });
    rt.notify(req.user.id, 'trip:update', { id: t.id, status: 'cancelled', cancelledBy: 'driver' });
    await rt.broadcast(t.id);
    rt.dispatch(t.id, req.user.id).catch(console.error);
    return res.json({ ok: true });
  }
  await db.query("UPDATE trips SET status = 'cancelled', cancelled_by = $1, cancel_reason = $2 WHERE id = $3",
    [role, clean((req.body || {}).reason, 200), t.id]);
  rt.clearOffer(t.id);
  if (t.driver_id) {
    rt.setDriverFree(t.driver_id, t.id);
    if (['accepted', 'arrived'].includes(t.status)) dtools.push(t.driver_id, { type: 'cancelled', tag: `trip-${t.id}`, title: 'Trip cancelled', body: 'The rider cancelled. You’re free for the next request.' }, { ttl: 300 }).catch(() => {});
  }
  await rt.broadcast(t.id);
  res.json({ ok: true });
}));

r.post('/trips/:id/rate', auth.requireAuth('rider', 'driver'), wrap(async (req, res) => {
  const role = req.user.role;
  const t = await ownTrip(req, res, role);
  if (!t) return;
  const stars = Math.round(Number(req.body.stars));
  if (t.status !== 'completed') return bad(res, 'You can rate after the trip.');
  if (!(stars >= 1 && stars <= 5)) return bad(res, 'Choose 1 to 5 stars.');
  const field = role === 'rider' ? 'rider_rating' : 'driver_rating';
  const target = role === 'rider' ? t.driver_id : t.rider_id;
  const ok = await db.one(`UPDATE trips SET ${field} = $1 WHERE id = $2 AND ${field} IS NULL RETURNING id`, [stars, t.id]);
  if (ok) await db.query('UPDATE users SET rating_sum = rating_sum + $1, rating_count = rating_count + 1 WHERE id = $2', [stars, target]);
  res.json({ ok: true });
}));

r.get('/trips/:id/messages', auth.requireAuth('rider', 'driver'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, req.user.role);
  if (!t) return;
  res.json(rt.messages(t.id));
}));

r.post('/trips/:id/sos', auth.requireAuth('rider', 'driver'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, req.user.role);
  if (!t) return;
  const sp = point({ lat: (req.body || {}).lat, lng: (req.body || {}).lng });
  const lat = sp ? sp.lat : null, lng = sp ? sp.lng : null;
  const a = await db.one('INSERT INTO sos_alerts(trip_id, user_id, lat, lng) VALUES ($1,$2,$3,$4) RETURNING *', [t.id, req.user.id, lat, lng]);
  rt.io.to('admin').emit('admin:sos', { id: a.id, tripId: t.id, user: req.user.name, phone: req.user.phone, lat, lng });
  res.json({ ok: true, emergencyContact: req.user.emergency_contact, shareToken: t.share_token });
}));

// A rider says the driver or the vehicle doesn't match what the app shows.
const REPORT = { photo: 'Driver doesn’t match the photo', plate: 'Number plate doesn’t match' };
r.post('/trips/:id/report', auth.requireAuth('rider'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'rider');
  if (!t) return;
  const kind = (req.body || {}).kind;
  if (!REPORT[kind]) return bad(res, 'Choose what doesn’t match.');
  const recent = t.status === 'completed' && t.completed_at && Date.now() - new Date(t.completed_at).getTime() < 48 * 3600e3;
  if (!t.driver_id || !(['accepted', 'arrived', 'in_progress'].includes(t.status) || recent)) return bad(res, 'You can report this during the trip or up to two days after it.');
  const row = await db.one(`INSERT INTO driver_reports(trip_id, driver_id, rider_id, kind, note) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (trip_id, rider_id, kind) DO NOTHING RETURNING id`, [t.id, t.driver_id, req.user.id, kind, clean((req.body || {}).note, 300) || null]);
  if (!row) return res.json({ ok: true, already: true });
  const s = await getSettings();
  const c = await db.one(`SELECT COUNT(DISTINCT rider_id)::int AS n FROM driver_reports
    WHERE driver_id = $1 AND dismissed = FALSE AND created_at > NOW() - INTERVAL '30 days'`, [t.driver_id]);
  let paused = false;
  if (s.drivers.mismatchPauseReports > 0 && c.n >= s.drivers.mismatchPauseReports) {
    const d = await db.one("UPDATE drivers SET status = 'suspended' WHERE user_id = $1 AND status = 'approved' RETURNING user_id", [t.driver_id]);
    if (d) { paused = true; rt.forceOffline(t.driver_id); rt.notify(t.driver_id, 'driver:status', { status: 'suspended' }); }
  }
  const who = await db.one('SELECT name FROM users WHERE id = $1', [t.driver_id]);
  rt.io.to('admin').emit('admin:report', { id: row.id, tripId: t.id, driver: who && who.name, kind, label: REPORT[kind], count: c.n, paused });
  res.json({ ok: true, paused });
}));

r.post('/trips/:id/pay', auth.requireAuth('rider'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'rider');
  if (!t) return;
  if (t.status !== 'completed' || t.payment_status === 'paid') return bad(res, 'Nothing to pay on this trip.');
  if (!['momo', 'card'].includes(t.payment_method)) return bad(res, 'This trip is paid in cash or wallet.');
  let out;
  try { out = await payments.createCheckout({ user: req.user, amount: t.fare - (t.discount || 0), purpose: 'trip', tripId: t.id, method: t.payment_method, baseUrl: baseUrl(req) }); }
  catch (e) { if (e instanceof payments.PaymentsUnavailable) return bad(res, e.message, 503); throw e; }
  if (out.demo) await rt.broadcast(t.id);
  res.json(out);
}));

// Mobile Money / card didn't work out: the rider pays the driver in cash instead.
r.post('/trips/:id/pay-cash', auth.requireAuth('rider'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'rider');
  if (!t) return;
  if (t.status !== 'completed' || t.payment_status === 'paid' || !['momo', 'card'].includes(t.payment_method)) return bad(res, 'Nothing to pay on this trip.');
  let done;
  await db.tx(async (tx) => { done = await ledger.settleAsCash(tx, t.id); });
  if (!done) return bad(res, 'This trip is already settled.');
  if (t.driver_id) rt.notify(t.driver_id, 'toast', { text: `💵 Collect UGX ${(t.fare - (t.discount || 0)).toLocaleString()} in cash for trip #${t.id}` });
  await rt.broadcast(t.id);
  res.json({ ok: true });
}));

// ---------- Driver trip actions ----------
async function driverStep(req, res, from, to, extra = '') {
  const t = await ownTrip(req, res, 'driver');
  if (!t) return null;
  if (!from.includes(t.status)) { bad(res, 'Trip is not at that stage.'); return null; }
  await db.query(`UPDATE trips SET status = $1 ${extra} WHERE id = $2`, [to, t.id]);
  return t;
}

r.post('/trips/:id/arrived', auth.requireAuth('driver'), wrap(async (req, res) => {
  const t = await driverStep(req, res, ['accepted'], 'arrived', ', arrived_at = NOW()');
  if (!t) return;
  await rt.broadcast(t.id);
  rt.notify(t.rider_id, 'toast', { text: 'Your ride is here 👋' });
  res.json({ ok: true });
}));

// The rider didn't come out. After the free waiting time the driver can leave; the no-show
// fee goes to the driver from the rider's wallet when the wallet covers it.
r.post('/trips/:id/noshow', auth.requireAuth('driver'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'driver');
  if (!t) return;
  if (t.status !== 'arrived' || !t.arrived_at) return bad(res, 'Mark that you have arrived at the pickup first.');
  const s = await getSettings();
  const waited = (Date.now() - new Date(t.arrived_at).getTime()) / 60000;
  if (waited < s.drivers.freeWaitMin) {
    const left = Math.ceil(s.drivers.freeWaitMin - waited);
    return bad(res, `Please wait ${left} more minute${left === 1 ? '' : 's'} for the ${t.passenger ? 'passenger' : 'rider'}.`);
  }
  let fee = 0, done = false;
  await db.tx(async (tx) => {
    const fresh = await tx.one("UPDATE trips SET status = 'cancelled', cancelled_by = 'rider', cancel_reason = 'no_show' WHERE id = $1 AND status = 'arrived' RETURNING id", [t.id]);
    if (!fresh) return;
    done = true;
    const want = s.drivers.noShowFee;
    if (want > 0) {
      const rider = await tx.one('SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE', [t.rider_id]);
      if (rider && rider.wallet_balance >= want) {
        fee = want;
        await tx.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [fee, t.rider_id]);
        await tx.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'no_show_fee',$2,$3,'No-show fee: the driver waited at your pickup')", [t.rider_id, -fee, t.id]);
        await tx.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [fee, req.user.id]);
        await tx.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'no_show_fee',$2,$3,'No-show fee from the rider')", [req.user.id, fee, t.id]);
        await tx.query('UPDATE trips SET no_show_fee = $1 WHERE id = $2', [fee, t.id]);
      }
    }
  });
  if (!done) return bad(res, 'This trip has already changed. Pull down to refresh.');
  rt.setDriverFree(req.user.id, t.id);
  dtools.logEvent(req.user.id, t.id, 'no_show');
  const mins = Math.floor(waited);
  rt.notify(t.rider_id, 'toast', { text: fee
    ? `Your driver waited ${mins} minutes and had to leave. A UGX ${fee.toLocaleString()} no-show fee was taken from your wallet.`
    : `Your driver waited ${mins} minutes and had to leave. Book again when you’re ready.` });
  await rt.broadcast(t.id);
  res.json({ ok: true, fee });
}));

r.post('/trips/:id/start', auth.requireAuth('driver'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'driver');
  if (!t) return;
  if (!['accepted', 'arrived'].includes(t.status)) return bad(res, 'Trip is not at that stage.');
  if (String((req.body || {}).pin || '').trim() !== t.pin) return bad(res, 'Wrong PIN. Ask the rider for the 4-digit PIN in their app.');
  await db.query("UPDATE trips SET status = 'in_progress', started_at = NOW() WHERE id = $1", [t.id]);
  await rt.broadcast(t.id);
  res.json({ ok: true });
}));

r.post('/trips/:id/complete', auth.requireAuth('driver'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'driver');
  if (!t) return;
  if (t.status !== 'in_progress') return bad(res, 'Start the trip first.');
  if (t.drop_code && String((req.body || {}).code || '').trim() !== t.drop_code) {
    return bad(res, 'Wrong delivery code. Ask the recipient for the 4-digit code the sender shared with them.');
  }
  let settled, bonuses = [];
  await db.tx(async (tx) => {
    const fresh = await tx.one("UPDATE trips SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status = 'in_progress' RETURNING *", [t.id]);
    if (fresh) { settled = await ledger.settleCompletedTrip(tx, fresh); bonuses = await dtools.payBonuses(tx, req.user.id); }
  });
  rt.setDriverFree(req.user.id, t.id);
  await rt.broadcast(t.id);
  for (const b of bonuses) rt.notify(req.user.id, 'toast', { text: `🎉 Bonus reached: ${b.title}. UGX ${b.reward.toLocaleString()} added to your balance.` });
  if (settled && settled.referral && settled.referral.referrerReward) {
    rt.notify(settled.referral.referrerId, 'toast', { text: `🎉 Your friend took their first Flytte trip. UGX ${settled.referral.referrerReward.toLocaleString()} added to your wallet.` });
  }
  res.json({ ok: true });
}));

// ---------- Tips ----------
r.post('/trips/:id/tip', auth.requireAuth('rider'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'rider');
  if (!t) return;
  if (t.status !== 'completed' || !t.driver_id) return bad(res, 'You can tip after the trip.');
  if (t.tip) return bad(res, 'You already tipped on this trip. Thank you!');
  const amount = Math.round(Number(req.body.amount));
  const method = req.body.method === 'wallet' ? 'wallet' : 'cash';
  if (!(amount >= 500 && amount <= 50000)) return bad(res, 'Tips are between UGX 500 and 50,000.');
  let out;
  await db.tx(async (tx) => { out = await ledger.tipDriver(tx, t, amount, method); });
  if (out.error) return bad(res, out.error);
  rt.notify(t.driver_id, 'toast', { text: `💛 ${String(req.user.name).split(' ')[0]} tipped you UGX ${amount.toLocaleString()}${method === 'cash' ? ' in cash' : ''}` });
  await rt.broadcast(t.id);
  res.json({ ok: true });
}));

// ---------- Scheduled rides ----------
r.get('/trips/upcoming', auth.requireAuth('rider'), wrap(async (req, res) => {
  const { rows } = await db.query("SELECT id FROM trips WHERE rider_id = $1 AND status = 'scheduled' ORDER BY scheduled_for", [req.user.id]);
  const out = [];
  for (const row of rows) out.push(rt.view(await rt.loadTrip(row.id), 'rider'));
  res.json(out);
}));

// ---------- Invite friends & Flytte Rewards ----------
r.get('/me/growth', auth.requireAuth('rider'), wrap(async (req, res) => {
  const s = await getSettings();
  const code = await growth.ensureReferralCode(req.user);
  const friends = await db.one('SELECT COUNT(*)::int AS joined, COUNT(*) FILTER (WHERE referral_rewarded)::int AS rode FROM users WHERE referred_by = $1', [req.user.id]);
  const earned = await db.one("SELECT COALESCE(SUM(amount),0)::int AS n FROM transactions WHERE user_id = $1 AND type = 'reward' AND note LIKE 'Invite reward%'", [req.user.id]);
  const u = await db.one('SELECT points, lifetime_points FROM users WHERE id = $1', [req.user.id]);
  res.json({
    code, link: `${baseUrl(req)}/?ref=${code}`, friends, earned: earned.n,
    referral: s.growth.referral, rewards: s.growth.rewards,
    points: u.points, lifetimePoints: u.lifetime_points, tier: growth.tier(u.lifetime_points),
    firstRide: s.growth.firstRide.enabled && await growth.firstRideEligible(req.user.id) ? s.growth.firstRide : null,
  });
}));

r.post('/rewards/redeem', auth.requireAuth('rider'), wrap(async (req, res) => {
  const s = await getSettings();
  const rw = s.growth.rewards;
  if (!rw.enabled) return bad(res, 'Rewards are paused right now.');
  let out;
  await db.tx(async (tx) => {
    const u = await tx.one('SELECT points FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (u.points < rw.redeemPoints) { out = { error: `You need ${rw.redeemPoints} points to redeem.` }; return; }
    await tx.query('UPDATE users SET points = points - $1 WHERE id = $2', [rw.redeemPoints, req.user.id]);
    await growth.credit(tx, req.user.id, rw.redeemValue, `Flytte Rewards: ${rw.redeemPoints} points`);
    out = { ok: true, points: u.points - rw.redeemPoints };
  });
  if (out.error) return bad(res, out.error);
  const u = await db.one('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
  res.json({ ...out, walletBalance: u.wallet_balance });
}));

// ---------- Wallet ----------
r.get('/wallet', auth.requireAuth(), wrap(async (req, res) => {
  const { rows } = await db.query('SELECT type, amount, note, trip_id, created_at FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 40', [req.user.id]);
  res.json({ balance: req.user.wallet_balance, transactions: rows });
}));

r.post('/wallet/topup', auth.requireAuth('rider'), wrap(async (req, res) => {
  const amount = Math.round(Number(req.body.amount));
  if (!(amount >= 1000 && amount <= 2000000)) return bad(res, 'Top up between UGX 1,000 and 2,000,000.');
  const method = req.body.method === 'card' ? 'card' : 'momo';
  let out;
  try { out = await payments.createCheckout({ user: req.user, amount, purpose: 'topup', method, baseUrl: baseUrl(req) }); }
  catch (e) { if (e instanceof payments.PaymentsUnavailable) return bad(res, e.message, 503); throw e; }
  const u = await db.one('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
  res.json({ ...out, balance: u.wallet_balance });
}));

// ---------- Payments (Flutterwave) ----------
r.get('/payments/callback', wrap(async (req, res) => {
  const ref = String(req.query.tx_ref || '').slice(0, 80);
  const result = /^(?:FLY|KWT)-(TOP|TRP|DBT)-\d+-[0-9a-f]{8}$/.test(ref) ? await payments.verifyAndApply(ref) : { ok: false };
  const p = ref && await db.one('SELECT * FROM payments WHERE tx_ref = $1', [ref]);
  if (p && p.trip_id && result.ok) await rt.broadcast(p.trip_id);
  if (p && result.ok) rt.notify(p.user_id, 'toast', { text: 'Payment received ✅' });
  res.redirect(`${p && p.purpose === 'debt' ? '/driver' : '/'}?payment=${result.ok ? 'success' : (result.reason === 'unreachable' ? 'pending' : 'failed')}`);
}));

r.post('/payments/webhook', wrap(async (req, res) => {
  if (!payments.webhookAuthentic(req)) return res.status(401).end();
  const ref = req.body && req.body.data && String(req.body.data.tx_ref || '');
  if (ref && /^(?:FLY|KWT)-(TOP|TRP|DBT)-\d+-[0-9a-f]{8}$/.test(ref)) {
    const result = await payments.verifyAndApply(ref);
    const p = await db.one('SELECT * FROM payments WHERE tx_ref = $1', [ref]);
    if (p && result.ok) {
      if (p.trip_id) await rt.broadcast(p.trip_id);
      rt.notify(p.user_id, 'toast', { text: 'Payment received ✅' });
    }
  }
  res.status(200).end();
}));

// ---------- Driver money ----------
r.get('/driver/earnings', auth.requireAuth('driver'), wrap(async (req, res) => {
  const d = await db.one('SELECT earnings_balance, momo_number FROM drivers WHERE user_id = $1', [req.user.id]);
  const today = await db.one(`SELECT COUNT(*)::int AS trips, COALESCE(SUM(fare - commission),0)::int AS net
    FROM trips WHERE driver_id = $1 AND status = 'completed' AND completed_at > date_trunc('day', NOW() AT TIME ZONE 'Africa/Kampala') AT TIME ZONE 'Africa/Kampala'`, [req.user.id]);
  const week = await db.one(`SELECT COUNT(*)::int AS trips, COALESCE(SUM(fare - commission),0)::int AS net
    FROM trips WHERE driver_id = $1 AND status = 'completed' AND completed_at > NOW() - INTERVAL '7 days'`, [req.user.id]);
  const { rows: tx } = await db.query('SELECT type, amount, note, trip_id, created_at FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 40', [req.user.id]);
  const { rows: wd } = await db.query('SELECT id, amount, status, created_at FROM withdrawals WHERE driver_id = $1 ORDER BY id DESC LIMIT 10', [req.user.id]);
  // Last 7 days, Kampala time, for the earnings chart.
  const { rows: byDay } = await db.query(`SELECT to_char(completed_at AT TIME ZONE 'Africa/Kampala', 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS trips, COALESCE(SUM(fare - commission),0)::int AS net
    FROM trips WHERE driver_id = $1 AND status = 'completed' AND completed_at > NOW() - INTERVAL '7 days' GROUP BY 1`, [req.user.id]);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() + 3 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
    const hit = byDay.find((x) => x.day === d);
    days.push({ day: d, trips: hit ? hit.trips : 0, net: hit ? hit.net : 0 });
  }
  const mix = await db.one(`SELECT COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN fare ELSE 0 END),0)::int AS cash,
      COALESCE(SUM(commission),0)::int AS commission, COUNT(*)::int AS trips
    FROM trips WHERE driver_id = $1 AND status = 'completed' AND completed_at > NOW() - INTERVAL '7 days'`, [req.user.id]);
  const all = await db.one("SELECT COUNT(*)::int AS trips FROM trips WHERE driver_id = $1 AND status = 'completed'", [req.user.id]);
  res.json({ balance: d.earnings_balance, momoNumber: d.momo_number, today, week, days, cashWeek: mix.cash, commissionWeek: mix.commission, allTrips: all.trips, transactions: tx, withdrawals: wd });
}));

// ---------- Driver tools ----------
const todayKla = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

// Everything the driver home screen needs beyond the trip itself.
r.get('/driver/overview', auth.requireAuth('driver'), wrap(async (req, res) => {
  const s = await getSettings();
  const d = await db.one('SELECT earnings_balance, home_lat, home_lng, home_address, home_uses_day, home_uses FROM drivers WHERE user_id = $1', [req.user.id]);
  const used = d.home_uses_day === todayKla() ? d.home_uses : 0;
  const live = rt.driverState(req.user.id);
  res.json({
    stats: await dtools.stats(req.user.id),
    bonuses: await dtools.bonusProgress(req.user.id),
    docs: await dtools.docAlerts(req.user.id),
    balance: d.earnings_balance,
    owed: Math.max(0, -d.earnings_balance),
    debtLimit: s.drivers.cashDebtLimit,
    cashPaused: s.drivers.cashDebtLimit > 0 && d.earnings_balance <= -s.drivers.cashDebtLimit,
    home: live.home,
    savedHome: d.home_lat != null ? { lat: d.home_lat, lng: d.home_lng, address: d.home_address } : null,
    homeUsesLeft: Math.max(0, s.drivers.headingHomePerDay - used),
    homePerDay: s.drivers.headingHomePerDay,
    push: await dtools.hasPush(req.user.id),
  });
}));

// Heading home: only trips that take the driver towards a chosen place.
r.post('/driver/home', auth.requireAuth('driver'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.on) { rt.setHome(req.user.id, null); return res.json({ ok: true, home: null }); }
  const s = await getSettings();
  if (s.drivers.headingHomePerDay <= 0) return bad(res, 'Heading home isn’t available right now.');
  if (!rt.driverState(req.user.id).online) return bad(res, 'Go online first, then switch on Heading home.');
  const d = await db.one('SELECT home_lat, home_lng, home_address, home_uses_day, home_uses FROM drivers WHERE user_id = $1', [req.user.id]);
  const place = point(b.place) || (d.home_lat != null ? { lat: d.home_lat, lng: d.home_lng, address: d.home_address } : null);
  if (!place) return bad(res, 'Choose where you’re heading.');
  const used = d.home_uses_day === todayKla() ? d.home_uses : 0;
  if (used >= s.drivers.headingHomePerDay) return bad(res, `You can use Heading home ${s.drivers.headingHomePerDay} time${s.drivers.headingHomePerDay === 1 ? '' : 's'} a day. It resets at midnight.`);
  await db.query('UPDATE drivers SET home_lat = $1, home_lng = $2, home_address = $3, home_uses_day = $4, home_uses = $5 WHERE user_id = $6',
    [place.lat, place.lng, place.address, todayKla(), used + 1, req.user.id]);
  rt.setHome(req.user.id, place);
  res.json({ ok: true, home: place, usesLeft: s.drivers.headingHomePerDay - used - 1 });
}));

// Trip-by-trip earnings for a period, for the breakdown and the statement.
r.get('/driver/trips', auth.requireAuth('driver'), wrap(async (req, res) => {
  const days = [1, 7, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const since = days === 1 ? new Date(Date.parse(todayKla() + 'T00:00:00Z') - 3 * 3600e3) : new Date(Date.now() - days * 86400e3);
  const { rows } = await db.query(`SELECT id, service, payment_method, fare, discount, commission, tip, tip_method, no_show_fee, status, cancel_reason,
      pickup_address, drop_address, distance_km, completed_at, created_at
    FROM trips WHERE driver_id = $1 AND (
      (status = 'completed' AND completed_at >= $2) OR (status = 'cancelled' AND cancel_reason = 'no_show' AND created_at >= $2))
    ORDER BY COALESCE(completed_at, created_at) DESC LIMIT 300`, [req.user.id, since]);
  const { rows: bon } = await db.query("SELECT amount, note, created_at FROM transactions WHERE user_id = $1 AND type = 'bonus' AND created_at >= $2 ORDER BY id DESC", [req.user.id, since]);
  const trips = rows.map((x) => {
    const noShow = x.status === 'cancelled';
    const walletTip = x.tip_method === 'wallet' ? x.tip : 0;
    return {
      id: x.id, at: x.completed_at || x.created_at, service: x.service, method: x.payment_method, noShow,
      from: x.pickup_address, to: x.drop_address, km: x.distance_km,
      fare: noShow ? 0 : x.fare, discount: noShow ? 0 : x.discount, commission: noShow ? 0 : x.commission,
      tip: x.tip || 0, tipMethod: x.tip_method, noShowFee: x.no_show_fee || 0,
      earning: noShow ? x.no_show_fee : x.fare - x.commission + walletTip,
    };
  });
  const sum = (k) => trips.reduce((a, t) => a + (t[k] || 0), 0);
  const bonusTotal = bon.reduce((a, b) => a + b.amount, 0);
  res.json({ days, since, trips, bonuses: bon, totals: { trips: trips.filter((t) => !t.noShow).length, fare: sum('fare'), commission: sum('commission'), discount: sum('discount'), tips: sum('tip'), noShowFees: sum('noShowFee'), bonuses: bonusTotal, earning: sum('earning') + bonusTotal } });
}));

// Pay the commission owed on cash trips by Mobile Money.
r.post('/driver/pay-debt', auth.requireAuth('driver'), wrap(async (req, res) => {
  const d = await db.one('SELECT earnings_balance FROM drivers WHERE user_id = $1', [req.user.id]);
  const owed = Math.max(0, -d.earnings_balance);
  if (!owed) return bad(res, 'You don’t owe anything right now.');
  let amount = Math.round(Number((req.body || {}).amount) || owed);
  amount = Math.min(owed, Math.max(Math.min(1000, owed), amount));
  let out;
  try { out = await payments.createCheckout({ user: req.user, amount, purpose: 'debt', method: 'momo', baseUrl: baseUrl(req) }); }
  catch (e) { if (e instanceof payments.PaymentsUnavailable) return bad(res, e.message.replace('Pay with cash for now.', 'Your balance clears from your next Mobile Money or wallet trips.'), 503); throw e; }
  const after = await db.one('SELECT earnings_balance FROM drivers WHERE user_id = $1', [req.user.id]);
  res.json({ ...out, balance: after.earnings_balance });
}));

// Ride alerts on a locked phone (Web Push).
r.get('/push/key', wrap(async (req, res) => res.json({ key: (await dtools.vapidKeys()).pub })));
r.post('/push/subscribe', auth.requireAuth(), wrap(async (req, res) => {
  if (!(await dtools.subscribe(req.user.id, (req.body || {}).subscription))) return bad(res, 'That subscription couldn’t be saved.');
  rt.markPush(req.user.id, true);
  res.json({ ok: true });
}));
r.post('/push/unsubscribe', auth.requireAuth(), wrap(async (req, res) => {
  await dtools.unsubscribe(req.user.id, (req.body || {}).endpoint);
  rt.markPush(req.user.id, await dtools.hasPush(req.user.id));
  res.json({ ok: true });
}));

r.post('/driver/withdraw', auth.requireAuth('driver'), wrap(async (req, res) => {
  const s = await getSettings();
  const amount = Math.round(Number(req.body.amount));
  if (!(amount >= s.minWithdrawal)) return bad(res, `Minimum withdrawal is UGX ${s.minWithdrawal.toLocaleString()}.`);
  const out = await db.tx(async (t) => {
    const d = await t.one('SELECT * FROM drivers WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    if (d.earnings_balance < amount) return { error: 'You cannot withdraw more than your balance.' };
    await t.query('UPDATE drivers SET earnings_balance = earnings_balance - $1 WHERE user_id = $2', [amount, req.user.id]);
    await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'withdrawal',$2,$3)", [req.user.id, -amount, `To ${d.momo_number}`]);
    return t.one('INSERT INTO withdrawals(driver_id, amount, momo_number) VALUES ($1,$2,$3) RETURNING *', [req.user.id, amount, d.momo_number]);
  });
  if (out.error) return bad(res, out.error);
  rt.io.to('admin').emit('admin:withdrawal', out);
  res.json({ ok: true, withdrawal: out });
}));

// ---------- Admin ----------
const admin = auth.requireAuth('admin');

r.get('/admin/stats', admin, wrap(async (req, res) => {
  const q = async (sql) => (await db.one(sql)) || {};
  res.json({
    riders: (await q("SELECT COUNT(*)::int n FROM users WHERE role = 'rider'")).n,
    drivers: (await q("SELECT COUNT(*)::int n FROM drivers WHERE status = 'approved'")).n,
    pendingDrivers: (await q("SELECT COUNT(*)::int n FROM drivers WHERE status = 'pending'")).n,
    onlineDrivers: rt.liveDrivers().length,
    activeTrips: (await q("SELECT COUNT(*)::int n FROM trips WHERE status IN ('requested','accepted','arrived','in_progress')")).n,
    today: await q(`SELECT COUNT(*)::int trips, COALESCE(SUM(fare),0)::int gmv, COALESCE(SUM(commission),0)::int revenue
      FROM trips WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'`),
    allTime: await q("SELECT COUNT(*)::int trips, COALESCE(SUM(fare),0)::int gmv, COALESCE(SUM(commission),0)::int revenue FROM trips WHERE status = 'completed'"),
    openSos: (await q('SELECT COUNT(*)::int n FROM sos_alerts WHERE resolved = FALSE')).n,
    pendingWithdrawals: (await q("SELECT COUNT(*)::int n FROM withdrawals WHERE status = 'pending'")).n,
    pendingChanges: (await q("SELECT COUNT(*)::int n FROM driver_changes WHERE status = 'pending'")).n,
    openReports: (await q('SELECT COUNT(*)::int n FROM driver_reports WHERE resolved = FALSE')).n,
    byService: (await db.query("SELECT service, COUNT(*)::int trips, COALESCE(SUM(fare),0)::int gmv FROM trips WHERE status = 'completed' GROUP BY service ORDER BY trips DESC")).rows,
  });
}));

r.get('/admin/live', admin, wrap(async (req, res) => {
  const { rows } = await db.query("SELECT id FROM trips WHERE status IN ('requested','accepted','arrived','in_progress') ORDER BY id DESC LIMIT 100");
  const trips = [];
  for (const row of rows) trips.push(rt.view(await rt.loadTrip(row.id), 'admin'));
  res.json({ drivers: rt.liveDrivers(), trips });
}));

r.get('/admin/drivers', admin, wrap(async (req, res) => {
  const { rows } = await db.query(`
    SELECT u.id, u.name, u.phone, u.blocked, u.rating_sum, u.rating_count, u.created_at, d.*,
      (SELECT COUNT(*)::int FROM trips t WHERE t.driver_id = u.id AND t.status = 'completed') AS trips,
      (SELECT COUNT(*)::int FROM driver_docs dd WHERE dd.user_id = u.id AND dd.kind <> 'insurance')
        + (SELECT CASE WHEN EXISTS (SELECT 1 FROM driver_changes c WHERE c.driver_id = u.id AND c.kind = 'photo' AND c.status = 'pending')
            AND NOT EXISTS (SELECT 1 FROM driver_docs dd WHERE dd.user_id = u.id AND dd.kind = 'photo') THEN 1 ELSE 0 END) AS docs,
      (SELECT MIN(dd.expires_on) FROM driver_docs dd WHERE dd.user_id = u.id AND dd.expires_on IS NOT NULL) AS next_expiry,
      (SELECT COUNT(*)::int FROM driver_events e WHERE e.driver_id = u.id AND e.kind = 'offer_accepted' AND e.created_at > NOW() - INTERVAL '30 days') AS ev_acc,
      (SELECT COUNT(*)::int FROM driver_events e WHERE e.driver_id = u.id AND e.kind IN ('offer_declined','offer_missed') AND e.created_at > NOW() - INTERVAL '30 days') AS ev_rej,
      (SELECT COUNT(*)::int FROM driver_events e WHERE e.driver_id = u.id AND e.kind = 'driver_cancelled' AND e.created_at > NOW() - INTERVAL '30 days') AS ev_can
    FROM drivers d JOIN users u ON u.id = d.user_id
    ORDER BY CASE d.status WHEN 'pending' THEN 0 ELSE 1 END, u.id DESC LIMIT 300`);
  res.json(rows.map((x) => ({
    id: x.id, name: x.name, phone: x.phone, status: x.status, vehicleType: x.vehicle_type, plate: x.plate,
    vehicle: [x.vehicle_color, x.vehicle_make].filter(Boolean).join(' '), licenseNo: x.license_no, momoNumber: x.momo_number,
    balance: x.earnings_balance, trips: x.trips, rating: x.rating_count ? Math.round((x.rating_sum / x.rating_count) * 10) / 10 : null,
    createdAt: x.created_at, docs: x.docs,
    nextExpiry: x.next_expiry ? (x.next_expiry instanceof Date ? x.next_expiry.toISOString() : String(x.next_expiry)).slice(0, 10) : null,
    acceptanceRate: x.ev_acc + x.ev_rej ? Math.round((x.ev_acc / (x.ev_acc + x.ev_rej)) * 100) : null,
    cancellationRate: x.ev_acc ? Math.round((x.ev_can / x.ev_acc) * 100) : null,
  })));
}));
// Photo and vehicle changes waiting for approval, shown next to what the team already approved.
r.get('/admin/changes', admin, wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT c.id, c.driver_id, c.kind, c.data, c.created_at, u.name, u.phone, d.plate, d.vehicle_make, d.vehicle_color, d.vehicle_type, d.status AS driver_status
    FROM driver_changes c JOIN users u ON u.id = c.driver_id JOIN drivers d ON d.user_id = c.driver_id
    WHERE c.status = 'pending' ORDER BY c.id`);
  const out = [];
  for (const r0 of rows) {
    const data = JSON.parse(r0.data);
    const { rows: docs } = await db.query("SELECT kind, mime, data FROM driver_docs WHERE user_id = $1 AND kind IN ('photo','national_id','license','vehicle')", [r0.driver_id]);
    const doc = Object.fromEntries(docs.map((x) => [x.kind, `data:${x.mime};base64,${x.data}`]));
    out.push({
      id: r0.id, kind: r0.kind, at: r0.created_at,
      driver: { id: r0.driver_id, name: r0.name, phone: r0.phone, status: r0.driver_status, vehicleType: r0.vehicle_type },
      current: r0.kind === 'photo' ? { photo: doc.photo || null } : { plate: r0.plate, vehicleMake: r0.vehicle_make, vehicleColor: r0.vehicle_color, photo: doc.vehicle || null },
      requested: r0.kind === 'photo' ? { photo: `data:${data.mime};base64,${data.data}` } : { plate: data.plate, vehicleMake: data.make, vehicleColor: data.color, photo: `data:${data.mime};base64,${data.photo}` },
      compare: r0.kind === 'photo' ? { national_id: doc.national_id || null, license: doc.license || null } : {},
    });
  }
  res.json(out);
}));
r.post('/admin/changes/:id', admin, wrap(async (req, res) => {
  const approve = (req.body || {}).decision === 'approve';
  const note = clean((req.body || {}).note, 200) || null;
  if (!approve && !note) return bad(res, 'Tell the driver why, so they can fix it.');
  let c;
  await db.tx(async (tx) => {
    c = await tx.one("UPDATE driver_changes SET status = $1, note = $2, decided_at = NOW() WHERE id = $3 AND status = 'pending' RETURNING *", [approve ? 'approved' : 'rejected', note, Number(req.params.id)]);
    if (!c || !approve) return;
    const d = JSON.parse(c.data);
    if (c.kind === 'photo') {
      await tx.query(`INSERT INTO driver_docs(user_id, kind, mime, data) VALUES ($1,'photo',$2,$3)
        ON CONFLICT (user_id, kind) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, created_at = NOW()`, [c.driver_id, d.mime, d.data]);
    } else {
      await tx.query('UPDATE drivers SET plate = $1, vehicle_make = $2, vehicle_color = $3 WHERE user_id = $4', [d.plate, d.make || null, d.color || null, c.driver_id]);
      await tx.query(`INSERT INTO driver_docs(user_id, kind, mime, data) VALUES ($1,'vehicle',$2,$3)
        ON CONFLICT (user_id, kind) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, created_at = NOW()`, [c.driver_id, d.mime, d.photo]);
    }
  });
  if (!c) return bad(res, 'This request was already handled.', 409);
  if (approve && c.kind === 'vehicle') rt.updateDriverVehicle(c.driver_id, JSON.parse(c.data).plate);
  const what = c.kind === 'photo' ? 'new profile photo' : 'vehicle change';
  const text = approve ? `Your ${what} was approved.` : `Your ${what} wasn’t approved: ${note}`;
  rt.notify(c.driver_id, 'driver:change', { kind: c.kind, status: approve ? 'approved' : 'rejected', note });
  rt.notify(c.driver_id, 'toast', { text });
  dtools.push(c.driver_id, { type: 'change', tag: `change-${c.kind}`, title: approve ? 'Approved' : 'Not approved', body: text }, { ttl: 86400, urgency: 'normal' }).catch(() => {});
  res.json({ ok: true });
}));

// Riders' reports that a driver or plate didn't match.
r.get('/admin/reports', admin, wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT r.id, r.trip_id, r.kind, r.note, r.resolved, r.dismissed, r.created_at, r.driver_id,
      d.name AS driver_name, d.phone AS driver_phone, rd.name AS rider_name, dv.plate, dv.status AS driver_status,
      (SELECT COUNT(DISTINCT x.rider_id)::int FROM driver_reports x WHERE x.driver_id = r.driver_id AND x.dismissed = FALSE AND x.created_at > NOW() - INTERVAL '30 days') AS reports30
    FROM driver_reports r JOIN users d ON d.id = r.driver_id JOIN users rd ON rd.id = r.rider_id JOIN drivers dv ON dv.user_id = r.driver_id
    ORDER BY r.resolved, r.id DESC LIMIT 200`);
  res.json(rows.map((x) => ({ id: x.id, tripId: x.trip_id, kind: x.kind, label: REPORT[x.kind], note: x.note, resolved: x.resolved, dismissed: x.dismissed, at: x.created_at,
    driver: { id: x.driver_id, name: x.driver_name, phone: x.driver_phone, plate: x.plate, status: x.driver_status }, rider: x.rider_name, reports30: x.reports30 })));
}));
r.post('/admin/reports/:id', admin, wrap(async (req, res) => {
  const dismiss = (req.body || {}).action === 'dismiss';
  const row = await db.one('UPDATE driver_reports SET resolved = TRUE, dismissed = $1 WHERE id = $2 RETURNING id', [dismiss, Number(req.params.id)]);
  if (!row) return bad(res, 'Report not found.', 404);
  res.json({ ok: true });
}));

r.get('/admin/drivers/:id/insights', admin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  res.json({ stats: await dtools.stats(id), docs: await dtools.docAlerts(id), bonuses: await dtools.bonusProgress(id) });
}));

// Onboard a verified driver. They sign in to the driver app with this phone and password.
r.post('/admin/drivers', admin, wrap(async (req, res) => {
  const out = await createAccount(req.body, 'driver', { approved: true });
  if (out.error) return bad(res, out.error);
  res.json({ ok: true, id: out.user.id });
}));

r.get('/admin/drivers/:id/documents', admin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query('SELECT kind, mime, data, created_at FROM driver_docs WHERE user_id = $1', [id]);
  const out = rows.map((x) => ({ kind: x.kind, label: ALL_DOCS[x.kind], url: `data:${x.mime};base64,${x.data}`, at: x.created_at }));
  const p = await db.one("SELECT data, created_at FROM driver_changes WHERE driver_id = $1 AND kind = 'photo' AND status = 'pending' ORDER BY id DESC LIMIT 1", [id]);
  if (p) {
    const x = JSON.parse(p.data);
    const item = { kind: 'photo', label: 'Profile photo · not checked yet', url: `data:${x.mime};base64,${x.data}`, at: p.created_at, pending: true };
    const i = out.findIndex((d) => d.kind === 'photo');
    if (i >= 0) out.splice(i + 1, 0, item); else out.push(item);
  }
  res.json(out);
}));

// Reset anyone's password (there's no SMS reset yet, so support does it).
r.post('/admin/users/:id/password', admin, wrap(async (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (pw.length < 6) return bad(res, 'Password must be at least 6 characters.');
  const u = await db.one("UPDATE users SET password_hash = $1 WHERE id = $2 AND role <> 'admin' RETURNING id", [await bcrypt.hash(pw, 10), Number(req.params.id)]);
  if (!u) return bad(res, 'User not found.', 404);
  res.json({ ok: true });
}));

r.post('/admin/drivers/:id/status', admin, wrap(async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'suspended', 'pending', 'rejected'].includes(status)) return bad(res, 'Invalid status.');
  const d = await db.one('UPDATE drivers SET status = $1 WHERE user_id = $2 RETURNING user_id', [status, Number(req.params.id)]);
  if (!d) return bad(res, 'Driver not found.', 404);
  if (status === 'approved') {
    // Approving a new driver means the team checked their photo against the ID: approve it too.
    const p = await db.one("SELECT id, data FROM driver_changes WHERE driver_id = $1 AND kind = 'photo' AND status = 'pending' ORDER BY id DESC LIMIT 1", [d.user_id]);
    const has = await db.one("SELECT 1 AS x FROM driver_docs WHERE user_id = $1 AND kind = 'photo'", [d.user_id]);
    if (p && !has) {
      const x = JSON.parse(p.data);
      await db.query(`INSERT INTO driver_docs(user_id, kind, mime, data) VALUES ($1,'photo',$2,$3)
        ON CONFLICT (user_id, kind) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, created_at = NOW()`, [d.user_id, x.mime, x.data]);
      await db.query("UPDATE driver_changes SET status = 'approved', decided_at = NOW() WHERE id = $1", [p.id]);
    }
  }
  if (status !== 'approved') rt.forceOffline(d.user_id);
  rt.notify(d.user_id, 'driver:status', { status });
  res.json({ ok: true });
}));

r.get('/admin/riders', admin, wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT u.id, u.name, u.phone, u.wallet_balance, u.blocked, u.created_at,
      (SELECT COUNT(*)::int FROM trips t WHERE t.rider_id = u.id AND t.status = 'completed') AS trips
    FROM users u WHERE role = 'rider' ORDER BY id DESC LIMIT 300`);
  res.json(rows);
}));

r.post('/admin/users/:id/block', admin, wrap(async (req, res) => {
  await db.query("UPDATE users SET blocked = $1 WHERE id = $2 AND role <> 'admin'", [!!req.body.blocked, Number(req.params.id)]);
  if (req.body.blocked) rt.forceOffline(Number(req.params.id));
  res.json({ ok: true });
}));

r.get('/admin/trips', admin, wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id FROM trips ORDER BY id DESC LIMIT 100');
  const out = [];
  for (const row of rows) out.push(rt.view(await rt.loadTrip(row.id), 'admin'));
  res.json(out);
}));

r.get('/admin/promos', admin, wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT p.*, (SELECT COUNT(*)::int FROM trips t WHERE t.promo_code = p.code AND t.status IN ('requested','accepted','arrived','in_progress','completed','scheduled')) AS uses,
    (SELECT COALESCE(SUM(discount),0)::int FROM trips t WHERE t.promo_code = p.code AND t.status = 'completed') AS spent FROM promos p ORDER BY created_at DESC`);
  const fr = await db.one("SELECT COUNT(*)::int AS n, COALESCE(SUM(discount),0)::int AS spent FROM trips WHERE discount > 0 AND promo_code IS NULL AND status = 'completed'");
  const ref = await db.one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::int AS spent FROM transactions WHERE type = 'reward'");
  res.json({ promos: rows, firstRide: fr, rewardsPaid: ref });
}));
r.post('/admin/promos', admin, wrap(async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 3 || code.length > 20) return bad(res, 'Codes are 3–20 letters or numbers.');
  const kind = b.kind === 'flat' ? 'flat' : 'percent';
  const value = Math.round(Number(b.value));
  if (!(value > 0) || (kind === 'percent' && value > 100)) return bad(res, kind === 'percent' ? 'Enter a percentage from 1 to 100.' : 'Enter the amount off in UGX.');
  const num = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(Number(v)) || 0));
  if (await db.one('SELECT code FROM promos WHERE code = $1', [code])) return bad(res, 'That code already exists.');
  await db.query(`INSERT INTO promos(code, kind, value, max_discount, min_fare, max_uses, per_user, first_ride_only, services, expires_at, note)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  [code, kind, value, num(b.maxDiscount), num(b.minFare) || 0, num(b.maxUses), Math.max(1, num(b.perUser) || 1), !!b.firstRideOnly,
    Array.isArray(b.services) && b.services.length ? b.services.join(',') : null, b.expiresAt ? new Date(b.expiresAt) : null, b.note ? String(b.note).slice(0, 120) : null]);
  res.json({ ok: true, code });
}));
r.post('/admin/promos/:code/active', admin, wrap(async (req, res) => {
  await db.query('UPDATE promos SET active = $1 WHERE code = $2', [!!(req.body || {}).active, String(req.params.code).toUpperCase()]);
  res.json({ ok: true });
}));

r.get('/admin/settings', admin, wrap(async (req, res) => res.json(await getSettings())));
r.put('/admin/settings', admin, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.supportPhone !== undefined && String(b.supportPhone).trim() && !/^\+?[0-9][0-9 ]{7,17}$/.test(String(b.supportPhone).trim())) {
    return bad(res, 'Support phone: use digits only, e.g. 0800 100 200 or +256 772 123456. Leave it empty to hide it.');
  }
  res.json(await updateSettings(b));
}));

r.get('/admin/sos', admin, wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT s.*, u.name, u.phone, u.role, u.emergency_contact FROM sos_alerts s
    JOIN users u ON u.id = s.user_id ORDER BY s.resolved, s.id DESC LIMIT 50`);
  res.json(rows);
}));
r.post('/admin/sos/:id/resolve', admin, wrap(async (req, res) => {
  await db.query('UPDATE sos_alerts SET resolved = TRUE WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

r.get('/admin/withdrawals', admin, wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT w.*, u.name, u.phone FROM withdrawals w JOIN users u ON u.id = w.driver_id
    ORDER BY CASE w.status WHEN 'pending' THEN 0 ELSE 1 END, w.id DESC LIMIT 100`);
  res.json(rows);
}));
r.post('/admin/withdrawals/:id', admin, wrap(async (req, res) => {
  const status = req.body.status;
  if (!['paid', 'rejected'].includes(status)) return bad(res, 'Invalid status.');
  const out = await db.tx(async (t) => {
    const w = await t.one("SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending' FOR UPDATE", [Number(req.params.id)]);
    if (!w) return null;
    await t.query('UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2', [status, w.id]);
    if (status === 'rejected') { // give the money back
      await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [w.amount, w.driver_id]);
      await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'refund',$2,'Withdrawal rejected')", [w.driver_id, w.amount]);
    }
    return w;
  });
  if (!out) return bad(res, 'Already processed.');
  rt.notify(out.driver_id, 'toast', { text: status === 'paid' ? `UGX ${out.amount.toLocaleString()} sent to your Mobile Money 💸` : 'Withdrawal was rejected and refunded to your balance.' });
  res.json({ ok: true });
}));

module.exports = r;
