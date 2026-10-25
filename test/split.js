// Split the fare: friends pay their share by Mobile Money through a link (no account), it lands in
// the rider's wallet, and the rider can pay the Mobile Money trip from the wallet at the end.
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

(async () => {
  const cfg = await api('/config');
  if (!cfg.paymentsAvailable) { console.log('· Mobile Money is off on this server; split checks skipped'); process.exit(0); }
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Split Driver', phone: dPhone, password: 'secret1', vehicleType: 'car', plate: 'UFS 606S', licenseNo: 'DL8', vehicleMake: 'Toyota Premio', vehicleColor: 'Silver' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  await ds.emitWithAck('driver:online', true);
  let want = null; ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }));

  const rider = await api('/auth/register', { name: 'Grace Nalubega', phone: '077' + rnd().slice(1), password: 'secret1' });
  const t = await api('/trips', { service: 'car', paymentMethod: 'momo', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop: { lat: 0.3366, lng: 32.5877, address: 'Acacia Mall' }, distanceKm: 3.5, durationMin: 10 }, rider.token);
  want = t.id; for (let i = 0; i < 30 && (await api('/trips/active', null, rider.token)).status !== 'accepted'; i++) await sleep(100);
  const payable = t.fare - (t.discount || 0);

  ok((await call(`/trips/${t.id}/split`, { people: 6 }, rider.token)).status === 400, 'splits are between 2 and 4 people');
  const sp = await api(`/trips/${t.id}/split`, { people: 2 }, rider.token);
  ok(sp.share === Math.ceil(payable / 2 / 100) * 100 && /\/split\/[\w-]+$/.test(sp.url), `a 2-way split asks each friend for UGX ${sp.share}`);
  const pub = await api('/split/' + sp.token);
  ok(pub.name === 'Grace' && pub.share === sp.share && pub.open && !('phone' in pub), 'the link shows the first name, trip and share, nothing private');

  ok((await call(`/split/${sp.token}/pay`, { name: 'Bob', phone: '12' })).status === 400, 'a wrong Mobile Money number is refused');
  const before = (await api('/wallet', null, rider.token)).balance;
  const paid = await api(`/split/${sp.token}/pay`, { name: 'Bob Okello', phone: '0772' + rnd().slice(2) });
  ok(paid.status === 'successful', 'a friend pays their share without an account (test mode)');
  const w = await api('/wallet', null, rider.token);
  ok(w.balance === before + sp.share, 'the share lands in the rider’s wallet');
  ok((w.transactions || w.history || []).some ? (w.transactions || w.history || []).some((x) => /Split from Bob Okello/.test(x.note || '')) : true, 'the wallet shows who it came from');
  ok((await call(`/split/${sp.token}/pay`, { name: 'Bob', phone: '0772' + rnd().slice(2) })).status === 400 && !(await api('/split/' + sp.token)).open, 'once everyone has paid, the link closes');
  ok((await call(`/trips/${t.id}/split`, { people: 4 }, rider.token)).status === 200 && (await api('/trips/active', null, rider.token)).split.share === sp.share, 'adding people later keeps the share someone already paid');

  // End of the trip: pay the Mobile Money trip from the wallet.
  await api(`/trips/${t.id}/arrived`, {}, driver.token);
  await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
  await api(`/trips/${t.id}/complete`, {}, driver.token);
  const bal0 = (await api('/driver/overview', null, driver.token)).balance;
  const short = await call(`/trips/${t.id}/pay-wallet`, {}, rider.token);
  const need = payable - (await api('/wallet', null, rider.token)).balance;
  if (need > 0) {
    ok(short.status === 400, 'paying from a wallet that doesn’t cover the fare is refused');
    await api('/wallet/topup', { amount: need, method: 'momo' }, rider.token);
  }
  await api(`/trips/${t.id}/pay-wallet`, {}, rider.token);
  const a = await api('/trips/active', null, rider.token);
  ok(a.paymentStatus === 'paid' && a.paymentMethod === 'wallet', 'the trip is paid from the wallet');
  const ov = await api('/driver/overview', null, driver.token);
  const row = (await api('/driver/trips?days=1', null, driver.token)).trips.find((x) => x.id === t.id);
  ok(row && ov.balance === bal0 + row.earning && row.earning === t.fare - row.commission, 'the driver is credited the fare less commission');
  ok((await call(`/trips/${t.id}/pay-wallet`, {}, rider.token)).status === 400, 'it can’t be paid twice');
  ds.close();
  console.log(failed ? `${failed} FAILED` : 'all split checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
