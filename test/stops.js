// Multiple stops: priced through every stop plus a per-stop fee, at most 2, never for parcels;
// the driver marks each stop done in order.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token) {
  const r = await fetch(BASE + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function api(path, body, token) { const r = await call(path, body, token); if (r.status >= 400) throw new Error(path + ': ' + r.body.error); return r.body; }
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3366, lng: 32.5877, address: 'Acacia Mall' };
const ntinda = { lat: 0.3536, lng: 32.6142, address: 'Ntinda' }, wandegeya = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' }, kisementi = { lat: 0.3390, lng: 32.5886, address: 'Kisementi' };

(async () => {
  const rider = await api('/auth/register', { name: 'Stops Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  const cfg = await api('/config');
  ok(cfg.stopFee === 1000, 'the per-stop fee (UGX 1,000) is shared with the app');

  const plain = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
  const one = await api('/fare/estimate', { pickup, drop, stops: [ntinda], distanceKm: 9.5, durationMin: 22 }, rider.token);
  const bodaPlain = plain.options.find((o) => o.id === 'boda'), bodaOne = one.options.find((o) => o.id === 'boda');
  ok(bodaOne.parts.stops === 1000 && bodaOne.fare >= bodaPlain.fare + 1000, 'a stop adds its fee and the extra distance');

  const faked = await api('/fare/estimate', { pickup, drop, stops: [ntinda], distanceKm: 1, durationMin: 2 }, rider.token);
  ok(faked.distanceKm >= 8, 'a fake short distance is replaced by the real distance through the stop');

  ok((await call('/fare/estimate', { pickup, drop, stops: [ntinda, wandegeya, kisementi] }, rider.token)).status === 400, 'no more than 2 stops');
  ok((await call('/fare/estimate', { pickup, drop, stops: [pickup] }, rider.token)).status === 400, 'a stop can’t be the same place as the one before');
  ok((await call('/trips', { service: 'parcel', paymentMethod: 'cash', pickup, drop, stops: [ntinda], parcel: { recipientName: 'Bob', recipientPhone: '0772123456', item: 'Box' } }, rider.token)).status === 400, 'parcels can’t have stops');

  // A price locked without stops doesn't apply once a stop is added.
  const t0 = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, stops: [ntinda], distanceKm: 9.5, durationMin: 22, quoteId: plain.quoteId }, rider.token);
  ok(t0.fare >= bodaPlain.fare + 1000, 'a price locked without stops isn’t used for a trip with stops');
  await api(`/trips/${t0.id}/cancel`, {}, rider.token);

  // Driver goes through the stops in order.
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Stops Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFS 505S', licenseNo: 'DL6', vehicleMake: 'Bajaj', vehicleColor: 'White' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  await ds.emitWithAck('driver:online', true);
  let want = null, offer = null;
  ds.on('trip:offer', (o) => { if (o.id === want) offer = o; ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }); });
  const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, stops: [ntinda, wandegeya], distanceKm: 14, durationMin: 35 }, rider.token);
  want = t.id;
  for (let i = 0; i < 30 && !offer; i++) await sleep(100);
  ok(offer && offer.stops.length === 2, 'the driver’s offer shows the 2 stops');
  await sleep(300);
  ok((await call(`/trips/${t.id}/stop`, {}, driver.token)).status === 400, 'stops can’t be marked before the trip starts');
  await api(`/trips/${t.id}/arrived`, {}, driver.token);
  await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
  let r = await api(`/trips/${t.id}/stop`, {}, driver.token);
  let a = await api('/trips/active', null, rider.token);
  ok(r.done === 1 && r.left === 1 && a.stops[0].doneAt && !a.stops[1].doneAt, 'first stop done, the rider sees it ticked');
  r = await api(`/trips/${t.id}/stop`, {}, driver.token);
  ok(r.left === 0 && (await call(`/trips/${t.id}/stop`, {}, driver.token)).status === 400, 'second stop done, then no more stops');
  const pub = await new Promise((res) => { const s = io(BASE); s.on('connect', () => s.emit('track:join', { token: a.shareToken }, (x) => { s.close(); res(x); })); });
  ok(pub.trip.stops.length === 2, 'family following the trip see the stops');
  await api(`/trips/${t.id}/complete`, {}, driver.token);
  ok((await api('/trips/active', null, rider.token)).status === 'completed', 'the trip completes after the stops');
  ds.close();
  console.log(failed ? `${failed} FAILED` : 'all stop checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
