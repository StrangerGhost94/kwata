// The store-app layer (public/js/native.js) in a browser with a stand-in for Capacitor's native
// plugins: push alerts through Firebase, background location while the driver is online (sent by
// native HTTP with the screen off), haptics, no install cards, and "Update to continue" for old versions.
// Starts its own server; signs in as the review driver (src/review.js).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

const PORT = 3413, BASE = `http://localhost:${PORT}`;
const EXE = process.env.CHROME || ['/opt/google/chrome/chrome', '/opt/pw-browsers/chromium'].find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
  || (() => { try { const d = '/opt/pw-browsers'; const c = fs.readdirSync(d).find((x) => /^chromium-\d+$/.test(x)); return c && ['chrome-linux64/chrome', 'chrome-linux/chrome'].map((x) => path.join(d, c, x)).find((x) => fs.existsSync(x)); } catch { return null; } })();
async function call(p, body, token) {
  const r = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

// A stand-in for Capacitor on an Android phone. Every plugin call is recorded in window.__cap.
function fakeCapacitor(version) {
  const calls = []; const rec = (name, args) => { calls.push([name, args]); };
  const listeners = {};
  let watchCb = null;
  const plugins = {
    App: { getInfo: async () => { rec('App.getInfo'); return { version, build: '7', id: 'co.flytte.driver', name: 'Flytte Driver' }; }, addListener: (e, cb) => { listeners['App.' + e] = cb; return Promise.resolve({ remove() {} }); } },
    Haptics: { impact: async (o) => rec('Haptics.impact', o), notification: async (o) => rec('Haptics.notification', o) },
    FirebaseMessaging: {
      checkPermissions: async () => ({ receive: window.__permGranted ? 'granted' : 'prompt' }),
      requestPermissions: async () => { rec('FM.requestPermissions'); window.__permGranted = true; return { receive: 'granted' }; },
      getToken: async () => { rec('FM.getToken'); return { token: 'fcm-test-token-' + 'x'.repeat(120) }; },
      deleteToken: async () => rec('FM.deleteToken'),
      createChannel: async (o) => rec('FM.createChannel', o.id),
      addListener: (e, cb) => { listeners['FM.' + e] = cb; return Promise.resolve({ remove() {} }); },
    },
    BackgroundGeolocation: {
      addWatcher: async (o, cb) => { rec('BG.addWatcher', o); watchCb = cb; return 'w1'; },
      removeWatcher: async (o) => { rec('BG.removeWatcher', o); watchCb = null; },
    },
    CapacitorHttp: { post: async (o) => { const r = await fetch(o.url, { method: 'POST', headers: o.headers, body: JSON.stringify(o.data) }); const data = await r.json(); rec('Http.post', { url: o.url, status: r.status, data }); return { status: r.status, data }; } },
  };
  window.__cap = { calls, listeners, fire: (loc) => watchCb && watchCb(loc) };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (n) => n in plugins, Plugins: plugins, registerPlugin: (n) => plugins[n] };
}

(async () => {
  if (!EXE) { console.log('- no Chromium found: skipped'); process.exit(0); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-native-'));
  // A made-up Firebase service account: enough for the server to accept store-app tokens (nothing is sent).
  const pem = require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const account = JSON.stringify({ project_id: 'flytte-test', client_email: 'push@flytte-test.iam.gserviceaccount.com', private_key: pem });
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', REVIEW_CODE: '135790', REVIEW_DRIVER_PHONE: '0700000202', MIN_APP_VERSION_DRIVER: '1.2.0', FIREBASE_SERVICE_ACCOUNT: account, FCM_TOKEN_URL: 'http://127.0.0.1:9/token' },
  });
  let log = ''; app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  const { chromium } = require('playwright-core');
  let b;
  try {
    for (let i = 0; i < 80 && !/Review mode on/.test(log); i++) await sleep(250);
    await call('/auth/otp/send', { phone: '0700000202' });
    const drv = (await call('/auth/otp/verify', { phone: '0700000202', code: '135790' })).body;
    ok(drv.user && drv.user.role === 'driver', 'signed in as an approved driver');
    b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

    async function open(version) {
      const c = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
      const p = await c.newPage();
      const errors = []; p.on('pageerror', (e) => errors.push(e.message));
      await p.addInitScript(fakeCapacitor, version);
      await p.addInitScript((s) => { localStorage.setItem('flytte_driver', s); localStorage.setItem('flytte_opened', String(Date.now())); }, JSON.stringify(drv));
      await p.goto(BASE + '/driver');
      return { c, p, errors };
    }

    // ---- an up-to-date app
    const { p, errors } = await open('1.4.0');
    await p.waitForSelector('#on', { timeout: 20000 });
    ok(await p.evaluate(() => document.documentElement.classList.contains('native-android') && K.native && K.platform === 'android'), 'the page knows it runs in the Android app');
    ok(await p.evaluate(() => K.standalone() && !document.querySelector('#installHost').children.length), 'no “install the app” card inside the app');
    ok(!(await p.$('.update-gate')), 'version 1.4.0 is allowed (minimum 1.2.0)');
    ok(await p.evaluate(() => __cap.calls.some(([n, a]) => n === 'FM.createChannel' && a === 'ride_requests')), 'the loud ride-request channel is created');

    await p.evaluate(() => K.push.enable());
    const calls = await p.evaluate(() => __cap.calls.map((c) => c[0]));
    ok(calls.includes('FM.requestPermissions') && calls.includes('FM.getToken'), 'turning on alerts asks for permission and gets the Firebase token');
    ok((await call('/driver/overview', null, drv.token)).body.push === true, 'the server has the phone for alerts');
    ok(await p.evaluate(() => K.push.permission() === 'granted' && K.push.current().then((x) => !!x)), 'the app reads alerts as on');

    await p.waitForFunction(() => !document.querySelector('#on[aria-disabled]'), null, { timeout: 15000 });
    await p.click('#on');
    await p.waitForSelector('#off', { timeout: 10000 });
    await sleep(300);
    const watch = await p.evaluate(() => (__cap.calls.find(([n]) => n === 'BG.addWatcher') || [])[1]);
    ok(watch && /online/i.test(watch.backgroundTitle) && watch.requestPermissions === true, 'going online starts background location with the “You’re online” notice');

    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); __cap.fire({ latitude: 0.3201, longitude: 32.5900, bearing: 90, accuracy: 8 }); });
    await p.waitForFunction(() => __cap.calls.some(([n]) => n === 'Http.post'), null, { timeout: 5000 });
    const post = await p.evaluate(() => __cap.calls.find(([n]) => n === 'Http.post')[1]);
    ok(post.url.endsWith('/api/driver/location') && post.status === 200 && post.data.ok === true, 'with the screen off, the position reaches the server by native HTTP');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });

    await p.evaluate(() => K.haptic());
    ok(await p.evaluate(() => __cap.calls.some(([n]) => n === 'Haptics.impact')), 'haptics use the phone’s engine');

    await p.click('#off');
    await sleep(400);
    ok(await p.evaluate(() => __cap.calls.some(([n]) => n === 'BG.removeWatcher')), 'going offline stops background location');
    ok(!errors.length, 'no script errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

    // ---- a version that's too old
    const old = await open('1.1.0');
    await old.p.waitForSelector('.update-gate', { timeout: 15000 });
    ok(/Update Flytte Driver to continue/.test(await old.p.textContent('.update-gate')), 'version 1.1.0 is asked to update');
    ok(/play\.google\.com\/store\/apps\/details\?id=co\.flytte\.driver/.test(await old.p.getAttribute('.update-gate a', 'href')), 'with a button to Flytte Driver on Google Play');
  } catch (e) { console.error(e); failed++; }
  finally { if (b) await b.close(); app.kill(); if (failed) console.log(log.split('\n').slice(-20).join('\n')); }
  console.log(failed ? `${failed} store-app check(s) failed` : 'all store-app checks passed');
  process.exit(failed ? 1 : 0);
})();
