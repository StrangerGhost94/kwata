// Accessibility: axe-core (WCAG 2.1 A/AA and best practice) on the main rider and driver screens and
// the public pages, in light and dark appearance. Any violation fails. Starts its own server.
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 3431, BASE = `http://localhost:${PORT}`;
const EXE = process.env.CHROME || ['/opt/google/chrome/chrome', '/opt/pw-browsers/chromium'].find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
  || (() => { try { const d = '/opt/pw-browsers'; const c = fs.readdirSync(d).find((x) => /^chromium-\d+$/.test(x)); return c && ['chrome-linux64/chrome', 'chrome-linux/chrome'].map((x) => path.join(d, c, x)).find((x) => fs.existsSync(x)); } catch { return null; } })();
let failed = 0;
const call = async (p, b) => (await fetch(BASE + '/api' + p, { method: b ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })).json();
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { cwd: dir, env: { ...process.env, PORT: String(PORT), DATABASE_URL: '', REVIEW_CODE: '111222', REVIEW_RIDER_PHONE: '0700000401', REVIEW_DRIVER_PHONE: '0700000402' } });
  let log = ''; srv.stdout.on('data', (d) => { log += d; });
  for (let i = 0; i < 80 && !/Review mode on/.test(log); i++) await sleep(250);
  const sign = async (ph) => { await call('/auth/otp/send', { phone: ph }); return call('/auth/otp/verify', { phone: ph, code: '111222' }); };
  const rider = await sign('0700000401'), driver = await sign('0700000402');
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const scan = async (name, url, sess, app, after) => {
    for (const theme of ['light', 'dark']) {
      const c = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 0.3136, longitude: 32.5811 }, permissions: ['geolocation'] });
      await c.addInitScript(([s, app, theme]) => { localStorage.setItem('flytte_opened', String(Date.now())); localStorage.setItem('flytte_onboarded', '1'); localStorage.setItem('flytte_loc_asked', '1'); localStorage.setItem('flytte_theme', theme); localStorage.setItem('flytte_install_dismissed', '1'); localStorage.setItem('flytte_install_dismissed_' + app, '1'); if (s) localStorage.setItem('flytte_' + app, s); }, [sess ? JSON.stringify(sess) : null, app, theme]);
      const p = await c.newPage();
      await p.goto(BASE + url); await sleep(4500);
      if (after) { try { await after(p); } catch (e) { console.log('✗ could not open', name, e.message); failed++; } await sleep(1500); }
      await p.addScriptTag({ content: AXE });
      const r = await p.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'], rules: { region: { enabled: false } } })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, t: v.nodes.slice(0, 3).map((x) => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n').slice(1, 2).join('')) })));
      console.log(`${r.length ? '✗' : '✓'} ${name} (${theme})${r.length ? '' : ': no accessibility problems'}`);
      r.forEach((v) => { failed++; console.log(`    ${v.impact} ${v.id} (${v.n}): ${v.help}`); v.t.forEach((t) => console.log('      ', t.slice(0, 220))); });
      await c.close();
    }
  };
  await scan('rider sign-in', '/', null, 'rider');
  await scan('rider home', '/', rider, 'rider');
  await scan('rider choose', '/', rider, 'rider', async (p) => { await p.click('#whereBtn'); await sleep(800); await p.fill('#qDrop', 'Acacia'); await sleep(1500); await p.locator('#res .lrow[data-i]').first().click(); await p.waitForSelector('#request', { timeout: 15000 }); });
  await scan('rider account', '/', rider, 'rider', async (p) => { await p.click('[data-tab="account"]'); });
  await scan('driver home', '/driver', driver, 'driver');
  await scan('driver earnings', '/driver', driver, 'driver', async (p) => { await p.click('[data-tab="earnings"]'); });
  for (const u of ['/about', '/terms', '/privacy', '/support', '/delete-account']) await scan('page ' + u, u, null, 'rider');
  await b.close(); srv.kill();
  console.log(failed ? `${failed} accessibility problem(s)` : 'all accessibility checks passed');
  process.exit(failed ? 1 : 0);
})();
