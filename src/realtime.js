// Real-time layer: driver locations, trip offers (dispatch) and live updates.
const { Server } = require('socket.io');
const crypto = require('crypto');
const SALT = crypto.randomBytes(8).toString('hex');
const anonId = (id) => crypto.createHash('sha1').update(SALT + id).digest('hex').slice(0, 10);
const db = require('./db');
const auth = require('./auth');
const { getSettings, haversineKm } = require('./pricing');

let io;
const drivers = new Map(); // userId -> live state
const offers = new Map();  // tripId -> { tried:Set, current, timer }
const chats = new Map();   // tripId -> [{ from, text, at }] (kept in memory for the trip)

const ACTIVE = ['accepted', 'arrived', 'in_progress'];

async function loadTrip(id) {
  return db.one(`
    SELECT t.*,
      r.name AS rider_name, r.phone AS rider_phone, r.rating_sum AS r_rs, r.rating_count AS r_rc,
      d.name AS driver_name, d.phone AS driver_phone, d.rating_sum AS d_rs, d.rating_count AS d_rc,
      dv.plate, dv.vehicle_make, dv.vehicle_color, dv.vehicle_type,
      (SELECT COUNT(*)::int FROM trips x WHERE x.driver_id = t.driver_id AND x.status = 'completed') AS d_trips,
      (SELECT COUNT(*)::int FROM trips x WHERE x.rider_id = t.rider_id AND x.status = 'completed') AS r_trips,
      EXISTS (SELECT 1 FROM driver_docs dd WHERE dd.user_id = t.driver_id AND dd.kind = 'photo') AS d_photo
    FROM trips t
    JOIN users r ON r.id = t.rider_id
    LEFT JOIN users d ON d.id = t.driver_id
    LEFT JOIN drivers dv ON dv.user_id = t.driver_id
    WHERE t.id = $1`, [id]);
}

const rating = (s, c) => (c ? Math.round((s / c) * 10) / 10 : null);

// role: 'rider' | 'driver' | 'admin' | 'public'
function view(t, role) {
  if (!t) return null;
  const live = t.driver_id ? drivers.get(t.driver_id) : null;
  const v = {
    id: t.id, service: t.service, status: t.status,
    pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
    drop: { lat: t.drop_lat, lng: t.drop_lng, address: t.drop_address },
    distanceKm: t.distance_km, durationMin: t.duration_min,
    fare: t.fare, paymentMethod: t.payment_method, paymentStatus: t.payment_status,
    parcel: t.parcel ? JSON.parse(t.parcel) : null, notes: t.notes,
    createdAt: t.created_at, acceptedAt: t.accepted_at, startedAt: t.started_at, completedAt: t.completed_at,
    cancelledBy: t.cancelled_by,
    driver: t.driver_id ? {
      id: t.driver_id, name: t.driver_name, rating: rating(t.d_rs, t.d_rc), trips: t.d_trips,
      photo: t.d_photo ? `/api/drivers/${t.driver_id}/photo` : null,
      plate: t.plate, vehicle: [t.vehicle_color, t.vehicle_make].filter(Boolean).join(' '), vehicleType: t.vehicle_type,
      location: live && live.lat ? { lat: live.lat, lng: live.lng, heading: live.heading } : null,
    } : null,
  };
  if (role === 'public') {
    v.rider = { name: (t.rider_name || '').split(' ')[0] };
    delete v.fare; delete v.paymentMethod; delete v.paymentStatus; delete v.parcel; delete v.notes;
    if (v.driver) v.driver = { name: t.driver_name, plate: t.plate, vehicle: v.driver.vehicle, vehicleType: t.vehicle_type, photo: v.driver.photo, location: v.driver.location };
    return v;
  }
  v.rider = { id: t.rider_id, name: t.rider_name, rating: rating(t.r_rs, t.r_rc), trips: t.r_trips };
  // Phone numbers are only shared while the trip is live.
  const live2 = ACTIVE.includes(t.status);
  if (role === 'rider') {
    v.pin = t.pin; v.shareToken = t.share_token; v.riderRated = t.rider_rating != null;
    if (v.driver && live2) v.driver.phone = t.driver_phone;
  }
  if (role === 'driver') {
    v.commission = t.commission; v.earning = t.fare - t.commission; v.driverRated = t.driver_rating != null;
    if (live2) v.rider.phone = t.rider_phone;
  }
  if (role === 'admin') {
    v.commission = t.commission; v.pin = undefined;
    v.rider.phone = t.rider_phone; if (v.driver) v.driver.phone = t.driver_phone;
  }
  return v;
}

async function broadcast(tripId) {
  const t = await loadTrip(tripId);
  if (!t) return null;
  if (['completed', 'cancelled', 'no_drivers'].includes(t.status)) setTimeout(() => chats.delete(t.id), 10 * 60e3);
  io.to(`user:${t.rider_id}`).emit('trip:update', view(t, 'rider'));
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
  const list = [];
  for (const [id, d] of drivers) {
    if (!d.online || d.busy || !d.lat || tried.has(id) || id === trip.rider_id) continue;
    if (!d.services.includes(trip.service)) continue;
    if (!io.sockets.adapter.rooms.get(`user:${id}`)) continue; // not connected
    const km = haversineKm(pickup, d);
    if (km <= s.dispatchRadiusKm) list.push({ id, km });
  }
  return list.sort((a, b) => a.km - b.km);
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
  const offer = { ...view(full, 'driver'), pickupKm: Math.round(next.km * 10) / 10, expiresIn: s.offerTimeoutSec };
  offer.earning = full.fare - Math.round((full.fare * s.commissionPct) / 100);
  delete offer.rider.phone;
  notify(next.id, 'trip:offer', offer);
  state.timer = setTimeout(() => {
    notify(next.id, 'trip:offer_expired', { id: tripId });
    dispatch(tripId).catch(console.error);
  }, s.offerTimeoutSec * 1000);
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
  if (d) { d.busy = true; d.tripId = tripId; }
  await broadcast(tripId);
  return { ok: true };
}

function setDriverFree(driverId) {
  const d = drivers.get(driverId);
  if (d) { d.busy = false; d.tripId = null; }
}

// ---------- Socket server ----------
function init(server) {
  io = new Server(server, { cors: { origin: true } });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) { socket.data.user = null; return next(); } // public trackers
    const p = auth.verify(token);
    if (!p) return next(new Error('unauthorized'));
    const u = await db.one('SELECT id, role, name, blocked FROM users WHERE id = $1', [p.id]);
    if (!u || u.blocked) return next(new Error('unauthorized'));
    socket.data.user = u;
    next();
  });

  io.on('connection', async (socket) => {
    const u = socket.data.user;

    socket.on('track:join', async ({ token } = {}, cb) => {
      const t = await db.one('SELECT id FROM trips WHERE share_token = $1', [String(token || '')]);
      if (!t) return cb && cb({ ok: false });
      socket.join(`share:${t.id}`);
      socket.join(`trip:${t.id}`);
      cb && cb({ ok: true, trip: view(await loadTrip(t.id), 'public') });
    });

    if (!u) return;
    socket.join(`user:${u.id}`);

    // In-trip chat between rider and driver
    socket.on('chat:send', async ({ tripId, text } = {}, cb) => {
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
    const active = await db.one(
      `SELECT id FROM trips WHERE (rider_id = $1 OR driver_id = $1) AND status = ANY($2) ORDER BY id DESC LIMIT 1`,
      [u.id, ACTIVE]
    );
    if (active) socket.join(`trip:${active.id}`);

    if (u.role === 'driver') {
      const dv = await db.one('SELECT * FROM drivers WHERE user_id = $1', [u.id]);
      if (!drivers.has(u.id)) {
        drivers.set(u.id, { online: false, busy: false, lat: null, lng: null, heading: null, services: [], tripId: null });
      }
      const d = drivers.get(u.id);
      d.services = dv ? dv.services.split(',') : [];
      d.name = u.name; d.plate = dv && dv.plate; d.vehicle = dv && dv.vehicle_type;
      if (active) { d.busy = true; d.tripId = active.id; }

      socket.on('driver:online', async (on, cb) => {
        const fresh = await db.one('SELECT status FROM drivers WHERE user_id = $1', [u.id]);
        if (on && (!fresh || fresh.status !== 'approved')) {
          return cb && cb({ ok: false, error: 'Your account is waiting for approval by the Kwata team.' });
        }
        d.online = !!on;
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

      socket.on('driver:location', (loc = {}) => {
        const lat = Number(loc.lat), lng = Number(loc.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        d.lat = lat; d.lng = lng; d.heading = Number(loc.heading) || null; d.updatedAt = Date.now();
        if (d.tripId) io.to(`trip:${d.tripId}`).emit('driver:location', { tripId: d.tripId, lat, lng, heading: d.heading });
      });

      socket.on('trip:respond', async ({ tripId, accept } = {}, cb) => {
        try {
          const r = await respond(u.id, Number(tripId), !!accept);
          if (r.ok && accept) socket.join(`trip:${tripId}`);
          cb && cb(r);
        } catch (e) { console.error(e); cb && cb({ ok: false, error: 'Something went wrong.' }); }
      });

      socket.on('disconnect', async () => {
        const still = io.sockets.adapter.rooms.get(`user:${u.id}`);
        if (!still) d.online = false; // all tabs closed
      });
    }
  });

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

function forceOffline(driverId) {
  const d = drivers.get(driverId);
  if (d) d.online = false;
  notify(driverId, 'driver:forced_offline', {});
}

module.exports = {
  init, broadcast, messages, dispatch, clearOffer, setDriverFree, loadTrip, view, notify, joinTripRoom,
  liveDrivers, nearbyDrivers, updateDriverServices, forceOffline, ACTIVE,
  driversSnapshot: () => [...drivers.values()],
  get io() { return io; },
};
