// Dynamic pricing for Kwata, modelled on how Bolt and Uber price rides:
//
//   1. The city is split into areas (~2.2 km squares, close to Uber's ~5 km² cells).
//   2. For each area and vehicle class (boda / car) we compare DEMAND (ride requests
//      in the last 10 minutes, plus open "checking prices" sessions) with SUPPLY
//      (free, online drivers nearby).
//   3. demand ÷ supply goes through a gentle curve. Nothing happens until demand
//      clearly outruns supply, and never on thin data (too few requests).
//   4. The result is smoothed: it rises quickly but falls slowly, moves at most
//      +0.3× per minute (falls −0.15×/min), and is capped (default 1.8× boda, 2.0× car).
//   5. Rain is a known demand spike in Kampala (and boda supply drops), so live
//      weather adds a small, capped boost.
//   6. Traffic: trip time is free-flow time × a Kampala time-of-day factor
//      (rush hours 7:30–9:30 and 17:00–19:30 on weekdays), and bodas weave
//      through jams so their time grows much less.
//   7. Every price shown is a locked quote for 2 minutes. Riders are never
//      charged more than the price they accepted.
const crypto = require('crypto');
const { haversineKm } = require('./pricing');

const CLASS_OF = { boda: 'boda', parcel: 'boda', car: 'car', comfort: 'car', airport: 'car' };
const CELL = 0.02;            // degrees, about 2.2 km in Kampala
const REQUEST_WINDOW = 10 * 60e3;
const LOOK_WINDOW = 5 * 60e3;
const QUOTE_TTL = 2 * 60e3;

const requests = [];          // { at, lat, lng, cls }
const looks = new Map();      // `${userId}:${cls}` -> { at, lat, lng, cls }  (one per rider)
const smooth = new Map();     // `${cell}:${cls}` -> { value, at }
const quotes = new Map();     // quoteId -> { userId, at, km, freeMin, pickup, drop, options }

const cellOf = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
const prune = () => {
  const now = Date.now();
  while (requests.length && now - requests[0].at > REQUEST_WINDOW) requests.shift();
  for (const [k, v] of looks) if (now - v.at > LOOK_WINDOW) looks.delete(k);
  for (const [k, v] of quotes) if (now - v.at > QUOTE_TTL) quotes.delete(k);
};

function recordRequest(service, lat, lng) {
  requests.push({ at: Date.now(), lat, lng, cls: CLASS_OF[service] || 'car' });
}
function recordLook(userId, lat, lng) {
  for (const cls of ['boda', 'car']) looks.set(`${userId}:${cls}`, { at: Date.now(), lat, lng, cls });
}

// ---------- Kampala time & traffic ----------
function kampalaNow(date = new Date()) {
  const d = new Date(date.getTime() + 3 * 3600e3); // EAT, UTC+3, no daylight saving
  return { hour: d.getUTCHours() + d.getUTCMinutes() / 60, day: d.getUTCDay() };
}
function trafficFactor(cls, raining, date) {
  const { hour, day } = kampalaNow(date);
  const weekday = day >= 1 && day <= 5;
  let f;
  if (hour < 5.5 || hour >= 22) f = 1.15;                                   // night: roads clear
  else if (weekday && ((hour >= 7.5 && hour < 9.5) || (hour >= 17 && hour < 19.5))) f = 2.2; // rush hour
  else if (weekday && ((hour >= 6.5 && hour < 7.5) || (hour >= 16 && hour < 17) || (hour >= 19.5 && hour < 20.5))) f = 1.8;
  else f = 1.6;                                                              // normal daytime
  if (raining) f += 0.25;
  // Bodas filter through jams: they feel only a fraction of the delay.
  return cls === 'boda' ? 1 + (f - 1) * 0.35 : f;
}
function trafficLabel(date) {
  const f = trafficFactor('car', false, date);
  return f >= 2.2 ? 'rush' : f >= 1.8 ? 'busy' : f <= 1.2 ? 'clear' : 'normal';
}

// ---------- Weather (Open-Meteo, cached 10 minutes) ----------
let weather = { at: 0, mm: 0, ok: false };
async function rainNow() {
  if (Date.now() - weather.at < 10 * 60e3) return weather;
  weather.at = Date.now(); // don't hammer the API if it fails
  try {
    const key = process.env.OPEN_METEO_KEY;
    const host = key ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
    const url = `${host}/v1/forecast?latitude=0.3136&longitude=32.5811&current=precipitation,rain${key ? '&apikey=' + encodeURIComponent(key) : ''}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    const j = await (await fetch(url, { signal: ctrl.signal })).json();
    clearTimeout(t);
    const mm = Number((j.current || {}).precipitation ?? (j.current || {}).rain) || 0;
    weather = { at: Date.now(), mm, ok: true };
  } catch { weather.ok = false; }
  return weather;
}
let rainOverride = null; // for testing / admin "it's pouring" switch: null | mm/h
function setRainOverride(mm) { rainOverride = mm == null ? null : Number(mm); }
async function currentRain(cfg) {
  if (rainOverride != null) return rainOverride;
  if (!cfg.weather) return 0;
  return (await rainNow()).mm;
}

// ---------- Supply & demand ----------
function supplyNear(lat, lng, cls) {
  const rt = require('./realtime');
  let n = 0;
  for (const d of rt.driversSnapshot()) {
    if (!d.online || d.busy || !d.lat) continue;
    if ((d.vehicle === 'car' ? 'car' : 'boda') !== cls) continue;
    if (haversineKm({ lat, lng }, d) <= 3) n++;
  }
  return n;
}
function demandNear(lat, lng, cls) {
  prune();
  let req = 0, look = 0;
  for (const r of requests) if (r.cls === cls && haversineKm({ lat, lng }, r) <= 3) req++;
  for (const l of looks.values()) if (l.cls === cls && haversineKm({ lat, lng }, l) <= 3) look++;
  return { req, look, score: req + 0.35 * look };
}

// Shaped curve: 1 + k·(ratio − 1)^0.7, flat below 1, needs enough signal.
function curve(ratio, k, demandScore, requests = 99) {
  // Needs real ride requests for this vehicle type, not just people browsing prices.
  if (requests < 2 || demandScore < 3 || ratio <= 1.15) return 1;
  return 1 + k * Math.pow(ratio - 1, 0.7);
}

function smoothed(key, target) {
  const now = Date.now();
  const prev = smooth.get(key);
  if (!prev) { const v = Math.min(target, 1.3); smooth.set(key, { value: v, at: now }); return v; }
  const mins = Math.max(0.05, (now - prev.at) / 60e3);
  let v;
  if (target > prev.value) v = Math.min(target, prev.value + 0.3 * mins);   // rise, at most +0.3×/min
  else v = Math.max(target, prev.value - 0.15 * mins);                     // fall slower, −0.15×/min
  smooth.set(key, { value: v, at: now });
  return v;
}

const DEFAULT_DYNAMIC = { enabled: true, sensitivity: 0.35, maxBoda: 1.8, maxCar: 2.0, weather: true };

// Returns { boda: {mult, reasons}, car: {mult, reasons}, rainMm, traffic }
async function conditions(lat, lng, cfg = DEFAULT_DYNAMIC) {
  const c = { ...DEFAULT_DYNAMIC, ...(cfg || {}) };
  const mm = await currentRain(c);
  const raining = mm >= 0.5;
  const out = { rainMm: mm, raining, traffic: trafficLabel() };
  for (const cls of ['boda', 'car']) {
    const reasons = [];
    let mult = 1;
    if (c.enabled) {
      const supply = supplyNear(lat, lng, cls);
      const demand = demandNear(lat, lng, cls);
      const ratio = demand.score / Math.max(supply, 0.5);
      const target = curve(ratio, c.sensitivity, demand.score, demand.req);
      mult = smoothed(`${cellOf(lat, lng)}:${cls}`, target);
      if (mult >= 1.05) reasons.push('demand');
      out[cls + 'Debug'] = { supply, demand, ratio: Math.round(ratio * 100) / 100, target: Math.round(target * 100) / 100 };
      if (raining) {
        const boost = mm >= 3 ? (cls === 'boda' ? 0.4 : 0.3) : (cls === 'boda' ? 0.2 : 0.15);
        mult += boost; reasons.push('rain');
      }
      mult = Math.min(mult, cls === 'boda' ? c.maxBoda : c.maxCar);
    }
    out[cls] = { mult: Math.round(mult * 10) / 10, reasons };
  }
  return out;
}

// ---------- Locked quotes ----------
function saveQuote(q) {
  prune();
  const id = crypto.randomBytes(9).toString('base64url');
  quotes.set(id, { ...q, at: Date.now() });
  return id;
}
function getQuote(id, userId) {
  prune();
  const q = id && quotes.get(id);
  return q && q.userId === userId ? q : null;
}
function dropQuote(id) { quotes.delete(id); }

module.exports = {
  CLASS_OF, DEFAULT_DYNAMIC, conditions, trafficFactor, trafficLabel, kampalaNow,
  recordRequest, recordLook, saveQuote, getQuote, dropQuote, setRainOverride, curve,
  _reset: () => { requests.length = 0; looks.clear(); smooth.clear(); quotes.clear(); },
};
