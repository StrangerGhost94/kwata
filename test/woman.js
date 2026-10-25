// "Woman driver": the request only goes to drivers marked as women; others never see it. With none
// free, the trip ends as no drivers and the rider can try any driver.
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
// A pickup far from the other tests, so only this test's drivers are nearby.
const pickup = { lat: 0.3790, lng: 32.6400, address: 'Kira Town' }, drop = { lat: 0.3600, lng: 32.6200, address: 'Naalya' };

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const mk = async (name, woman) => {
    const phone = '075' + rnd().slice(1);
    const out = await api('/admin/drivers', { name, phone, password: 'secret1', vehicleType: 'boda', plate: 'UFW ' + rnd().slice(0, 3) + 'W', licenseNo: 'DL5', vehicleMake: 'Bajaj', vehicleColor: 'Green', woman }, admin.token);
    const d = await api('/auth/login', { phone, password: 'secret1' });
    const s = io(BASE, { auth: { token: d.token } }); await new Promise((r) => s.on('connect', r));
    s.emit('driver:location', { lat: pickup.lat + 0.001, lng: pickup.lng }); await sleep(150);
    await s.emitWithAck('driver:online', true);
    const seen = []; s.on('trip:offer', (o) => { seen.push(o.id); s.emit('trip:respond', { tripId: o.id, accept: false }); });
    return { id: out.id, s, seen };
  };
  const man = await mk('Peter Driver', false);
  const woman = await mk('Sarah Driver', true);
  const list = await api('/admin/drivers', null, admin.token);
  ok(list.find((x) => x.id === woman.id).woman === true && list.find((x) => x.id === man.id).woman === false, 'admin sees who is marked as a woman driver');

  const rider = await api('/auth/register', { name: 'Woman Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3, durationMin: 10, womanDriver: true }, rider.token);
  await sleep(1500);
  ok(woman.seen.includes(t.id), 'the woman driver gets the request');
  ok(!man.seen.includes(t.id), 'other drivers never see it');
  ok((await api('/trips/active', null, rider.token)).womanDriver === true, 'the rider’s trip remembers the choice');
  await api(`/trips/${t.id}/cancel`, {}, rider.token);

  // Switched off in admin: she no longer gets these requests (no reconnect needed).
  await api(`/admin/drivers/${woman.id}/woman`, { woman: false }, admin.token);
  woman.seen.length = 0;
  const t2 = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3, durationMin: 10, womanDriver: true }, rider.token);
  await sleep(1500);
  ok(!woman.seen.includes(t2.id) && !man.seen.includes(t2.id), 'with no woman driver nearby, nobody is offered the trip');
  await api(`/trips/${t2.id}/cancel`, {}, rider.token);

  // Without the choice, anyone nearby can get it.
  const t3 = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3, durationMin: 10 }, rider.token);
  await sleep(1500);
  ok(man.seen.includes(t3.id) || woman.seen.includes(t3.id), 'a normal request goes to any driver');
  await api(`/trips/${t3.id}/cancel`, {}, rider.token);

  man.s.close(); woman.s.close();
  console.log(failed ? `${failed} FAILED` : 'all woman driver checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
