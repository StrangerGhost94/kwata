// Prepaid company accounts: the admin tops up the company wallet, staff rides are paid from it, rides it
// can't cover are refused (or go on credit if Flytte gave the account some), fees on work trips are the
// company's, people not on Flytte yet are invited, ride rules and trip reasons, removals cancel bookings.
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
const office = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, client = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };
const reg = (name, phone) => { phone = phone || '077' + rnd().slice(1); return api('/auth/register', { name, phone, password: 'secret1' }).then((u) => ({ ...u, phone })); };
const ride = (co, token, extra = {}) => call('/trips', { service: 'boda', paymentMethod: 'business', companyId: co, pickup: office, drop: client, distanceKm: 3.2, durationMin: 12, ...extra }, token);

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const before = (await api('/admin/settings', null, admin.token)).business;
  await api('/admin/settings', { business: { creditLimit: 0, lowBalance: 20000 } }, admin.token, 'PUT');
  try {
    const boss = await reg('Wallet Boss'), staff = await reg('Wallet Staff');
    const co = (await api('/business', { name: 'Prepaid Co' }, boss.token)).id;
    await api(`/business/${co}/members`, { phone: staff.phone, budget: 0 }, boss.token);
    let d = await api(`/business/${co}`, null, boss.token);
    ok(d.wallet === 0 && d.creditLimit === 0 && d.low, 'a new account is prepaid, with an empty wallet');
    const r0 = await ride(co, staff.token);
    ok(r0.status === 400 && /wallet doesn’t have enough/.test(r0.body.error), 'a staff ride is refused while the wallet is empty');

    const tu = await api(`/business/${co}/topup`, { amount: 20000, network: 'mtn', phone: boss.phone }, boss.token);
    d = await api(`/business/${co}`, null, boss.token);
    ok((tu.demo && d.wallet === 20000) || tu.link || tu.pending, 'the admin tops up the company wallet by Mobile Money');
    ok((await call(`/business/${co}/topup`, { amount: 5000 }, staff.token)).status === 403, 'staff can’t top up (only admins)');

    // A ride paid from the wallet.
    const dPhone = '075' + rnd().slice(1);
    await api('/admin/drivers', { name: 'Wallet Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFW 303W', licenseNo: 'DL3', vehicleMake: 'Bajaj', vehicleColor: 'Blue' }, admin.token);
    const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
    const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
    ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150); await ds.emitWithAck('driver:online', true);
    const want = new Set(); ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: want.has(o.id) }));
    const accepted = async (id) => { for (let i = 0; i < 40; i++) { const a = await api('/trips/active', null, driver.token); if (a && a.id === id && a.status === 'accepted') return; await sleep(100); } };
    let t = (await ride(co, staff.token)).body;
    want.add(t.id); await accepted(t.id);
    await api(`/trips/${t.id}/arrived`, {}, driver.token); await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token); await api(`/trips/${t.id}/complete`, {}, driver.token);
    d = await api(`/business/${co}`, null, boss.token);
    ok(d.wallet === 20000 - t.fare && d.balanceDue === 0, `the ride came out of the wallet (UGX ${t.fare.toLocaleString()}), nothing owed`);
    ok((await api('/wallet', null, staff.token)).balance === 0, 'the staff member paid nothing themselves');

    // Late cancel on a work trip: the company pays the fee, not the employee.
    await api('/admin/settings', { drivers: { cancelFee: 1000, cancelGraceMin: 0 } }, admin.token, 'PUT');
    await api('/wallet/topup', { amount: 5000, method: 'momo' }, staff.token);
    t = (await ride(co, staff.token)).body; want.add(t.id); await accepted(t.id);
    const c1 = await api(`/trips/${t.id}/cancel`, { reason: 'test' }, staff.token);
    const w1 = (await api(`/business/${co}`, null, boss.token)).wallet;
    ok(c1.fee === 1000 && w1 === d.wallet - 1000 && (await api('/wallet', null, staff.token)).balance === 5000, 'a late-cancel fee on a work trip comes from the company, not the employee');
    await api('/admin/settings', { drivers: { cancelFee: 1000, cancelGraceMin: 2 } }, admin.token, 'PUT');

    // Ride rules and trip reasons.
    await api(`/business/${co}`, { allowedServices: ['boda'], requireReason: true }, boss.token, 'PATCH');
    const r1 = await ride(co, staff.token, { service: 'car' });
    ok(r1.status === 400 && /allows Boda rides/.test(r1.body.error), 'a ride type the company doesn’t allow is refused');
    const r2 = await ride(co, staff.token);
    ok(r2.status === 400 && r2.body.code === 'NEED_REASON', 'a trip reason is asked for when the company requires one');
    const r3 = await ride(co, staff.token, { tripReason: 'Client meeting', scheduledFor: new Date(Date.now() + 2 * 3600e3).toISOString() });
    ok(r3.status === 200, 'with a reason, the work ride is booked');
    const st = await api(`/business/${co}/statement`, null, boss.token);
    ok(st.payments.some((p) => p.kind === 'topup' && p.amount === 20000) && st.feeRows.length === 1, 'the statement shows the top-up and the cancellation fee');

    // Removing someone cancels their booked work rides.
    await api(`/business/${co}/members/${staff.user.id}`, { active: false }, boss.token, 'PATCH');
    const up = await api('/trips/upcoming', null, staff.token);
    ok(!up.some((x) => x.id === r3.body.id), 'removing someone cancels their scheduled work rides');

    // Invite someone who isn't on Flytte yet; they join when they sign up.
    const newPhone = '0774' + rnd().slice(0, 6);
    const inv = await api(`/business/${co}/members`, { phone: newPhone, budget: 50000 }, boss.token);
    ok(inv.invited && /sign up/.test(inv.text), 'someone not on Flytte yet is invited, with a message to send them');
    d = await api(`/business/${co}`, null, boss.token);
    ok(d.invites.length === 1, 'the invite shows on the dashboard');
    const joined = await reg('New Hire', newPhone);
    const mine = await api('/business/me', null, joined.token);
    ok(mine.companies.some((c) => c.id === co && c.budget === 50000), 'when they sign up they’re on the account, with their budget');

    // Credit from Flytte covers what the wallet can't.
    await api(`/admin/companies/${co}`, { creditLimit: 50000 }, admin.token);
    await api(`/business/${co}`, { allowedServices: ['boda', 'car', 'comfort', 'parcel', 'airport'], requireReason: false }, boss.token, 'PATCH');
    d = await api(`/business/${co}`, null, boss.token);
    ok(d.available === d.wallet + 50000, 'with credit, the account can spend the wallet plus the credit');
    ds.close();
  } finally {
    await api('/admin/settings', { business: before }, admin.token, 'PUT');
  }
  console.log(failed ? `${failed} FAILED` : 'all company wallet checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
