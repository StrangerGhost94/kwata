// In-process checks for payment safety. Runs on a throwaway local database; no server needed.
//   node test/payments.js
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++; };

(async () => {
  // 1. A live server must refuse to start with the public development JWT secret.
  const run = (env) => { try { execFileSync(process.execPath, ['-e', "require('./src/auth')"], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, stdio: 'pipe' }); return 'started'; } catch (e) { return String(e.stderr); } };
  ok(/JWT_SECRET is not set/.test(run({ DATABASE_URL: 'postgres://example' })), 'live server without JWT_SECRET refuses to start');
  ok(run({ DATABASE_URL: 'postgres://example', JWT_SECRET: 'x'.repeat(40) }) === 'started', 'live server with a JWT_SECRET starts');

  // 2. Demo payments: on for local development, off on a live server, overridable.
  const mode = (env) => execFileSync(process.execPath, ['-e', "const p=require('./src/payments');process.stdout.write(JSON.stringify({d:p.demo(),a:p.available()}))"], { cwd: ROOT, env: { PATH: process.env.PATH, ...env } }).toString();
  ok(mode({}) === '{"d":true,"a":true}', 'local development: demo payments on');
  ok(mode({ DATABASE_URL: 'postgres://example', JWT_SECRET: 'x'.repeat(40) }) === '{"d":false,"a":false}', 'live server without Flutterwave keys: no fake payments');
  ok(mode({ DATABASE_URL: 'postgres://example', JWT_SECRET: 'x'.repeat(40), FLW_SECRET_KEY: 'FLWSECK_TEST-x' }) === '{"d":false,"a":true}', 'live server with Flutterwave keys: real payments only');

  // 3. Webhook signature check
  const hook = execFileSync(process.execPath, ['-e', `const p=require('./src/payments');
    const t=(h)=>p.webhookAuthentic({headers:{'verif-hash':h}});
    process.stdout.write([t('s3cret-hash'),t('s3cret-has'),t(''),t(undefined)].join(','))`], { cwd: ROOT, env: { PATH: process.env.PATH, FLW_WEBHOOK_HASH: 's3cret-hash' } }).toString();
  ok(hook === 'true,false,false,false', 'webhook accepts only the exact Flutterwave secret hash');
  const noHash = execFileSync(process.execPath, ['-e', "process.stdout.write(String(require('./src/payments').webhookAuthentic({headers:{'verif-hash':''}})))"], { cwd: ROOT, env: { PATH: process.env.PATH } }).toString();
  ok(noHash === 'false', 'with no hash configured, every webhook is refused');

  // 4. The same payment confirmed twice (redirect + webhook, at the same moment) credits once.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwata-pay-'));
  process.chdir(tmp);
  const db = require(path.join(ROOT, 'src/db'));
  await db.connect();
  const payments = require(path.join(ROOT, 'src/payments'));
  const u = await db.one("INSERT INTO users(name, phone, password_hash, role) VALUES ('Pay Test', '+256770000001', 'x', 'rider') RETURNING id");
  await db.query("INSERT INTO payments(tx_ref, user_id, purpose, amount) VALUES ('KWT-TOP-1-aaaaaaaa', $1, 'topup', 15000)", [u.id]);
  await Promise.all([payments._applyPayment('KWT-TOP-1-aaaaaaaa', 'flw-1'), payments._applyPayment('KWT-TOP-1-aaaaaaaa', 'flw-1'), payments._applyPayment('KWT-TOP-1-aaaaaaaa', 'flw-1')]);
  const after = await db.one('SELECT wallet_balance FROM users WHERE id = $1', [u.id]);
  const txs = await db.one("SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1 AND type = 'topup'", [u.id]);
  ok(after.wallet_balance === 15000 && txs.n === 1, `duplicate confirmations credit once (balance ${after.wallet_balance}, ${txs.n} transaction)`);
  const unknown = await payments.verifyAndApply('KWT-TOP-9-ffffffff');
  ok(unknown.ok === false, 'an unknown payment reference is never applied');
  try { await payments.createCheckout({ user: { id: u.id, phone: '+256770000001', name: 'Pay Test' }, amount: 0, purpose: 'topup', method: 'momo', baseUrl: 'http://x' }); ok(false, 'zero amount rejected'); }
  catch (e) { ok(e instanceof payments.PaymentsUnavailable, 'a zero-amount payment is rejected'); }

  console.log(failed ? `\n${failed} PAYMENT CHECK(S) FAILED` : '\nALL PAYMENT CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
