// Real-time layer: driver locations, trip offers (dispatch) and live updates.
const { Server } = require('socket.io');
const crypto = require('crypto');
const SALT = crypto.randomBytes(8).toString('hex');
const anonId = (id) => crypto.createHash('sha1').update(SALT + id).digest('hex').slice(0, 10);
const db = require('./db');
const auth = require('./auth');
const { getSettings, haversineKm } = require('./pricing');
const dtools = require('./drivers');
const night = require('./nightshare');
const AWAY_MS = 15 * 60e3; // a locked phone with ride alerts stays online this long

let io;
const drivers = new Map(); // userId -> live state
const offers = new Map();  // tripId -> { tried:Set, current, timer }
const chats = new Map();   // tripId -> [{ from, text, at }] (kept in memory for the trip)

const ACTIVE = ['accepted', 'arrived', 'in_progress'];

async function loadTrip(id) {
  return db.one(`
    SELECT t.*,
      r.name AS rider_name, r.phone AS rider_phone, r.emergency_contact AS rider_ec, r.rating_sum AS r_rs, r.rating_count AS r_rc,
      d.name AS driver_name, d.phone AS driver_phone, d.rating_sum AS d_rs, d.rating_count AS d_rc,
      dv.plate, dv.vehicle_make, dv.vehicle_color, dv.vehicle_type,
      (SELECT COUNT(*)::int FROM trips x WHERE x.driver_id = t.driver_id AND x.status = 'completed') AS d_trips,
      (SELECT COUNT(*)::int FROM trips x WHERE x.rider_id = t.rider_id AND x.status = 'completed') AS r_trips,
      (SELECT dd.created_at FROM driver_docs dd WHERE dd.user_id = t.driver_id AND dd.kind = 'photo') AS d_photo,
      EXISTS (SELECT 1 FROM errand_receipts er WHERE er.trip_id = t.id) AS has_receipt,
      EXISTS (SELECT 1 FROM driver_docs dd WHERE dd.user_id = t.driver_id AND dd.kind = 'national_id') AS d_has_id,
      EXISTS (SELECT 1 FROM driver_docs dd WHERE dd.user_id = t.driver_id AND dd.kind = 'license') AS d_has_permit,
      (SELECT dd.expires_on FROM driver_docs dd WHERE dd.user_id = t.driver_id AND dd.kind = 'license') AS d_permit_exp,
      dv.status AS d_status, dv.created_at AS d_since,
      fs.people AS split_people, fs.paid AS split_paid, fs.share AS split_share, fs.token AS split_token
    FROM trips t
    JOIN users r ON r.id = t.rider_id
    LEFT JOIN users d ON d.id = t.driver_id
    LEFT JOIN drivers dv ON dv.user_id = t.driver_id
    LEFT JOIN fare_splits fs ON fs.trip_id = t.id
    WHERE t.id = $1`, [id]);
}

const rating = (s, c) => (c ? Math.round((s / c) * 10) / 10 : null);

// What riders are shown about a driver's checks. "ID checked": a National ID is on file and the Flytte
// team approved the driver. "Permit valid": a driving permit is on file and its expiry date hasn't passed.
function driverChecks(t) {
  const approved = t.d_status === 'approved';
  const exp = t.d_permit_exp ? new Date(t.d_permit_exp) : null;
  const today = new Date(new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10));   // Kampala's date, not UTC's
  return {
    id: approved && !!t.d_has_id,
    permit: approved && !!t.d_has_permit && (!exp || exp >= today),
    since: t.d_since ? new Date(t.d_since).toISOString().slice(0, 7) : null,   // "2026-10"
  };
}

// role: 'rider' | 'driver' | 'admin' | 'public'
function view(t, role) {
  if (!t) return null;
  const live = t.driver_id ? drivers.get(t.driver_id) : null;
  const v = {
    id: t.id, service: t.service, status: t.status,
    pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
    drop: { lat: t.drop_lat, lng: t.drop_lng, address: t.drop_address },
    stops: t.stops ? JSON.parse(t.stops) : [],
    distanceKm: t.distance_km, durationMin: t.duration_min,
    fare: t.fare, paymentMethod: t.payment_method, paymentStatus: t.payment_status,
    parcel: t.parcel ? JSON.parse(t.parcel) : null, notes: t.notes,
    errand: t.errand ? { ...JSON.parse(t.errand), goodsTotal: t.goods_total ?? null, receipt: !!t.has_receipt } : null,
    createdAt: t.created_at, acceptedAt: t.accepted_at, startedAt: t.started_at, completedAt: t.completed_at,
    cancelledBy: t.cancelled_by, cancelReason: t.cancel_reason === 'no_show' ? 'no_show' : undefined, noShowFee: t.no_show_fee || 0, cancelFee: t.cancel_fee || 0,
    arrivedAt: t.arrived_at || null,
    // What the rider pays in all: the fare less any discount, plus the goods on an errand.
    discount: t.discount || 0, payable: t.fare - (t.discount || 0) + (t.goods_total || 0), goodsTotal: t.goods_total || 0, promoLabel: t.promo_label || null,
    tip: t.tip || 0, tipMethod: t.tip_method || null,
    scheduledFor: t.scheduled_for || null, womanDriver: !!t.woman_driver,
    passenger: t.passenger ? JSON.parse(t.passenger) : null,
    school: t.plan_id ? { leg: t.plan_leg } : null,
    driver: t.driver_id ? {
      id: t.driver_id, name: t.driver_name, rating: rating(t.d_rs, t.d_rc), trips: t.d_trips,
      photo: t.d_photo ? `/api/drivers/${t.driver_id}/photo?v=${new Date(t.d_photo).getTime()}` : null, // a newly approved photo shows straight away
      plate: t.plate, vehicle: [t.vehicle_color, t.vehicle_make].filter(Boolean).join(' '), vehicleType: t.vehicle_type,
      location: live && live.lat ? { lat: live.lat, lng: live.lng, heading: live.heading } : null,
      checks: driverChecks(t),
    } : null,
  };
  if (role === 'public') {
    v.rider = { name: (t.rider_name || '').split(' ')[0] };
    delete v.fare; delete v.paymentMethod; delete v.paymentStatus; delete v.parcel; delete v.notes; delete v.errand; delete v.goodsTotal;
    delete v.discount; delete v.payable; delete v.promoLabel; delete v.tip; delete v.tipMethod; delete v.noShowFee; delete v.cancelFee;
    if (v.passenger) v.rider = { name: String(v.passenger.name).split(' ')[0] };
    delete v.passenger;
    if (v.driver) v.driver = { name: t.driver_name, plate: t.plate, vehicle: v.driver.vehicle, vehicleType: t.vehicle_type, photo: v.driver.photo, location: v.driver.location, checks: v.driver.checks };
    return v;
  }
  v.rider = { id: t.rider_id, name: t.rider_name, rating: rating(t.r_rs, t.r_rc), trips: t.r_trips };
  // Phone numbers are only shared while the trip is live.
  const live2 = ACTIVE.includes(t.status);
  if (role === 'rider') {
    v.pin = t.pin; v.shareToken = t.share_token; v.riderRated = t.rider_rating != null; v.myStars = t.rider_rating || null;
    v.dropCode = t.drop_code || null; v.pointsEarned = t.points_earned || 0;
    v.split = t.split_token ? { people: t.split_people, paid: t.split_paid, share: t.split_share, token: t.split_token } : null;
    if (v.driver && live2) v.driver.phone = t.driver_phone;
    v.nightShare = nightView(t);
  }
  if (role === 'driver') {
    v.commission = t.commission; v.earning = t.fare - t.commission; v.driverRated = t.driver_rating != null;
    v.shareToken = t.share_token; // drivers can share their trip with family too
    if (live2) v.rider.phone = t.rider_phone;
    // Booked for someone else: the driver meets and calls the passenger.
    if (v.passenger) { v.bookedBy = v.rider.name; v.rider = { ...v.rider, name: v.passenger.name, phone: live2 ? v.passenger.phone : undefined }; }
    v.needsDropCode = !!t.drop_code;
  }
  if (role === 'admin') {
    v.commission = t.commission; v.pin = undefined;
    v.rider.phone = t.rider_phone; if (v.driver) v.driver.phone = t.driver_phone;
  }
  return v;
}

// Night-time sharing as the rider sees it on the trip screen: how it went, and the same message ready
// to send on WhatsApp in one tap when it wasn't texted.
function nightView(t) {
  if (!t.night_share_status) return null;
  const contact = t.rider_ec || null;
  const out = { status: t.night_share_status, reason: t.night_share_reason || null, at: t.night_share_at || null, opened: !!t.night_share_opened_at, contact };
  if (t.night_share_status !== 'sms' && contact && ACTIVE.includes(t.status)) {
    out.text = night.message(t);
    out.whatsapp = night.waLink(contact, out.text);
  }
  return out;
}

// ---------- Rider alerts ----------
// Key moments reach the rider's lock screen when Flytte isn't on screen. Each moment is sent once.
const riderVisible = new Map();          // userId -> app on screen
const riderSent = new Map();             // tripId -> Set of moments already pushed
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'Your driver';
function riderAway(userId) {
  const room = io && io.sockets.adapter.rooms.get(`user:${userId}`);
  return !room || riderVisible.get(userId) === false;
}
function riderAlert(t, moment) {
  if (moment === 'near' && t.accepted_at && Date.now() - new Date(t.accepted_at).getTime() < 90e3) return; // already close when accepted
  let sent = riderSent.get(t.id);
  if (!sent) { sent = new Set(); riderSent.set(t.id, sent); }
  if (sent.has(moment)) return;
  sent.add(moment);
  // School runs: the parent hears every step, even with the app open (they're often not the one riding).
  if (t.plan_id) return schoolAlert(t, moment);
  if (!riderAway(t.rider_id)) return;
  const who = ['parcel', 'errand'].includes(t.service) ? 'courier' : 'driver';
  const name = firstName(t.driver_name), plate = t.plate ? ` · ${t.plate}` : '';
  const msg = {
    accepted: [`${name} is on the way`, `${[t.vehicle_color, t.vehicle_make].filter(Boolean).join(' ') || 'Your ' + who}${plate}`],
    near: [`${name} is almost here`, `Head to your pickup point${plate}`],
    arrived: [`${name} has arrived`, `Meet your ${who} at the pickup${plate}`],
    completed: [t.service === 'parcel' ? 'Parcel delivered' : 'You’ve arrived', 'Thanks for riding with Flytte. Tap to rate your trip.'],
    driver_cancelled: [`Your ${who} cancelled`, 'Open Flytte to request again.'],
    no_drivers: ['No drivers available', 'Open Flytte to try again.'],
    night_share: [`Send your trip to ${night.pretty(t.rider_ec)}`, 'It wasn’t texted. Tap to send your driver, plate and live link on WhatsApp.'],
  }[moment];
  if (!msg) return;
  dtools.push(t.rider_id, { app: 'rider', type: moment, tag: `trip-${t.id}`, title: msg[0], body: msg[1], tripId: t.id }, { ttl: moment === 'completed' ? 3600 : 600, urgency: 'high' }).catch(() => {});
}

function schoolAlert(t, moment) {
  const p = t.passenger ? JSON.parse(t.passenger) : {};
  const child = p.name || 'Your child', name = firstName(t.driver_name), plate = t.plate ? ` · ${t.plate}` : '';
  const toSchool = t.plan_leg === 'morning';
  const msg = {
    accepted: [`${name} is coming for ${child}`, `${[t.vehicle_color, t.vehicle_make].filter(Boolean).join(' ') || 'School run'}${plate}`],
    arrived: [`${name} is at the ${toSchool ? 'pickup' : 'school'} for ${child}`, toSchool ? 'Bring them out to the car' : 'The school gives the driver the handover code'],
    started: [`${child} is on the way ${toSchool ? 'to school' : 'home'}`, `With ${name}${plate}. Tap to follow live.`],
    completed: [toSchool ? `${child} is at school` : `${child} is home`, toSchool ? `Handed over at ${String(t.drop_address || 'school').split(',')[0]} with the school’s code.` : 'Dropped off with your code. Tap to rate the ride.'],
    driver_cancelled: [`The driver for ${child} cancelled`, 'We’re finding another vetted driver now.'],
    no_drivers: [`No driver found for ${child}’s school run`, 'Open Flytte to try again, or call us.'],
  }[moment];
  if (!msg) return;
  notify(t.rider_id, 'toast', { text: `${msg[0]}. ${msg[1]}` });
  dtools.push(t.rider_id, { app: 'rider', type: moment, tag: `trip-${t.id}`, title: msg[0], body: msg[1], tripId: t.id }, { ttl: 3600, urgency: 'high' }).catch(() => {});
}

function nightShareAlert(t) { riderAlert(t, 'night_share'); }

async function broadcast(tripId) {
  const t = await loadTrip(tripId);
  if (!t) return null;
  if (t.merchant) { /* a shop's delivery: the shop follows it on its Business page, not as its own trip */ }
  else if (t.status === 'accepted') riderAlert(t, 'accepted');
  else if (t.status === 'arrived') riderAlert(t, 'arrived');
  else if (t.status === 'in_progress' && t.plan_id) riderAlert(t, 'started');
  else if (t.status === 'completed') riderAlert(t, 'completed');
  else if (t.status === 'no_drivers') riderAlert(t, 'no_drivers');
  else if (t.status === 'cancelled' && t.cancelled_by === 'driver') riderAlert(t, 'driver_cancelled');
  if (['completed', 'cancelled', 'no_drivers'].includes(t.status)) setTimeout(() => riderSent.delete(t.id), 30 * 60e3);
  else if (t.status === 'requested') riderSent.delete(t.id);   // re-requested after a driver cancelled
  if (['completed', 'cancelled', 'no_drivers'].includes(t.status)) setTimeout(() => chats.delete(t.id), 10 * 60e3);
  const ld = t.driver_id && drivers.get(t.driver_id);
  if (ld && ld.tripId === t.id) { ld.tripStatus = t.status; ld.drop = { lat: t.drop_lat, lng: t.drop_lng }; ld.pickup = { lat: t.pickup_lat, lng: t.pickup_lng }; ld.trip = t; }
  if (!t.merchant) io.to(`user:${t.rider_id}`).emit('trip:update', view(t, 'rider'));
  if (t.driver_id) io.to(`user:${t.driver_id}`).emit('trip:update', view(t, 'driver'));
  io.to(`share:${t.id}`).emit('trip:update', view(t, 'public'));
  io.to('admin').emit('admin:trip', view(t, 'admin'));
  return t;
}

function notify(userId, event, payload) {
  io.to(`user:${userId}`).emit(event, payload);
}

// ---------- Dispatch ----------
async function candidates(trip, tried) {
  const s = await getSettings();
  const pickup = { lat: trip.pickup_lat, lng: trip.pickup_lng };
  const drop = { lat: trip.drop_lat, lng: trip.drop_lng };
  const list = [];
  for (const [id, d] of drivers) {
    if (!d.online || !d.lat || tried.has(id) || id === trip.rider_id) continue;
    if (!d.services.includes(trip.service)) continue;
    if (trip.woman_driver && !d.woman) continue;   // the rider asked for a woman driver
    if (trip.plan_id && !d.school) continue;       // school runs: only drivers the team has vetted for children
    const connected = !!io.sockets.adapter.rooms.get(`user:${id}`);
    // Phone locked or app in the background: still reachable through a ride alert, for a while.
    const reachable = connected || (d.away && d.push && d.updatedAt && Date.now() - d.updatedAt < AWAY_MS);
    if (!reachable) continue;
    let km = haversineKm(pickup, d), queued = false;
    if (d.busy) {
      // Next trip lined up: only when the current trip is nearly over and ends near this pickup.
      if (!s.drivers.queueNext || d.queuedTripId || d.tripStatus !== 'in_progress' || !d.drop) continue;
      const left = haversineKm(d, d.drop), gap = haversineKm(d.drop, pickup);
      if (left > 2 || gap > 2) continue;
      km = left + gap; queued = true;
    }
    if (km > s.dispatchRadiusKm) continue;
    if (d.home) {
      // Heading home: the trip must take the driver closer to home, without a big detour to the pickup.
      const now = haversineKm(d, d.home);
      if (!(haversineKm(drop, d.home) <= now - 1 && haversineKm(pickup, d.home) <= now + 2)) continue;
    }
    list.push({ id, km, queued, away: !connected || d.visible === false });
  }
  // Commission owed on cash trips: past the limit, a driver gets no new cash trips until they pay.
  if (trip.payment_method === 'cash' && s.drivers.cashDebtLimit > 0 && list.length) {
    const ids = list.map((x) => x.id);
    const { rows } = await db.query(`SELECT user_id, earnings_balance FROM drivers WHERE user_id IN (${ids.map((_, i) => '$' + (i + 1)).join(',')})`, ids);
    const owing = new Set(rows.filter((r) => r.earnings_balance <= -s.drivers.cashDebtLimit).map((r) => r.user_id));
    for (let i = list.length - 1; i >= 0; i--) if (owing.has(list[i].id)) list.splice(i, 1);
  }
  // Free drivers first, then by distance. A school run goes to the child's usual driver first.
  list.sort((a, b) => (a.queued - b.queued) || (a.km - b.km));
  if (trip.plan_id) {
    const p = await db.one('SELECT preferred_driver_id FROM ride_plans WHERE id = $1', [trip.plan_id]);
    const i = p && p.preferred_driver_id ? list.findIndex((x) => x.id === p.preferred_driver_id) : -1;
    if (i > 0) list.unshift(...list.splice(i, 1));
  }
  return list;
}

async function dispatch(tripId, excludeDriverId) {
  const trip = await db.one('SELECT * FROM trips WHERE id = $1', [tripId]);
  if (!trip || trip.status !== 'requested') return clearOffer(tripId);
  let state = offers.get(tripId);
  if (!state) { state = { tried: new Set(), current: null, timer: null, exclude: excludeDriverId }; offers.set(tripId, state); }
  if (state.exclude) state.tried.add(state.exclude);

  const list = await candidates(trip, state.tried);
  if (!list.length) {
    // Nobody free right now. Keep searching for up to 3 minutes, then give up.
    const age = (Date.now() - new Date(trip.created_at).getTime()) / 1000;
    if (age > 180) {
      clearOffer(tripId);
      await db.query("UPDATE trips SET status = 'no_drivers' WHERE id = $1 AND status = 'requested'", [tripId]);
      await broadcast(tripId);
      return;
    }
    state.current = null;
    state.timer = setTimeout(() => {
      state.tried.clear(); // give everyone another chance
      if (state.exclude) state.tried.add(state.exclude);
      dispatch(tripId).catch(console.error);
    }, 8000);
    return;
  }

  const s = await getSettings();
  const next = list[0];
  state.tried.add(next.id);
  state.current = next.id;
  const full = await loadTrip(tripId);
  // A driver reached through a ride alert needs a little longer to unlock the phone.
  const secs = next.away ? Math.max(s.offerTimeoutSec, 40) : s.offerTimeoutSec;
  const offer = { ...view(full, 'driver'), pickupKm: Math.round(next.km * 10) / 10, expiresIn: secs, queued: next.queued };
  offer.earning = full.fare - Math.round((full.fare * s.commissionPct) / 100);
  delete offer.rider.phone;
  // Optional: hide where the trip goes until the driver accepts, so trips aren't picked by destination.
  if (s.drivers && s.drivers.showDestination === false) offer.drop = { hidden: true };
  state.offer = offer; state.expiresAt = Date.now() + secs * 1000;
  notify(next.id, 'trip:offer', offer);
  const d = drivers.get(next.id);
  if (d && d.push && next.away) {
    const what = full.service === 'parcel' ? 'delivery' : full.service === 'errand' ? 'errand' : 'ride';
    dtools.push(next.id, {
      type: 'offer', tripId, tag: `offer-${tripId}`,
      title: `New ${what} request · UGX ${offer.earning.toLocaleString()}`,
      body: `${offer.pickupKm} km away · ${String(full.pickup_address || 'Pickup').split(',')[0]} → ${String(full.drop_address || 'Destination').split(',')[0]}. Open within ${secs} seconds.`,
    }, { ttl: secs }).catch(() => {});
  }
  state.timer = setTimeout(() => {
    notify(next.id, 'trip:offer_expired', { id: tripId });
    dtools.logEvent(next.id, tripId, 'offer_missed');
    dispatch(tripId).catch(console.error);
  }, secs * 1000);
}

function clearOffer(tripId) {
  const st = offers.get(tripId);
  if (st) {
    clearTimeout(st.timer);
    if (st.current) notify(st.current, 'trip:offer_expired', { id: tripId });
  }
  offers.delete(tripId);
}

async function respond(driverId, tripId, accept) {
  const st = offers.get(tripId);
  if (!st || st.current !== driverId) return { ok: false, error: 'This request is no longer available.' };
  clearTimeout(st.timer);
  dtools.logEvent(driverId, tripId, accept ? 'offer_accepted' : 'offer_declined');
  if (!accept) { dispatch(tripId).catch(console.error); return { ok: true }; }

  const row = await db.one(
    "UPDATE trips SET driver_id = $1, status = 'accepted', accepted_at = NOW() WHERE id = $2 AND status = 'requested' RETURNING id, rider_id",
    [driverId, tripId]
  );
  offers.delete(tripId);
  if (!row) return { ok: false, error: 'Rider cancelled this request.' };
  io.in(`user:${row.rider_id}`).socketsJoin(`trip:${tripId}`);
  io.in(`user:${driverId}`).socketsJoin(`trip:${tripId}`);
  const d = drivers.get(driverId);
  if (d) {
    if (d.busy && d.tripId && d.tripId !== tripId) d.queuedTripId = tripId; // lined up after the current trip
    else { d.busy = true; d.tripId = tripId; d.tripStatus = 'accepted'; }
  }
  await broadcast(tripId);
  return { ok: true };
}

// A trip ended or was cancelled. If it was the lined-up next trip, only that is cleared;
// if it was the current trip, the lined-up one (if any) becomes current.
function setDriverFree(driverId, tripId) {
  const d = drivers.get(driverId);
  if (!d) return;
  if (tripId && d.queuedTripId === tripId) { d.queuedTripId = null; return; }
  if (d.queuedTripId) { d.tripId = d.queuedTripId; d.queuedTripId = null; d.busy = true; d.tripStatus = 'accepted'; d.drop = null; return; }
  d.busy = false; d.tripId = null; d.tripStatus = null; d.drop = null;
}

// ---------- Socket server ----------
// Socket handlers run on input from any client. An error in one (a malformed message, a database
// hiccup) is logged and answered with ok:false; it must never take the whole server down.
function guard(name, fn) {
  return async (...args) => {
    try { return await fn(...args); } catch (e) {
      console.error(`socket ${name}:`, e.message);
      const cb = args[args.length - 1];
      if (typeof cb === 'function') cb({ ok: false, error: 'Something went wrong. Try again.' });
    }
  };
}

function init(server) {
  io = new Server(server, { cors: { origin: true } });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) { socket.data.user = null; return next(); } // public trackers
      const p = auth.verify(token);
      if (!p) return next(new Error('unauthorized'));
      const u = await db.one('SELECT id, role, name, blocked FROM users WHERE id = $1', [p.id]);
      if (!u || u.blocked) return next(new Error('unauthorized'));
      socket.data.user = u;
      next();
    } catch (e) { console.error('socket auth:', e.message); next(new Error('unavailable')); }
  });

  io.on('connection', guard('connection', async (socket) => {
    const u = socket.data.user;
    const handle = (event, fn) => socket.on(event, guard(event, fn));

    handle('track:join', async ({ token } = {}, cb) => {
      const t = await db.one('SELECT id FROM trips WHERE share_token = $1', [String(token || '')]);
      if (!t) return cb && cb({ ok: false });
      socket.join(`share:${t.id}`);
      socket.join(`trip:${t.id}`);
      cb && cb({ ok: true, trip: view(await loadTrip(t.id), 'public') });
    });

    if (!u) return;
    socket.join(`user:${u.id}`);

    // In-trip chat between rider and driver
    handle('chat:send', async ({ tripId, text } = {}, cb) => {
      const msg = String(text || '').trim().slice(0, 500);
      if (!msg) return cb && cb({ ok: false });
      const t = await db.one('SELECT id, rider_id, driver_id, status FROM trips WHERE id = $1', [Number(tripId)]);
      if (!t || !ACTIVE.includes(t.status) || (t.rider_id !== u.id && t.driver_id !== u.id)) {
        return cb && cb({ ok: false, error: 'Chat is only open during a trip.' });
      }
      const m = { tripId: t.id, from: t.rider_id === u.id ? 'rider' : 'driver', name: u.name.split(' ')[0], text: msg, at: new Date().toISOString() };
      const list = chats.get(t.id) || [];
      list.push(m); if (list.length > 100) list.shift();
      chats.set(t.id, list);
      notify(t.rider_id, 'chat:message', m);
      notify(t.driver_id, 'chat:message', m);
      cb && cb({ ok: true, message: m });
    });
    if (u.role === 'admin') socket.join('admin');

    // Re-join an active trip after reconnecting
    const { rows: actives } = await db.query(
      `SELECT id, status FROM trips WHERE (rider_id = $1 OR driver_id = $1) AND status = ANY($2) ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'arrived' THEN 1 ELSE 2 END, id`,
      [u.id, ACTIVE]
    );
    for (const a of actives) socket.join(`trip:${a.id}`);
    const active = actives[0] || null;

    if (u.role === 'rider') {
      riderVisible.set(u.id, true);
      handle('rider:visible', (v) => { riderVisible.set(u.id, !!v); });
    }

    if (u.role === 'driver') {
      const dv = await db.one('SELECT * FROM drivers WHERE user_id = $1', [u.id]);
      if (!drivers.has(u.id)) {
        drivers.set(u.id, { online: false, busy: false, lat: null, lng: null, heading: null, services: [], tripId: null });
      }
      const d = drivers.get(u.id);
      d.services = dv ? dv.services.split(',') : [];
      d.name = u.name; d.plate = dv && dv.plate; d.vehicle = dv && dv.vehicle_type; d.woman = !!(dv && dv.woman); d.school = !!(dv && dv.school_ok);
      if (active) { d.busy = true; d.tripId = active.id; d.tripStatus = active.status; d.queuedTripId = actives[1] ? actives[1].id : null; }
      d.away = false; d.visible = true; clearTimeout(d.awayTimer);
      dtools.hasPush(u.id).then((v) => { d.push = v; }).catch(() => {});
      // Came back from a ride alert: show the request that is still waiting for this driver.
      for (const [tid, st] of offers) {
        if (st.current === u.id && st.offer && st.expiresAt > Date.now() + 2000) {
          socket.emit('trip:offer', { ...st.offer, expiresIn: Math.floor((st.expiresAt - Date.now()) / 1000) });
        }
      }
      handle('driver:visible', (v) => { d.visible = !!v; });

      handle('driver:online', async (on, cb) => {
        const fresh = await db.one('SELECT status FROM drivers WHERE user_id = $1', [u.id]);
        if (on && (!fresh || fresh.status !== 'approved')) {
          return cb && cb({ ok: false, error: 'Your account is waiting for approval by the Flytte team.' });
        }
        if (on && !d.lat) return cb && cb({ ok: false, error: 'We need your position before you can go online.' });
        d.online = !!on;
        if (!d.online) d.home = null;
        cb && cb({ ok: true, online: d.online });
        // pick up any riders already waiting nearby
        if (d.online) {
          const waiting = await db.query("SELECT id FROM trips WHERE status = 'requested'");
          for (const w of waiting.rows) {
            const st = offers.get(w.id);
            if (st && !st.current) { clearTimeout(st.timer); dispatch(w.id).catch(console.error); }
          }
        }
      });

      handle('driver:location', (loc = {}) => {
        const lat = Number(loc.lat), lng = Number(loc.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -12 || lat > 6 || lng < 28 || lng > 42) return;
        d.lat = lat; d.lng = lng; d.heading = Number(loc.heading) || null; d.updatedAt = Date.now();
        if (d.tripId) io.to(`trip:${d.tripId}`).emit('driver:location', { tripId: d.tripId, lat, lng, heading: d.heading });
        // About a minute away from the pickup: tell the rider to head out.
        if (d.tripId && d.tripStatus === 'accepted' && d.pickup && d.trip && d.trip.id === d.tripId && haversineKm(d, d.pickup) < 0.35) riderAlert(d.trip, 'near');
        if (d.queuedTripId) io.to(`trip:${d.queuedTripId}`).emit('driver:location', { tripId: d.queuedTripId, lat, lng, heading: d.heading });
        if (d.home && haversineKm(d, d.home) < 0.8) { d.home = null; notify(u.id, 'driver:home', { on: false, arrived: true }); }
      });

      handle('trip:respond', async ({ tripId, accept } = {}, cb) => {
        try {
          const r = await respond(u.id, Number(tripId), !!accept);
          if (r.ok && accept) socket.join(`trip:${tripId}`);
          cb && cb(r);
        } catch (e) { console.error(e); cb && cb({ ok: false, error: 'Something went wrong.' }); }
      });

      handle('disconnect', async () => {
        const still = io.sockets.adapter.rooms.get(`user:${u.id}`);
        if (still) return;
        if (d.online && d.push) {
          // Locked phone or app in the background: stay online and reachable by ride alerts for a while.
          d.away = true; d.awaySince = Date.now();
          clearTimeout(d.awayTimer);
          d.awayTimer = setTimeout(() => {
            if (!d.away || io.sockets.adapter.rooms.get(`user:${u.id}`)) return;
            d.online = false; d.away = false; d.home = null;
            dtools.push(u.id, { type: 'offline', tag: 'offline', title: 'You’re offline now', body: 'Flytte set you offline after 15 minutes away. Open the app to go online again.' }, { ttl: 3600, urgency: 'normal' }).catch(() => {});
          }, AWAY_MS);
        } else d.online = false; // all tabs closed and no ride alerts
      });
    }
  }));

  return io;
}

function messages(tripId) { return chats.get(tripId) || []; }

function joinTripRoom(userId, tripId) {
  io.in(`user:${userId}`).socketsJoin(`trip:${tripId}`);
}

function liveDrivers() {
  return [...drivers.entries()]
    .filter(([, d]) => d.online && d.lat)
    .map(([id, d]) => ({ id, name: d.name, plate: d.plate, vehicle: d.vehicle, lat: d.lat, lng: d.lng, busy: d.busy, services: d.services }));
}

function nearbyDrivers(lat, lng, service) {
  const out = [];
  for (const [id, d] of drivers.entries()) {
    if (!d.online || !d.lat || d.busy) continue;
    if (service && !d.services.includes(service)) continue;
    const km = haversineKm({ lat, lng }, d);
    if (km <= 5) out.push({ k: anonId(id), lat: d.lat, lng: d.lng, heading: d.heading, vehicle: d.vehicle, km });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, 15);
}

function updateDriverServices(driverId, services) {
  const d = drivers.get(driverId);
  if (d) d.services = services;
}

function setHome(driverId, place) {
  const d = drivers.get(driverId);
  if (d) d.home = place ? { lat: place.lat, lng: place.lng, address: place.address } : null;
}
function setWoman(driverId, woman) { const d = drivers.get(driverId); if (d) d.woman = !!woman; }
function setSchool(driverId, ok) { const d = drivers.get(driverId); if (d) d.school = !!ok; }

function driverState(driverId) {
  const d = drivers.get(driverId);
  return d ? { online: d.online, home: d.home || null, push: !!d.push } : { online: false, home: null, push: false };
}
function markPush(driverId, on) { const d = drivers.get(driverId); if (d) d.push = !!on; }
function updateDriverVehicle(driverId, plate) { const d = drivers.get(driverId); if (d) d.plate = plate; }

function forceOffline(driverId) {
  const d = drivers.get(driverId);
  if (d) { d.online = false; d.home = null; }
  notify(driverId, 'driver:forced_offline', {});
}

module.exports = { setWoman, setSchool, nightShareAlert,
  init, broadcast, messages, dispatch, clearOffer, setDriverFree, loadTrip, view, notify, joinTripRoom,
  liveDrivers, nearbyDrivers, updateDriverServices, forceOffline, setHome, driverState, markPush, updateDriverVehicle, ACTIVE,
  driversSnapshot: () => [...drivers.values()],
  get io() { return io; },
};
