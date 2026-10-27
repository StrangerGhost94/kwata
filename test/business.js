// Flytte for Business and Flytte for Shops: company accounts pay staff rides (driver paid as for a wallet
// trip, the company owes the fare), budgets and the credit limit are enforced, statements and payment;
// shops get customer requests through their own link and send many deliveries at once without them
// taking over the staff member's own trip screen.
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
const reg = (name) => { const phone = '077' + rnd().slice(1); return api('/auth/register', { name, phone, password: 'secret1' }).then((u) => ({ ...u, phone })); };

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const boss = await reg('Biz Boss'), staff = await reg('Biz Staff');
  const co = await api('/business', { name: 'Acme Uganda Ltd', email: 'accounts@acme.test' }, boss.token);
  ok(co.id && co.companies[0].role === 'admin', 'a rider can open a company account and is its admin');
  ok((await call('/business/' + co.id + '/members', { phone: '0779999' + rnd().slice(0, 3), budget: 10000 }, boss.token)).status === 400, 'only people already on Flytte can be added');
  await api(`/business/${co.id}/members`, { phone: staff.phone, budget: 9000 }, boss.token);
  const mine = await api('/business/me', null, staff.token);
  ok(mine.companies.length === 1 && mine.companies[0].budget === 9000 && mine.companies[0].role === 'staff', 'staff see the account and their budget');
  ok((await call(`/business/${co.id}`, null, staff.token)).status === 403, 'staff can’t open the admin dashboard');

  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Biz Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFB 101B', licenseNo: 'DL1', vehicleMake: 'Bajaj', vehicleColor: 'Red' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150); await ds.emitWithAck('driver:online', true);
  const want = new Set(); ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: want.has(o.id) }));
  const accepted = async (id) => { for (let i = 0; i < 40; i++) { const a = await api('/trips/active', null, driver.token); if (a && a.id === id && a.status === 'accepted') return true; await sleep(100); } return false; };
  const finish = async (t) => { await api(`/trips/${t.id}/arrived`, {}, driver.token); await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token); await api(`/trips/${t.id}/complete`, t.dropCode ? { code: t.dropCode } : {}, driver.token); };

  const balBefore = (await api('/driver/overview', null, driver.token)).balance;
  const t1 = await api('/trips', { service: 'boda', paymentMethod: 'business', companyId: co.id, pickup: office, drop: client, distanceKm: 3.2, durationMin: 12 }, staff.token);
  ok(t1.paymentMethod === 'business' && t1.discount === 0, 'a staff member books on the company account (personal offers don’t apply)');
  want.add(t1.id); await accepted(t1.id); await finish(t1);
  let d = await api(`/business/${co.id}`, null, boss.token);
  ok(d.balanceDue === t1.fare, `the company owes the fare (UGX ${t1.fare.toLocaleString()})`);
  ok((await api('/wallet', null, staff.token)).balance === 0, 'the staff member pays nothing');
  const s = await api('/admin/settings', null, admin.token);
  ok((await api('/driver/overview', null, driver.token)).balance === balBefore + t1.fare - Math.round(t1.fare * s.commissionPct / 100), 'the driver is paid the fare less commission, as for a wallet trip');
  ok(d.staff.find((x) => x.name === 'Biz Staff').spent === t1.fare, 'the dashboard shows what each person spent');

  ok((await call('/trips', { service: 'car', paymentMethod: 'business', companyId: co.id, pickup: office, drop: client, distanceKm: 3.2, durationMin: 12 }, staff.token)).status === 400, 'a ride over the person’s monthly budget is refused');

  const st = await api(`/business/${co.id}/statement`, null, boss.token);
  ok(st.trips.length === 1 && st.total === t1.fare && st.people[0].name === 'Biz Staff', 'the monthly statement lists the trip, the total and who spent it');
  const paid = await api(`/business/${co.id}/pay`, {}, boss.token);
  d = await api(`/business/${co.id}`, null, boss.token);
  ok((paid.demo && d.balanceDue === 0) || paid.link, 'the admin pays the statement by Mobile Money');

  // The credit limit.
  await api('/admin/settings', { business: { creditLimit: 1000 } }, admin.token, 'PUT');
  const small = await api('/business', { name: 'Tiny Co' }, boss.token);
  ok((await call('/trips', { service: 'boda', paymentMethod: 'business', companyId: small.id, pickup: office, drop: client, distanceKm: 3.2, durationMin: 12 }, boss.token)).status === 400, 'a ride past the account limit is refused');
  await api('/admin/settings', { business: { creditLimit: 300000 } }, admin.token, 'PUT');

  // ---------- Shops ----------
  const shopOwner = await reg('Shop Owner');
  ok((await call('/business', { kind: 'merchant', name: 'Mama’s Kitchen' }, shopOwner.token)).status === 400, 'a shop needs a pickup location');
  const shop = await api('/business', { kind: 'merchant', name: 'Mama’s Kitchen', shop: office }, shopOwner.token);
  d = await api(`/business/${shop.id}`, null, shopOwner.token);
  ok(d.kind === 'merchant' && /\/shop\/mama-s-kitchen/.test(d.link), `the shop gets its own order link (${d.link})`);
  const pub = await api('/shop/' + d.slug);
  ok(pub.name === 'Mama’s Kitchen', 'anyone can open the order link');
  ok((await call(`/shop/${d.slug}/request`, { name: 'Customer A', phone: '0772' + rnd().slice(0, 6), drop: client }, null)).status === 400, 'a request needs to say what was ordered');
  await api(`/shop/${d.slug}/request`, { name: 'Customer A', phone: '0772' + rnd().slice(0, 6), drop: client, note: '2 chicken pizzas, order #114' });
  d = await api(`/business/${shop.id}`, null, shopOwner.token);
  ok(d.requests.length === 1 && /pizzas/.test(d.requests[0].note), 'the request shows on the shop’s page');

  const book = (who) => api('/trips', { service: 'parcel', paymentMethod: 'business', companyId: shop.id, merchant: true, pickup: office, drop: client, distanceKm: 3.2, durationMin: 12, parcel: { recipientName: who, recipientPhone: '0772' + rnd().slice(0, 6), item: 'Pizza' } }, shopOwner.token);
  const p1 = await book('Customer A'), p2 = await book('Customer B');
  ok(p1.id && p2.id, 'a shop can have several deliveries on the road at once');
  await api(`/business/${shop.id}/requests/${d.requests[0].id}`, { status: 'sent', tripId: p1.id }, shopOwner.token);
  ok((await api(`/business/${shop.id}`, null, shopOwner.token)).requests.length === 0, 'answering a request takes it off the list');
  ok((await api('/trips/active', null, shopOwner.token)) === null, 'shop deliveries don’t take over the owner’s own trip screen');
  const n = await api(`/business/${shop.id}/deliveries/${p1.id}/notify`, {}, shopOwner.token);
  ok(/\/t\//.test(n.text) && n.text.includes(p1.dropCode), 'the customer message has the live link and the delivery code');
  const live = await api(`/business/${shop.id}/deliveries`, null, shopOwner.token);
  ok(live.length === 2, 'the shop page lists its deliveries');
  const own = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup: office, drop: client, distanceKm: 3.2, durationMin: 12 }, shopOwner.token);
  ok(own.id, 'the owner can still book a ride of their own');
  for (const id of [p1.id, p2.id, own.id]) await call(`/trips/${id}/cancel`, { reason: 'test' }, shopOwner.token);
  ok((await call('/trips', { service: 'parcel', paymentMethod: 'business', companyId: co.id, merchant: true, pickup: office, drop: client, parcel: { recipientName: 'X', recipientPhone: '0772000000', item: 'Y' } }, boss.token)).status === 400, 'only shop accounts send shop deliveries');

  ds.close();
  console.log(failed ? `${failed} FAILED` : 'all business checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
