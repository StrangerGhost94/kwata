// Mobile Money through Relworx, against a simulated Relworx. Starts its own Flytte server (separate data
// folder) with RELWORX_* set, so nothing here touches the main test server.
//   - a top-up sends a PIN prompt (right account, phone, amount, reference) and stays pending;
//   - approved: credited once, however many times the status is checked or the webhook arrives;
//   - declined: nothing credited, the app is told; a fake webhook (Relworx says pending) credits nothing;
//   - a "success" for less than was asked credits nothing; cards are off; Flytte Pass by Mobile Money works.
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

// ---------- simulated Relworx ----------
const MOCK_PORT = 3402, APP_PORT = 3401, BASE = `http://localhost:${APP_PORT}`;
const reqs = [], tx = new Map();   // internal_reference -> { reference, msisdn, amount, status, payAmount }
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.headers.authorization !== 'Bearer test-key' || req.headers.accept !== 'application/vnd.relworx.v2') return send(401, { success: false, message: 'Unauthorized' });
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST' && u.pathname === '/api/mobile-money/request-payment') {
      const b = JSON.parse(body || '{}'); reqs.push(b);
      const id = require('crypto').randomBytes(16).toString('hex');
      tx.set(id, { ...b, status: 'pending' });
      return send(200, { success: true, message: 'Request payment in progress.', internal_reference: id });
    }
    if (req.method === 'GET' && u.pathname === '/api/mobile-money/check-request-status') {
      const t = tx.get(u.searchParams.get('internal_reference'));
      if (!t || u.searchParams.get('account_no') !== 'RELTEST123') return send(404, { success: false, message: 'Not found' });
      return send(200, { success: true, status: t.status, message: t.status === 'failed' ? 'Insufficient balance.' : 'ok', customer_reference: t.reference, internal_reference: u.searchParams.get('internal_reference'), msisdn: t.msisdn, amount: t.payAmount ?? t.amount, currency: 'UGX', provider: 'MTN_UGANDA', provider_transaction_id: 'MTN' + rnd() });
    }
    send(404, { success: false });
  });
});
const byRef = (ref) => [...tx.values()].find((t) => t.reference === ref);

async function call(p, body, token) {
  const r = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const statusOf = async (ref) => { await sleep(3100); return (await call('/payments/' + ref + '/status')).body; };

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flytte-relworx-'));
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(APP_PORT), RELWORX_API_KEY: 'test-key', RELWORX_ACCOUNT_NO: 'RELTEST123', RELWORX_URL: `http://localhost:${MOCK_PORT}`, RELWORX_POLL_MS: '2000', DATABASE_URL: '', PAYMENTS_DEMO: '', FLW_SECRET_KEY: '' },
  });
  let log = ''; app.stdout.on('data', (d) => { log += d; }); app.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 60 && !/running on/.test(log); i++) await sleep(250);
    const cfg = (await call('/config')).body;
    ok(cfg.paymentsAvailable && cfg.paymentsLive && !cfg.paymentsDemo && cfg.cardPayments === false, 'with Relworx set: Mobile Money on, not test mode, cards off');

    const phone = '0772' + rnd().slice(0, 6);
    const rider = (await call('/auth/register', { name: 'Momo Rider', phone, password: 'secret1' })).body;
    ok((await call('/wallet/topup', { amount: 5000, method: 'card' }, rider.token)).status === 503, 'a card top-up is refused while cards are off');

    // 1. Approved.
    let out = (await call('/wallet/topup', { amount: 5000, method: 'momo' }, rider.token)).body;
    const sent = reqs[reqs.length - 1];
    ok(out.pending && out.tx_ref && out.phone === '+256' + phone.slice(1), 'a top-up sends a PIN prompt and waits');
    ok(sent.account_no === 'RELTEST123' && sent.msisdn === out.phone && sent.amount === 5000 && sent.currency === 'UGX' && sent.reference === out.tx_ref, 'the prompt goes to the right account, number and amount');
    ok((await statusOf(out.tx_ref)).status === 'pending' && (await call('/wallet', null, rider.token)).body.balance === 0, 'nothing is credited while it’s pending');
    byRef(out.tx_ref).status = 'success';
    ok((await statusOf(out.tx_ref)).status === 'successful', 'once approved, the app sees it');
    ok((await call('/wallet', null, rider.token)).body.balance === 5000, 'and the wallet has UGX 5,000');
    await call('/payments/relworx/webhook', { status: 'success', customer_reference: out.tx_ref });
    await call('/payments/relworx/webhook', { status: 'success', customer_reference: out.tx_ref });
    await statusOf(out.tx_ref);
    ok((await call('/wallet', null, rider.token)).body.balance === 5000, 'a repeated webhook and status check never credit twice');

    // 2. Declined.
    out = (await call('/wallet/topup', { amount: 3000, method: 'momo' }, rider.token)).body;
    byRef(out.tx_ref).status = 'failed';
    const f = await statusOf(out.tx_ref);
    ok(f.status === 'failed' && f.message, 'a declined payment is reported as failed');
    ok((await call('/wallet', null, rider.token)).body.balance === 5000, 'and nothing is credited');

    // 3. A fake webhook: says success, but Relworx says it's still pending.
    out = (await call('/wallet/topup', { amount: 4000, method: 'momo' }, rider.token)).body;
    const w = await call('/payments/relworx/webhook', { status: 'success', customer_reference: out.tx_ref, amount: 4000, currency: 'UGX' });
    ok(w.status === 200 && (await call('/wallet', null, rider.token)).body.balance === 5000, 'a webhook alone credits nothing; Relworx is always asked');

    // 4. Approved for less than asked.
    byRef(out.tx_ref).status = 'success'; byRef(out.tx_ref).payAmount = 400;
    ok((await statusOf(out.tx_ref)).status === 'failed' && (await call('/wallet', null, rider.token)).body.balance === 5000, 'a payment for less than asked credits nothing');

    // 5. The background check confirms a payment even if nobody is waiting on it.
    out = (await call('/wallet/topup', { amount: 2000, method: 'momo' }, rider.token)).body;
    byRef(out.tx_ref).status = 'success';
    let bal = 0;
    for (let i = 0; i < 30 && bal !== 7000; i++) { await sleep(1000); bal = (await call('/wallet', null, rider.token)).body.balance; }
    ok(bal === 7000, 'a payment approved after the app was closed is still credited');

    // 6. Flytte Pass by Mobile Money.
    out = (await call('/me/pass/buy', { method: 'momo' }, rider.token)).body;
    ok(out.pending && byRef(out.tx_ref).amount === 15000, 'Flytte Pass sends a UGX 15,000 prompt');
    byRef(out.tx_ref).status = 'success';
    await statusOf(out.tx_ref);
    ok((await call('/me/pass', null, rider.token)).body.active === true, 'and the Pass starts once it’s approved');

    // 7. A non-Ugandan number can't pay by Mobile Money.
    const ke = (await call('/auth/register', { name: 'Kenya Rider', phone: '+254712' + rnd().slice(0, 6), password: 'secret1' })).body;
    const k = await call('/wallet/topup', { amount: 2000, method: 'momo' }, ke.token);
    ok(k.status === 503 && /Ugandan/.test(k.body.error), 'a non-Ugandan number is told it needs an MTN or Airtel number');
    ok((await call('/payments/FLY-TOP-1-deadbeef/status')).status === 404, 'an unknown payment reference is not found');

    // Choosing the network and number at payment time.
    let r = await call('/wallet/topup', { amount: 2000, method: 'momo', network: 'airtel', phone: '0772123456' }, rider.token);
    ok(r.status === 400 && /isn’t an Airtel number/.test(r.body.error), 'Airtel with an MTN number is refused with a clear message');
    r = await call('/wallet/topup', { amount: 2000, method: 'momo', network: 'mtn', phone: '0701234567' }, rider.token);
    ok(r.status === 400 && /isn’t an MTN number/.test(r.body.error), 'MTN with an Airtel number is refused');
    r = await call('/wallet/topup', { amount: 2000, method: 'momo', network: 'airtel', phone: '0752 111 222' }, rider.token);
    ok(r.status === 200 && r.body.pending && reqs[reqs.length - 1].msisdn === '+256752111222', 'the prompt goes to the number chosen for that payment');
    const me = (await call('/me', null, rider.token)).body.user;
    ok(me.payPhone === '+256752111222' && me.payPref === 'airtel', 'and that number is remembered for next time');
    const patch = (body) => fetch(BASE + '/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rider.token }, body: JSON.stringify(body) });
    ok((await patch({ payPhone: '0791234567' })).status === 400, 'a Mobile Money number that isn’t MTN or Airtel Uganda is refused');
    ok((await patch({ payPhone: '0701234567' })).status === 200, 'an Airtel number is accepted');
  } finally {
    app.kill(); mock.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (failed) console.log(log.split('\n').filter((l) => /error|Relworx/i.test(l)).slice(-10).join('\n'));
  console.log(failed ? `${failed} FAILED` : 'all Relworx Mobile Money checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
