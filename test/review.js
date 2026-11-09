// App review mode (src/review.js): fixed-code sign-in for the review numbers, a demo driver who
// completes the review rider's trip by themselves, a demo rider who requests trips for the review
// driver, and no demo trips reaching real people. Starts its own server with the review variables.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

const PORT = 3411, BASE = `http://localhost:${PORT}`;
const CODE = '246810', RIDER = '0700000101', DRIVER = '0700000102';
async function call(p, body, token) {
  const r = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const KLA = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, ACACIA = { lat: 0.3349, lng: 32.5926, address: 'Acacia Mall' };
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(300); } return null; }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-review-'));
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', REVIEW_CODE: CODE, REVIEW_RIDER_PHONE: RIDER, REVIEW_DRIVER_PHONE: DRIVER, REVIEW_SPEED: '10' },
  });
  let log = ''; app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  const sockets = [];
  try {
    await until(() => /Review mode on/.test(log), 20000);
    ok(/Review mode on/.test(log), 'review accounts are created on start');

    // ---- sign-in with the fixed code
    const s1 = await call('/auth/otp/send', { phone: RIDER });
    ok(s1.status === 200 && !s1.body.demoCode && s1.body.exists && s1.body.role === 'rider', 'review rider number: code "sent" without an SMS, account exists');
    ok((await call('/auth/otp/verify', { phone: RIDER, code: '111111' })).status === 400, 'a wrong code is refused');
    const rider = (await call('/auth/otp/verify', { phone: RIDER, code: CODE })).body;
    ok(rider.token && rider.user.role === 'rider', 'the review rider signs in with REVIEW_CODE');
    const other = await call('/auth/otp/send', { phone: '0772' + String(Date.now()).slice(-6) });
    ok(other.status === 200 && other.body.demoCode && other.body.demoCode !== CODE, 'other numbers still get their own code');

    // ---- a real rider's request never goes to the demo driver
    const real = (await call('/auth/register', { name: 'Real Rider', phone: '0772' + String(Date.now() + 7).slice(-6), password: 'secret1' })).body;
    const rt = await call('/trips', { service: 'car', paymentMethod: 'cash', pickup: KLA, drop: ACACIA }, real.token);
    ok(rt.status === 200, 'a real rider can request');
    await sleep(1500);
    ok((await call('/trips/active', null, real.token)).body.status === 'requested', 'the demo driver does not take a real rider’s trip');
    await call(`/trips/${rt.body.id}/cancel`, {}, real.token);

    // ---- the demo driver completes the review rider's trip
    const t = await call('/trips', { service: 'car', paymentMethod: 'cash', pickup: KLA, drop: ACACIA }, rider.token);
    ok(t.status === 200, 'the review rider requests a car');
    const seen = new Set();
    const done = await until(async () => { const a = (await call(`/trips/history`, null, rider.token)).body; const cur = (await call('/trips/active', null, rider.token)).body; if (cur && cur.status) seen.add(cur.status); const h = (a.trips || a || []).find?.((x) => x.id === t.body.id); return h && h.status === 'completed' ? h : null; }, 30000);
    ok(['accepted', 'arrived', 'in_progress'].every((s) => seen.has(s)), `the trip goes accepted → arrived → started (saw ${[...seen].join(', ')})`);
    ok(!!done, 'and the demo driver completes it');

    // ---- the review driver gets demo requests, even from abroad
    const s2 = await call('/auth/otp/send', { phone: DRIVER });
    ok(s2.body.role === 'driver', 'review driver number is a driver account');
    const drv = (await call('/auth/otp/verify', { phone: DRIVER, code: CODE })).body;
    ok(drv.token && drv.user.role === 'driver', 'the review driver signs in with REVIEW_CODE');
    const sock = io(BASE, { auth: { token: drv.token }, transports: ['websocket'] }); sockets.push(sock);
    await new Promise((r) => sock.on('connect', r));
    const offer = new Promise((r) => sock.on('trip:offer', r));
    sock.emit('driver:location', { lat: 37.3349, lng: -122.009 });   // Apple Park
    await sleep(300);
    const online = await new Promise((r) => sock.emit('driver:online', true, r));
    ok(online && online.ok, 'the review driver goes online from outside Uganda');
    const o = await Promise.race([offer, sleep(8000).then(() => null)]);
    ok(!!o, 'a demo rider requests a trip near them');
    const acc = await new Promise((r) => sock.emit('trip:respond', { tripId: o.id, accept: true }, r));
    ok(acc && acc.ok, 'the review driver accepts');
    ok((await call(`/trips/${o.id}/arrived`, {}, drv.token)).status === 200, 'slides to arrive');
    ok((await call(`/trips/${o.id}/start`, { pin: '1234' }, drv.token)).status === 200, 'starts with PIN 1234');
    ok((await call(`/trips/${o.id}/complete`, {}, drv.token)).status === 200, 'and completes the demo trip');
  } catch (e) { console.error(e); failed++; }
  finally {
    sockets.forEach((s) => s.close());
    app.kill();
    if (failed) console.log(log.split('\n').slice(-30).join('\n'));
  }
  console.log(failed ? `${failed} review check(s) failed` : 'all review mode checks passed');
  process.exit(failed ? 1 : 0);
})();
