// Home suggestion prices don't count as demand; trip history carries the stars the rider gave.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function api(path, body, token) {
  const r = await fetch(BASE + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (r.status >= 400) throw new Error(path + ': ' + j.error); return j;
}
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
(async () => {
  const rider = await api('/auth/register', { name: 'Premium Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  const pickup = { lat: 0.4100, lng: 32.6500, address: 'Far pickup' }, drop = { lat: 0.4300, lng: 32.6600, address: 'Far drop' };
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const before = (await api('/admin/surge', null, admin.token).catch(() => null));
  const q = await api('/fare/estimate', { pickup, drop, distanceKm: 3, durationMin: 8, peek: true }, rider.token);
  ok(q.options.length > 0 && q.options.every((o) => o.fare > 0), 'a suggestion can be priced without booking');

  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Premium Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFP 707P', licenseNo: 'DL7', vehicleMake: 'Bajaj', vehicleColor: 'Blue' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150); await ds.emitWithAck('driver:online', true);
  let want = null; ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }));
  const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop: { lat: 0.3366, lng: 32.5877, address: 'Acacia Mall' }, distanceKm: 3.5, durationMin: 10 }, rider.token);
  want = t.id; for (let i = 0; i < 30 && (await api('/trips/active', null, rider.token)).status !== 'accepted'; i++) await sleep(100);
  await api(`/trips/${t.id}/arrived`, {}, driver.token); await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token); await api(`/trips/${t.id}/complete`, {}, driver.token);
  await api(`/trips/${t.id}/rate`, { stars: 4 }, rider.token);
  const h = await api('/trips/history', null, rider.token);
  const row = h.find((x) => x.id === t.id);
  ok(row && row.myStars === 4 && row.acceptedAt && row.startedAt && row.completedAt, 'history has the stars you gave and the times for the timeline');
  ds.close();
  console.log(failed ? `${failed} FAILED` : 'all premium checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
