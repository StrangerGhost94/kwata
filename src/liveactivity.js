// The trip on an iPhone's lock screen and Dynamic Island (the rider app's Live Activity,
// apps/ios-live-activity). The app starts it when a driver accepts and sends us its push token;
// from then on the server keeps it current through Firebase (src/fcm.js), so it follows the trip
// even when the app is closed: on the way (with minutes), almost here, arrived, on the trip, done.
// The "content-state" fields must match FlytteTripAttributes.ContentState in the Swift code.
const db = require('./db');
const fcm = require('./fcm');
const { haversineKm } = require('./pricing');

const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'Your driver';
const short = (a, d) => String(a || d).split(',')[0];
const CITY_KMH = 22;                       // Kampala traffic, for the minutes until pickup
const ETA_EVERY_MS = 45e3;                 // Apple limits how often a Live Activity may update

// Title and line under it for each moment. Kept in step with the app's own (public/js/native.js).
function content(t, status, etaMinutes = null) {
  const who = first(t.driver_name), plate = t.plate || '';
  const car = [t.vehicle_color, t.vehicle_make].filter(Boolean).join(' ');
  const parcel = ['parcel', 'errand'].includes(t.service);
  const s = {
    accepted: [`${who} is on the way`, [car, `Pickup: ${short(t.pickup_address, 'your pickup')}`].filter(Boolean).join(' · ')],
    near: [`${who} is almost here`, ['Head to the pickup', car].filter(Boolean).join(' · ')],
    arrived: [`${who} has arrived`, ['Meet them at the pickup', car].filter(Boolean).join(' · ')],
    in_progress: [parcel ? 'Your parcel is on its way' : `On your way to ${short(t.drop_address, 'your destination')}`, [`With ${who}`, plate].filter(Boolean).join(' · ')],
    completed: [t.service === 'parcel' ? 'Parcel delivered' : 'You’ve arrived', 'Thanks for riding with Flytte'],
    searching: ['Finding you another driver', 'Your driver couldn’t make it. We’re matching you again.'],
    cancelled: t.cancelled_by === 'rider' ? ['Trip cancelled', 'You cancelled this trip'] : t.driver_id ? [`${who} cancelled`, 'Open Flytte to request again'] : ['No driver this time', 'Open Flytte to request again'],
  }[status];
  if (!s) return null;
  return { status, title: s[0], subtitle: s[1], plate: status === 'searching' ? '' : plate, etaMinutes: ['accepted', 'near'].includes(status) ? etaMinutes : null };
}
const etaFrom = (km) => (km == null ? null : Math.max(1, Math.round((km / CITY_KMH) * 60)));

async function register(userId, tripId, token) {
  token = String(token || '').trim();
  if (!/^[0-9a-f]{32,400}$/i.test(token)) return false;
  const t = await db.one("SELECT id FROM trips WHERE id = $1 AND rider_id = $2 AND status IN ('accepted','arrived','in_progress')", [Number(tripId), userId]);
  if (!t) return false;
  await db.query(`INSERT INTO live_activity_tokens(trip_id, user_id, token) VALUES ($1,$2,$3)
    ON CONFLICT (trip_id) DO UPDATE SET token = $3, user_id = $2, updated_at = NOW()`, [t.id, userId, token]);
  return true;
}

const last = new Map();   // tripId -> { key, at }
async function push(t, status, { etaMinutes = null, force = false } = {}) {
  if (!fcm.configured()) return false;
  const row = await db.one('SELECT user_id, token FROM live_activity_tokens WHERE trip_id = $1', [t.id]);
  if (!row) return false;
  const state = content(t, status, etaMinutes);
  if (!state) return false;
  const key = `${status}:${state.etaMinutes}`, prev = last.get(t.id), now = Date.now();
  if (!force && prev && (prev.key === key || (prev.key.split(':')[0] === status && now - prev.at < ETA_EVERY_MS))) return false;
  last.set(t.id, { key, at: now });
  const end = ['completed', 'cancelled'].includes(status);
  const aps = { timestamp: Math.floor(now / 1000), event: end ? 'end' : 'update', 'content-state': state,
    ...(end ? { 'dismissal-date': Math.floor(now / 1000) + 5 * 60 } : {}) };
  // The big moments also light up the screen; ETA ticks don't.
  if (['accepted', 'near', 'arrived'].includes(status) && prev && prev.key.split(':')[0] !== status) aps.alert = { title: state.title, body: state.subtitle };
  const ok = await fcm.sendLiveActivity(row.user_id, row.token, aps);
  if (end) { last.delete(t.id); await db.query('DELETE FROM live_activity_tokens WHERE trip_id = $1', [t.id]).catch(() => {}); }
  return ok;
}

// From realtime.broadcast: the trip's status changed (or was re-sent).
function onTrip(t, driver) {
  // Back to "requested" after a driver cancelled: the rider is being matched again.
  const status = t.status === 'cancelled' || t.status === 'no_drivers' ? 'cancelled' : t.status === 'requested' ? 'searching' : t.status;
  if (!['searching', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'].includes(status)) return;
  const km = status === 'accepted' && driver && driver.lat ? haversineKm(driver, { lat: t.pickup_lat, lng: t.pickup_lng }) : null;
  push(t, status, { etaMinutes: etaFrom(km) }).catch((e) => console.error('live activity', e.message));
}
// From realtime.driverLocation: minutes until pickup while the driver is coming.
function onDriverMoved(t, km) {
  if (!t || t.status !== 'accepted') return;
  push(t, km < 0.35 ? 'near' : 'accepted', { etaMinutes: etaFrom(km) }).catch((e) => console.error('live activity', e.message));
}

module.exports = { register, content, onTrip, onDriverMoved, etaFrom };
