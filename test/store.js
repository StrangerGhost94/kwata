// Store-app support on the server: app-link files, app settings in /api/config, error reports
// from phones, the support page, and deleting an account on flytte.co/delete-account without the app
// (driven in a real browser when Chromium is available). Starts its own server with the store variables.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

const PORT = 3412, BASE = `http://localhost:${PORT}`;
const CERT = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
async function call(p, body, token) {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, body: json, text, type: r.headers.get('content-type') || '' };
}
const EXE = process.env.CHROME || ['/opt/google/chrome/chrome', '/opt/pw-browsers/chromium'].find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
  || (() => { try { const d = '/opt/pw-browsers'; const c = fs.readdirSync(d).find((x) => /^chromium-\d+$/.test(x)); const f = c && ['chrome-linux64/chrome', 'chrome-linux/chrome'].map((x) => path.join(d, c, x)).find((x) => fs.existsSync(x)); return f; } catch { return null; } })();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-store-'));
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', APPLE_TEAM_ID: 'ABCDE12345', ANDROID_CERT_SHA256: CERT, MIN_APP_VERSION_DRIVER: '1.2.0', APPSTORE_ID_RIDER: '6400000001', SUPPORT_EMAIL: 'help@flytte.co',
      COMPANY_NAME: 'Flytte Technologies Ltd', COMPANY_REG_NO: '80020001234567', COMPANY_ADDRESS: 'Plot 12 Kampala Road | Kampala', COMPANY_TIN: '' },
  });
  let log = ''; app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 80 && !/running on/.test(log); i++) await sleep(250);

    // ---- app links
    const al = await call('/.well-known/assetlinks.json');
    ok(al.status === 200 && /json/.test(al.type) && al.body.length === 2, 'assetlinks.json lists both Android apps');
    ok(al.body.some((x) => x.target.package_name === 'co.flytte.rider') && al.body.every((x) => x.target.sha256_cert_fingerprints[0] === CERT), 'with the package names and signing certificate');
    const aasa = await call('/.well-known/apple-app-site-association');
    ok(aasa.status === 200 && /application\/json/.test(aasa.type), 'apple-app-site-association is served as JSON');
    const det = aasa.body.applinks.details;
    ok(det.find((d) => d.appIDs[0] === 'ABCDE12345.co.flytte.driver').components.some((c) => c['/'] === '/driver*'), 'driver links open Flytte Driver');
    ok(det.find((d) => d.appIDs[0] === 'ABCDE12345.co.flytte.rider').components.some((c) => c['/'] === '/t/*'), 'trip links open Flytte');
    ok(aasa.body.webcredentials.apps.length === 2, 'passkeys work in both iPhone apps');

    // ---- /api/config for the apps
    const cfg = (await call('/api/config')).body.apps;
    ok(cfg.minVersion.driver === '1.2.0' && cfg.minVersion.rider === null, 'minimum versions per app');
    ok(cfg.store.rider.ios === 'https://apps.apple.com/app/id6400000001' && cfg.store.driver.ios === null && /id=co\.flytte\.driver$/.test(cfg.store.driver.android), 'store links (App Store only once its id is set)');
    ok(cfg.supportEmail === 'help@flytte.co', 'support email');

    // ---- error reports from phones
    const ce = await call('/api/client-error', { message: 'TypeError: x is undefined', stack: 'at render (rider.js:10:5)', app: 'rider', platform: 'ios', version: '1.0.0 (3)', page: '/' });
    ok(ce.status === 204, 'an error report from a phone is accepted');
    await sleep(200);
    ok(/client error .*"platform":"ios".*TypeError: x is undefined/.test(log), 'and written to the server log with the app and platform');

    // ---- public pages
    const co = await call('/company');
    ok(co.status === 200 && /Flytte Technologies Ltd, trading as Flytte/.test(co.text) && /80020001234567/.test(co.text) && /Plot 12 Kampala Road<br>Kampala/.test(co.text), '/company shows the legal name, registration number and address that are set');
    ok(!/<script src=/.test(co.text) && /"legalName":"Flytte Technologies Ltd"/.test(co.text) && !/Tax identification/.test(co.text), 'as plain HTML with structured data, leaving out what isn’t set');
    for (const p of ['/support', '/delete-account']) { const r = await call(p); ok(r.status === 200 && /<h1>/.test(r.text), `${p} is public`); }
    ok(/flytte\.co\/delete-account/.test((await call('/privacy')).text), 'the privacy policy links to the deletion page');

    // ---- delete an account without the app
    if (!EXE) { console.log('- no Chromium found: skipped the browser part'); }
    else {
      const phone = '0772' + String(Date.now()).slice(-6);
      const rider = (await call('/api/auth/register', { name: 'Leaving Rider', phone, password: 'secret12', role: 'rider' })).body;
      ok(!!rider.token, 'a rider account to delete');
      const { chromium } = require('playwright-core');
      const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
      const p = await b.newPage({ viewport: { width: 390, height: 844 } });
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/delete-account');
      await p.fill('#phone', '0700 999 888');
      await p.click('#send');
      await p.waitForFunction(() => document.getElementById('msg').textContent.length > 0);
      ok(/No Flytte account/.test(await p.textContent('#msg')), 'an unknown number is told there is no account');
      await sleep(1100);
      await p.fill('#phone', phone);
      await p.click('#send');
      await p.waitForSelector('#s-code:not([hidden])');
      const code = (await p.textContent('#msg')).match(/\d{6}/)[0];
      await p.fill('#code', code);
      await p.waitForSelector('#s-confirm:not([hidden])');
      ok(/Leaving Rider/.test(await p.textContent('#who')), 'after the code, it names the account to delete');
      await p.click('#go');
      await p.waitForSelector('#s-done:not([hidden])');
      ok(true, 'the account is deleted');
      ok((await call('/api/me', null, rider.token)).status === 401, 'its old sign-in no longer works');
      ok((await call('/api/auth/otp/send', { phone })).body.exists === false, 'and the number is free again');
      ok(!errs.length, 'no script errors on the page');
      await b.close();
    }
  } catch (e) { console.error(e); failed++; }
  finally { app.kill(); if (failed) console.log(log.split('\n').slice(-25).join('\n')); }
  console.log(failed ? `${failed} store check(s) failed` : 'all store checks passed');
  process.exit(failed ? 1 : 0);
})();
