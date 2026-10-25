// Rider cancellation fee: free during the grace period, then paid to the driver from the rider's
// wallet (only when it covers it), and listed in the driver's earnings.
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
const restore = (admin) => api('/admin/settings', { drivers: { cancelFee: 1000, cancelGraceMin: 2 } }, admin.token, 'PUT');

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  try {
    const cfg = await api('/config');
    ok(cfg.drivers.cancelFee === 1000 && cfg.drivers.cancelGraceMin === 2, 'defaults: UGX 1,000 after 2 free minutes, shared with the apps');

    const dPhone = '075' + rnd().slice(1);
    await api('/admin/drivers', { name: 'Cancel Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFC 404C', licenseNo: 'DL4', vehicleMake: 'Bajaj', vehicleColor: 'Black' }, admin.token);
    const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
    const ds = io(BASE, { auth: { token: driver.token } });
    await new Promise((r) => ds.on('connect', r));
    ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
    await ds.emitWithAck('driver:online', true);
    let want = null;
    ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }));
    const rider = await api('/auth/register', { name: 'Cancel Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
    const booked = async () => {
      const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop: { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' }, distanceKm: 3.2, durationMin: 12 }, rider.token);
      want = t.id; for (let i = 0; i < 30 && (await api('/trips/active', null, rider.token)).status !== 'accepted'; i++) await sleep(100);
      return t;
    };
    const balance = async () => (await api('/driver/overview', null, driver.token)).balance;

    // 1. Inside the grace period: free.
    await api('/wallet/topup', { amount: 5000, method: 'momo' }, rider.token);
    let t = await booked();
    let out = await api(`/trips/${t.id}/cancel`, { reason: 'rider' }, rider.token);
    ok(out.fee === 0 && (await api('/wallet', null, rider.token)).balance === 5000, 'cancelling within 2 minutes of the driver accepting is free');

    // 2. After the grace period: the driver gets the fee from the rider's wallet.
    await api('/admin/settings', { drivers: { cancelGraceMin: 0 } }, admin.token, 'PUT');
    const before = await balance();
    t = await booked();
    out = await api(`/trips/${t.id}/cancel`, { reason: 'rider' }, rider.token);
    ok(out.fee === 1000, 'a late cancel charges UGX 1,000');
    ok((await api('/wallet', null, rider.token)).balance === 4000, 'it comes from the rider’s wallet');
    ok((await balance()) === before + 1000, 'and is added to the driver’s balance');
    const list = await api('/driver/trips?days=1', null, driver.token);
    const row = list.trips.find((x) => x.id === t.id);
    ok(row && row.feeKind === 'cancel' && row.earning === 1000 && list.totals.cancelFees >= 1000, 'the driver sees it in their earnings as a cancellation fee');

    // 3. Wallet doesn't cover it: nothing is taken.
    await api('/admin/settings', { drivers: { cancelFee: 9000 } }, admin.token, 'PUT');
    t = await booked();
    out = await api(`/trips/${t.id}/cancel`, { reason: 'rider' }, rider.token);
    ok(out.fee === 0 && (await api('/wallet', null, rider.token)).balance === 4000, 'when the wallet can’t cover the fee, nothing is charged');

    // 4. Still searching for a driver: always free.
    await api('/admin/settings', { drivers: { cancelFee: 1000 } }, admin.token, 'PUT');
    ds.emit('driver:online', false); await sleep(100);
    const t4 = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop: { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' }, distanceKm: 3.2, durationMin: 12 }, rider.token);
    out = await api(`/trips/${t4.id}/cancel`, { reason: 'rider' }, rider.token);
    ok(out.fee === 0, 'cancelling before a driver accepts is free');
    ds.close();
  } finally { await restore(admin); }
  console.log(failed ? `${failed} FAILED` : 'all cancellation fee checks passed');
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(1); });
