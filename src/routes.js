const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const auth = require('./auth');
const rt = require('./realtime');
const ledger = require('./ledger');
const payments = require('./payments');
const { getSettings, updateSettings, quote, calcFare, trustedDistance } = require('./pricing');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;

function point(p) {
  if (!p) return null;
  const lat = Number(p.lat), lng = Number(p.lng);
  // Rough bounding box for East Africa — keeps junk coordinates out.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -12 || lat > 6 || lng < 28 || lng > 42) return null;
  return { lat, lng, address: String(p.address || '').slice(0, 200) };
}

// Tiny in-memory rate limiter for login / register
const hits = new Map();
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

// ---------- Public ----------
r.get('/config', wrap(async (req, res) => {
  const s = await getSettings();
  res.json({
    services: Object.entries(s.services).filter(([, v]) => v.enabled).map(([id, v]) => ({ id, name: v.name, icon: v.icon, vehicle: v.vehicle, seats: v.seats, blurb: v.blurb })),
    paymentsLive: payments.enabled(),
    commissionPct: s.commissionPct,
    supportPhone: s.supportPhone,
    minWithdrawal: s.minWithdrawal,
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
  if (!name || String(name).trim().length < 2) return { error: 'Enter the full name.' };
  if (!p) return { error: 'Enter a valid Ugandan phone number, e.g. 0772 123456.' };
  if (!password || String(password).length < 6) return { error: 'Password must be at least 6 characters.' };
  if (await db.one('SELECT id FROM users WHERE phone = $1', [p])) return { error: 'This phone number already has an account.' };

  let driverInfo = null;
  if (role === 'driver') {
    const { vehicleType, plate, vehicleMake, vehicleColor, licenseNo, momoNumber } = body;
    if (!['boda', 'car'].includes(vehicleType)) return { error: 'Choose boda or car.' };
    if (!plate || String(plate).trim().length < 4) return { error: 'Enter the number plate.' };
    if (!licenseNo) return { error: 'Enter the driving permit number.' };
    const s = await getSettings();
    const services = Object.entries(s.services).filter(([, v]) => v.vehicle === vehicleType).map(([id]) => id);
    driverInfo = {
      vehicleType, services: services.join(','), plate: String(plate).toUpperCase().trim(),
      vehicleMake: String(vehicleMake || '').slice(0, 60), vehicleColor: String(vehicleColor || '').slice(0, 30),
      licenseNo: String(licenseNo).slice(0, 40), momo: auth.normalizePhone(momoNumber) || p,
    };
  }

  const hash = await bcrypt.hash(String(password), 10);
  const user = await db.tx(async (t) => {
    const u = await t.one('INSERT INTO users(name, phone, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [String(name).trim().slice(0, 80), p, email ? String(email).slice(0, 120) : null, hash, role]);
    if (driverInfo) {
      await t.query(`INSERT INTO drivers(user_id, vehicle_type, services, plate, vehicle_make, vehicle_color, license_no, momo_number, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.id, driverInfo.vehicleType, driverInfo.services, driverInfo.plate, driverInfo.vehicleMake, driverInfo.vehicleColor, driverInfo.licenseNo, driverInfo.momo, approved ? 'approved' : 'pending']);
    }
    return u;
  });
  return { user };
}

// Public sign-up is for riders only. Drivers are added by the Kwata team after
// checking their permit, logbook and ID in person.
r.post('/auth/register', limit(10, 10 * 60e3), wrap(async (req, res) => {
  const role = (req.body || {}).role || 'rider';
  if (role !== 'rider') return bad(res, 'Driver accounts are created by the Kwata team after verification.', 403);
  const out = await createAccount(req.body, 'rider');
  if (out.error) return bad(res, out.error);
  res.json({ token: auth.sign(out.user), user: auth.publicUser(out.user) });
}));

r.post('/me/password', auth.requireAuth(), wrap(async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await bcrypt.compare(String(current || ''), req.user.password_hash))) return bad(res, 'Your current password is wrong.');
  if (!next || String(next).length < 6) return bad(res, 'New password must be at least 6 characters.');
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
  const { name, email, emergencyContact, savedPlaces } = req.body || {};
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
    [name ? String(name).slice(0, 80) : null, email ? String(email).slice(0, 120) : null, ec, req.user.id]);
  res.json({ user: auth.publicUser(u) });
}));

// ---------- Rider ----------
r.post('/fare/estimate', auth.requireAuth(), wrap(async (req, res) => {
  const pickup = point(req.body.pickup), drop = point(req.body.drop);
  if (!pickup || !drop) return bad(res, 'Choose a pickup and a destination.');
  const q = await quote(pickup, drop, req.body.distanceKm, req.body.durationMin);
  // How far is the nearest free driver for each ride type?
  for (const o of q.options) {
    const near = rt.nearbyDrivers(pickup.lat, pickup.lng, o.id)[0];
    o.etaMin = near ? Math.max(2, Math.round(((near.km * 1.3) / 20) * 60)) : null;
  }
  res.json(q);
}));

r.get('/drivers/nearby', auth.requireAuth(), wrap(async (req, res) => {
  res.json(rt.nearbyDrivers(Number(req.query.lat), Number(req.query.lng), req.query.service));
}));

r.post('/trips', auth.requireAuth('rider'), wrap(async (req, res) => {
  const { service, paymentMethod = 'cash', distanceKm, durationMin, parcel, notes } = req.body || {};
  const pickup = point(req.body.pickup), drop = point(req.body.drop);
  if (!pickup || !drop) return bad(res, 'Choose a pickup and a destination.');
  const s = await getSettings();
  const svc = s.services[service];
  if (!svc || !svc.enabled) return bad(res, 'That ride type is not available.');
  if (!['cash', 'wallet', 'momo', 'card'].includes(paymentMethod)) return bad(res, 'Choose a payment method.');

  const busy = await db.one(
    "SELECT id FROM trips WHERE rider_id = $1 AND status IN ('requested','accepted','arrived','in_progress')", [req.user.id]);
  if (busy) return bad(res, 'You already have a trip in progress.');

  const { km, min } = trustedDistance(pickup, drop, distanceKm, durationMin);
  const fare = calcFare(svc, km, min);
  if (paymentMethod === 'wallet' && req.user.wallet_balance < fare) {
    return bad(res, `Your wallet has UGX ${req.user.wallet_balance.toLocaleString()}. Top up or choose another payment method.`);
  }

  let parcelJson = null;
  if (service === 'parcel') {
    const pc = parcel || {};
    const rp = auth.normalizePhone(pc.recipientPhone);
    if (!pc.recipientName || !rp || !pc.item) return bad(res, 'Add the recipient name, phone and what you are sending.');
    parcelJson = JSON.stringify({ recipientName: String(pc.recipientName).slice(0, 80), recipientPhone: rp, item: String(pc.item).slice(0, 120) });
  }

  const pin = String(crypto.randomInt(1000, 10000));
  const share = crypto.randomBytes(12).toString('base64url');
  const t = await db.one(`
    INSERT INTO trips(rider_id, service, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address,
      distance_km, duration_min, fare, payment_method, pin, share_token, parcel, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
  [req.user.id, service, pickup.lat, pickup.lng, pickup.address, drop.lat, drop.lng, drop.address,
    km, min, fare, paymentMethod, pin, share, parcelJson, notes ? String(notes).slice(0, 200) : null]);

  rt.dispatch(t.id).catch(console.error);
  const full = await rt.loadTrip(t.id);
  rt.io.to('admin').emit('admin:trip', rt.view(full, 'admin'));
  res.json(rt.view(full, 'rider'));
}));

r.get('/trips/active', auth.requireAuth(), wrap(async (req, res) => {
  const col = req.user.role === 'driver' ? 'driver_id' : 'rider_id';
  // Also return a just-finished trip that still needs rating or payment.
  const t = await db.one(`
    SELECT id FROM trips WHERE ${col} = $1 AND (
      status IN ('requested','accepted','arrived','in_progress')
      OR (status = 'completed' AND completed_at > NOW() - INTERVAL '2 hours' AND (
        ${req.user.role === 'driver' ? 'driver_rating IS NULL' : "rider_rating IS NULL OR payment_status = 'pending'"}))
    ) ORDER BY id DESC LIMIT 1`, [req.user.id]);
  if (!t) return res.json(null);
  res.json(rt.view(await rt.loadTrip(t.id), req.user.role === 'driver' ? 'driver' : 'rider'));
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
  const allowed = role === 'rider' ? ['requested', 'accepted', 'arrived'] : ['accepted', 'arrived'];
  if (!allowed.includes(t.status)) return bad(res, 'This trip can no longer be cancelled.');
  if (role === 'driver') {
    // Don't strand the rider: put the request back and find another driver.
    await db.query("UPDATE trips SET status = 'requested', driver_id = NULL, accepted_at = NULL, arrived_at = NULL WHERE id = $1", [t.id]);
    rt.setDriverFree(req.user.id);
    rt.io.in(`user:${req.user.id}`).socketsLeave(`trip:${t.id}`);
    rt.notify(t.rider_id, 'toast', { text: 'Your driver cancelled. Finding you another one…' });
    rt.notify(req.user.id, 'trip:update', { id: t.id, status: 'cancelled', cancelledBy: 'driver' });
    await rt.broadcast(t.id);
    rt.dispatch(t.id, req.user.id).catch(console.error);
    return res.json({ ok: true });
  }
  await db.query("UPDATE trips SET status = 'cancelled', cancelled_by = $1, cancel_reason = $2 WHERE id = $3",
    [role, String((req.body || {}).reason || '').slice(0, 200), t.id]);
  rt.clearOffer(t.id);
  if (t.driver_id) rt.setDriverFree(t.driver_id);
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
  const lat = Number(req.body.lat) || null, lng = Number(req.body.lng) || null;
  const a = await db.one('INSERT INTO sos_alerts(trip_id, user_id, lat, lng) VALUES ($1,$2,$3,$4) RETURNING *', [t.id, req.user.id, lat, lng]);
  rt.io.to('admin').emit('admin:sos', { id: a.id, tripId: t.id, user: req.user.name, phone: req.user.phone, lat, lng });
  res.json({ ok: true, emergencyContact: req.user.emergency_contact, shareToken: t.share_token });
}));

r.post('/trips/:id/pay', auth.requireAuth('rider'), wrap(async (req, res) => {
  const t = await ownTrip(req, res, 'rider');
  if (!t) return;
  if (t.status !== 'completed' || t.payment_status === 'paid') return bad(res, 'Nothing to pay on this trip.');
  if (!['momo', 'card'].includes(t.payment_method)) return bad(res, 'This trip is paid in cash or wallet.');
  const out = await payments.createCheckout({ user: req.user, amount: t.fare, purpose: 'trip', tripId: t.id, method: t.payment_method, baseUrl: baseUrl(req) });
  if (out.demo) await rt.broadcast(t.id);
  res.json(out);
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
  rt.notify(t.rider_id, 'toast', { text: 'Your driver has arrived 👋' });
  res.json({ ok: true });
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
  await db.tx(async (tx) => {
    const fresh = await tx.one("UPDATE trips SET status = 'completed', completed_at = NOW() WHERE id = $1 AND status = 'in_progress' RETURNING *", [t.id]);
    if (fresh) await ledger.settleCompletedTrip(tx, fresh);
  });
  rt.setDriverFree(req.user.id);
  await rt.broadcast(t.id);
  res.json({ ok: true });
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
  const out = await payments.createCheckout({ user: req.user, amount, purpose: 'topup', method, baseUrl: baseUrl(req) });
  const u = await db.one('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
  res.json({ ...out, balance: u.wallet_balance });
}));

// ---------- Payments (Flutterwave) ----------
r.get('/payments/callback', wrap(async (req, res) => {
  const ref = String(req.query.tx_ref || '');
  const result = ref ? await payments.verifyAndApply(ref) : { ok: false };
  const p = ref && await db.one('SELECT * FROM payments WHERE tx_ref = $1', [ref]);
  if (p && p.trip_id && result.ok) await rt.broadcast(p.trip_id);
  if (p && result.ok) rt.notify(p.user_id, 'toast', { text: 'Payment received ✅' });
  res.redirect(`/rider.html?payment=${result.ok ? 'success' : 'failed'}`);
}));

r.post('/payments/webhook', wrap(async (req, res) => {
  if (!payments.webhookAuthentic(req)) return res.status(401).end();
  const ref = req.body && req.body.data && req.body.data.tx_ref;
  if (ref) {
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
  res.json({ balance: d.earnings_balance, momoNumber: d.momo_number, today, week, transactions: tx, withdrawals: wd });
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
      (SELECT COUNT(*)::int FROM trips t WHERE t.driver_id = u.id AND t.status = 'completed') AS trips
    FROM drivers d JOIN users u ON u.id = d.user_id
    ORDER BY CASE d.status WHEN 'pending' THEN 0 ELSE 1 END, u.id DESC LIMIT 300`);
  res.json(rows.map((x) => ({
    id: x.id, name: x.name, phone: x.phone, status: x.status, vehicleType: x.vehicle_type, plate: x.plate,
    vehicle: [x.vehicle_color, x.vehicle_make].filter(Boolean).join(' '), licenseNo: x.license_no, momoNumber: x.momo_number,
    balance: x.earnings_balance, trips: x.trips, rating: x.rating_count ? Math.round((x.rating_sum / x.rating_count) * 10) / 10 : null,
    createdAt: x.created_at,
  })));
}));

// Onboard a verified driver. They sign in to the driver app with this phone and password.
r.post('/admin/drivers', admin, wrap(async (req, res) => {
  const out = await createAccount(req.body, 'driver', { approved: true });
  if (out.error) return bad(res, out.error);
  res.json({ ok: true, id: out.user.id });
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

r.get('/admin/settings', admin, wrap(async (req, res) => res.json(await getSettings())));
r.put('/admin/settings', admin, wrap(async (req, res) => res.json(await updateSettings(req.body || {}))));

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
