// Place search for the rider app. Results come in this order:
//   1. Kampala landmarks (src/landmarks.js), matched on their names and nicknames ("owino", "mubs").
//   2. Places riders use a lot, learned from completed trips. A place is only suggested once
//      3 or more different riders have used it, so nobody's own address is shown to others.
//   3. OpenStreetMap search through Photon, which (unlike Nominatim) is built for search-as-you-type.
// Set PHOTON_URL to use another Photon server (e.g. self-hosted) instead of the public one.
const db = require('./db');
const LANDMARKS = require('./landmarks');
const { haversineKm } = require('./pricing');

const PHOTON = (process.env.PHOTON_URL || 'https://photon.komoot.io').replace(/\/+$/, '');
const UGANDA_BBOX = '29.5,-1.5,35.1,4.3';
const KAMPALA = { lat: 0.3136, lng: 32.5811 };
const MIN_RIDERS = 3;
const MAX_RESULTS = 8;
const MAX_KM = 80;   // Flytte serves Kampala and around (Entebbe, Mukono); skip same-named places upcountry
// Names that describe a person's own spot rather than a place others would look for.
const PRIVATE_NAME = /^(home|work|current location|pinned location|finding address.*|my location)$/i;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);
const close = (a, b, km = 0.15) => haversineKm(a, b) < km;

// Every typed word has to start a word of the place's name or nickname (an area alone counts for less).
// Returns 0 for no match; higher is better.
function score(q, name, aliases = [], area = '') {
  const main = [...words(name), ...aliases.flatMap(words)];
  const all = [...main, ...words(area)];
  const startsAll = (pool) => q.words.every((w) => pool.some((x) => x.startsWith(w)));
  if (!startsAll(all)) return 0;
  if (!startsAll(main)) return 0.5;
  let s = 2;
  if (norm(name).startsWith(q.text)) s += 3;
  if (aliases.some((a) => norm(a).startsWith(q.text))) s += 2;
  return s;
}

const landmarks = LANDMARKS.map((l) => ({ ...l }));
const landmarkKeys = new Set(landmarks.map((l) => norm(l.name)));

// ---------- Places riders use (learned from completed trips) ----------
let popular = { at: 0, list: [] };
async function popularPlaces() {
  if (Date.now() - popular.at < 5 * 60e3) return popular.list;
  const { rows } = await db.query('SELECT name, lat, lng, uses FROM places WHERE riders >= $1 ORDER BY uses DESC LIMIT 2000', [MIN_RIDERS]);
  popular = { at: Date.now(), list: rows.map((r) => ({ name: r.name, lat: Number(r.lat), lng: Number(r.lng), uses: Number(r.uses) })) };
  return popular.list;
}

async function remember(riderId, name, lat, lng) {
  name = String(name || '').trim();
  const key = norm(name);
  if (!riderId || key.length < 3 || name.length > 80 || PRIVATE_NAME.test(name) || landmarkKeys.has(key)) return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  // The same name within ~300 m is the same place.
  let p = await db.one('SELECT id FROM places WHERE name_key = $1 AND ABS(lat - $2) < 0.003 AND ABS(lng - $3) < 0.003 LIMIT 1', [key, lat, lng]);
  if (!p) p = await db.one('INSERT INTO places(name, name_key, lat, lng) VALUES ($1,$2,$3,$4) RETURNING id', [name, key, lat, lng]);
  const firstTime = (await db.query('INSERT INTO place_riders(place_id, rider_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING place_id', [p.id, riderId])).rows.length > 0;
  const row = await db.one('UPDATE places SET uses = uses + 1, riders = riders + $2, last_used = NOW() WHERE id = $1 RETURNING riders', [p.id, firstTime ? 1 : 0]);
  if (firstTime && Number(row.riders) === MIN_RIDERS) popular.at = 0;   // just became popular: show it right away
}

// Called after a trip is completed: its pickup and destination count as one use each.
async function learnFromTrip(tripId) {
  const t = await db.one("SELECT rider_id, pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng FROM trips WHERE id = $1 AND status = 'completed'", [tripId]);
  if (!t) return;
  await remember(t.rider_id, t.pickup_address, Number(t.pickup_lat), Number(t.pickup_lng));
  await remember(t.rider_id, t.drop_address, Number(t.drop_lat), Number(t.drop_lng));
}

// ---------- OpenStreetMap search (Photon) ----------
const AREAS = new Set(['suburb', 'neighbourhood', 'quarter', 'village', 'locality', 'town', 'hamlet']);
// A word for the kind of place, so same-named results can be told apart ("Kololo" the area vs the bank).
const KINDS = {
  bank: 'Bank', hospital: 'Hospital', clinic: 'Clinic', pharmacy: 'Pharmacy', school: 'School', university: 'University', college: 'College',
  fuel: 'Fuel station', marketplace: 'Market', mall: 'Mall', supermarket: 'Supermarket', bus_station: 'Taxi or bus park', hotel: 'Hotel',
  restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', place_of_worship: 'Place of worship', police: 'Police', stadium: 'Stadium',
  aerodrome: 'Airport', village: 'Village', suburb: 'Area', neighbourhood: 'Area', locality: 'Area', town: 'Town',
};
const cache = new Map();
async function photon(text, near) {
  const key = `${text}|${near.lat.toFixed(2)},${near.lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.items;
  const url = `${PHOTON}/api/?` + new URLSearchParams({ q: text, lat: near.lat, lon: near.lng, limit: 10, lang: 'en', bbox: UGANDA_BBOX });
  const r = await fetch(url, { headers: { 'User-Agent': 'Flytte ride-hailing (https://flytte.co)' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`place search answered ${r.status}`);
  const j = await r.json();
  const items = (j.features || []).map((f) => {
    const p = f.properties || {};
    const [lng, lat] = (f.geometry && f.geometry.coordinates) || [];
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ');
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const region = p.state && !/region$/i.test(p.state) ? p.state : null;   // e.g. "Mpigi" for a village upcountry
    const parts = [KINDS[p.osm_value], p.name ? p.street : null, p.district || p.locality, p.city || p.county || region].filter((x) => x && norm(x) !== norm(name));
    return { name, address: [...new Set(parts)].join(', '), lat, lng, isArea: AREAS.has(p.osm_value) };
  }).filter(Boolean);
  cache.set(key, { at: Date.now(), items });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return items;
}

// ---------- Search ----------
async function search(text, near = KAMPALA) {
  const q = { text: norm(text), words: words(text) };
  if (q.text.length < 2) return { results: [], partial: false };
  const byScore = (a, b) => b.score - a.score || haversineKm(near, a) - haversineKm(near, b);

  // A landmark shows when its own name or nickname matches; typing just its area ("kololo") lists the area itself.
  const marks = landmarks.map((l) => ({ ...l, score: score(q, l.name, l.aliases, l.area) })).filter((l) => l.score >= 2).sort(byScore).slice(0, 4)
    .map((l) => ({ name: l.name, address: l.area, lat: l.lat, lng: l.lng, kind: 'landmark', icon: l.icon }));

  const pop = await popularPlaces().catch((e) => { console.error('popular places:', e.message); return []; });
  const used = pop.map((p) => ({ ...p, score: score(q, p.name) + Math.log10(1 + p.uses) })).filter((p) => p.score >= 2).sort(byScore)
    .map((p) => ({ name: p.name, address: 'Popular with riders', lat: p.lat, lng: p.lng, kind: 'popular' }));

  let osm = [], partial = false;
  try {
    // Nearby first (a Kololo in Mpigi after the one in Kampala); typing an area's name puts the area before shops in it.
    const rank = (p) => (haversineKm(near, p) > 30 ? 2 : 0) + (p.isArea && norm(p.name).startsWith(q.text) ? 0 : 1);
    osm = (await photon(text.trim(), near)).filter((p) => haversineKm(near, p) <= MAX_KM)
      .map((p, i) => ({ p, i, r: rank(p), km: haversineKm(near, p) })).sort((a, b) => a.r - b.r || (a.r === 0 ? a.km - b.km : 0) || a.i - b.i)
      .map(({ p }) => ({ name: p.name, address: p.address, lat: p.lat, lng: p.lng, kind: 'map' }));
  } catch (e) { partial = true; console.error('place search:', e.message); }

  const out = [];
  const add = (p) => {
    if (out.length >= MAX_RESULTS) return;
    // Skip a result that is already listed: the same place nearby, or the same name very close by.
    if (out.some((o) => close(o, p, 0.05) || (norm(o.name) === norm(p.name) && close(o, p, 0.4)))) return;
    out.push(p);
  };
  marks.forEach(add);
  used.slice(0, 3).forEach(add);
  osm.forEach(add);
  return { results: out, partial };
}

module.exports = { search, learnFromTrip, norm, MIN_RIDERS, _cache: cache, _reset: () => { popular.at = 0; } };
