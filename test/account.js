// Settings: delete my account, and the legal pages.
const BASE = process.env.BASE || 'http://localhost:3000';
const rnd = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
let failed = 0;
const assert = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

(async () => {
  // rider with no wallet balance
  const phone = '077' + rnd();
  const reg = await call('/auth/register', { name: 'Delete Me', phone, password: 'secret12', role: 'rider' });
  const tok = reg.body.token;
  await call('/me', { emergencyContact: '0772 000 111' }, tok, 'PATCH');
  const del = await call('/me/delete', {}, tok);
  assert(del.status === 200 && del.body.ok, 'a rider can delete their account');
  const me = await call('/me', null, tok);
  assert(me.status === 401, 'the old sign-in stops working straight away');
  const chk = await call('/auth/check', { phone });
  assert(chk.status === 200 && chk.body.exists === false, 'the phone number is free again');
  const again = await call('/auth/register', { name: 'Back Again', phone, password: 'secret12', role: 'rider' });
  assert(again.status === 200 && again.body.user.id !== reg.body.user.id, 'the same number can sign up again as a new account');

  // rider with wallet credit must confirm losing it
  const p2 = '078' + rnd();
  const r2 = await call('/auth/register', { name: 'Has Wallet', phone: p2, password: 'secret12', role: 'rider' });
  const top = await call('/wallet/topup', { amount: 5000, method: 'momo' }, r2.body.token);
  const bal = (await call('/me', null, r2.body.token)).body.user.walletBalance;
  if (top.status === 200 && bal > 0) {
    const d1 = await call('/me/delete', {}, r2.body.token);
    assert(d1.status === 409 && d1.body.code === 'WALLET' && /Wallet has UGX/.test(d1.body.error), 'a wallet balance must be confirmed before deleting');
    const d2 = await call('/me/delete', { forfeit: true }, r2.body.token);
    assert(d2.status === 200, 'deleting after confirming works');
  } else console.log('· wallet top-up not available here; skipped the wallet check');

  // admin no longer lists deleted riders
  const admin = (await call('/auth/login', { phone: '0700000000', password: 'admin123' })).body.token;
  const riders = (await call('/admin/riders', null, admin)).body;
  assert(!riders.some((u) => u.id === reg.body.user.id), 'deleted riders disappear from the admin list');

  // driver with a pending sign-up can delete; staff accounts can't use this
  const dp = '070' + rnd();
  const dr = await call('/auth/register', { name: 'Driver Leaving', phone: dp, password: 'secret12', role: 'driver', vehicleType: 'boda', plate: 'UAA 123B', licenseNo: 'DL9' });
  const dd = await call('/me/delete', {}, dr.body.token);
  assert(dd.status === 200, 'a driver with nothing owed can delete their account');
  const ad = await call('/me/delete', {}, admin);
  assert(ad.status === 403, 'the staff account can’t be deleted from the app');

  // legal pages
  for (const p of ['/terms', '/privacy']) {
    const r = await fetch(BASE + p); const t = await r.text();
    assert(r.status === 200 && /Flytte/.test(t) && /Last updated/.test(t), `${p} page is served`);
  }
  console.log(failed ? `${failed} ACCOUNT CHECK(S) FAILED` : 'ALL ACCOUNT CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
