// Staying signed in: long sliding sessions, a cookie copy that brings the sign-in back if the phone
// clears the app's data, sign-out only on a real session problem, and logging out sticks.
const { chromium } = require('playwright-core');
const jwt = require('jsonwebtoken');
const BASE = process.env.BASE || 'http://localhost:3000';
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const EXE = process.env.CHROME || ['/opt/google/chrome/chrome', '/opt/pw-browsers/chromium'].find((p) => { try { return require('fs').statSync(p).isFile(); } catch { return false; } });
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, { token, cookie, method } = {}) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
}
const cookieOf = (h) => (h.getSetCookie ? h.getSetCookie() : [h.get('set-cookie')]).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

(async () => {
  const phone = '077' + rnd().slice(1);
  const reg = await call('/auth/register', { name: 'Stay Rider', phone, password: 'secret12' });
  const ck = cookieOf(reg.headers);
  ok(reg.status === 200 && /^fs_rider=/.test(ck), 'signing in also saves a secure cookie copy of the session');
  const exp = jwt.decode(reg.body.token).exp - Math.floor(Date.now() / 1000);
  ok(exp > 170 * 86400, 'a session lasts months, not weeks');

  const res1 = await call('/auth/resume', { app: 'rider' }, { cookie: ck });
  ok(res1.body.session && res1.body.session.user.phone === reg.body.user.phone, 'the app can sign back in from the cookie if its saved data is cleared');
  ok((await call('/auth/resume', { app: 'rider' })).body.session === null, 'no cookie, no session');
  ok((await call('/auth/resume', { app: 'driver' }, { cookie: ck.replace('fs_rider', 'fs_driver') })).body.session === null, 'a rider’s session can’t open the driver app');

  // Sliding renewal
  const old = jwt.sign({ id: reg.body.user.id, role: 'rider', iat: Math.floor(Date.now() / 1000) - 3 * 86400 }, SECRET, { expiresIn: '180d' });
  const me = await call('/me', null, { token: old });
  const fresh = me.headers.get('x-session-token');
  ok(me.status === 200 && fresh && jwt.decode(fresh).iat > jwt.decode(old).iat, 'using the app renews an older session automatically');

  // Only a real session problem signs out
  const badTok = await call('/me', null, { token: 'nonsense' });
  ok(badTok.status === 401 && badTok.body.code === 'SESSION', 'a broken session is reported as such');
  const wrongPw = await call('/auth/login', { phone, password: 'wrong-one' }, { token: reg.body.token });
  ok(wrongPw.status === 401 && wrongPw.body.code !== 'SESSION', 'a wrong password or code is not treated as a session problem');

  // Logout clears the cookie
  const lo = await call('/auth/logout', { app: 'rider' }, { cookie: ck });
  ok(/fs_rider=;/.test((lo.headers.getSetCookie ? lo.headers.getSetCookie() : [lo.headers.get('set-cookie')]).join(';')), 'logging out removes the cookie copy');

  // ---- In the browser ----
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('flytte_install_dismissed_rider', '1'); localStorage.setItem('flytte_opened', String(Date.now())); localStorage.setItem('flytte_alerts_asked', '1'); localStorage.setItem('flytte_onboarded', '1'); });
  await p.goto(BASE + '/');
  // sign in through the page so the browser gets the cookie
  await p.evaluate(async (a) => { const r = await K.api('/auth/login', a); K.session.set(r); }, { phone, password: 'secret12' });
  await p.reload(); await p.waitForSelector('#whereBtn', { timeout: 20000 });
  ok(true, 'signed in');
  // The phone clears the app's saved data (what iOS does to web apps)
  await p.evaluate(() => { localStorage.removeItem('flytte_rider'); localStorage.removeItem('flytte_rider_cache'); });
  await p.reload();
  const back = await p.waitForSelector('#whereBtn', { timeout: 20000 }).then(() => true).catch(() => false);
  ok(back, 'after the app’s data is cleared, it opens still signed in');
  // A wrong code inside the app doesn't sign out
  await p.evaluate(() => K.api('/me/email/verify', { code: '000000' }).catch(() => {}));
  await p.waitForTimeout(1200);
  ok(await p.$('#whereBtn') !== null && await p.evaluate(() => !!K.token()), 'a wrong code inside the app keeps you signed in');
  // Logging out sticks
  await p.evaluate(() => K.logout());
  await p.waitForSelector('.phone-first, #ph, input[type=tel]', { timeout: 20000 });
  await p.reload(); await p.waitForTimeout(2500);
  ok(await p.$('#whereBtn') === null && await p.evaluate(() => !K.token()), 'after logging out, it stays logged out');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await b.close();
  console.log(failed ? `${failed} failed` : 'all session checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
