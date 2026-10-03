// Growth features: first-ride discount, promo codes, invite rewards, points, tips,
// scheduled rides, booking for someone else and parcel delivery codes.
// Run against a server started with SCHEDULE_LEAD_MIN=30 to test scheduled activation.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (Array.isArray(j)) return Object.assign(j, { ok: r.ok, status: r.status });
  return { ok: r.ok, status: r.status, ...j };
}
async function api(path, body, token, method) { const j = await call(path, body, token, method); if (!j.ok) throw new Error(path + ': ' + j.error); return j; }
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('✓', m); };

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  await api('/admin/settings', { growth: { firstRide: { enabled: true, percent: 50, max: 3000 }, referral: { enabled: true, referrer: 3000, friend: 2000 }, rewards: { enabled: true, pointsPer1000: 1, redeemPoints: 100, redeemValue: 2000 } } }, admin.token, 'PUT');
  const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };

  // driver
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Promo Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFG 101A', licenseNo: 'DL9' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  await ds.emitWithAck('driver:online', true);
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 });
  await sleep(200);
  const bal = async () => (await api('/driver/earnings', null, driver.token)).balance;
  const ride = async (rider, body, extra = {}) => {
    const offer = new Promise((r) => ds.once('trip:offer', r));
    const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9, ...body }, rider.token);
    const o = await offer; await ds.emitWithAck('trip:respond', { tripId: t.id, accept: true });
    await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
    await api(`/trips/${t.id}/complete`, extra, driver.token);
    return { t, o };
  };

  // 1. Invite codes
  const alice = await api('/auth/register', { name: 'Alice Akello', phone: '077' + rnd().slice(1), password: 'secret1' });
  const ga = await api('/me/growth', null, alice.token);
  assert(/^[A-Z]+\d+$/.test(ga.code) && ga.link.includes('?ref=' + ga.code), 'new rider gets an invite code and link: ' + ga.code);
  const badInvite = await call('/auth/register', { name: 'Bad Code', phone: '077' + rnd().slice(1), password: 'secret1', inviteCode: 'NOPE999' });
  assert(!badInvite.ok && /invite code/.test(badInvite.error), 'wrong invite code is rejected with a clear message');
  const bob = await api('/auth/register', { name: 'Bob Okello', phone: '078' + rnd().slice(1), password: 'secret1', inviteCode: ga.code.toLowerCase() });

  // 2. First-ride discount
  const est = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9 }, bob.token);
  const eb = est.options.find((o) => o.id === 'boda');
  assert(eb.discount > 0 && eb.payable === eb.fare - eb.discount && eb.discount <= 3000 && /First ride/.test(eb.promoLabel), `first ride: boda ${eb.fare} → pays ${eb.payable} (${eb.promoLabel})`);
  const b0 = await bal();
  const r1 = await ride(bob, { quoteId: est.quoteId });
  assert(r1.t.discount === eb.discount && r1.o.payable === eb.payable, 'driver offer shows the discounted cash amount to collect');
  const b1 = await bal();
  const commission1 = Math.round(r1.t.fare * 0.12);
  assert(b1 - b0 === r1.t.discount - commission1, `cash trip: driver repaid the discount by Kwata (${r1.t.discount}) minus commission (${commission1})`);

  // 3. Invite rewards after Bob's first trip
  const wa = await api('/wallet', null, alice.token), wb = await api('/wallet', null, bob.token);
  assert(wa.balance === 3000 && wb.balance === 2000, 'invite rewards: Alice +3,000 and Bob +2,000 in wallet');
  const ga2 = await api('/me/growth', null, alice.token);
  assert(ga2.friends.joined === 1 && ga2.friends.rode === 1 && ga2.earned === 3000, 'Alice sees 1 friend joined and UGX 3,000 earned');

  // 4. Points
  const gb = await api('/me/growth', null, bob.token);
  assert(gb.points === Math.floor((r1.t.fare - r1.t.discount) / 1000), `Bob earned ${gb.points} Kwata Rewards points (1 per UGX 1,000 paid)`);
  assert(!gb.firstRide, 'first-ride offer is gone after the first trip');
  const est2 = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9 }, bob.token);
  assert(est2.options.find((o) => o.id === 'boda').discount === 0, 'no discount on the second trip without a code');

  // 5. Promo codes
  const code = 'SAVE' + rnd().slice(0, 4);
  await api('/admin/promos', { code, kind: 'percent', value: 20, maxDiscount: 1000, perUser: 1 }, admin.token);
  const est3 = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9, promoCode: code.toLowerCase() }, bob.token);
  const e3 = est3.options.find((o) => o.id === 'boda');
  assert(e3.discount === Math.min(1000, Math.round(e3.fare * 0.2 / 100) * 100) && e3.promoCode === code, `promo ${code}: ${e3.fare} → ${e3.payable}`);
  const bad = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9, promoCode: 'WRONG1' }, bob.token);
  assert(/isn’t valid/.test(bad.promoError), 'unknown promo code gives a clear message');
  await api('/wallet/topup', { amount: 5000, method: 'momo' }, bob.token);
  const wbBefore = (await api('/wallet', null, bob.token)).balance;
  const b2 = await bal();
  const r2 = await ride(bob, { quoteId: est3.quoteId, promoCode: code, paymentMethod: 'wallet' });
  const wbAfter = (await api('/wallet', null, bob.token)).balance;
  assert(wbBefore - wbAfter === r2.t.fare - r2.t.discount, `wallet trip: Bob paid ${r2.t.fare - r2.t.discount} (fare ${r2.t.fare} less ${r2.t.discount})`);
  assert((await bal()) - b2 === r2.t.fare - Math.round(r2.t.fare * 0.12), 'wallet trip with promo: driver still earns on the full fare');
  const again = await api('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9, promoCode: code }, bob.token);
  assert(/already used/.test(again.promoError), 'promo code can only be used once per rider');
  const promos = await api('/admin/promos', null, admin.token);
  const pr = promos.promos.find((p) => p.code === code);
  assert(pr.uses === 1 && pr.spent === r2.t.discount, `admin sees ${code}: 1 use, UGX ${pr.spent} spent`);
  await api(`/admin/promos/${code}/active`, { active: false }, admin.token);
  const off = await call('/fare/estimate', { pickup, drop, distanceKm: 3.2, durationMin: 9, promoCode: code }, alice.token);
  assert(/isn’t valid/.test(off.promoError), 'switched-off promo stops working');

  // 6. Tips
  const b3 = await bal();
  const wbt = (await api('/wallet', null, bob.token)).balance;
  const tipToast = new Promise((r) => ds.once('toast', r));
  await api(`/trips/${r2.t.id}/tip`, { amount: 1000, method: 'wallet' }, bob.token);
  assert((await bal()) - b3 === 1000 && wbt - (await api('/wallet', null, bob.token)).balance === 1000, 'wallet tip: UGX 1,000 moves from rider to driver, no commission');
  assert(/tipped you UGX 1,000/.test((await tipToast).text), 'driver is told about the tip');
  const tip2 = await call(`/trips/${r2.t.id}/tip`, { amount: 500, method: 'cash' }, bob.token);
  assert(!tip2.ok, 'only one tip per trip');

  // 7. Rewards redeem
  await api('/admin/settings', { growth: { rewards: { enabled: true, pointsPer1000: 1, redeemPoints: 1, redeemValue: 2000 } } }, admin.token, 'PUT');
  const wr = (await api('/wallet', null, bob.token)).balance;
  const red = await api('/rewards/redeem', {}, bob.token);
  assert(red.walletBalance === wr + 2000, 'redeeming points adds UGX 2,000 to the wallet');
  await api('/admin/settings', { growth: { rewards: { enabled: true, pointsPer1000: 1, redeemPoints: 100, redeemValue: 2000 } } }, admin.token, 'PUT');

  // 8. Book for someone else
  const offerP = new Promise((r) => ds.once('trip:offer', r));
  const tp = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9, passenger: { name: 'Mama Sarah', phone: '0772 555111' } }, alice.token);
  await offerP; await ds.emitWithAck('trip:respond', { tripId: tp.id, accept: true });
  const dv = await api('/trips/active', null, driver.token);
  assert(dv.rider.name === 'Mama Sarah' && dv.rider.phone === '+256772555111' && dv.bookedBy === 'Alice Akello', 'driver sees and can call the passenger, booked by Alice');
  await api(`/trips/${tp.id}/start`, { pin: tp.pin }, driver.token);
  await api(`/trips/${tp.id}/complete`, {}, driver.token);
  const pub = await fetch(`${BASE}/api/track/${tp.shareToken}`).then((r) => r.json());
  assert(pub.rider && pub.rider.name === 'Mama', 'family tracking link shows the passenger’s name');

  // 9. Parcel delivery code
  const offP = new Promise((r) => ds.once('trip:offer', r));
  const tparcel = await api('/trips', { service: 'parcel', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9, parcel: { recipientName: 'Joan', recipientPhone: '0772 000111', item: 'Documents' } }, alice.token);
  assert(/^\d{4}$/.test(tparcel.dropCode), 'parcel gets a 4-digit delivery code for the recipient');
  await offP; await ds.emitWithAck('trip:respond', { tripId: tparcel.id, accept: true });
  const dvp = await api('/trips/active', null, driver.token);
  assert(dvp.needsDropCode && !dvp.dropCode, 'driver must ask for the code (and can’t see it)');
  await api(`/trips/${tparcel.id}/start`, { pin: tparcel.pin }, driver.token);
  const wrong = await call(`/trips/${tparcel.id}/complete`, { code: '0000' }, driver.token);
  assert(!wrong.ok && /delivery code/.test(wrong.error), 'wrong delivery code cannot complete the delivery');
  await api(`/trips/${tparcel.id}/complete`, { code: tparcel.dropCode }, driver.token);
  assert((await api('/trips/history', null, alice.token)).find((t) => t.id === tparcel.id).status === 'completed', 'right delivery code completes it');

  // 10. Scheduled rides
  const soon = await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, scheduledFor: new Date(Date.now() + 5 * 60e3).toISOString() }, alice.token);
  assert(!soon.ok && /20 minutes/.test(soon.error), 'cannot schedule less than 20 minutes ahead');
  const later = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9, scheduledFor: new Date(Date.now() + 26 * 60e3).toISOString() }, alice.token);
  assert(later.status === 'scheduled' && later.scheduledFor, 'ride scheduled for later');
  const up = await api('/trips/upcoming', null, alice.token);
  assert(up.length === 1 && up[0].id === later.id, 'upcoming rides list shows it');
  const extra = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9, scheduledFor: new Date(Date.now() + 2 * 86400e3).toISOString() }, alice.token);
  await api(`/trips/${extra.id}/cancel`, {}, alice.token);
  assert((await api('/trips/upcoming', null, alice.token)).length === 1, 'a scheduled ride can be cancelled');
  if (Number(process.env.SCHEDULE_LEAD_MIN) >= 30) {
    // wait for this ride's offer (decline anything left over from earlier runs)
    const offerS = new Promise((resolve) => { const h = async (o) => { if (o.id === later.id) { ds.off('trip:offer', h); resolve(o); } else await ds.emitWithAck('trip:respond', { tripId: o.id, accept: false }); }; ds.on('trip:offer', h); });
    const o = await Promise.race([offerS, sleep(45000).then(() => null)]);
    assert(o && o.id === later.id, 'scheduled ride starts looking for a driver ahead of pickup time');
    await ds.emitWithAck('trip:respond', { tripId: later.id, accept: false });
  } else console.log('… (skipping activation check: start server with SCHEDULE_LEAD_MIN=30)');

  ds.close();
  console.log('\nALL GROWTH TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
