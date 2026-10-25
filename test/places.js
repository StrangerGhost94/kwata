// Place search: Kampala landmarks by nickname, places riders use (only once 3 different riders have
// used them, never "Home"), and that search keeps working without the map search.
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
const search = (q, token) => api('/places/search?' + new URLSearchParams({ q, lat: 0.3136, lng: 32.5811 }), null, token);

(async () => {
  ok((await call('/places/search?q=owino')).status === 401, 'search needs a signed-in user');
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });

  const r1 = await search('owino', admin.token);
  ok(r1.results[0] && r1.results[0].kind === 'landmark' && /Owino Market/.test(r1.results[0].name), 'a nickname finds the landmark first (owino → Owino Market)');
  const r2 = await search('mubs', admin.token);
  ok(r2.results[0] && /Business School/.test(r2.results[0].name), 'mubs → Makerere University Business School');
  const r3 = await search('kololo', admin.token);
  ok(!r3.results.some((p) => p.name === 'Acacia Mall'), 'typing an area does not list every landmark in it');
  ok((await search('a', admin.token)).results.length === 0, 'one letter returns nothing yet');
  ok(r1.results.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.name), 'every result has a name and a position');

  // A driver near the pickup to complete trips with.
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Places Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFP 202P', licenseNo: 'DL7', vehicleMake: 'Bajaj', vehicleColor: 'Red' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  await ds.emitWithAck('driver:online', true);
  let want = null;
  ds.on('trip:offer', (o) => { if (o.id === want) ds.emit('trip:respond', { tripId: o.id, accept: true }); else ds.emit('trip:respond', { tripId: o.id, accept: false }); });

  const spot = `Kyanja Test Stage ${rnd().slice(0, 5)}`;
  const ride = async (dropName) => {
    const rider = await api('/auth/register', { name: 'Places Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
    const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3790, lng: 32.6010, address: dropName };
    const accepted = new Promise((r) => { const h = (o) => { if (o.id === want) { ds.off('trip:offer', h); setTimeout(r, 300); } }; ds.on('trip:offer', h); });
    const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 8, durationMin: 20 }, rider.token);
    want = t.id; await accepted;
    await api(`/trips/${t.id}/arrived`, {}, driver.token);
    await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
    await api(`/trips/${t.id}/complete`, {}, driver.token);
    await sleep(300);   // learning runs after the response
    return rider;
  };
  const has = async (name) => (await search(name, admin.token)).results.some((p) => p.name === name && p.kind === 'popular');

  await ride(spot); await ride(spot);
  ok(!(await has(spot)), 'a place two riders used is not suggested to others yet');
  await ride(spot);
  ok(await has(spot), 'after a third rider it is suggested as popular');

  const home = await ride('Home'); await ride('Home'); await ride('Home');
  ok(!(await search('home', home.token)).results.some((p) => p.kind === 'popular' && /^home$/i.test(p.name)), '“Home” is never shared with other riders');

  ds.close();
  console.log(failed ? `${failed} FAILED` : 'all place search checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
