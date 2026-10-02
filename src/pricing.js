// Services, fares and platform settings. Admins can change these live.
const db = require('./db');

const DEFAULT_SERVICES = {
  boda:    { name: 'Kwata Boda',    icon: '🏍️', vehicle: 'boda', seats: 1, base: 1500,  perKm: 700,  perMin: 50,  minFare: 2500,  surge: 1, enabled: true, blurb: 'Beat the jam. Helmet provided.' },
  car:     { name: 'Kwata Car',     icon: '🚗', vehicle: 'car',  seats: 4, base: 3000,  perKm: 1400, perMin: 100, minFare: 7000,  surge: 1, enabled: true, blurb: 'Affordable everyday rides.' },
  comfort: { name: 'Kwata Comfort', icon: '🚙', vehicle: 'car',  seats: 4, base: 5000,  perKm: 2000, perMin: 150, minFare: 12000, surge: 1, enabled: true, blurb: 'Newer cars, AC, top-rated drivers.' },
  parcel:  { name: 'Kwata Parcel',  icon: '📦', vehicle: 'boda', seats: 0, base: 2000,  perKm: 800,  perMin: 0,   minFare: 3000,  surge: 1, enabled: true, blurb: 'Send packages across town.' },
  airport: { name: 'Kwata Airport', icon: '✈️', vehicle: 'car',  seats: 4, base: 15000, perKm: 1500, perMin: 0,   minFare: 50000, surge: 1, enabled: true, blurb: 'Entebbe & long-distance trips.' },
};

const DEFAULTS = {
  services: DEFAULT_SERVICES,
  commissionPct: 12,      // Uber took ~25%. Lower commission = happier drivers.
  dispatchRadiusKm: 8,
  offerTimeoutSec: 20,
  minWithdrawal: 5000,
  supportPhone: '+256 700 000000',
};

let cache = null;

async function getSettings() {
  if (cache) return cache;
  const rows = (await db.query('SELECT key, value FROM settings')).rows;
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* ignore bad rows */ }
  }
  // make sure new default services appear even if older settings were saved
  for (const [k, v] of Object.entries(DEFAULT_SERVICES)) {
    s.services[k] = { ...v, ...(s.services[k] || {}) };
  }
  cache = s;
  return s;
}

async function updateSettings(patch) {
  const current = await getSettings();
  const allowed = ['services', 'commissionPct', 'dispatchRadiusKm', 'offerTimeoutSec', 'minWithdrawal', 'supportPhone'];
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

// Client sends road distance from OSRM; we sanity-check it against the
// straight-line distance so nobody can fake a cheap fare.
function trustedDistance(pickup, drop, clientKm, clientMin) {
  const straight = haversineKm(pickup, drop);
  let km = Number(clientKm);
  if (!Number.isFinite(km) || km <= 0) km = straight * 1.35;
  km = Math.min(Math.max(km, straight), straight * 3 + 1);
  let min = Number(clientMin);
  const minPossible = (km / 60) * 60;   // 60 km/h average best case
  if (!Number.isFinite(min) || min <= 0) min = (km / 22) * 60; // Kampala avg ~22 km/h
  min = Math.min(Math.max(min, minPossible), (km / 5) * 60 + 10);
  return { km: Math.round(km * 100) / 100, min: Math.round(min) };
}

function roundUGX(n) {
  return Math.ceil(n / 500) * 500;
}

function calcFare(svc, km, min) {
  const raw = (svc.base + svc.perKm * km + svc.perMin * min) * (svc.surge || 1);
  return roundUGX(Math.max(svc.minFare, raw));
}

async function quote(pickup, drop, clientKm, clientMin) {
  const s = await getSettings();
  const { km, min } = trustedDistance(pickup, drop, clientKm, clientMin);
  const options = Object.entries(s.services)
    .filter(([, v]) => v.enabled)
    .map(([id, v]) => ({
      id, name: v.name, icon: v.icon, seats: v.seats, blurb: v.blurb, vehicle: v.vehicle,
      surge: v.surge, fare: calcFare(v, km, min),
    }));
  return { distanceKm: km, durationMin: min, options };
}

module.exports = { getSettings, updateSettings, quote, calcFare, haversineKm, trustedDistance, DEFAULT_SERVICES };
