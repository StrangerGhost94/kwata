// Share night trips, end to end:
//  1. SMS sent (local demo mode on the main test server)
//  2. Once per trip, even if the driver's "start" arrives twice at the same moment
//  3. Switched off: nothing is sent or offered
//  4. SMS not set up (like the live site without EgoSMS keys): the rider is offered WhatsApp
//  5. SMS set up but failing: the rider is offered WhatsApp too
// 4 and 5 start their own short-lived servers (own port, own empty database folder).
const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const MAIN = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

function client(BASE) {
  async function call(p, body, token, method) {
    const r = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  async function api(p, body, token, method) { const r = await call(p, body, token, method); if (r.status >= 400) throw new Error(p + ': ' + r.body.error); return r.body; }
  return { call, api };
}

// A rider (night sharing on or off), an approved online driver, and a trip that gets started.
async function nightTrip(BASE, { on = true, plate, doubleStart = false } = {}) {
  const { api, call } = client(BASE);
  const contact = '0772' + rnd().slice(2);
  const rPhone = '077' + rnd().slice(1);
  let rider = (await call('/auth/register', { name: 'Amina Night', phone: rPhone, password: 'secret1' })).body;
  if (!rider.token) { // a server with SMS keys asks for a code first; take it on WhatsApp (local demo)
    const sent = await api('/auth/otp/send', { phone: rPhone, channel: 'whatsapp' });
    const v = await api('/auth/otp/verify', { phone: rPhone, code: sent.demoCode });
    rider = await api('/auth/register', { name: 'Amina Night', phone: rPhone, phoneToken: v.phoneToken, role: 'rider' });
  }
  await api('/me', { emergencyContact: contact, nightShare: { on, from: '00:00' } }, rider.token, 'PATCH'); // from midnight: always "night"
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Okello Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate, licenseNo: 'DL' + rnd().slice(0, 4), vehicleMake: 'Bajaj', vehicleColor: 'Red' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token }, transports: ['websocket'] }); await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150); await ds.emitWithAck('driver:online', true);
  let want = null; ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }));
  // The rider's app is open, so the trip screen hears the update straight away.
  const rs = io(BASE, { auth: { token: rider.token }, transports: ['websocket'] }); await new Promise((r) => rs.on('connect', r));
  const heard = []; rs.on('trip:update', (t) => heard.push(t));
  const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop: { lat: 0.3366, lng: 32.5877, address: 'Acacia Mall, Kisementi' }, distanceKm: 3.5, durationMin: 10 }, rider.token);
  want = t.id; for (let i = 0; i < 40 && (await api('/trips/active', null, rider.token)).status !== 'accepted'; i++) await sleep(100);
  await api(`/trips/${t.id}/arrived`, {}, driver.token);
  if (doubleStart) await Promise.all([call(`/trips/${t.id}/start`, { pin: t.pin }, driver.token), call(`/trips/${t.id}/start`, { pin: t.pin }, driver.token)]);
  else await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
  let view = null;
  for (let i = 0; i < 30; i++) { view = await api('/trips/active', null, rider.token); if (!on || view.nightShare) break; await sleep(100); }
  await sleep(200);
  const done = async () => { await call(`/trips/${t.id}/complete`, {}, driver.token); ds.close(); rs.close(); };
  return { api, call, rider, admin, driver, trip: t, view, heard, contact, done };
}

// A second server with its own settings and an empty database, for the "no SMS" cases.
async function startServer(port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-ns-'));
  const logFile = path.join(dir, 'server.log');
  const out = fs.openSync(logFile, 'w');
  const env2 = { ...process.env, PORT: String(port), ...env };
  delete env2.DATABASE_URL; delete env2.NODE_ENV; delete env2.EGOSMS_USERNAME; delete env2.EGOSMS_PASSWORD;
  Object.assign(env2, env);
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: dir, env: env2, stdio: ['ignore', out, out] });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await sleep(200); }
  await sleep(300);
  return { base, log: () => fs.readFileSync(logFile, 'utf8'), stop: () => { p.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

(async () => {
  const R = rnd().slice(0, 3); // plates unique to this run, so a reused server log can't confuse the counts
  // 1. SMS sent (local demo mode)
  const cfg = await client(MAIN).api('/config');
  ok(cfg.nightShareSms === true, 'local server: night trips are texted automatically (demo mode)');
  const a = await nightTrip(MAIN, { plate: `UNS ${R}A` });
  ok(a.view.nightShare && a.view.nightShare.status === 'sms', 'trip screen: shared by SMS');
  ok(!a.view.nightShare.whatsapp, 'no WhatsApp card when the text went');
  ok(a.heard.some((t) => t.nightShare && t.nightShare.status === 'sms'), 'the open app hears it straight away');
  const st = await a.api('/admin/stats', null, a.admin.token);
  ok(st.nightShare && st.nightShare.sms === 'demo' && st.nightShare.week.sms >= 1, 'admin: SMS in test mode, texts counted this week');
  ok((await a.call(`/trips/${a.trip.id}/night-share/opened`, {}, a.rider.token)).status === 400, 'a texted trip has nothing to send on WhatsApp');
  await a.done();

  // 2. Once per trip, even when two "start" calls race
  const b = await nightTrip(MAIN, { plate: `UNS ${R}B`, doubleStart: true });
  ok(b.view.nightShare && b.view.nightShare.status === 'sms', 'double start: still shared');
  if (process.env.SERVER_LOG) {
    const n = fs.readFileSync(process.env.SERVER_LOG, 'utf8').split('[sms demo]').filter((x) => x.includes(`UNS ${R}B`)).length;
    ok(n === 1, `double start: exactly one text (got ${n})`);
  }
  await b.done();

  // 3. Switched off: nothing sent, nothing offered
  const c = await nightTrip(MAIN, { on: false, plate: `UNS ${R}C` });
  ok(c.view.status === 'in_progress' && !c.view.nightShare, 'switch off: nothing sent or offered');
  if (process.env.SERVER_LOG) ok(!new RegExp(`UNS ${R}C`).test(fs.readFileSync(process.env.SERVER_LOG, 'utf8').split('[sms demo]').slice(1).join('')), 'switch off: no text in the log');
  await c.done();

  // 4. SMS not set up (live site without EgoSMS keys): WhatsApp fallback
  const s1 = await startServer(3117, { SMS_DEMO: 'false' });
  try {
    const cfg2 = await client(s1.base).api('/config');
    ok(cfg2.nightShareSms === false, 'no SMS keys: the app says it needs one tap');
    const d = await nightTrip(s1.base, { plate: `UNS ${R}D` });
    const n = d.view.nightShare || {};
    ok(n.status === 'whatsapp' && n.reason === 'not_set_up', 'trip recorded as offered on WhatsApp (SMS not set up)');
    const digits = d.contact.replace(/^0/, '256');
    ok(String(n.whatsapp).startsWith(`https://wa.me/${digits}?text=`), 'one tap opens WhatsApp to the emergency contact');
    const text = decodeURIComponent(String(n.whatsapp).split('?text=')[1] || '');
    ok(text === n.text && new RegExp(`UNS ${R}D`).test(text) && /driver Okello/.test(text) && /\/t\/[\w-]+/.test(text) && /^Amina is on a Flytte boda/.test(text), 'same message as the SMS: driver, plate and live link');
    ok(d.heard.some((t) => t.nightShare && t.nightShare.whatsapp), 'the open app gets the card straight away (toast + card)');
    ok(!/\[sms demo\]/.test(s1.log()), 'nothing pretended to be texted');
    let st2 = await d.api('/admin/stats', null, d.admin.token);
    ok(st2.nightShare.sms === 'off' && st2.nightShare.week.whatsapp === 1 && st2.nightShare.week.sms === 0, 'admin: SMS is off, 1 offered on WhatsApp this week');
    ok((await d.call(`/trips/${d.trip.id}/night-share/opened`, {}, d.driver.token)).status === 403, 'only the rider can mark it sent');
    await d.api(`/trips/${d.trip.id}/night-share/opened`, {}, d.rider.token);
    const v2 = await d.api('/trips/active', null, d.rider.token);
    ok(v2.nightShare.opened === true && v2.nightShare.status === 'whatsapp', 'tapping Send on WhatsApp is recorded on the trip');
    st2 = await d.api('/admin/stats', null, d.admin.token);
    ok(st2.nightShare.week.opened === 1, 'admin: counted as opened by the rider');
    await d.done();
    const off = await nightTrip(s1.base, { on: false, plate: `UNS ${R}E` });
    ok(!off.view.nightShare, 'no SMS keys + switch off: no WhatsApp card either');
    await off.done();
  } finally { s1.stop(); }

  // 5. SMS set up but the send fails: WhatsApp fallback
  const s2 = await startServer(3118, { EGOSMS_USERNAME: 'test', EGOSMS_PASSWORD: 'test', EGOSMS_URL: 'http://127.0.0.1:9/' });
  try {
    const e = await nightTrip(s2.base, { plate: `UNS ${R}F` });
    const n = e.view.nightShare || {};
    ok(n.status === 'whatsapp' && n.reason === 'sms_error' && /^https:\/\/wa\.me\//.test(n.whatsapp), 'SMS failed: recorded and offered on WhatsApp');
    await e.done();
  } finally { s2.stop(); }

  console.log(failed ? `${failed} FAILED` : 'all night-sharing checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
