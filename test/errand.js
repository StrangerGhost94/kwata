// "Buy it for me": priced with a shopping fee; items and a budget are required; the courier records what
// they spent (never over budget, the rider can raise it), photographs the receipt, delivers with a code;
// the goods go back to the courier in full, commission only on the fare; nobody can cancel once bought.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token) {
  const r = await fetch(BASE + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}
async function api(path, body, token) { const r = await call(path, body, token); if (r.status >= 400) throw new Error(path + ': ' + r.body.error); return r.body; }
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const shop = { lat: 0.3157, lng: 32.5747, address: 'Kikuubo' }, home = { lat: 0.3536, lng: 32.6142, address: 'Ntinda' };
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

(async () => {
  const cfg = await api('/config');
  ok(cfg.errand && cfg.errand.shopFee === 2000 && cfg.errand.maxBudget === 200000, 'errand settings are shared with the apps');
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Errand Courier', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFE 808E', licenseNo: 'DL8', vehicleMake: 'Bajaj', vehicleColor: 'Black' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3160, lng: 32.5750 }); await sleep(150); await ds.emitWithAck('driver:online', true);
  let want = null, offer = null;
  ds.on('trip:offer', (o) => { if (o.id === want) offer = o; ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }); });
  const rider = await api('/auth/register', { name: 'Errand Rider', phone: '077' + rnd().slice(1), password: 'secret1' });

  const q = await api('/fare/estimate', { pickup: shop, drop: home, distanceKm: 6, durationMin: 15 }, rider.token);
  const er = q.options.find((o) => o.id === 'errand'), pc = q.options.find((o) => o.id === 'parcel');
  ok(er && er.parts.shop === 2000, 'the errand price includes the UGX 2,000 shopping fee');

  const base = { service: 'errand', paymentMethod: 'cash', pickup: shop, drop: home, distanceKm: 6, durationMin: 15 };
  ok((await call('/trips', { ...base, errand: { items: [], budget: 20000 } }, rider.token)).status === 400, 'an errand needs at least one item');
  ok((await call('/trips', { ...base, errand: { items: ['Sugar'], budget: 500000 } }, rider.token)).status === 400, 'the budget can’t go over the maximum');
  ok((await call('/trips', { ...base, paymentMethod: 'wallet', errand: { items: ['Sugar'], budget: 50000 } }, rider.token)).status === 400, 'a wallet errand needs the wallet to cover the budget too');

  // 1. Cash errand from booking to delivery.
  const t = await api('/trips', { ...base, errand: { items: ['2 kg sugar', 'Panadol, 1 packet', 'Airtime card 10,000'], budget: 20000, substitutes: true } }, rider.token);
  want = t.id; for (let i = 0; i < 40 && !offer; i++) await sleep(100);
  ok(offer && offer.errand && offer.errand.items.length === 3 && offer.errand.budget === 20000, 'the courier sees the list and budget before accepting');
  await sleep(300);
  ok((await call(`/trips/${t.id}/start`, {}, driver.token)).status === 400, 'the trip can’t start before the items are bought');
  await api(`/trips/${t.id}/arrived`, {}, driver.token);
  ok((await call(`/trips/${t.id}/goods`, { total: 25000 }, driver.token)).status === 400, 'the courier can’t spend more than the budget');
  await api(`/trips/${t.id}/budget`, { budget: 30000 }, rider.token);
  ok((await api('/trips/active', null, rider.token)).errand.budget === 30000, 'the rider can raise the budget');
  await api(`/trips/${t.id}/goods`, { total: 25000, photo: jpeg }, driver.token);
  let a = await api('/trips/active', null, rider.token);
  ok(a.errand.goodsTotal === 25000 && a.errand.receipt && a.payable === t.fare - (t.discount || 0) + 25000, 'what was spent and the receipt show; the rider’s total includes the items');
  const ph = await fetch(BASE + `/api/trips/${t.id}/receipt-photo`, { headers: { Authorization: 'Bearer ' + rider.token } });
  ok(ph.status === 200 && /image/.test(ph.headers.get('content-type')), 'the rider can see the receipt photo');
  const stranger = await api('/auth/register', { name: 'Someone Else', phone: '078' + rnd().slice(1), password: 'secret1' });
  ok((await fetch(BASE + `/api/trips/${t.id}/receipt-photo`, { headers: { Authorization: 'Bearer ' + stranger.token } })).status === 403, 'nobody else can');
  ok((await call(`/trips/${t.id}/budget`, { budget: 40000 }, rider.token)).status === 400, 'the budget is fixed once the items are bought');
  ok((await call(`/trips/${t.id}/cancel`, {}, rider.token)).status === 400 && (await call(`/trips/${t.id}/cancel`, {}, driver.token)).status === 400, 'nobody can cancel once the items are bought');
  await api(`/trips/${t.id}/start`, {}, driver.token);
  ok((await call(`/trips/${t.id}/complete`, { code: '0000' === t.dropCode ? '1111' : '0000' }, driver.token)).status === 400, 'delivery needs the rider’s code');
  const bal0 = (await api('/driver/overview', null, driver.token)).balance;
  await api(`/trips/${t.id}/complete`, { code: t.dropCode }, driver.token);
  const row = (await api('/driver/trips?days=1', null, driver.token)).trips.find((x) => x.id === t.id);
  ok((await api('/driver/overview', null, driver.token)).balance === bal0 - row.commission + (t.discount || 0), 'cash errand: commission is on the fare only (the courier holds the cash for the items)');

  // 2. Wallet errand: items go back to the courier in full.
  await api('/wallet/topup', { amount: 60000, method: 'momo' }, rider.token);
  offer = null;
  const t2 = await api('/trips', { ...base, paymentMethod: 'wallet', errand: { items: ['Bread'], budget: 15000 } }, rider.token);
  want = t2.id; for (let i = 0; i < 40 && !offer; i++) await sleep(100); await sleep(300);
  await api(`/trips/${t2.id}/arrived`, {}, driver.token);
  await api(`/trips/${t2.id}/goods`, { total: 12000 }, driver.token);
  await api(`/trips/${t2.id}/start`, {}, driver.token);
  const w0 = (await api('/wallet', null, rider.token)).balance, b0 = (await api('/driver/overview', null, driver.token)).balance;
  await api(`/trips/${t2.id}/complete`, { code: t2.dropCode }, driver.token);
  const r2 = (await api('/driver/trips?days=1', null, driver.token)).trips.find((x) => x.id === t2.id);
  ok((await api('/wallet', null, rider.token)).balance === w0 - (t2.fare - (t2.discount || 0)) - 12000, 'wallet errand: the rider pays the delivery plus the items');
  ok((await api('/driver/overview', null, driver.token)).balance === b0 + (t2.fare - r2.commission) + 12000, 'and the courier gets the fare less commission plus the items in full');
  ok((await call(`/trips/${t2.id}/noshow`, {}, driver.token)).status === 400, 'errands have no no-show');
  ds.close();
  console.log(failed ? `${failed} FAILED` : 'all errand checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
