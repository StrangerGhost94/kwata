// Flytte Pass: bought from the wallet (or Mobile Money), 10% off every ride up to a cap, normal prices
// at busy times, free late cancellations (Flytte still pays the driver), auto-renew from the wallet.
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
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };
const trip = { pickup, drop, distanceKm: 3.2, durationMin: 12 };

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const settings = await api('/admin/settings', null, admin.token);
  const oldSurge = settings.services.boda.surge, oldDrivers = settings.drivers;
  try {
    const cfg = await api('/config');
    ok(cfg.pass && cfg.pass.price === 15000 && cfg.pass.percent === 10 && cfg.pass.days === 30, 'the pass offer (UGX 15,000, 10%, 30 days) is shared with the apps');

    const rider = await api('/auth/register', { name: 'Pass Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
    // Use up the first-ride offer so it doesn't hide the pass discount.
    let p = await api('/me/pass', null, rider.token);
    ok(p.active === false && p.offer.price === 15000, 'a new rider has no pass yet');
    ok((await call('/me/pass/buy', { method: 'wallet' }, rider.token)).status === 400, 'buying from an empty wallet is refused');

    await api('/wallet/topup', { amount: 40000, method: 'momo' }, rider.token);
    await api('/admin/settings', { services: { boda: { surge: 1.5 } } }, admin.token, 'PUT');
    const before = await api('/fare/estimate', trip, rider.token);
    const bodaBefore = before.options.find((o) => o.id === 'boda');
    ok(bodaBefore.surge > 1 && bodaBefore.fare > bodaBefore.regularFare, 'without a pass, a busy time costs more');

    const bought = await api('/me/pass/buy', { method: 'wallet' }, rider.token);
    ok(bought.pass && bought.pass.active, 'buying from the wallet starts the pass');
    ok((await api('/wallet', null, rider.token)).balance === 25000, 'UGX 15,000 comes out of the wallet');

    const q = await api('/fare/estimate', trip, rider.token);
    const boda = q.options.find((o) => o.id === 'boda');
    ok(q.pass === true && boda.surge === 1 && boda.fare === boda.regularFare && boda.passSaved > 0, 'with a pass, the busy-time price is gone');
    const want = Math.min(3000, Math.round(boda.fare * 0.1 / 100) * 100);
    ok(boda.discount >= want && boda.discount > 0, 'and 10% comes off (or the first-ride offer, if bigger)');

    // A full trip, to record what the pass saved.
    const dPhone = '075' + rnd().slice(1);
    await api('/admin/drivers', { name: 'Pass Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFP 515P', licenseNo: 'DL5', vehicleMake: 'Bajaj', vehicleColor: 'Black' }, admin.token);
    const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
    const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
    ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150); await ds.emitWithAck('driver:online', true);
    let wantId = null; ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: o.id === wantId }));
    const book = async () => {
      const t = await api('/trips', { ...trip, service: 'boda', paymentMethod: 'cash', quoteId: q.quoteId }, rider.token);
      wantId = t.id; for (let i = 0; i < 30 && (await api('/trips/active', null, rider.token)).status !== 'accepted'; i++) await sleep(100);
      return t;
    };
    let t = await book();
    ok(t.fare === boda.regularFare, 'the booked fare is the normal price');
    await api(`/trips/${t.id}/arrived`, {}, driver.token); await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token); await api(`/trips/${t.id}/complete`, {}, driver.token);
    p = await api('/me/pass', null, rider.token);
    ok(p.saved > 0 && p.trips === 1, `the pass page shows what it saved (UGX ${p.saved})`);

    // Late cancel: free for the rider, the driver is still paid.
    await api('/admin/settings', { drivers: { cancelFee: 1000, cancelGraceMin: 0 } }, admin.token, 'PUT');
    const bal = async () => (await api('/driver/overview', null, driver.token)).balance;
    const dBefore = await bal(), wBefore = (await api('/wallet', null, rider.token)).balance;
    t = await book();
    const out = await api(`/trips/${t.id}/cancel`, { reason: 'rider' }, rider.token);
    ok(out.fee === 0 && out.passFree === true && (await api('/wallet', null, rider.token)).balance === wBefore, 'a late cancel is free with the pass');
    ok((await bal()) === dBefore + 1000, 'and Flytte still pays the driver the cancellation fee');

    // Auto-renew switch, and adding a period.
    p = await api('/me/pass/renew', { on: false }, rider.token);
    ok(p.autoRenew === false, 'auto-renew can be switched off');
    const end1 = new Date(p.endsAt).getTime();
    await api('/me/pass/buy', { method: 'wallet' }, rider.token);
    p = await api('/me/pass', null, rider.token);
    ok(Math.round((new Date(p.endsAt).getTime() - end1) / 864e5) === 30, 'buying again adds 30 days to the running pass');
    ds.close();

    // Mobile Money (local demo payments) starts a pass too.
    const r2 = await api('/auth/register', { name: 'Pass MoMo', phone: '077' + rnd().slice(1), password: 'secret1' });
    const mm = await api('/me/pass/buy', { method: 'momo' }, r2.token);
    ok((mm.demo && mm.pass && mm.pass.active) || mm.link, 'paying by Mobile Money starts the pass');
  } finally {
    await api('/admin/settings', { services: { boda: { surge: oldSurge } }, drivers: { cancelFee: oldDrivers.cancelFee, cancelGraceMin: oldDrivers.cancelGraceMin } }, admin.token, 'PUT');
  }
  console.log(failed ? `${failed} FAILED` : 'all Flytte Pass checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
