// Browser checks for the states that matter in production:
// location denied → no guessed pickup → rider sets one → can get prices;
// Google shown as unavailable; Mobile Money/card disabled when payments are off;
// offline banner; keyboard focus stays inside dialogs.
// Needs a running server (BASE, default http://localhost:3000) and Playwright's Chromium.
//   BASE=http://localhost:3000 node test/ui.js            (payments demo on: local default)
//   BASE=http://localhost:3101 PAYMENTS_OFF=1 node test/ui.js   (server started with PAYMENTS_DEMO=false)
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const EXE = process.env.CHROME || ['/opt/google/chrome/chrome', '/opt/pw-browsers/chromium'].find((p) => { try { return require('fs').statSync(p).isFile(); } catch { return false; } });
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++; };
const api = async (path, body, token) => {
  const r = await fetch(BASE + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};

(async () => {
  const user = await api('/auth/register', { name: 'Ui Tester', phone: '070' + String(Date.now()).slice(-7), password: 'secret12', role: 'rider' });
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];

  // ---- 1. Location denied: rider must set a pickup, nothing is guessed
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: [] }); // geolocation NOT granted
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript((s) => {
    localStorage.setItem('flytte_rider', s); localStorage.setItem('flytte_onboarded', '1'); localStorage.setItem('flytte_loc_asked', '1'); localStorage.setItem('flytte_install_dismissed', '1');
    // Simulate "permission denied" the way phones report it.
    navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 1, message: 'denied' }), 50);
  }, JSON.stringify(user));
  await p.goto(BASE + '/');
  await p.waitForSelector('.loc-card', { timeout: 15000 });
  ok(/couldn’t find your location/i.test(await p.textContent('.loc-card')), 'location denied: home explains it instead of guessing');
  ok(await p.evaluate(() => !document.querySelector('.pick-set')), 'no pickup is set automatically');

  // "Set pickup" → "Set pickup on map" → Back: nothing unconfirmed sticks
  await p.click('#setPick'); await p.waitForSelector('#onMap'); await p.waitForTimeout(300);
  await p.click('#onMap'); await p.waitForSelector('#confirm'); await p.waitForTimeout(900);
  await p.click('#backBtn'); await p.waitForSelector('#whereBtn'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !document.querySelector('.pick-set') && !!document.querySelector('.loc-card')), 'backing out of the map pin does not set a pickup');

  // "Where to?" starts on the destination; a destination picked first is kept while we ask for the pickup
  await p.click('#whereBtn');
  await p.waitForSelector('#qDrop'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'qDrop'), '“Where to?” opens on the destination field');
  const destName = await p.locator('#res .lrow[data-i] .t').nth(2).textContent();
  await p.locator('#res .lrow[data-i]').nth(2).click();
  ok(/Now set your pickup point/.test(await p.textContent('#sErr')) && (await p.inputValue('#qDrop')) === destName, 'a destination picked without a pickup is kept, and the pickup is asked for next');
  ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'qPick'), 'focus moves to the pickup field');

  // Set the pickup → prices load for the kept destination
  await p.locator('#res .lrow[data-i]').nth(0).click();
  await p.waitForSelector('#request', { timeout: 20000 });
  ok(/Request|Schedule/.test(await p.textContent('#request')), 'after setting the pickup manually, fares load and Request is available');
  await p.screenshot({ path: (process.env.SHOTS || '/tmp') + '/ui-manual-pickup.png' });

  // Back home: the manual pickup is shown with a Change button
  await p.click('#backBtn'); await p.waitForSelector('#whereBtn');
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => !!document.querySelector('.pick-set')), 'going back keeps the pickup the rider set, with a Change button');

  // ---- 2. Dialog keyboard focus stays inside
  await p.evaluate(() => K.modal('<h2>Test dialog</h2><button id="a1">One</button><button id="a2">Two</button>'));
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  ok(await p.evaluate(() => !!document.activeElement.closest('[role=dialog]')), 'Tab key stays inside an open dialog');
  ok(await p.evaluate(() => !!document.querySelector('[role=dialog][aria-labelledby]')), 'dialogs are labelled by their heading');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => !document.querySelector('.overlay')), 'Escape closes the dialog');

  // ---- 3. Payments: options match what the server can actually take
  const cfg = await api('/config');
  await p.evaluate(() => document.querySelector('[data-tab="account"]').click());
  await p.waitForSelector('[data-a="pay"]'); await p.click('[data-a="pay"]');
  await p.waitForSelector('.pay-item'); await p.waitForTimeout(600);
  const offCount = await p.locator('.pay-item.off').count();
  if (cfg.paymentsAvailable) ok(offCount === 0, 'payments on: Mobile Money and card can be chosen');
  else ok(offCount === 3 && /coming soon/i.test(await p.locator('.page').last().textContent()), 'payments off: Mobile Money and card are shown as coming soon, not selectable');
  await p.screenshot({ path: (process.env.SHOTS || '/tmp') + '/ui-payments.png' });

  // ---- 4. Offline banner
  await c.setOffline(true); await p.waitForTimeout(400);
  ok(/offline/i.test(await p.evaluate(() => (document.getElementById('netBanner') || {}).textContent || '')), 'offline banner appears when the connection drops');
  await c.setOffline(false); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !document.getElementById('netBanner') || document.getElementById('netBanner').classList.contains('out')), 'banner goes away when back online');
  await c.close();

  // ---- 5. Sign-in: phone number first, no Google button
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await c2.newPage(); p2.on('pageerror', (e) => errors.push(e.message));
  await p2.addInitScript(() => { localStorage.setItem('flytte_onboarded', '1'); });
  await p2.goto(BASE + '/'); await p2.waitForSelector('.phone-first #ph', { timeout: 15000 });
  ok(!(await p2.$('[data-google]')) && !(await p2.$('.phone-first #pw')), 'sign-in starts with just the phone number (no Google, no password yet)');
  await p2.fill('#ph', '12345'); await p2.click('button[type=submit]');
  ok(/valid Ugandan mobile number/.test(await p2.textContent('.error')), 'phone step checks the number before sending');
  await p2.fill('#ph', user.user.phone.replace(/^\+?256/, '0')); await p2.click('button[type=submit]');
  await p2.waitForSelector('#pw', { timeout: 10000 });
  ok(/Welcome back/.test(await p2.textContent('h1')) && !!(await p2.$('.phone-chip')), 'a registered number goes to the password step');
  await p2.click('[data-chg]'); await p2.waitForSelector('.phone-first #ph');
  await p2.fill('#ph', '0759' + String(Date.now()).slice(-6)); await p2.click('button[type=submit]');
  await p2.waitForSelector('#nm', { timeout: 10000 });
  ok(/Create your account/.test(await p2.textContent('h1')) && !(await p2.$('#f #ph')), 'a new number goes straight to creating an account');
  await c2.close();

  // ---- 6. Second open is served from the phone; offline reopen still shows the app
  const c3 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  const p3 = await c3.newPage(); p3.on('pageerror', (e) => errors.push(e.message));
  await p3.addInitScript((s) => { localStorage.setItem('flytte_rider', s); localStorage.setItem('flytte_onboarded', '1'); localStorage.setItem('flytte_loc_asked', '1');
    navigator.geolocation.getCurrentPosition = (ok, fail) => setTimeout(() => fail({ code: 1 }), 50); }, JSON.stringify(user));
  await p3.goto(BASE + '/'); await p3.waitForSelector('#whereBtn', { timeout: 20000 });
  await p3.evaluate(() => navigator.serviceWorker.ready); await p3.waitForTimeout(800);
  await p3.reload(); await p3.waitForSelector('#whereBtn', { timeout: 20000 }); // first controlled load fills the cache
  const fromNet = [];
  p3.on('response', (r) => { if (/\/(js|css)\/.*\?v=/.test(r.url()) && !r.fromServiceWorker()) fromNet.push(r.url()); });
  const sw = [];
  p3.on('response', (r) => { if (/\/(js|css)\/.*\?v=/.test(r.url()) && r.fromServiceWorker()) sw.push(r.url()); });
  const t0 = Date.now(); await p3.reload(); await p3.waitForSelector('#whereBtn', { timeout: 20000 });
  ok(sw.length >= 3 && fromNet.length === 0, `reopen: app code comes from the phone (${sw.length} files, ${fromNet.length} from network)`);
  ok(Date.now() - t0 < 4000, `reopen with saved data shows Home in ${Date.now() - t0} ms`);
  await c3.setOffline(true);
  await p3.reload().catch(() => {}); await p3.waitForSelector('#whereBtn', { timeout: 20000 }).catch(() => {});
  ok(await p3.evaluate(() => !!document.querySelector('#whereBtn')), 'offline reopen still shows the app (with the offline banner)');
  await c3.close();

  ok(errors.length === 0, `no script errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await b.close();
  console.log(failed ? `\n${failed} UI CHECK(S) FAILED` : '\nALL UI CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
