// The iPhone Live Activity's server side (src/liveactivity.js): a rider registers the activity's push
// token, and every step of the trip reaches it through Firebase with the right content-state, which
// must match FlytteTripAttributes.ContentState in apps/ios-live-activity. Runs a review-mode server
// (the demo driver drives the trip) against a stand-in for Google's sign-in and Firebase.
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

const PORT = 3414, BASE = `http://localhost:${PORT}`, CODE = '975310', RIDER = '0700000501';
async function call(p, body, token) {
  const r = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  // ---- stand-in Google sign-in + Firebase
  const pushes = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/token') return res.end(JSON.stringify({ access_token: 'ya29.la', expires_in: 3600 }));
      pushes.push(JSON.parse(b).message);
      res.end(JSON.stringify({ name: 'projects/x/messages/1' }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-la-'));
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', REVIEW_CODE: CODE, REVIEW_RIDER_PHONE: RIDER, REVIEW_SPEED: '10',
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'flytte-test', client_email: 'push@flytte-test.iam.gserviceaccount.com', private_key: pem }),
      FCM_TOKEN_URL: `http://127.0.0.1:${mock.address().port}/token`, FCM_API_BASE: `http://127.0.0.1:${mock.address().port}` },
  });
  let log = ''; app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 80 && !/Review mode on/.test(log); i++) await sleep(250);
    await call('/auth/otp/send', { phone: RIDER });
    const rider = (await call('/auth/otp/verify', { phone: RIDER, code: CODE })).body;
    const IOS_TOKEN = 'ios-rider-fcm-' + 'z'.repeat(140);
    ok((await call('/push/native', { token: IOS_TOKEN, platform: 'ios', app: 'rider' }, rider.token)).status === 200, 'the rider’s iPhone is registered for alerts');

    const LA_TOKEN = crypto.randomBytes(32).toString('hex');
    const t = (await call('/trips', { service: 'car', paymentMethod: 'cash', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road, Kampala' }, drop: { lat: 0.3349, lng: 32.5926, address: 'Acacia Mall, Kisementi' } }, rider.token)).body;
    ok((await call('/push/live-activity', { tripId: t.id, token: LA_TOKEN }, rider.token)).status === 400, 'a token can’t be registered before a driver accepts');
    for (let i = 0; i < 40; i++) { const a = (await call('/trips/active', null, rider.token)).body; if (a && a.status === 'accepted') break; await sleep(150); }
    ok((await call('/push/live-activity', { tripId: t.id, token: LA_TOKEN }, rider.token)).status === 200, 'once a driver accepts, the Live Activity’s token is registered');
    ok((await call('/push/live-activity', { tripId: t.id, token: 'not-hex' }, rider.token)).status === 400, 'a malformed token is refused');

    // Let the demo driver drive, arrive, start and finish.
    for (let i = 0; i < 120; i++) { const h = (await call('/trips/active', null, rider.token)).body; if (!h || h.status === 'completed') break; await sleep(250); }
    await sleep(800);
    const la = pushes.filter((m) => m.apns && m.apns.live_activity_token);
    const states = la.map((m) => m.apns.payload.aps['content-state'].status);
    ok(la.length >= 4 && la.every((m) => m.token === IOS_TOKEN && m.apns.live_activity_token === LA_TOKEN), `updates go to this iPhone’s Live Activity (${la.length} sent: ${states.join(' → ')})`);
    ok(['accepted', 'near', 'arrived', 'in_progress', 'completed'].every((s) => states.includes(s)), 'every step: on the way, almost here, arrived, on the trip, done');
    const keys = new Set(la.flatMap((m) => Object.keys(m.apns.payload.aps['content-state'])));
    ok([...keys].sort().join() === 'etaMinutes,plate,status,subtitle,title', 'content-state has exactly the fields FlytteTripAttributes.ContentState decodes');
    const swift = fs.readFileSync(path.join(__dirname, '..', 'apps/ios-live-activity/FlytteTripAttributes.swift'), 'utf8');
    ok([...keys].every((k) => new RegExp(`var ${k}: `).test(swift)), 'and the Swift model declares each of them');
    const onWay = la.find((m) => m.apns.payload.aps['content-state'].status === 'accepted').apns.payload.aps;
    ok(/is on the way$/.test(onWay['content-state'].title) && onWay['content-state'].plate === 'UBR 901D' && Number.isInteger(onWay['content-state'].etaMinutes), 'on the way: driver, plate and minutes until pickup');
    ok(onWay.event === 'update' && Number.isInteger(onWay.timestamp) && m(la, 'arrived').aps.alert && /has arrived/.test(m(la, 'arrived').aps.alert.title), 'updates are timestamped; arriving lights up the screen');
    const done = m(la, 'completed').aps;
    ok(done.event === 'end' && done['dismissal-date'] > done.timestamp && done['content-state'].title === 'You’ve arrived', 'the trip ends the activity with “You’ve arrived”, gone a few minutes later');
    ok(la.filter((x) => x.apns.payload.aps['content-state'].status === 'in_progress').length === 1, 'no repeated pushes for the same step');
  } catch (e) { console.error(e); failed++; }
  finally { app.kill(); mock.close(); if (failed) console.log(log.split('\n').slice(-20).join('\n')); }
  console.log(failed ? `${failed} Live Activity check(s) failed` : 'all Live Activity checks passed');
  process.exit(failed ? 1 : 0);
  function m(list, status) { return list.find((x) => x.apns.payload.aps['content-state'].status === status).apns.payload; }
})();
