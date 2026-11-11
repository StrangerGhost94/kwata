// Wallet security: every wallet payment needs the Wallet PIN (or the fingerprint/face set up on the
// phone: a WebAuthn passkey, tested with Chromium's virtual authenticator). Covers creating,
// entering, changing and resetting the PIN, the lock-out after wrong tries, and the app's sheets.
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

  const trip = (extra) => call('/trips', { service: 'boda', paymentMethod: 'wallet', pickup, drop, distanceKm: 3.2, durationMin: 9, ...extra }, rider.token);
  const lockState = async () => (await call('/wallet/lock', null, rider.token)).body;

  // ---- No PIN yet: the wallet can't be spent ----
  const t0 = await trip();
  ok(t0.status === 403 && t0.body.code === 'WALLET_SETUP', 'a wallet with no PIN can’t pay: the app is told to create one');
  ok((await lockState()).pinSet === false, 'the PIN starts unset');
  ok((await call('/wallet/unlock/pin', { pin: '4827' }, rider.token)).body.code === 'WALLET_SETUP', 'and there is nothing to unlock yet');

  // ---- Creating the PIN ----
  for (const weak of ['1234', '0000', '4321', '2580', '1994', '12', 'abcd']) {
    if ((await call('/wallet/pin', { pin: weak }, rider.token)).status !== 400) { ok(false, `weak or malformed PIN ${weak} should be refused`); }
  }
  ok(true, 'easy-to-guess and malformed PINs are refused (1234, 0000, 4321, 2580, a birth year, 12, abcd)');
  const made = await call('/wallet/pin', { pin: '4827' }, rider.token);
  ok(made.status === 200 && made.body.pass, 'a new account creates its Wallet PIN and gets a payment pass');
  ok((await lockState()).pinSet === true && (await call('/me', null, rider.token)).body.user.walletPin === true, 'the account now has a PIN');

  // ---- Every wallet payment needs proof ----
  const t1 = await trip();
  ok(t1.status === 403 && t1.body.code === 'WALLET_LOCK', 'without the PIN, the wallet can’t be charged');
  ok((await trip({ walletPass: 'forged' })).status === 403, 'a made-up pass is refused');
  const t2 = await trip({ walletPass: made.body.pass });
  ok(t2.status === 200, 'with the pass, the wallet trip goes through');
  await call(`/trips/${t2.body.id}/cancel`, {}, rider.token);
  const cash = await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup, drop, distanceKm: 3.2, durationMin: 9 }, rider.token);
  ok(cash.status === 200, 'cash trips are not affected');
  await call(`/trips/${cash.body.id}/cancel`, {}, rider.token);

  // ---- Entering the PIN ----
  const wrong = await call('/wallet/unlock/pin', { pin: '1111' }, rider.token);
  ok(wrong.status === 400 && wrong.body.code === 'PIN_WRONG' && /4 tries left/.test(wrong.body.error), 'a wrong PIN is refused and says how many tries are left');
  const right = await call('/wallet/unlock/pin', { pin: '4827' }, rider.token);
  ok(right.status === 200 && right.body.pass, 'the right PIN gives a payment pass');

  // ---- Changing the PIN, and turning fingerprint on, need proof ----
  ok((await call('/wallet/pin', { pin: '9153' }, rider.token)).body.code === 'NEED_CODE', 'the PIN can’t be changed without the current PIN or a code');
  ok((await call('/wallet/pin', { pin: '4827', pass: right.body.pass }, rider.token)).status === 400, 'the new PIN must differ from the current one');
  ok((await call('/wallet/pin', { pin: '9153', pass: right.body.pass }, rider.token)).status === 200, 'with proof, the PIN is changed');
  ok((await call('/wallet/unlock/pin', { pin: '4827' }, rider.token)).status === 400, 'the old PIN stops working');
  ok((await call('/wallet/lock/options', {}, rider.token)).status === 403, 'fingerprint can’t be set up without the PIN');
  ok((await call('/wallet/lock/off', {}, rider.token)).status === 403, 'or turned off without it');
  ok((await call('/wallet/unlock/code', { code: '123456' }, rider.token)).status === 404, 'a code alone no longer gives a payment pass');

  // ---- Browser: pay with the PIN, then turn on the (virtual) fingerprint ----
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const cdp = await c.newCDPSession(p);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await p.addInitScript((s) => { localStorage.setItem('flytte_rider', s); localStorage.setItem('flytte_install_dismissed_rider', '1'); localStorage.setItem('flytte_opened', String(Date.now())); localStorage.setItem('flytte_onboarded', '1'); localStorage.setItem('flytte_loc_asked', '1'); }, JSON.stringify(rider));
  await p.goto(BASE + '/'); await p.waitForSelector('#whereBtn', { timeout: 20000 }); await p.waitForTimeout(1200);

  const viaPin = p.evaluate(() => K.walletLock.unlock({ amount: 2500 }));
  await p.waitForSelector('#wp', { timeout: 8000 });
  ok(/Pay.*UGX 2,500/.test(await p.textContent('.unlock')), 'the confirm sheet shows the amount and asks for the Wallet PIN');
  await p.fill('#wp', '0000');
  await p.waitForFunction(() => /Wrong PIN/.test(document.querySelector('.unlock .error').textContent), null, { timeout: 5000 });
  ok(true, 'a wrong PIN shows “Wrong PIN” and clears the field');
  await p.waitForTimeout(400);
  await p.fill('#wp', '9153');
  const uiPass = await viaPin;
  ok(typeof uiPass === 'string' && uiPass.length > 20, 'the right PIN closes the sheet with a payment pass');

  await p.click('[data-tab="account"]'); await p.waitForTimeout(900);
  await p.click('[data-a="wallet"]'); await p.waitForSelector('#lockRow', { timeout: 8000 }); await p.waitForTimeout(900);
  ok(/Change/.test(await p.textContent('#pinRow')) && await p.$('#lockRow[aria-checked="false"]') !== null, 'the wallet shows the PIN as on (with Change) and fingerprint as off');
  await p.click('#lockRow');
  await p.waitForSelector('#wp', { timeout: 8000 }); await p.waitForTimeout(400);
  await p.fill('#wp', '9153');
  await p.waitForSelector('#lockRow[aria-checked="true"]', { timeout: 10000 }).catch(() => {});
  const st1 = await lockState();
  ok(st1.enabled === true && st1.devices.length === 1, 'turning fingerprint on asks for the PIN, then saves this phone');
  ok((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.length === 1, 'a passkey was saved on the phone');
  ok(await p.$('#lockRow[aria-checked="true"]') !== null, 'the switch shows On');

  await p.evaluate(() => { const o = document.querySelector('.overlay'); if (o) o.click(); });
  await p.waitForTimeout(500);
  const bioPass = await p.evaluate(async () => {
    const pr = K.walletLock.unlock({ amount: 2500 });
    for (let i = 0; i < 40 && !(document.querySelector('[data-bio]') && !document.querySelector('[data-bio]').classList.contains('hidden')); i++) await new Promise((r) => setTimeout(r, 150));
    document.querySelector('[data-bio]').click();
    return pr;
  });
  ok(typeof bioPass === 'string' && bioPass.length > 20, 'after that, the fingerprint alone gives a payment pass');
  const t3 = await trip({ walletPass: bioPass });
  ok(t3.status === 200, 'and the wallet trip goes through with it');
  await call(`/trips/${t3.body.id}/cancel`, {}, rider.token);

  // ---- Guessing is shut out ----
  let last;
  for (let i = 0; i < 5; i++) last = await call('/wallet/unlock/pin', { pin: '7777' }, rider.token);
  ok(last.status === 429 && last.body.code === 'PIN_LOCKED', 'five wrong PINs lock the wallet');
  ok((await call('/wallet/unlock/pin', { pin: '9153' }, rider.token)).status === 429, 'even the right PIN is refused while it’s locked');
  ok((await lockState()).lockedMinutes >= 14, 'for 15 minutes');

  // ---- Forgotten PIN: reset with the code sent to the phone ----
  const sent = await call('/auth/otp/send', { phone: rider.user.phone, channel: 'sms' });
  if (sent.body && sent.body.demoCode) {
    const badCode = await call('/wallet/pin', { pin: '6204', code: sent.body.demoCode === '000000' ? '111111' : '000000' }, rider.token);
    ok(badCode.status === 400, 'a wrong code doesn’t reset the PIN');
    const reset = await call('/wallet/pin', { pin: '6204', code: sent.body.demoCode }, rider.token);
    ok(reset.status === 200 && reset.body.pass, 'the code from the phone resets the PIN');
    const st2 = await lockState();
    ok(st2.lockedMinutes === 0 && st2.enabled === false && st2.devices.length === 0, 'the lock-out is lifted and fingerprint set-ups are cleared');
    ok((await call('/wallet/unlock/pin', { pin: '6204' }, rider.token)).status === 200, 'and the new PIN works');
  } else console.log('· SMS is live on this server; skipped the reset checks');

  // ---- A brand-new rider creates their PIN from the pay sheet ----
  const rider2 = (await call('/auth/register', { name: 'New Wallet', phone: '077' + rnd().slice(1), password: 'secret12' })).body;
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
  const p2 = await c2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
  await p2.addInitScript((s) => { localStorage.setItem('flytte_rider', s); localStorage.setItem('flytte_opened', String(Date.now())); localStorage.setItem('flytte_onboarded', '1'); localStorage.setItem('flytte_loc_asked', '1'); }, JSON.stringify(rider2));
  await p2.goto(BASE + '/'); await p2.waitForSelector('#whereBtn', { timeout: 20000 }); await p2.waitForTimeout(1000);
  const firstPass = p2.evaluate(() => K.walletLock.unlock({ amount: 4000 }));
  await p2.waitForSelector('#np', { timeout: 8000 });
  ok(/Create your Wallet PIN/.test(await p2.textContent('.unlock')), 'with no PIN yet, paying opens “Create your Wallet PIN”');
  await p2.fill('#np', '1234'); await p2.waitForTimeout(300); await p2.fill('#np', '1234');
  await p2.waitForFunction(() => /too easy/.test(document.querySelector('.unlock .error').textContent), null, { timeout: 5000 });
  ok(true, 'an easy PIN is turned down in the sheet');
  await p2.fill('#np', '5309'); await p2.waitForTimeout(300); await p2.fill('#np', '5390');
  await p2.waitForFunction(() => /didn’t match/.test(document.querySelector('.unlock .error').textContent), null, { timeout: 5000 });
  ok(true, 'two different entries are caught');
  await p2.fill('#np', '5309'); await p2.waitForTimeout(300); await p2.fill('#np', '5309');
  const fp = await firstPass;
  ok(typeof fp === 'string' && fp.length > 20 && (await call('/wallet/lock', null, rider2.token)).body.pinSet === true, 'entering it twice creates the PIN and pays in the same step');

  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close(); ds.close();
  console.log(failed ? `${failed} failed` : 'all wallet security checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
