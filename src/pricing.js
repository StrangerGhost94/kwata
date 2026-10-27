// Services, fares and platform settings. Admins can change these live.
const db = require('./db');

// Fares are calibrated against what riders actually pay in Kampala today.
// Bolt's published Kampala route prices (Oct 2026) fit this formula almost exactly:
//   Motorbike ≈ 700 + 620/km + 29/min   Car ≈ 4,250 + 1,800/km + 84/min   XL ≈ 2,700 + 2,270/km + 107/min
// Flytte sits about 8–10% below Bolt for riders, while our lower commission
// (12% vs Bolt's 15–20%) means drivers still take home about the same per trip.
//   fare = max(minFare, base + perKm × road km + perMin × trip minutes) × surge
const PRICING_VERSION = 2;
const DEFAULT_SERVICES = {
  boda:    { name: 'Flytte Boda',    icon: '🏍️', vehicle: 'boda', seats: 1, base: 700,  perKm: 570,  perMin: 26, minFare: 2000,  surge: 1, enabled: true, blurb: 'Beat the traffic on a motorbike.' },
  car:     { name: 'Flytte Car',     icon: '🚗', vehicle: 'car',  seats: 4, base: 3800, perKm: 1650, perMin: 75, minFare: 6000,  surge: 1, enabled: true, blurb: 'Affordable everyday rides.' },
  comfort: { name: 'Flytte Comfort', icon: '🚙', vehicle: 'car',  seats: 4, base: 4500, perKm: 2050, perMin: 95, minFare: 9000,  surge: 1, enabled: true, blurb: 'A step up from Car, for up to 4.' },
  parcel:  { name: 'Flytte Parcel',  icon: '📦', vehicle: 'boda', seats: 0, base: 1000, perKm: 600,  perMin: 20, minFare: 2500,  surge: 1, enabled: true, blurb: 'Send packages across town.' },
  errand:  { name: 'Flytte Errand',  icon: '🛍️', vehicle: 'boda', seats: 0, base: 1000, perKm: 600,  perMin: 20, minFare: 3000,  surge: 1, enabled: true, blurb: 'We buy it and bring it to you.' },
  airport: { name: 'Flytte Airport', icon: '✈️', vehicle: 'car',  seats: 4, base: 8000, perKm: 1750, perMin: 50, minFare: 25000, surge: 1, enabled: true, blurb: 'Entebbe & long-distance trips.' },
};

const DEFAULTS = {
  services: DEFAULT_SERVICES,
  pricingVersion: PRICING_VERSION,
  commissionPct: 12,      // Bolt 15–20%, SafeBoda 15%, Faras 10%. Low commission = happier drivers.
  dispatchRadiusKm: 8,
  offerTimeoutSec: 20,
  stopFee: 1000,          // added per extra stop on a trip, for the driver's waiting time (UGX)
  minWithdrawal: 5000,
  // "Buy it for me": a fee for the courier's shopping time, and the most a courier is asked to spend on goods.
  errand: { shopFee: 2000, maxBudget: 200000 },
  // Flytte Pass: monthly subscription (see src/pass.js).
  pass: { enabled: true, price: 15000, days: 30, percent: 10, maxDiscount: 3000 },
  // Flytte for Business: the credit a new company account starts with (see src/business.js).
  business: { enabled: true, creditLimit: 300000 },
  supportPhone: '',      // set the real line in Admin → Pricing (or SUPPORT_PHONE). Hidden in the apps until set.
  // Dynamic pricing (see src/surge.js). Caps keep fares affordable in Kampala.
  dynamic: { enabled: true, sensitivity: 0.35, maxBoda: 1.8, maxCar: 2.0, weather: true },
  // Growth: what makes people try Flytte, invite friends and come back. Flytte pays for these.
  growth: {
    firstRide: { enabled: true, percent: 50, max: 3000 },       // first trip: 50% off, up to UGX 3,000
    referral: { enabled: true, referrer: 3000, friend: 2000 },  // wallet credit once the friend finishes a first trip
    rewards: { enabled: true, pointsPer1000: 1, redeemPoints: 100, redeemValue: 2000 }, // ~2% back
  },
  // Driver protections and tools. All of these can be changed in Admin → Drivers.
  drivers: {
    cashDebtLimit: 30000,   // commission owed (UGX) before new cash trips pause; Mobile Money/wallet trips continue
    freeWaitMin: 5,         // free waiting at pickup before the driver may cancel as a no-show
    noShowFee: 2000,        // paid to the driver from the rider's wallet on a no-show (only if the wallet covers it)
    cancelFee: 1000,        // paid to the driver from the rider's wallet when the rider cancels late (only if the wallet covers it)
    cancelGraceMin: 2,      // minutes after a driver accepts during which the rider can cancel for free
    headingHomePerDay: 2,   // how many times a day a driver can switch on "Heading home"
    queueNext: true,        // offer a nearby next trip when the current one is about to finish
    showDestination: true,  // drivers see where the trip goes before accepting (off: only the distance, address after accepting)
    docReminderDays: 14,    // remind drivers this many days before a document expires
    mismatchPauseReports: 3, // riders (different people, last 30 days) reporting the wrong face or plate before a driver is paused; 0 = never
  },
  // Driver bonuses set by the team, e.g. { id, title, trips: 10, reward: 5000, period: 'day', active: true }.
  // Flytte pays these; none are switched on until the team adds them.
  bonuses: [],
};

const OLD_BLURBS = ['Beat the jam. Helmet provided.', 'Newer cars, AC, top-rated drivers.'];
let cache = null;

async function getSettings() {
  if (cache) return cache;
  const rows = (await db.query('SELECT key, value FROM settings')).rows;
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  for (const r of rows) {
    try { s[r.key] = JSON.parse(r.value); } catch { /* ignore bad rows */ }
  }
  s.dynamic = { ...DEFAULTS.dynamic, ...(s.dynamic || {}) };
  s.errand = { ...DEFAULTS.errand, ...(s.errand || {}) };
  s.pass = { ...DEFAULTS.pass, ...(s.pass || {}) };
  s.business = { ...DEFAULTS.business, ...(s.business || {}) };
  s.drivers = { ...DEFAULTS.drivers, ...(s.drivers || {}) };
  if (!Array.isArray(s.bonuses)) s.bonuses = [];
  const g = s.growth || {};
  s.growth = { firstRide: { ...DEFAULTS.growth.firstRide, ...(g.firstRide || {}) }, referral: { ...DEFAULTS.growth.referral, ...(g.referral || {}) }, rewards: { ...DEFAULTS.growth.rewards, ...(g.rewards || {}) } };
  // make sure new default services appear even if older settings were saved
  for (const [k, v] of Object.entries(DEFAULT_SERVICES)) {
    s.services[k] = { ...v, ...(s.services[k] || {}) };
    // Earlier placeholder descriptions made promises nobody had confirmed; show the neutral one instead.
    if (OLD_BLURBS.includes(s.services[k].blurb)) s.services[k].blurb = v.blurb;
    // The app was renamed to Flytte: service names saved under the old name follow the new one.
    if (typeof s.services[k].name === 'string') s.services[k].name = s.services[k].name.replace(/^Kwata\b/, 'Flytte');
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
  const allowed = ['services', 'commissionPct', 'dispatchRadiusKm', 'offerTimeoutSec', 'minWithdrawal', 'stopFee', 'errand', 'pass', 'business', 'supportPhone', 'dynamic', 'growth', 'drivers', 'bonuses'];
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
        if (typeof svc.blurb === 'string') clean.blurb = svc.blurb.replace(/[<>]/g, '').trim().slice(0, 60);
        value[id] = { ...value[id], ...clean };
      }
    } else if (key === 'growth') {
      const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
      const cur = current.growth, g = value || {};
      const fr = { ...cur.firstRide, ...(g.firstRide || {}) }, rf = { ...cur.referral, ...(g.referral || {}) }, rw = { ...cur.rewards, ...(g.rewards || {}) };
      value = {
        firstRide: { enabled: !!fr.enabled, percent: num(fr.percent, 0, 100, 50), max: num(fr.max, 0, 100000, 3000) },
        referral: { enabled: !!rf.enabled, referrer: num(rf.referrer, 0, 100000, 3000), friend: num(rf.friend, 0, 100000, 2000) },
        rewards: { enabled: !!rw.enabled, pointsPer1000: num(rw.pointsPer1000, 0, 100, 1), redeemPoints: num(rw.redeemPoints, 1, 100000, 100), redeemValue: num(rw.redeemValue, 0, 100000, 2000) },
      };
    } else if (key === 'dynamic') {
      const d = { ...current.dynamic };
      if (value.enabled !== undefined) d.enabled = !!value.enabled;
      if (value.weather !== undefined) d.weather = !!value.weather;
      if (value.sensitivity !== undefined) d.sensitivity = Math.min(1, Math.max(0.05, Number(value.sensitivity) || 0.35));
      if (value.maxBoda !== undefined) d.maxBoda = Math.min(3, Math.max(1, Number(value.maxBoda) || 1.8));
      if (value.maxCar !== undefined) d.maxCar = Math.min(3, Math.max(1, Number(value.maxCar) || 2));
      value = d;
    } else if (key === 'drivers') {
      const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
      const c = { ...current.drivers, ...(value || {}) };
      value = {
        cashDebtLimit: num(c.cashDebtLimit, 0, 1000000, 30000),
        freeWaitMin: num(c.freeWaitMin, 0, 30, 5),
        noShowFee: num(c.noShowFee, 0, 50000, 2000),
        cancelFee: num(c.cancelFee, 0, 50000, 1000),
        cancelGraceMin: num(c.cancelGraceMin, 0, 30, 2),
        headingHomePerDay: num(c.headingHomePerDay, 0, 10, 2),
        queueNext: c.queueNext !== false && c.queueNext !== 'false',
        showDestination: c.showDestination !== false && c.showDestination !== 'false',
        docReminderDays: num(c.docReminderDays, 1, 90, 14),
        mismatchPauseReports: num(c.mismatchPauseReports, 0, 20, 3),
      };
    } else if (key === 'bonuses') {
      if (!Array.isArray(value)) continue;
      const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
      value = value.slice(0, 10).map((b) => ({
        id: /^[a-z0-9]{4,16}$/.test(String(b.id || '')) ? String(b.id) : require('crypto').randomBytes(4).toString('hex'),
        title: String(b.title || '').replace(/[<>]/g, '').trim().slice(0, 60) || 'Trip bonus',
        trips: num(b.trips, 1, 200),
        reward: num(b.reward, 0, 1000000),
        period: b.period === 'week' ? 'week' : 'day',
        active: !!b.active,
      }));
    } else if (key === 'errand') {
      const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
      const c = { ...current.errand, ...(value || {}) };
      value = { shopFee: num(c.shopFee, 0, 50000, 2000), maxBudget: num(c.maxBudget, 5000, 2000000, 200000) };
    } else if (key === 'pass') {
      const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
      const c = { ...current.pass, ...(value || {}) };
      value = { enabled: c.enabled !== false && c.enabled !== 'false', price: num(c.price, 1000, 500000, 15000), days: num(c.days, 7, 365, 30), percent: num(c.percent, 0, 50, 10), maxDiscount: num(c.maxDiscount, 0, 50000, 3000) };
    } else if (key === 'business') {
      const c = { ...current.business, ...(value || {}) };
      const n = Math.round(Number(c.creditLimit));
      value = { enabled: c.enabled !== false && c.enabled !== 'false', creditLimit: Number.isFinite(n) ? Math.min(50000000, Math.max(0, n)) : 300000 };
    } else if (key === 'supportPhone') {
      value = String(value || '').trim();
      if (value && !/^\+?[0-9][0-9 ]{7,17}$/.test(value)) continue; // digits, spaces and an optional +
    } else {
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
// With stops, the straight line runs pickup → each stop → destination.
function trustedDistance(pickup, drop, clientKm, clientFreeMin, stops = []) {
  const pts = [pickup, ...stops, drop];
  let straight = 0;
  for (let i = 1; i < pts.length; i++) straight += haversineKm(pts[i - 1], pts[i]);
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
async function quote(pickup, drop, clientKm, clientFreeMin, stops = []) {
  const surge = require('./surge');
  const s = await getSettings();
  const { km, min: freeMin } = trustedDistance(pickup, drop, clientKm, clientFreeMin, stops);
  const stopsFee = stops.length * (s.stopFee || 0);
  const shopFee = (s.errand && s.errand.shopFee) || 0;
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
        durationMin: mins, fare: calcFare(v, km, mins, mult) + stopsFee + (id === 'errand' ? shopFee : 0), regularFare: calcFare(v, km, mins, 1) + stopsFee + (id === 'errand' ? shopFee : 0),
        // How the price is made, for "Why this price?"
        parts: { base: v.base, distance: Math.round(v.perKm * km), time: Math.round(v.perMin * mins), minFare: v.minFare, km: Math.round(km * 10) / 10, min: mins, stops: stopsFee, shop: id === 'errand' ? shopFee : 0 },
      };
    });
  const car = options.find((o) => surge.CLASS_OF[o.id] === 'car') || options[0];
  return { distanceKm: km, freeMin, durationMin: car ? car.durationMin : Math.round(freeMin), traffic: cond.traffic, raining: cond.raining, options };
}

module.exports = { getSettings, updateSettings, quote, calcFare, haversineKm, trustedDistance, DEFAULT_SERVICES };
