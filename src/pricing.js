// Services, fares and platform settings. Admins can change these live.
const db = require('./db');

// Fares are calibrated against what riders actually pay in Kampala today.
// Bolt's published Kampala route prices (Oct 2026) fit this formula almost exactly:
//   Motorbike ≈ 700 + 620/km + 29/min   Car ≈ 4,250 + 1,800/km + 84/min   XL ≈ 2,700 + 2,270/km + 107/min
// Kwata sits about 8–10% below Bolt for riders, while our lower commission
// (12% vs Bolt's 15–20%) means drivers still take home about the same per trip.
//   fare = max(minFare, base + perKm × road km + perMin × trip minutes) × surge
const PRICING_VERSION = 2;
const DEFAULT_SERVICES = {
  boda:    { name: 'Kwata Boda',    icon: '🏍️', vehicle: 'boda', seats: 1, base: 700,  perKm: 570,  perMin: 26, minFare: 2000,  surge: 1, enabled: true, blurb: 'Beat the jam. Helmet provided.' },
  car:     { name: 'Kwata Car',     icon: '🚗', vehicle: 'car',  seats: 4, base: 3800, perKm: 1650, perMin: 75, minFare: 6000,  surge: 1, enabled: true, blurb: 'Affordable everyday rides.' },
  comfort: { name: 'Kwata Comfort', icon: '🚙', vehicle: 'car',  seats: 4, base: 4500, perKm: 2050, perMin: 95, minFare: 9000,  surge: 1, enabled: true, blurb: 'Newer cars, AC, top-rated drivers.' },
  parcel:  { name: 'Kwata Parcel',  icon: '📦', vehicle: 'boda', seats: 0, base: 1000, perKm: 600,  perMin: 20, minFare: 2500,  surge: 1, enabled: true, blurb: 'Send packages across town.' },
  airport: { name: 'Kwata Airport', icon: '✈️', vehicle: 'car',  seats: 4, base: 8000, perKm: 1750, perMin: 50, minFare: 25000, surge: 1, enabled: true, blurb: 'Entebbe & long-distance trips.' },
};

const DEFAULTS = {
  services: DEFAULT_SERVICES,
  pricingVersion: PRICING_VERSION,
  commissionPct: 12,      // Bolt 15–20%, SafeBoda 15%, Faras 10%. Low commission = happier drivers.
  dispatchRadiusKm: 8,
  offerTimeoutSec: 20,
  minWithdrawal: 5000,
  supportPhone: '+256 700 000000',
  // Dynamic pricing (see src/surge.js). Caps keep fares affordable in Kampala.
  dynamic: { enabled: true, sensitivity: 0.35, maxBoda: 1.8, maxCar: 2.0, weather: true },
};

let cache = null;

async function getSettings() {
  if (cache) return cache;
  const rows = (await db.query('SELECT key, value FROM settings')).rows;
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* ignore bad rows */ }
  }
  s.dynamic = { ...DEFAULTS.dynamic, ...(s.dynamic || {}) };
  // make sure new default services appear even if older settings were saved
  for (const [k, v] of Object.entries(DEFAULT_SERVICES)) {
    s.services[k] = { ...v, ...(s.services[k] || {}) };
  }
  // One-time move to the new real-world rates. Keeps each service's on/off switch and surge.
  const stored = rows.find((r) => r.key === 'pricingVersion');
  if (!stored || Number(stored.value) < PRICING_VERSION) {
    for (const [k, v] of Object.entries(DEFAULT_SERVICES)) {
      s.services[k] = { ...s.services[k], base: v.base, perKm: v.perKm, perMin: v.perMin, minFare: v.minFare };
    }
    s.pricingVersion = PRICING_VERSION;
    for (const [key, value] of [['services', s.services], ['pricingVersion', PRICING_VERSION]]) {
      await db.query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
    }
  }
  cache = s;
  return s;
}

async function updateSettings(patch) {
  const current = await getSettings();
  const allowed = ['services', 'commissionPct', 'dispatchRadiusKm', 'offerTimeoutSec', 'minWithdrawal', 'supportPhone', 'dynamic'];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (key === 'services') {
      value = { ...current.services };
      for (const [id, svc] of Object.entries(patch.services)) {
        if (!value[id]) continue;
        const clean = {};
        for (const f of ['base', 'perKm', 'perMin', 'minFare', 'surge']) {
          if (svc[f] !== undefined) clean[f] = Math.max(0, Number(svc[f]) || 0);
        }
        if (clean.surge !== undefined) clean.surge = Math.min(5, Math.max(1, clean.surge));
        if (svc.enabled !== undefined) clean.enabled = !!svc.enabled;
        value[id] = { ...value[id], ...clean };
      }
    } else if (key === 'dynamic') {
      const d = { ...current.dynamic };
      if (value.enabled !== undefined) d.enabled = !!value.enabled;
      if (value.weather !== undefined) d.weather = !!value.weather;
      if (value.sensitivity !== undefined) d.sensitivity = Math.min(1, Math.max(0.05, Number(value.sensitivity) || 0.35));
      if (value.maxBoda !== undefined) d.maxBoda = Math.min(3, Math.max(1, Number(value.maxBoda) || 1.8));
      if (value.maxCar !== undefined) d.maxCar = Math.min(3, Math.max(1, Number(value.maxCar) || 2));
      value = d;
    } else if (key !== 'supportPhone') {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0) continue;
    }
    await db.query(
      'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value)]
    );
  }
  cache = null;
  return getSettings();
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Client sends road distance and FREE-FLOW driving time from OSRM; we sanity-check
// both against the straight line so nobody can fake a cheap fare. Traffic is added
// on the server (see surge.trafficFactor), so everyone gets the same treatment.
function trustedDistance(pickup, drop, clientKm, clientFreeMin) {
  const straight = haversineKm(pickup, drop);
  let km = Number(clientKm);
  if (!Number.isFinite(km) || km <= 0) km = straight * 1.35;
  km = Math.min(Math.max(km, straight), straight * 3 + 1);
  let min = Number(clientFreeMin);
  if (!Number.isFinite(min) || min <= 0) min = (km / 35) * 60;           // free-flow ~35 km/h in town
  min = Math.min(Math.max(min, (km / 70) * 60), (km / 15) * 60 + 5);     // between 70 and 15 km/h
  return { km: Math.round(km * 100) / 100, min: Math.round(min * 10) / 10 };
}

// Round like the apps riders know: to the nearest UGX 100 for everyday fares,
// and to the nearest 500 for long trips, so cash change is easy.
function roundUGX(n) {
  const step = n < 20000 ? 100 : 500;
  return Math.round(n / step) * step;
}

// fare = max(minimum, base + per km × km + per minute × minutes) × multiplier
function calcFare(svc, km, min, mult) {
  const m = mult == null ? (svc.surge || 1) : mult;
  const raw = Math.max(svc.minFare, svc.base + svc.perKm * km + svc.perMin * min);
  return roundUGX(raw * m);
}

// Full upfront quote for every ride type, with live demand, rain and traffic.
async function quote(pickup, drop, clientKm, clientFreeMin) {
  const surge = require('./surge');
  const s = await getSettings();
  const { km, min: freeMin } = trustedDistance(pickup, drop, clientKm, clientFreeMin);
  const cond = await surge.conditions(pickup.lat, pickup.lng, s.dynamic);
  const options = Object.entries(s.services)
    .filter(([, v]) => v.enabled)
    .map(([id, v]) => {
      const cls = surge.CLASS_OF[id] || 'car';
      const mins = Math.max(1, Math.round(freeMin * surge.trafficFactor(cls, cond.raining)));
      const dyn = cond[cls].mult, manual = v.surge || 1;
      const mult = Math.min(5, Math.max(dyn, manual));
      const reasons = manual > dyn ? ['busy'] : cond[cls].reasons;
      return {
        id, name: v.name, icon: v.icon, seats: v.seats, blurb: v.blurb, vehicle: v.vehicle,
        surge: Math.round(mult * 10) / 10, surgeReasons: mult > 1 ? reasons : [],
        durationMin: mins, fare: calcFare(v, km, mins, mult), regularFare: calcFare(v, km, mins, 1),
      };
    });
  const car = options.find((o) => surge.CLASS_OF[o.id] === 'car') || options[0];
  return { distanceKm: km, freeMin, durationMin: car ? car.durationMin : Math.round(freeMin), traffic: cond.traffic, raining: cond.raining, options };
}

module.exports = { getSettings, updateSettings, quote, calcFare, haversineKm, trustedDistance, DEFAULT_SERVICES };
