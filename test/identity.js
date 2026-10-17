// Driver identity: photo and number-plate changes need approval; riders can report a driver or
// plate that doesn't match, and repeated reports pause the driver.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function api(path, body, token, method) { const r = await call(path, body, token, method); if (r.status >= 400) throw new Error(path + ': ' + r.body.error); return r.body; }
let failed = 0;
const assert = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const jpegA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const jpegB = jpegA.replace(/A=*$/, '') + 'AQ==';
const photoBytes = async (id) => { const r = await fetch(BASE + `/api/drivers/${id}/photo`); return r.status === 200 ? Buffer.from(await r.arrayBuffer()).toString('base64') : r.status; };

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  await api('/admin/settings', { drivers: { mismatchPauseReports: 2 } }, admin.token, 'PUT');
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Id Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFA 100A', licenseNo: 'DL1', vehicleMake: 'Bajaj', vehicleColor: 'Red' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const id = driver.user.id;
  await api('/driver/documents', { kind: 'national_id', image: jpegA }, driver.token);

  // 1. Photo changes
  let r = await api('/driver/documents', { kind: 'photo', image: jpegA, live: true }, driver.token);
  assert(r.pending, 'an approved driver’s new photo goes to review');
  assert((await photoBytes(id)) === 404, 'riders don’t see an unapproved photo');
  let changes = await api('/admin/changes', null, admin.token);
  let c = changes.find((x) => x.driver.id === id && x.kind === 'photo');
  assert(c && c.requested.photo.startsWith('data:image/jpeg') && c.compare.national_id, 'admin sees the new photo next to the National ID');
  await api(`/admin/changes/${c.id}`, { decision: 'approve' }, admin.token);
  const approvedA = await photoBytes(id);
  assert(typeof approvedA === 'string', 'once approved, riders see the photo');
  await api('/driver/documents', { kind: 'photo', image: jpegB, live: true }, driver.token);
  assert((await photoBytes(id)) === approvedA, 'a second change keeps the approved photo for riders while it’s checked');
  c = (await api('/admin/changes', null, admin.token)).find((x) => x.driver.id === id && x.kind === 'photo');
  const noReason = await call(`/admin/changes/${c.id}`, { decision: 'reject' }, admin.token);
  assert(noReason.status === 400, 'rejecting needs a reason for the driver');
  await api(`/admin/changes/${c.id}`, { decision: 'reject', note: 'Face not clear' }, admin.token);
  let mine = await api('/driver/changes', null, driver.token);
  assert(mine.photo.status === 'rejected' && mine.photo.note === 'Face not clear' && (await photoBytes(id)) === approvedA, 'driver sees why; riders still see the approved photo');

  // 2. Vehicle / number plate changes
  const vdoc = await call('/driver/documents', { kind: 'vehicle', image: jpegA }, driver.token);
  assert(vdoc.status === 400, 'an approved driver can’t swap the vehicle photo directly');
  const badPlate = await call('/driver/vehicle-change', { plate: '!!', photo: jpegA }, driver.token);
  assert(badPlate.status === 400, 'a nonsense plate is refused');
  const noPhoto = await call('/driver/vehicle-change', { plate: 'UFB 222B' }, driver.token);
  assert(noPhoto.status === 400, 'a plate change needs a photo of the vehicle');
  await api('/driver/vehicle-change', { plate: 'ufb  222b', vehicleMake: 'TVS Star', vehicleColor: 'Blue', photo: jpegA }, driver.token);
  let me = await api('/me', null, driver.token);
  assert(me.driver.plate === 'UFA 100A', 'the old plate stays until approved');
  c = (await api('/admin/changes', null, admin.token)).find((x) => x.driver.id === id && x.kind === 'vehicle');
  assert(c && c.requested.plate === 'UFB 222B' && c.current.plate === 'UFA 100A', 'admin sees the current and requested plate side by side');
  await api(`/admin/changes/${c.id}`, { decision: 'approve' }, admin.token);
  me = await api('/me', null, driver.token);
  assert(me.driver.plate === 'UFB 222B' && me.driver.vehicleMake === 'TVS Star' && me.driver.vehicleColor === 'Blue', 'after approval the new plate, make and colour are used');

  // 3. Rider reports
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((res) => ds.on('connect', res));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  await ds.emitWithAck('driver:online', true);
  let want = 0;
  ds.on('trip:offer', (o) => { ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }); });
  const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };
  const ride = async () => {
    const rider = await api('/auth/register', { name: 'Report Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
    const pre = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 12 }, rider.token);
    want = pre.id;
    for (let i = 0; i < 30; i++) { const a = await api('/trips/active', null, rider.token); if (a && a.status === 'accepted') return { rider, trip: a }; await sleep(200); }
    throw new Error('driver never accepted');
  };
  const one = await ride();
  assert(one.trip.driver.plate === 'UFB 222B' && /photo\?v=\d+/.test(one.trip.driver.photo), 'riders see the approved plate and photo');
  const bad = await call(`/trips/${one.trip.id}/report`, { kind: 'shoes' }, one.rider.token);
  assert(bad.status === 400, 'only photo or plate reports');
  r = await api(`/trips/${one.trip.id}/report`, { kind: 'photo', note: 'Different man came' }, one.rider.token);
  assert(r.ok && !r.paused, 'first report is recorded, driver not paused yet');
  r = await api(`/trips/${one.trip.id}/report`, { kind: 'photo' }, one.rider.token);
  assert(r.already, 'the same rider can’t report the same thing twice');
  await api(`/trips/${one.trip.id}/cancel`, {}, one.rider.token);
  const two = await ride();
  r = await api(`/trips/${two.trip.id}/report`, { kind: 'plate', note: 'Plate was UFC 9' }, two.rider.token);
  assert(r.ok && r.paused, 'a second rider’s report pauses the driver (limit 2)');
  me = await api('/me', null, driver.token);
  assert(me.driver.status === 'suspended', 'the driver is paused');
  const reps = await api('/admin/reports', null, admin.token);
  const mineReps = reps.filter((x) => x.driver.id === id);
  assert(mineReps.length === 2 && mineReps[0].reports30 === 2 && mineReps.some((x) => x.note === 'Plate was UFC 9'), 'admin sees both reports with notes');
  for (const x of mineReps) await api(`/admin/reports/${x.id}`, { action: 'dismiss' }, admin.token);
  await api(`/admin/drivers/${id}/status`, { status: 'approved' }, admin.token);
  const stats = await api('/admin/stats', null, admin.token);
  assert(typeof stats.pendingChanges === 'number' && typeof stats.openReports === 'number', 'admin counts include checks waiting');

  ds.close();
  await api('/admin/settings', { drivers: { mismatchPauseReports: 3 } }, admin.token, 'PUT');
  console.log(failed ? `${failed} FAILED` : 'All identity checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
