// Driver checks shown to riders before pickup: "ID checked", "Permit valid" (and not once it has
// expired), and the month the driver joined.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function api(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (r.status >= 400) throw new Error(path + ': ' + j.error); return j;
}
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const day = (n) => new Date(Date.now() + 3 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Trust Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFT 303T', licenseNo: 'DL3', vehicleMake: 'Bajaj', vehicleColor: 'Blue' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const rider = await api('/auth/register', { name: 'Trust Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  await ds.emitWithAck('driver:online', true);
  let want = null;
  const accepted = new Promise((res) => ds.on('trip:offer', (o) => { ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }); if (o.id === want) setTimeout(res, 300); }));
  const book = (id) => { want = id; };

  // No documents yet: no badges.
  const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop: { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' }, distanceKm: 3.2, durationMin: 12 }, rider.token);
  book(t.id); await accepted;
  let a = await api('/trips/active', null, rider.token);
  ok(a.driver && a.driver.checks && a.driver.checks.id === false && a.driver.checks.permit === false, 'without documents the rider sees no ID or permit badge');
  ok(a.driver.checks.since === new Date().toISOString().slice(0, 7), 'the month the driver joined is shown');

  await api('/driver/documents', { kind: 'national_id', image: jpeg }, driver.token);
  await api('/driver/documents', { kind: 'license', image: jpeg, expiresOn: day(200) }, driver.token);
  a = await api('/trips/active', null, rider.token);
  ok(a.driver.checks.id === true && a.driver.checks.permit === true, 'with ID and a valid permit on file, both badges show');

  await api('/driver/documents/expiry', { kind: 'license', expiresOn: day(-1) }, driver.token);
  a = await api('/trips/active', null, rider.token);
  ok(a.driver.checks.id === true && a.driver.checks.permit === false, 'an expired permit loses its badge');

  const pub = await new Promise((res) => { const s = io(BASE); s.on('connect', () => s.emit('track:join', { token: a.shareToken }, (r) => { s.close(); res(r); })); });
  ok(pub.ok && pub.trip.driver.checks && pub.trip.driver.checks.id === true && !pub.trip.driver.phone, 'family following the trip see the checks but not the phone number');

  await api(`/trips/${t.id}/cancel`, {}, rider.token).catch(() => {});
  ds.close();
  console.log(failed ? `${failed} FAILED` : 'all driver check badges passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
