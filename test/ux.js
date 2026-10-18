// UX round: trip help (rider, driver, admin reply), pickup notes, price parts,
// hidden destination for drivers, and the weekly earnings summary.
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
  await api('/admin/drivers', { name: 'Help Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFG 303C', licenseNo: 'DL11' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const rider = await api('/auth/register', { name: 'Help Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 });
  await sleep(150);
  await ds.emitWithAck('driver:online', true);
  await sleep(200);

  // Price parts in the quote
  const q = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
  const o = q.options && q.options[0];
  assert(o && o.parts && o.parts.base >= 0 && o.parts.distance > 0 && o.parts.km > 0, 'quotes explain the price (base, distance, time)');

  // Pickup note reaches the driver with the request
  const offerP = new Promise((r) => ds.once('trip:offer', r));
  const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9, notes: 'Blue gate next to the pharmacy' }, rider.token);
  const offer = await offerP;
  assert(offer.notes === 'Blue gate next to the pharmacy', 'the pickup note is on the driver’s request');
  assert(offer.drop && offer.drop.address === 'Wandegeya', 'the destination shows on requests by default');
  await ds.emitWithAck('trip:respond', { tripId: t.id, accept: true });
  await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
  await api(`/trips/${t.id}/complete`, {}, driver.token);
  await call(`/trips/${t.id}/pay-cash`, {}, rider.token);

  // Rider help
  const h0 = await api(`/trips/${t.id}/help`, null, rider.token);
  assert(h0.kinds && h0.kinds.lost_item && h0.issues.length === 0, 'riders get the help topics for their trip');
  const bad1 = await call(`/trips/${t.id}/help`, { kind: 'lost_item', details: '' }, rider.token);
  assert(bad1.status === 400, 'a lost-item report needs a description');
  const bad2 = await call(`/trips/${t.id}/help`, { kind: 'nope', details: 'hello there' }, rider.token);
  assert(bad2.status === 400, 'unknown topics are refused');
  const rep = await call(`/trips/${t.id}/help`, { kind: 'lost_item', details: 'Black Samsung phone on the back seat' }, rider.token);
  assert(rep.status === 200 && rep.body.status === 'open', 'a rider can report a lost item on a trip');
  const dup = await call(`/trips/${t.id}/help`, { kind: 'lost_item', details: 'Again' }, rider.token);
  assert(dup.status === 409, 'the same open report can’t be sent twice');
  const other = await api('/auth/register', { name: 'Not Mine', phone: '078' + rnd().slice(1), password: 'secret1' });
  const nm = await call(`/trips/${t.id}/help`, { kind: 'other', details: 'Not my trip' }, other.token);
  assert(nm.status === 403, 'nobody can report on someone else’s trip');

  // Driver help
  const dh = await api(`/trips/${t.id}/help`, null, driver.token);
  assert(dh.kinds && dh.kinds.payment && !dh.kinds.fare, 'drivers get driver help topics');
  const drep = await call(`/trips/${t.id}/help`, { kind: 'lost_item', details: 'Phone on the back seat, I have it' }, driver.token);
  assert(drep.status === 200, 'a driver can report an item left behind');

  // Admin sees and replies
  const stats = await api('/admin/stats', null, admin.token);
  assert(stats.openIssues >= 2, 'admin counts open help reports');
  const list = await api('/admin/issues', null, admin.token);
  const mine = list.find((i) => i.id === rep.body.id);
  assert(mine && mine.trip && mine.trip.driver && mine.trip.driver.plate === 'UFG 303C' && mine.from.name === 'Help Rider', 'admin sees the report with the trip, rider and driver');
  const noReply = await call(`/admin/issues/${mine.id}`, { reply: '' }, admin.token);
  assert(noReply.status === 400, 'a reply can’t be empty');
  await api(`/admin/issues/${mine.id}`, { reply: 'Your driver has the phone and will drop it at the office tomorrow.' }, admin.token);
  const h1 = await api(`/trips/${t.id}/help`, null, rider.token);
  assert(h1.issues[0].status === 'resolved' && /drop it at the office/.test(h1.issues[0].reply), 'the rider sees the Flytte reply on the trip');
  const riderNoAdmin = await call('/admin/issues', null, rider.token);
  assert(riderNoAdmin.status === 401 || riderNoAdmin.status === 403, 'only staff can see all reports');

  // Weekly summary
  const e = await api('/driver/earnings', null, driver.token);
  assert(e.summary && e.summary.prevWeek && Array.isArray(e.summary.busyHours) && e.summary.avgTrip > 0, 'driver earnings include a weekly summary');

  // Hidden destination
  const before = await api('/admin/settings', null, admin.token);
  await api('/admin/settings', { drivers: { showDestination: false } }, admin.token, 'PUT');
  const s2 = await api('/admin/settings', null, admin.token);
  assert(s2.drivers.showDestination === false && s2.drivers.queueNext === before.drivers.queueNext, 'admin can hide destinations without changing other rules');
  const offer2P = new Promise((r) => ds.once('trip:offer', r));
  const t2 = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
  const offer2 = await offer2P;
  assert(offer2.drop && offer2.drop.hidden && !offer2.drop.address && offer2.distanceKm > 0, 'with it off, the request shows trip length but not the destination');
  await ds.emitWithAck('trip:respond', { tripId: t2.id, accept: true });
  const act = await api('/trips/active', null, driver.token);
  assert(act && act.drop && act.drop.address === 'Wandegeya', 'the destination appears once the driver accepts');
  await call(`/trips/${t2.id}/cancel`, {}, rider.token);
  await api('/admin/settings', { drivers: { showDestination: true } }, admin.token, 'PUT');

  ds.close();
  console.log(failed ? `${failed} failed` : 'all UX checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
