// End-to-end ride simulation: rider books, driver accepts, PIN start, complete, pay, rate.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function api(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + ': ' + j.error); return j;
}
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('✓', m); };
(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const rider = await api('/auth/register', { name: 'Test Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  const driver = await api('/auth/register', { name: 'Test Driver', phone: '075' + rnd().slice(1), password: 'secret1', role: 'driver', vehicleType: 'boda', plate: 'UFA 123X', licenseNo: 'DL123', vehicleMake: 'Bajaj Boxer', vehicleColor: 'Red' });
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  let res = await ds.emitWithAck('driver:online', true);
  assert(!res.ok, 'unapproved driver cannot go online');
  await api(`/admin/drivers/${driver.user.id}/status`, { status: 'approved' }, admin.token);
  res = await ds.emitWithAck('driver:online', true);
  assert(res.ok, 'approved driver goes online');
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 });
  await sleep(200);

  const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };
  const est = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 12 }, rider.token);
  const boda = est.options.find((o) => o.id === 'boda');
  assert(boda.fare >= 2500, 'boda fare estimate UGX ' + boda.fare);
  const fake = await api('/fare/estimate', { pickup, drop, distanceKm: 0.01, durationMin: 1 }, rider.token);
  assert(fake.distanceKm >= 2.5, 'cannot fake a tiny distance (server used ' + fake.distanceKm + ' km)');

  const rs = io(BASE, { auth: { token: rider.token } });
  await new Promise((r) => rs.on('connect', r));
  const updates = []; rs.on('trip:update', (t) => updates.push(t.status));
  let gotLoc = false; rs.on('driver:location', () => { gotLoc = true; });

  const offerP = new Promise((r) => ds.once('trip:offer', r));
  const trip = await api('/trips', { service: 'boda', paymentMethod: 'momo', pickup, drop, distanceKm: 3.2, durationMin: 12 }, rider.token);
  assert(trip.pin && trip.pin.length === 4, 'trip created with PIN');
  const offer = await offerP;
  assert(offer.id === trip.id && !offer.pin, 'driver receives offer without the PIN');
  res = await ds.emitWithAck('trip:respond', { tripId: trip.id, accept: true });
  assert(res.ok, 'driver accepts');
  ds.emit('driver:location', { lat: 0.3140, lng: 32.5808 }); await sleep(300);
  assert(gotLoc, 'rider receives live driver location');
  await api(`/trips/${trip.id}/arrived`, {}, driver.token);
  try { await api(`/trips/${trip.id}/start`, { pin: '0000' === trip.pin ? '1111' : '0000' }, driver.token); assert(false, 'wrong pin'); } catch (e) { assert(/Wrong PIN/.test(e.message), 'wrong PIN rejected'); }
  await api(`/trips/${trip.id}/start`, { pin: trip.pin }, driver.token);
  await api(`/trips/${trip.id}/complete`, {}, driver.token);
  let active = await api('/trips/active', null, rider.token);
  assert(active.status === 'completed' && active.paymentStatus === 'pending', 'momo trip awaits payment');
  const pay = await api(`/trips/${trip.id}/pay`, {}, rider.token);
  assert(pay.demo && pay.status === 'successful', 'demo payment succeeds');
  const earn = await api('/driver/earnings', null, driver.token);
  assert(earn.balance === trip.fare - Math.round(trip.fare * 0.12), 'driver credited fare minus 12% (' + earn.balance + ')');
  await api(`/trips/${trip.id}/rate`, { stars: 5 }, rider.token);
  await api(`/trips/${trip.id}/rate`, { stars: 4 }, driver.token);
  const me = await api('/me', null, driver.token);
  assert(me.user.rating === 5, 'driver rating recorded');

  // Wallet + cash flows
  const top = await api('/wallet/topup', { amount: 20000, method: 'momo' }, rider.token);
  assert(top.balance === 20000, 'wallet top-up (demo) credited');
  const off2 = new Promise((r) => ds.once('trip:offer', r));
  const t2 = await api('/trips', { service: 'boda', paymentMethod: 'wallet', pickup, drop, distanceKm: 3.2, durationMin: 12 }, rider.token);
  await off2; await ds.emitWithAck('trip:respond', { tripId: t2.id, accept: true });
  await api(`/trips/${t2.id}/start`, { pin: t2.pin }, driver.token);
  await api(`/trips/${t2.id}/complete`, {}, driver.token);
  const w = await api('/wallet', null, rider.token);
  assert(w.balance === 20000 - t2.fare, 'wallet trip deducted ' + t2.fare);

  // Driver cancels -> re-dispatched, rider cancels -> cancelled
  const off3 = new Promise((r) => ds.once('trip:offer', r));
  const t3 = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop }, rider.token);
  await off3; await ds.emitWithAck('trip:respond', { tripId: t3.id, accept: true });
  await api(`/trips/${t3.id}/cancel`, {}, driver.token);
  active = await api('/trips/active', null, rider.token);
  assert(active.id === t3.id && active.status === 'requested', 'driver cancel puts rider back in queue');
  await api(`/trips/${t3.id}/cancel`, {}, rider.token);
  active = await api('/trips/active', null, rider.token);
  assert(!active || active.id !== t3.id, 'rider cancel ends request');

  // Cash trip commission
  const before = (await api('/driver/earnings', null, driver.token)).balance;
  const off4 = new Promise((r) => ds.once('trip:offer', r));
  const t4 = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop }, rider.token);
  await off4; await ds.emitWithAck('trip:respond', { tripId: t4.id, accept: true });
  await api(`/trips/${t4.id}/start`, { pin: t4.pin }, driver.token);
  await api(`/trips/${t4.id}/complete`, {}, driver.token);
  const after = (await api('/driver/earnings', null, driver.token)).balance;
  assert(before - after === Math.round(t4.fare * 0.12), 'cash trip: commission taken from driver balance');

  // Withdrawal + SOS + share tracking + admin
  await api('/driver/withdraw', { amount: 5000 }, driver.token);
  const wds = await api('/admin/withdrawals', null, admin.token);
  await api(`/admin/withdrawals/${wds[0].id}`, { status: 'paid' }, admin.token);
  const pub = await api('/track/' + trip.shareToken);
  assert(!pub.fare && !pub.pin && pub.driver.plate === 'UFA 123X', 'public tracking hides fare/PIN');
  const stats = await api('/admin/stats', null, admin.token);
  assert(stats.allTime.trips >= 3, 'admin stats: ' + JSON.stringify(stats.allTime));
  await api('/admin/settings', { commissionPct: 10, services: { boda: { surge: 1.5 } } }, admin.token, 'PUT');
  const est2 = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 12 }, rider.token);
  assert(est2.options.find((o) => o.id === 'boda').fare > boda.fare, 'admin surge raises fare');
  await api('/admin/settings', { commissionPct: 12, services: { boda: { surge: 1 } } }, admin.token, 'PUT');
  console.log('\nALL TESTS PASSED. Rider saw statuses:', [...new Set(updates)].join(' → '));
  ds.close(); rs.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
