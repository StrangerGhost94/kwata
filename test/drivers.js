// Driver tools: no-show fee, cash-commission limit and paying it off, bonuses, acceptance and
// cancellation rates, heading home, next trip lined up, trip breakdown, document expiry, ride alerts.
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
const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const day = (n) => new Date(Date.now() + 3 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  await api('/admin/settings', { minWithdrawal: 1000, drivers: { freeWaitMin: 0, noShowFee: 1500, cashDebtLimit: 100000, headingHomePerDay: 1, queueNext: true }, bonuses: [{ title: 'First trip of the day', trips: 1, reward: 3000, period: 'day', active: true }] }, admin.token, 'PUT');
  const cfg = await api('/config');
  assert(cfg.drivers && cfg.drivers.noShowFee === 1500 && cfg.drivers.freeWaitMin === 0, 'driver settings are saved and shared with the apps');

  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Tools Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFT 101T', licenseNo: 'DL9', vehicleMake: 'Bajaj', vehicleColor: 'Black' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  assert((await ds.emitWithAck('driver:online', true)).ok, 'driver goes online');

  let ov = await api('/driver/overview', null, driver.token);
  assert(ov.bonuses.length === 1 && ov.bonuses[0].done === 0 && !ov.push, 'overview shows the bonus at 0 of 1 and no ride alerts yet');

  // Ride alerts (Web Push) subscription
  const key = await api('/push/key');
  assert(typeof key.key === 'string' && key.key.length > 40, 'server publishes its ride-alert key');
  const sub = { endpoint: 'https://push.example.invalid/' + rnd(), keys: { p256dh: 'BOr' + 'x'.repeat(80), auth: 'y'.repeat(22) } };
  await api('/push/subscribe', { subscription: sub }, driver.token);
  ov = await api('/driver/overview', null, driver.token);
  assert(ov.push === true, 'a phone can subscribe to ride alerts');
  await api('/push/unsubscribe', { endpoint: sub.endpoint }, driver.token);
  assert((await api('/driver/overview', null, driver.token)).push === false, 'and unsubscribe');

  const rider = await api('/auth/register', { name: 'Tools Rider', phone: '077' + rnd().slice(1), password: 'secret1' });
  await api('/wallet/topup', { amount: 5000, method: 'momo' }, rider.token);
  const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };
  const book = async (who, method, p = pickup, d = drop) => { const t = await api('/trips', { service: 'boda', paymentMethod: method, pickup: p, drop: d, distanceKm: 3.2, durationMin: 12 }, who.token); want = t.id; return t; };
  // Waits for an offer for the trip booked next. Requests left over from other test runs are declined.
  let want = null;
  const offerFor = (ms = 4000) => new Promise((r) => {
    const h = (o) => {
      if (want && o.id < want) { ds.emit('trip:respond', { tripId: o.id, accept: false }); return; }
      clearTimeout(t); ds.off('trip:offer', h); r(o);
    };
    const t = setTimeout(() => { ds.off('trip:offer', h); r(null); }, ms);
    ds.on('trip:offer', h);
  });

  // 1. No-show
  let op = offerFor();
  const t1 = await book(rider, 'cash');
  let offer = await op;
  assert(offer && offer.id === t1.id, 'driver is offered the trip');
  await ds.emitWithAck('trip:respond', { tripId: t1.id, accept: true });
  const early = await call(`/trips/${t1.id}/noshow`, {}, driver.token);
  assert(early.status === 400, 'no-show is refused before the driver has arrived');
  await api(`/trips/${t1.id}/arrived`, {}, driver.token);
  const ns = await api(`/trips/${t1.id}/noshow`, {}, driver.token);
  assert(ns.ok && ns.fee === 1500, 'after the free waiting time the driver leaves and gets the UGX 1,500 no-show fee');
  const w = await api('/wallet', null, rider.token);
  assert(w.balance === 3500, 'the fee came from the rider’s wallet');
  const view1 = await api('/trips/history', null, rider.token);
  assert(view1[0].status === 'cancelled' && view1[0].cancelReason === 'no_show', 'the trip shows as a no-show');

  // 2. Completed cash trip pays the bonus
  op = offerFor();
  const t2 = await book(rider, 'cash');
  offer = await op;
  assert(offer && typeof offer.earning === 'number' && offer.queued === false, 'offer shows the driver’s earning');
  await ds.emitWithAck('trip:respond', { tripId: t2.id, accept: true });
  const dv = await api('/trips/active', null, driver.token);
  assert(dv.shareToken && dv.shareToken.length > 8, 'drivers get a trip link they can share');
  await api(`/trips/${t2.id}/arrived`, {}, driver.token);
  await api(`/trips/${t2.id}/start`, { pin: t2.pin }, driver.token);
  await api(`/trips/${t2.id}/complete`, {}, driver.token);
  ov = await api('/driver/overview', null, driver.token);
  assert(ov.bonuses[0].paid && ov.bonuses[0].done === 1, 'reaching the target pays the bonus once');
  const earn = await api('/driver/earnings', null, driver.token);
  assert(earn.transactions.some((x) => x.type === 'bonus' && x.amount === 3000), 'bonus appears in the driver’s activity');
  const st = ov.stats;
  assert(st.accepted === 2 && st.acceptanceRate === 100 && st.cancellationRate === 0, 'acceptance 100%, cancellation 0%');

  // 3. Trip breakdown
  const br = await api('/driver/trips?days=1', null, driver.token);
  assert(br.trips.length === 2 && br.trips.some((x) => x.noShow && x.earning === 1500) && br.totals.bonuses === 3000, 'trip breakdown lists the trip, the no-show fee and the bonus');

  // 4. Cash commission limit and paying it off
  const bal = (await api('/driver/earnings', null, driver.token)).balance;
  await api('/driver/withdraw', { amount: bal }, driver.token);
  op = offerFor();
  const t3 = await book(rider, 'cash');
  offer = await op;
  await ds.emitWithAck('trip:respond', { tripId: t3.id, accept: true });
  await api(`/trips/${t3.id}/arrived`, {}, driver.token);
  await api(`/trips/${t3.id}/start`, { pin: t3.pin }, driver.token);
  await api(`/trips/${t3.id}/complete`, {}, driver.token);
  ov = await api('/driver/overview', null, driver.token);
  assert(ov.owed > 0 && !ov.cashPaused, `driver owes UGX ${ov.owed} commission on a cash trip`);
  await api('/admin/settings', { drivers: { cashDebtLimit: 100 } }, admin.token, 'PUT');
  ov = await api('/driver/overview', null, driver.token);
  assert(ov.cashPaused, 'past the limit, cash trips pause');
  op = offerFor(2500);
  const t4 = await book(rider, 'cash');
  assert(!(await op), 'no cash trip is offered while the driver owes more than the limit');
  await api(`/trips/${t4.id}/cancel`, {}, rider.token);
  op = offerFor();
  const t5 = await book(rider, 'wallet');
  offer = await op;
  assert(offer && offer.id === t5.id, 'wallet and Mobile Money trips still come through');
  await ds.emitWithAck('trip:respond', { tripId: t5.id, accept: false });
  await sleep(300);
  await api(`/trips/${t5.id}/cancel`, {}, rider.token);
  const paid = await api('/driver/pay-debt', {}, driver.token);
  ov = await api('/driver/overview', null, driver.token);
  assert(paid.demo && ov.owed === 0 && !ov.cashPaused, 'paying the commission by Mobile Money clears it and cash trips resume');

  // 5. Driver cancellation is counted
  op = offerFor();
  const t6 = await book(rider, 'cash');
  await op;
  await ds.emitWithAck('trip:respond', { tripId: t6.id, accept: true });
  await api(`/trips/${t6.id}/cancel`, {}, driver.token);
  await sleep(300);
  await api(`/trips/${t6.id}/cancel`, {}, rider.token).catch(() => {});
  ov = await api('/driver/overview', null, driver.token);
  assert(ov.stats.cancelled === 1 && ov.stats.cancellationRate > 0 && ov.stats.declined === 1, `cancellation counted (${ov.stats.cancellationRate}%) and the declined offer too`);

  // 6. Heading home: only trips going towards home
  const home = { lat: 0.3700, lng: 32.5800, address: 'Kawempe' };
  const h = await api('/driver/home', { on: true, place: home }, driver.token);
  assert(h.ok && h.usesLeft === 0, 'heading home switched on (last use today)');
  op = offerFor(2500);
  const away = await book(rider, 'cash', pickup, { lat: 0.2900, lng: 32.6000, address: 'Kabalagala' });
  { const o = await op; assert(!o, 'a trip going away from home is not offered' + (o ? ` (got trip ${o.id}, away=${away.id})` : '')); }
  await api(`/trips/${away.id}/cancel`, {}, rider.token);
  op = offerFor();
  const towards = await book(rider, 'cash', pickup, { lat: 0.3550, lng: 32.5790, address: 'Bwaise' });
  offer = await op;
  assert(offer && offer.id === towards.id, 'a trip towards home is offered');
  await ds.emitWithAck('trip:respond', { tripId: towards.id, accept: false });
  await sleep(300);
  await api(`/trips/${towards.id}/cancel`, {}, rider.token);
  await api('/driver/home', { on: false }, driver.token);
  const again = await call('/driver/home', { on: true, place: home }, driver.token);
  assert(again.status === 400 && /a day/.test(again.body.error), 'the daily limit applies');

  // 7. Next trip lined up near the end of the current one
  op = offerFor();
  const cur = await book(rider, 'cash');
  await op;
  await ds.emitWithAck('trip:respond', { tripId: cur.id, accept: true });
  await api(`/trips/${cur.id}/arrived`, {}, driver.token);
  await api(`/trips/${cur.id}/start`, { pin: cur.pin }, driver.token);
  ds.emit('driver:location', { lat: 0.3300, lng: 32.5700 }); await sleep(200);
  const rider2 = await api('/auth/register', { name: 'Next Rider', phone: '078' + rnd().slice(1), password: 'secret1' });
  op = offerFor();
  const nxt = await book(rider2, 'cash', { lat: 0.3340, lng: 32.5690, address: 'Makerere gate' }, { lat: 0.3150, lng: 32.5820, address: 'City Square' });
  offer = await op;
  assert(offer && offer.id === nxt.id && offer.queued, 'a nearby request is offered as the next trip while the current one is finishing');
  await ds.emitWithAck('trip:respond', { tripId: nxt.id, accept: true });
  let act = await api('/trips/active', null, driver.token);
  assert(act.id === cur.id && act.status === 'in_progress' && act.next && act.next.id === nxt.id, 'the current trip stays on screen with the next one lined up');
  await api(`/trips/${cur.id}/complete`, {}, driver.token);
  await api(`/trips/${cur.id}/rate`, { stars: 5 }, driver.token);
  act = await api('/trips/active', null, driver.token);
  assert(act.id === nxt.id && act.status === 'accepted', 'after finishing, the next trip becomes current');
  await api(`/trips/${nxt.id}/cancel`, {}, rider2.token);

  // 8. Documents with expiry dates
  await api('/driver/documents', { kind: 'license', image: tinyJpeg, expiresOn: day(5) }, driver.token);
  await api('/driver/documents', { kind: 'insurance', image: tinyJpeg }, driver.token);
  await api('/driver/documents/expiry', { kind: 'insurance', expiresOn: day(-2) }, driver.token);
  const docs = await api('/driver/documents', null, driver.token);
  assert(docs.expires.license === day(5) && docs.optional.insurance, 'expiry dates are saved; insurance is optional');
  ov = await api('/driver/overview', null, driver.token);
  assert(ov.docs.some((d) => d.kind === 'license' && d.soon && d.days === 5) && ov.docs.some((d) => d.kind === 'insurance' && d.expired), 'expiring and expired documents are flagged');
  const list = await api('/admin/drivers', null, admin.token);
  const me = list.find((x) => x.id === driver.user.id);
  assert(me && me.nextExpiry === day(-2) && me.acceptanceRate !== null, 'admin sees the next expiry and acceptance rate');

  ds.close();
  await api('/admin/settings', { drivers: { freeWaitMin: 5, noShowFee: 2000, cashDebtLimit: 30000, headingHomePerDay: 2 }, bonuses: [], minWithdrawal: 5000 }, admin.token, 'PUT');
  console.log(failed ? `${failed} FAILED` : 'All driver tool checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
