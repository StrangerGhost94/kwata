// Android: Back closes what's on top (search, tab pages, dialogs, Choose a ride) instead of leaving the
// app, and asks before closing at the home screen. The app's own Inter font is used.
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const EXE = process.env.CHROME || ['/opt/google/chrome/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => { try { return require('fs').statSync(p).isFile(); } catch { return false; } });
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
(async () => {
  const user = await (await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Android Rider', phone: '070' + String(Date.now()).slice(-7), password: 'secret12' }) })).json();
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, userAgent: UA, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((s) => { localStorage.setItem('flytte_rider', s); localStorage.setItem('flytte_onboarded', '1'); localStorage.setItem('flytte_loc_asked', '1'); localStorage.setItem('flytte_install_dismissed', '1'); }, JSON.stringify(user));
  await p.goto(BASE + '/'); await p.waitForSelector('#whereBtn'); await p.waitForTimeout(1500);
  ok(await p.evaluate(() => document.documentElement.classList.contains('android')), 'Android phones are recognised');
  ok(await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Inter'); }), 'the app’s Inter font is loaded from Flytte itself');

  await p.click('#whereBtn'); await p.waitForSelector('#qDrop'); await p.waitForTimeout(500);
  await p.goBack(); await p.waitForTimeout(700);
  ok(await p.evaluate(() => !document.querySelector('#qDrop') && !!document.querySelector('#whereBtn') && location.pathname === '/'), 'Back closes search and stays in the app');

  await p.click('[data-tab="account"]'); await p.waitForSelector('.acct-head'); await p.waitForTimeout(500);
  await p.click('[data-a="rate"]'); await p.waitForSelector('.overlay .stars'); await p.waitForTimeout(400);
  await p.goBack(); await p.waitForTimeout(700);
  ok(await p.evaluate(() => !document.querySelector('.overlay .stars') && !!document.querySelector('.acct-head')), 'Back closes a dialog, the page under it stays');
  await p.goBack(); await p.waitForTimeout(700);
  ok(await p.evaluate(() => !document.querySelector('.acct-head') && !!document.querySelector('#whereBtn')), 'Back from Account returns to Home');

  await p.click('#whereBtn'); await p.waitForSelector('#qDrop'); await p.waitForTimeout(600);
  await p.locator('#res .lrow[data-i]').nth(2).click(); await p.waitForSelector('#request', { timeout: 20000 }); await p.waitForTimeout(800);
  await p.goBack(); await p.waitForTimeout(900);
  ok(await p.evaluate(() => !document.querySelector('#request') && !!document.querySelector('#whereBtn') && location.pathname === '/'), 'Back on Choose a ride goes back to Home');

  await p.goBack(); await p.waitForTimeout(500);
  ok(await p.evaluate(() => /Press back again/.test((document.getElementById('toast') || {}).textContent || '') && location.pathname === '/'), 'Back at Home asks before closing Flytte');
  // The close button still works and leaves history tidy: Back afterwards doesn't reopen anything.
  await p.click('[data-tab="account"]'); await p.waitForSelector('.acct-head'); await p.click('[data-tab="home"]'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !document.querySelector('.acct-head')), 'closing with the app’s own buttons keeps Back in step');
  ok(!errs.length, 'no script errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(failed ? `${failed} FAILED` : 'all Android checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
