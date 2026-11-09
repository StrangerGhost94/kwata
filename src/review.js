// App Store and Google Play review accounts.
//
// Reviewers work outside Uganda, can't receive our SMS codes, and have no real riders or drivers
// near them. With these variables set, two review accounts sign in with a fixed code, and two demo
// characters make every flow work end to end:
//
//   REVIEW_CODE          6 digits, the sign-in code for both review accounts (turns review mode on)
//   REVIEW_RIDER_PHONE   the rider account the reviewer uses, e.g. 0700 000 101
//   REVIEW_DRIVER_PHONE  the driver account the reviewer uses (already approved), e.g. 0700 000 102
//   REVIEW_PIN           4 digits the reviewer types to start a demo trip as a driver (default 1234)
//
// - The reviewer's rider requests are served by a demo driver, who accepts, drives to the pickup,
//   arrives, starts and completes the trip on their own. Pay with cash.
// - When the reviewer's driver account goes online, a demo rider requests a trip next to them. The
//   start PIN is REVIEW_PIN.
// Demo trips only ever involve these four accounts: real riders never see the demo driver, and the
// review driver never gets real requests. Remove REVIEW_CODE after the review to turn it all off.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const auth = require('./auth');
const { getSettings, haversineKm } = require('./pricing');

const ANCHOR = { lat: 0.3136, lng: 32.5811 };   // central Kampala: where reviewers outside Uganda are placed
const BOT_DRIVER_PHONE = '+256000000901';        // not a real number, so it can never clash with a person
const BOT_RIDER_PHONE = '+256000000902';
const STEP_MS = 2000;
const SPEED = Math.max(1, Number(process.env.REVIEW_SPEED) || 1);   // tests run the demo trips faster

const code = () => String(process.env.REVIEW_CODE || '').trim();
const pin = () => (/^\d{4}$/.test(String(process.env.REVIEW_PIN || '').trim()) ? String(process.env.REVIEW_PIN).trim() : '1234');
const riderPhone = () => auth.normalizePhone(process.env.REVIEW_RIDER_PHONE || '');
const driverPhone = () => auth.normalizePhone(process.env.REVIEW_DRIVER_PHONE || '');
const on = () => /^\d{6}$/.test(code()) && !!(riderPhone() || driverPhone());

const ids = { rider: null, driver: null, botDriver: null, botRider: null };
const demoIds = new Set();
let rt = null, base = '';

function isReviewPhone(p) { return on() && !!p && (p === riderPhone() || p === driverPhone()); }
// Demo accounts: the two reviewers and the two demo characters.
function isDemo(userId) { return on() && demoIds.has(userId); }
function isReviewDriver(userId) { return on() && userId != null && userId === ids.driver; }

// Sign-in: store the fixed code for a review number instead of sending an SMS.
async function storeCode(p) {
  const now = Date.now();
  await db.query(`INSERT INTO otp_codes(phone, code_hash, expires_at, attempts, sent_at, hour_start, sends_hour) VALUES ($1,$2,$3,0,$4,$4,1)
    ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = $3, attempts = 0, sent_at = $4, hour_start = $4, sends_hour = 1`,
  [p, auth.hashCode(p, code()), now + 3600e3, now]);
}

async function ensureUser(phone, name, role, driver) {
  let u = await db.one('SELECT * FROM users WHERE phone = $1', [phone]);
  if (!u) {
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('base64'), 10);
    u = await db.one('INSERT INTO users(name, phone, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING *', [name, phone, hash, role]);
  }
  if (driver && u.role === 'driver') {
    const s = await getSettings();
    const services = Object.entries(s.services).filter(([, v]) => v.vehicle === 'car').map(([id]) => id).join(',') || 'car';
    await db.query(`INSERT INTO drivers(user_id, vehicle_type, services, plate, vehicle_make, vehicle_color, license_no, momo_number, status)
      VALUES ($1,'car',$2,$3,$4,$5,$6,$7,'approved') ON CONFLICT (user_id) DO UPDATE SET status = 'approved'`,
    [u.id, services, driver.plate, driver.make, driver.color, 'REVIEW', phone]);
  }
  return u;
}

// Creates (or finds) the four accounts. Safe to call on every start.
async function setup(realtime, port) {
  rt = realtime;
  base = `http://127.0.0.1:${port}/api`;
  if (!on()) return;
  try {
    if (riderPhone()) ids.rider = (await ensureUser(riderPhone(), 'App Review', 'rider')).id;
    if (driverPhone()) ids.driver = (await ensureUser(driverPhone(), 'App Review Driver', 'driver', { plate: 'UBR 101R', make: 'Toyota Premio', color: 'Silver' })).id;
    ids.botDriver = (await ensureUser(BOT_DRIVER_PHONE, 'Moses (demo driver)', 'driver', { plate: 'UBR 901D', make: 'Toyota Corolla', color: 'White' })).id;
    ids.botRider = (await ensureUser(BOT_RIDER_PHONE, 'Grace (demo rider)', 'rider')).id;
    Object.values(ids).forEach((id) => id && demoIds.add(id));
    rt.botDriver(ids.botDriver, { name: 'Moses (demo driver)', plate: 'UBR 901D' });
    console.log('Review mode on: review accounts ready', JSON.stringify({ rider: !!ids.rider, driver: !!ids.driver }));
  } catch (e) { console.error('review setup:', e.message); }
}

// ---------- calling our own API as a demo character ----------
const tokenFor = (id, role) => auth.sign({ id, role });
async function api(path, body, id, role) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(id, role) }, body: JSON.stringify(body || {}) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${out.error || r.status}`);
  return out;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
const offset = (p, kmNorth, kmEast) => ({ lat: p.lat + kmNorth / 111, lng: p.lng + kmEast / (111 * Math.cos(p.lat * Math.PI / 180)) });
async function tripRow(id) { return db.one('SELECT * FROM trips WHERE id = $1', [id]); }
const alive = async (id, statuses) => { const t = await tripRow(id); return t && statuses.includes(t.status) ? t : null; };

// Drive the demo driver along a straight line, a step every 2 seconds.
async function drive(tripId, from, to, seconds, statuses) {
  const steps = Math.max(3, Math.round((seconds * 1000) / STEP_MS));
  for (let i = 1; i <= steps; i++) {
    if (!(await alive(tripId, statuses))) return false;
    const f = i / steps;
    rt.moveDriver(ids.botDriver, from.lat + (to.lat - from.lat) * f, from.lng + (to.lng - from.lng) * f);
    await wait(STEP_MS);
  }
  return true;
}

// ---------- the demo driver serves the review rider ----------
// Placed about a kilometre from the pickup whenever a review trip is dispatched.
function placeBot(d, pickup) { const p = offset(pickup, 0.7, 0.6); d.lat = p.lat; d.lng = p.lng; d.updatedAt = Date.now(); }
const busyTrips = new Set();
function botOffer(tripId) {
  if (busyTrips.has(tripId)) return;
  busyTrips.add(tripId);
  runBotDriver(tripId).catch((e) => console.error('review demo driver:', e.message)).finally(() => busyTrips.delete(tripId));
}
async function runBotDriver(tripId) {
  await wait(3000);
  const r = await rt.respond(ids.botDriver, tripId, true);
  if (!r.ok) return;
  let t = await tripRow(tripId);
  const pickup = { lat: t.pickup_lat, lng: t.pickup_lng }, drop = { lat: t.drop_lat, lng: t.drop_lng };
  const d = rt.driverState(ids.botDriver) || {};
  const start = d.lat ? { lat: d.lat, lng: d.lng } : offset(pickup, 0.7, 0.6);
  if (!(await drive(tripId, start, pickup, 24, ['accepted']))) return;
  await api(`/trips/${tripId}/arrived`, {}, ids.botDriver, 'driver');
  await wait(15000);
  t = await alive(tripId, ['arrived']);
  if (!t) return;
  await api(`/trips/${tripId}/start`, { pin: t.pin }, ids.botDriver, 'driver');
  const secs = Math.min(60, Math.max(30, haversineKm(pickup, drop) * 8));
  if (!(await drive(tripId, pickup, drop, secs, ['in_progress']))) return;
  await api(`/trips/${tripId}/complete`, { code: t.drop_code || undefined }, ids.botDriver, 'driver');
  // Demo trips never build up commission owed, which would stop cash requests reaching the demo driver.
  await db.query('UPDATE drivers SET earnings_balance = 0 WHERE user_id = $1', [ids.botDriver]);
}

// ---------- the demo rider gives the review driver trips ----------
let riderLoop = null;
function driverOnline(userId, online) {
  if (!isReviewDriver(userId)) return;
  clearTimeout(riderLoop);
  if (online) riderLoop = setTimeout(() => requestForReviewDriver().catch((e) => console.error('review demo rider:', e.message)), 8000 / SPEED);
}
async function requestForReviewDriver() {
  const d = rt.driverState(ids.driver);
  if (!d || !d.online) return;
  const open = await db.one("SELECT id FROM trips WHERE rider_id = $1 AND status IN ('requested','accepted','arrived','in_progress') LIMIT 1", [ids.botRider]);
  if (!open && !d.busy) {
    const here = d.lat ? { lat: d.lat, lng: d.lng } : ANCHOR;
    const pickup = { ...offset(here, 0.4, 0.3), address: 'Demo pickup · Kampala Road' };
    const drop = { ...offset(here, 2.2, 1.6), address: 'Demo destination · Acacia Mall' };
    const s = await getSettings();
    const service = (d.services || []).find((x) => s.services[x] && s.services[x].enabled && !['parcel', 'errand'].includes(x)) || 'car';
    const t = await api('/trips', { service, paymentMethod: 'cash', pickup, drop, distanceKm: 3, durationMin: 10 }, ids.botRider, 'rider');
    await db.query('UPDATE trips SET pin = $1 WHERE id = $2', [pin(), t.id]);
  }
  // Check again later: the next request comes once this one is finished or has run out.
  clearTimeout(riderLoop);
  riderLoop = setTimeout(() => requestForReviewDriver().catch((e) => console.error('review demo rider:', e.message)), 20000 / SPEED);
}
// The review driver's phone is wherever the reviewer is. Anywhere outside East Africa counts as central Kampala.
function mapLocation(userId, lat, lng) {
  if (!isReviewDriver(userId)) return null;
  if (lat >= -12 && lat <= 6 && lng >= 28 && lng <= 42) return null;
  return ANCHOR;
}
// After a demo trip, clear the commission the review driver would otherwise owe for cash.
async function afterTrip(t) {
  if (!t || !on() || !isDemo(t.rider_id)) return;
  if (t.driver_id === ids.driver) await db.query('UPDATE drivers SET earnings_balance = GREATEST(earnings_balance, 0) WHERE user_id = $1', [ids.driver]).catch(() => {});
}

module.exports = { on, isReviewPhone, isDemo, isReviewDriver, storeCode, setup, placeBot, botOffer, driverOnline, mapLocation, afterTrip, pin, ids, ANCHOR };
