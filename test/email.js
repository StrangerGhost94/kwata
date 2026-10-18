// Email for receipts: add + verify with a code, settings, and the trip receipt itself.
// Needs a local server (demo email). The receipt is sent a few minutes after a paid trip; the
// local-only /api/dev/emails?run=1 sends due receipts straight away for the test.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

(async () => {
  const cfg = (await call('/config')).body;
  if (!cfg.emailReceipts) { console.log('· email is off on this server; skipped'); process.exit(0); }
  const admin = (await call('/auth/login', { phone: '0700000000', password: 'admin123' })).body;
  const rider = (await call('/auth/register', { name: 'Mail Rider', phone: '077' + rnd().slice(1), password: 'secret12' })).body;
  const mail = `rider${rnd()}@example.com`;

  // Can't set an unverified email any more through the profile update
  const pr = await call('/me', { email: 'sneaky@example.com', emergencyContact: '0772 000 111' }, rider.token, 'PATCH');
  let me = (await call('/me', null, rider.token)).body.user;
  ok(pr.status === 200 && me.emergencyContact && me.email !== 'sneaky@example.com', 'profile updates still work, but an email can’t be added without confirming it');

  const bad = await call('/me/email', { email: 'not-an-email' }, rider.token);
  ok(bad.status === 400, 'an invalid address is refused');
  const s1 = await call('/me/email', { email: mail }, rider.token);
  ok(s1.status === 200 && s1.body.demoCode && s1.body.email === mail, 'a code is emailed to the address');
  const out1 = (await call('/dev/emails')).body;
  const vmail = out1.reverse().find((m) => m.to === mail && m.tag === 'verify');
  ok(vmail && vmail.subject.includes(s1.body.demoCode) && vmail.html.includes(s1.body.demoCode), 'the email carries the code');
  const again = await call('/me/email', { email: mail }, rider.token);
  ok(again.status === 429, 'resending waits 30 seconds');
  const wrong = await call('/me/email/verify', { code: s1.body.demoCode === '000000' ? '111111' : '000000' }, rider.token);
  ok(wrong.status === 400, 'a wrong code is refused');
  const v = await call('/me/email/verify', { code: s1.body.demoCode }, rider.token);
  ok(v.status === 200 && v.body.user.email === mail && v.body.user.emailVerified && v.body.user.emailReceipts, 'the right code confirms the email, receipts on');
  const reuse = await call('/me/email/verify', { code: s1.body.demoCode }, rider.token);
  ok(reuse.status === 400, 'a code works only once');

  // A paid trip produces a receipt
  const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya Market' };
  const dPhone = '075' + rnd().slice(1);
  await call('/admin/drivers', { name: 'Mail Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFM 505M', licenseNo: 'DL505' }, admin.token);
  const driver = (await call('/auth/login', { phone: dPhone, password: 'secret1' })).body;
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  await ds.emitWithAck('driver:online', true); await sleep(200);
  const offer = new Promise((r) => ds.once('trip:offer', r));
  const t = (await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token)).body;
  await offer; await ds.emitWithAck('trip:respond', { tripId: t.id, accept: true });
  await call(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
  await call(`/trips/${t.id}/complete`, {}, driver.token);
  await call(`/trips/${t.id}/tip`, { amount: 1000, method: 'cash' }, rider.token);
  const out2 = (await call('/dev/emails?run=1')).body;
  const rc = out2.filter((m) => m.to === mail && m.tag === 'receipt');
  ok(rc.length === 1, 'a receipt is emailed after the paid trip');
  const r0 = rc[0] || { html: '', text: '' };
  ok(r0.html.includes('Wandegeya Market') && r0.html.includes('Mail Driver') && r0.html.includes('UFM 505M') && /FLY-0*\d+/.test(r0.html), 'it shows the route, driver, plate and receipt number');
  ok(r0.text.includes('Tip for Mail') && r0.text.includes('Total:'), 'the tip is included in the total');
  const out3 = (await call('/dev/emails?run=1')).body;
  ok(out3.filter((m) => m.to === mail && m.tag === 'receipt').length === 1, 'each trip gets only one receipt');

  // Receipts off → no receipt
  const off = await call('/me/email/settings', { receipts: false }, rider.token);
  ok(off.status === 200 && off.body.user.emailReceipts === false, 'receipts can be switched off');
  const offer2 = new Promise((r) => ds.once('trip:offer', r));
  const t2 = (await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token)).body;
  await offer2; await ds.emitWithAck('trip:respond', { tripId: t2.id, accept: true });
  await call(`/trips/${t2.id}/start`, { pin: t2.pin }, driver.token);
  await call(`/trips/${t2.id}/complete`, {}, driver.token);
  const out4 = (await call('/dev/emails?run=1')).body;
  ok(out4.filter((m) => m.to === mail && m.tag === 'receipt').length === 1, 'with receipts off, no new receipt is sent');

  const rm = await call('/me/email/settings', { remove: true }, rider.token);
  ok(rm.status === 200 && !rm.body.user.email && !rm.body.user.emailVerified, 'the email can be removed');
  const drv = await call('/me/email', { email: 'd@example.com' }, driver.token);
  ok(drv.status === 403 || drv.status === 401, 'driver accounts don’t use rider receipts');

  ds.close();
  console.log(failed ? `${failed} failed` : 'all email checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
