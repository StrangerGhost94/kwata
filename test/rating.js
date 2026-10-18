// Rating is optional: a rider can skip it ("not now") without the trip coming back,
// and a skip never changes the driver's rating.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function api(path, body, token, method) { const j = await call(path, body, token, method); if (j.status >= 400) throw new Error(path + ': ' + (j.body && j.body.error)); return j.body; }
let failed = 0;
const assert = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Rate Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFG 202B', licenseNo: 'DL10' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const rider = await api('/auth/register', { name: 'Skip Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 });
  await sleep(150);
  await ds.emitWithAck('driver:online', true);
  await sleep(200);
  const ride = async () => {
    const offer = new Promise((r) => ds.once('trip:offer', r));
    const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
    await offer; await ds.emitWithAck('trip:respond', { tripId: t.id, accept: true });
    await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
    await api(`/trips/${t.id}/complete`, {}, driver.token);
    await call(`/trips/${t.id}/pay-cash`, {}, rider.token);
    return t;
  };
  const driverRating = async () => (await api('/me', null, driver.token)).user;

  const t1 = await ride();
  const before = await driverRating();
  const a1 = await api('/trips/active', null, rider.token);
  assert(a1 && a1.id === t1.id && !a1.riderRated, 'an unrated trip waits on the done screen');
  const bad = await call(`/trips/${t1.id}/rate`, {}, rider.token);
  assert(bad.status === 400, 'an empty rating without skip is still refused');
  const sk = await call(`/trips/${t1.id}/rate`, { skip: true }, rider.token);
  assert(sk.status === 200, 'the rider can skip rating');
  const a2 = await api('/trips/active', null, rider.token);
  assert(a2 === null, 'a skipped trip no longer comes back as the current trip');
  const after = await driverRating();
  assert(after.rating === before.rating, "skipping doesn't change the driver's rating");
  const late = await call(`/trips/${t1.id}/rate`, { stars: 1 }, rider.token);
  const after2 = await driverRating();
  assert(late.status === 200 && after2.rating === before.rating, 'a skipped trip cannot be rated afterwards to sneak in a score');

  const t2 = await ride();
  await api(`/trips/${t2.id}/rate`, { stars: 4 }, rider.token);
  const after3 = await driverRating();
  assert(after3.rating !== before.rating || before.rating === 4, 'a real rating still counts');
  const hist = await api('/trips/history', null, rider.token);
  const h1 = hist.find((x) => x.id === t1.id);
  assert(h1 && h1.riderRated === true, 'history shows the skipped trip as dealt with');

  ds.close();
  console.log(failed ? `${failed} failed` : 'all rating checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
