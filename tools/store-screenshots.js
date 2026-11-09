// Store screenshots of both apps, taken from the real app with demo trips (review mode, src/review.js):
//   store/<app>/screenshots/play/NN-name.png        Google Play phone, 1080 × 1920
//   store/<app>/screenshots/app-store/NN-name.png   App Store iPhone 6.9", 1320 × 2868
// Starts its own local server on a throwaway database. Run: node tools/store-screenshots.js
// (needs Playwright's Chromium; the map needs internet access for its tiles).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const { chromiumPath } = require('./brand');

const ROOT = path.join(__dirname, '..');
const PORT = 3421, BASE = `http://localhost:${PORT}`;
const CODE = '864201', RIDER = '0700000301', DRIVER = '0700000302';
const SIZES = { play: { width: 360, height: 640 }, 'app-store': { width: 440, height: 956 } };   // × 3 device pixels
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(p, body, token) {
  const r = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function signIn(phone) { await call('/auth/otp/send', { phone }); return call('/auth/otp/verify', { phone, code: CODE }); }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-shots-'));
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', REVIEW_CODE: CODE, REVIEW_RIDER_PHONE: RIDER, REVIEW_DRIVER_PHONE: DRIVER, REVIEW_SPEED: '1', REVIEW_PLAIN_NAMES: '1' },
  });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80 && !/Review mode on/.test(log); i++) await sleep(250);
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  try {
    const rider = await signIn(RIDER), driver = await signIn(DRIVER);
    await call('/me', null, rider.token);
    for (const [kind, vp] of Object.entries(SIZES)) {
      const shot = async (p, app, n, name) => {
        const f = path.join(ROOT, 'store', app, 'screenshots', kind, `${String(n).padStart(2, '0')}-${name}.png`);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        await sleep(700);
        await p.screenshot({ path: f });
        console.log('wrote', path.relative(ROOT, f));
      };
      const context = async (app, session) => {
        const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 3, isMobile: true, hasTouch: true, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
        await c.addInitScript(([app, s]) => {
          localStorage.setItem('flytte_opened', String(Date.now())); localStorage.setItem('flytte_onboarded', '1'); localStorage.setItem('flytte_loc_asked', '1');
          localStorage.setItem('flytte_install_dismissed', '1'); localStorage.setItem('flytte_install_dismissed_' + app, '1');
          if (s) localStorage.setItem('flytte_' + app, s);
        }, [app, session ? JSON.stringify(session) : null]);
        return c.newPage();
      };

      // ---------- rider ----------
      let p = await context('rider', null);
      await p.goto(BASE + '/'); await p.waitForSelector('.auth2', { timeout: 20000 }); await sleep(3500);
      await shot(p, 'rider', 1, 'sign-in');
      await p.context().close();
      p = await context('rider', rider);
      await p.goto(BASE + '/'); await p.waitForSelector('#whereBtn', { timeout: 20000 }); await sleep(3500);
      await shot(p, 'rider', 2, 'home');
      await p.click('#whereBtn'); await p.waitForSelector('#qDrop'); await sleep(700);
      await p.fill('#qDrop', 'Acacia Mall'); await sleep(1800);
      await p.locator('#res .lrow[data-i]').first().click();
      await p.waitForSelector('#request', { timeout: 20000 }); await sleep(2500);
      await shot(p, 'rider', 3, 'choose-a-ride');
      await p.click('#request');
      await p.waitForFunction(() => /on the way|arriving|min away/i.test(document.body.innerText), null, { timeout: 30000 });
      await sleep(9000);
      await shot(p, 'rider', 4, 'driver-on-the-way');
      await p.waitForFunction(() => /arrived|is here/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
      await sleep(1500);
      await shot(p, 'rider', 5, 'driver-arrived');
      // Let the demo trip finish before the next round.
      for (let i = 0; i < 90; i++) {
        const a = await call('/trips/active', null, rider.token);
        if (!a) break;
        if (a.status === 'completed') { await call(`/trips/${a.id}/rate`, { stars: 5 }, rider.token); break; }
        await sleep(1000);
      }
      await p.context().close();

      // ---------- driver ----------
      p = await context('driver', null);
      await p.goto(BASE + '/driver'); await p.waitForSelector('.auth2', { timeout: 20000 }); await sleep(3500);
      await shot(p, 'driver', 1, 'sign-in');
      await p.context().close();
      p = await context('driver', driver);
      await p.goto(BASE + '/driver'); await p.waitForSelector('#on', { timeout: 20000 });
      await p.waitForFunction(() => !document.querySelector('#on[aria-disabled]'), null, { timeout: 15000 }); await sleep(2500);
      await p.click('#on'); await p.waitForSelector('#off'); await sleep(1500);
      await shot(p, 'driver', 2, 'online');
      await p.waitForSelector('#yes', { timeout: 30000 }); await sleep(800);
      await shot(p, 'driver', 3, 'ride-request');
      await p.click('#yes'); await sleep(5000);
      await shot(p, 'driver', 4, 'to-pickup');
      // Finish the demo trip, then show earnings.
      const t = await call('/trips/active', null, driver.token);
      if (t && t.id) {
        await call(`/trips/${t.id}/arrived`, {}, driver.token); await call(`/trips/${t.id}/start`, { pin: '1234' }, driver.token);
        await call(`/trips/${t.id}/complete`, {}, driver.token); await call(`/trips/${t.id}/rate`, { stars: 5 }, driver.token);
      }
      await p.goto(BASE + '/driver'); await p.waitForSelector('[data-tab="earnings"]', { timeout: 20000 }); await sleep(1500);
      await p.click('[data-tab="earnings"]'); await sleep(2500);
      await shot(p, 'driver', 5, 'earnings');
      await p.evaluate(() => document.querySelector('#off') && document.querySelector('#off').click());
      await p.context().close();
      await sleep(1000);
    }
  } catch (e) { console.error(e); process.exitCode = 1; console.log(log.split('\n').slice(-15).join('\n')); }
  finally { await browser.close(); server.kill(); }
})();
