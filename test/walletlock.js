// Wallet lock: fingerprint/face (WebAuthn passkey, using Chromium's virtual authenticator) and the
// code fallback. The server must refuse wallet payments from a locked wallet without proof.
const { chromium } = require('playwright-core');
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const EXE = process.env.CHROME || ['/opt/google/chrome/chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => { try { return require('fs').statSync(p).isFile(); } catch { return false; } });
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

(async () => {
  const admin = (await call('/auth/login', { phone: '0700000000', password: 'admin123' })).body;
  const pickup = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };
  const dPhone = '075' + rnd().slice(1);
  await call('/admin/drivers', { name: 'Lock Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFL 404L', licenseNo: 'DL404' }, admin.token);
  const driver = (await call('/auth/login', { phone: dPhone, password: 'secret1' })).body;
  const ds = io(BASE, { auth: { token: driver.token } });
  await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150);
  await ds.emitWithAck('driver:online', true); await sleep(200);
  ds.on('trip:offer', () => {});   // stay online; never accept

  const phone = '077' + rnd().slice(1);
  const rider = (await call('/auth/register', { name: 'Lock Rider', phone, password: 'secret12' })).body;
  const top = await call('/wallet/topup', { amount: 20000, method: 'momo' }, rider.token);
  if (top.status !== 200) { console.log('· wallet top-ups are off on this server; skipped'); ds.close(); process.exit(0); }

  // Not locked: wallet booking works as before.
  const t0 = await call('/trips', { service: 'boda', paymentMethod: 'wallet', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
  ok(t0.status === 200, 'an unlocked wallet pays without extra steps');
  await call(`/trips/${t0.body.id}/cancel`, {}, rider.token);
  const st0 = (await call('/wallet/lock', null, rider.token)).body;
  ok(st0.enabled === false && st0.devices.length === 0, 'the lock starts off');

  // ---- Browser: turn the lock on with the (virtual) fingerprint ----
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await c.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await p.addInitScript((s) => { localStorage.setItem('flytte_rider', s); localStorage.setItem('flytte_install_dismissed_rider', '1'); localStorage.setItem('flytte_opened', String(Date.now())); localStorage.setItem('flytte_alerts_asked', '1'); }, JSON.stringify(rider));
  await p.goto(BASE + '/'); await p.waitForSelector('#whereBtn', { timeout: 20000 }); await p.waitForTimeout(1200);
  await p.click('[data-tab="account"]'); await p.waitForTimeout(900);
  await p.click('[data-a="wallet"]'); await p.waitForSelector('#lockRow', { timeout: 8000 }); await p.waitForTimeout(800);
  await p.click('#lockRow'); await p.waitForTimeout(2500);
  const st1 = (await call('/wallet/lock', null, rider.token)).body;
  ok(st1.enabled === true && st1.devices.length === 1, 'the rider turns the lock on with their fingerprint');
  const creds = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  ok(creds.length === 1, 'a passkey was saved on the phone');
  await p.waitForSelector('#lockRow[aria-checked="true"]', { timeout: 5000 }).catch(() => {});
  ok(await p.$('#lockRow[aria-checked="true"]') !== null, 'the switch shows On');

  // ---- Server refuses wallet payments without proof ----
  const t1 = await call('/trips', { service: 'boda', paymentMethod: 'wallet', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
  ok(t1.status === 403 && t1.body.code === 'WALLET_LOCK', 'a locked wallet can’t be charged without the fingerprint or a code');
  const t1b = await call('/trips', { service: 'boda', paymentMethod: 'wallet', pickup, drop, distanceKm: 3.2, durationMin: 9, walletPass: 'forged' }, rider.token);
  ok(t1b.status === 403, 'a made-up pass is refused');
  const cash = await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
  ok(cash.status === 200, 'cash trips are not affected');
  await call(`/trips/${cash.body.id}/cancel`, {}, rider.token);
  const off0 = await call('/wallet/lock/off', {}, rider.token);
  ok(off0.status === 403, 'the lock can’t be turned off without proof');
  const add0 = await call('/wallet/lock/options', {}, rider.token);
  ok(add0.status === 403, 'another phone can’t be added without proof');

  // ---- Paying from the app: confirm sheet + fingerprint ----
  await p.evaluate(() => document.querySelector('.overlay [data-close], .overlay .modal') && document.querySelector('.overlay').click());
  const pass = await p.evaluate(async () => {
    const pr = K.walletLock.unlock({ amount: 2500 });
    await new Promise((r) => setTimeout(r, 900));
    document.querySelector('[data-bio]').click();
    return pr;
  });
  ok(typeof pass === 'string' && pass.length > 20, 'the fingerprint gives a payment pass');
  const t2 = await call('/trips', { service: 'boda', paymentMethod: 'wallet', pickup, drop, distanceKm: 3.2, durationMin: 9, walletPass: pass }, rider.token);
  ok(t2.status === 200, 'with it, the wallet trip goes through');
  await call(`/trips/${t2.body.id}/cancel`, {}, rider.token);
  // ---- Code fallback (new phone / no fingerprint) ----
  const sent = await call('/auth/otp/send', { phone: rider.user.phone, channel: 'sms' });
  if (sent.body && sent.body.demoCode) {
    const bad = await call('/wallet/unlock/code', { code: sent.body.demoCode === '000000' ? '111111' : '000000' }, rider.token);
    ok(bad.status === 400, 'a wrong code is refused');
    const good = await call('/wallet/unlock/code', { code: sent.body.demoCode }, rider.token);
    ok(good.status === 200 && good.body.pass, 'the right code gives a payment pass');
    const off = await call('/wallet/lock/off', { pass: good.body.pass }, rider.token);
    ok(off.status === 200, 'with proof, the lock can be turned off');
    const st2 = (await call('/wallet/lock', null, rider.token)).body;
    ok(st2.enabled === false && st2.devices.length === 0, 'turning off removes the saved fingerprint link');
    const t3 = await call('/trips', { service: 'boda', paymentMethod: 'wallet', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
    ok(t3.status === 200, 'and wallet payments work without it again');
    await call(`/trips/${t3.body.id}/cancel`, {}, rider.token);
  } else console.log('· SMS is live on this server; skipped the code checks');

  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close(); ds.close();
  console.log(failed ? `${failed} failed` : 'all wallet lock checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
