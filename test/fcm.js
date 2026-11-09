// Native push (src/fcm.js) against a stand-in for Google's sign-in and Firebase servers:
// the service-account sign-in, the message sent to Android and to iPhone, ride requests on their
// own loud channel, and dead tokens removed. Runs in-process on a throwaway database.
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

(async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const seen = { token: [], sends: [] };
  const mock = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/token') {
        const assertion = new URLSearchParams(body).get('assertion');
        let claims = null; try { claims = jwt.verify(assertion, publicKey.export({ type: 'spki', format: 'pem' }), { algorithms: ['RS256'] }); } catch {}
        seen.token.push(claims);
        res.writeHead(claims ? 200 : 401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(claims ? { access_token: 'ya29.test', expires_in: 3600 } : { error: 'invalid_grant' }));
      }
      const m = JSON.parse(body).message;
      seen.sends.push({ url: req.url, auth: req.headers.authorization, m });
      if (m.token.startsWith('dead')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: 'projects/flytte-test/messages/1' }));
    });
  });
  await new Promise((r) => mock.listen(0, r));
  const base = `http://127.0.0.1:${mock.address().port}`;
  process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify({ project_id: 'flytte-test', client_email: 'push@flytte-test.iam.gserviceaccount.com', private_key: pem })).toString('base64');
  process.env.FCM_TOKEN_URL = base + '/token';
  process.env.FCM_API_BASE = base;
  process.env.DATABASE_URL = '';
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-fcm-')));
  const db = require('../src/db');
  await db.connect();
  const fcm = require('../src/fcm');
  const dtools = require('../src/drivers');
  try {
    const u = await db.one("INSERT INTO users(name, phone, password_hash, role) VALUES ('Push Driver', '+256700000555', 'x', 'driver') RETURNING id");
    ok(fcm.configured(), 'a base64 service account is accepted');
    ok(!(await fcm.register(u.id, 'short', 'ios', 'driver')), 'a junk token is refused');
    ok(await fcm.register(u.id, 'android-token-' + 'a'.repeat(140), 'android', 'driver'), 'an Android token is saved');
    ok(await fcm.register(u.id, 'ios-token-' + 'b'.repeat(140), 'ios', 'driver'), 'an iPhone token is saved');
    ok(await fcm.register(u.id, 'dead-token-' + 'c'.repeat(140), 'android', 'driver'), 'a third (soon dead) token is saved');
    ok(await dtools.hasPush(u.id), 'the driver counts as reachable by alerts');

    const sent = await dtools.push(u.id, { type: 'offer', tripId: 42, tag: 'offer-42', title: 'New ride request · UGX 6,500', body: '1.2 km away' }, { ttl: 40 });
    ok(sent === 2, `ride request delivered to the two live devices (sent ${sent})`);
    const claims = seen.token[0];
    ok(claims && claims.iss === 'push@flytte-test.iam.gserviceaccount.com' && /firebase\.messaging/.test(claims.scope), 'signed in to Google with the service account (RS256)');
    ok(seen.sends.every((s) => s.url === '/v1/projects/flytte-test/messages:send' && s.auth === 'Bearer ya29.test'), 'sends to the project’s FCM v1 endpoint with the access token');
    const android = seen.sends.find((s) => s.m.token.startsWith('android')).m, ios = seen.sends.find((s) => s.m.token.startsWith('ios')).m;
    ok(android.android.priority === 'HIGH' && android.android.notification.channel_id === 'ride_requests' && android.android.ttl === '40s', 'Android: high priority, ride-request channel, 40 s lifetime');
    ok(ios.apns.headers['apns-priority'] === '10' && ios.apns.payload.aps['interruption-level'] === 'time-sensitive', 'iPhone: immediate and time-sensitive');
    ok(android.data.tripId === '42' && android.data.type === 'offer' && android.notification.title.startsWith('New ride request'), 'trip id, type and text are in the message');
    ok(!(await db.one("SELECT 1 AS x FROM native_push_tokens WHERE token LIKE 'dead%'")), 'a token Firebase no longer knows is removed');

    seen.sends.length = 0;
    await dtools.push(u.id, { type: 'arrived', tag: 'trip-7', title: 'Moses has arrived', body: 'Meet your driver' }, { ttl: 600, urgency: 'normal' });
    const a2 = seen.sends.find((s) => s.m.android).m;
    ok(a2.android.notification.channel_id === 'trip_updates' && a2.android.priority === 'NORMAL', 'trip updates use the normal channel');
    ok(seen.token.length === 1, 'the access token is reused, not fetched again');

    await fcm.remove(u.id);
    ok(!(await fcm.has(u.id)), 'turning alerts off removes the store-app tokens');
  } catch (e) { console.error(e); failed++; }
  mock.close();
  console.log(failed ? `${failed} native push check(s) failed` : 'all native push checks passed');
  process.exit(failed ? 1 : 0);
})();
