// Sign in with an SMS code. Run against a local server, where no EgoSMS keys are set and the
// code comes back in the response (demo mode) instead of by SMS.
const BASE = process.env.BASE || 'http://localhost:3000';
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token) {
  const r = await fetch(BASE + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
let failed = 0;
const assert = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };

(async () => {
  const cfg = (await call('/config')).body;
  assert(cfg.smsLogin === true, 'config says SMS sign-in is on (local demo mode)');
  assert(JSON.stringify(cfg.codeChannels) === '["whatsapp","sms"]', 'config offers WhatsApp and SMS for the code');

  // WhatsApp code: same code rules, sent on WhatsApp
  const wp = '078' + rnd().slice(0, 7);
  const ws = await call('/auth/otp/send', { phone: wp, channel: 'whatsapp' });
  assert(ws.status === 200 && ws.body.channel === 'whatsapp' && /^\d{6}$/.test(ws.body.demoCode), 'code sent on WhatsApp');
  const wv = await call('/auth/otp/verify', { phone: wp, code: ws.body.demoCode });
  assert(wv.status === 200 && wv.body.verified && wv.body.phoneToken, 'WhatsApp code confirms the number');

  // New number: code, then sign up without a password
  const phone = '077' + rnd().slice(0, 7);
  const s1 = await call('/auth/otp/send', { phone });
  assert(s1.status === 200 && /^\d{6}$/.test(s1.body.demoCode) && s1.body.exists === false, 'code sent to a new number');
  const again = await call('/auth/otp/send', { phone });
  assert(again.status === 429 && /Wait \d+ seconds/.test(again.body.error), 'a second code needs a 30-second wait');
  const wrong = s1.body.demoCode === '000000' ? '111111' : '000000';
  const w = await call('/auth/otp/verify', { phone, code: wrong });
  assert(w.status === 400 && /isn’t right/.test(w.body.error), 'a wrong code is refused');
  const v = await call('/auth/otp/verify', { phone, code: s1.body.demoCode });
  assert(v.status === 200 && v.body.verified && v.body.phoneToken && !v.body.token, 'right code on a new number gives a sign-up pass, not a login');
  const reuse = await call('/auth/otp/verify', { phone, code: s1.body.demoCode });
  assert(reuse.status === 400 && /expired/.test(reuse.body.error), 'a code works only once');
  const other = '077' + rnd().slice(0, 7);
  const steal = await call('/auth/register', { name: 'Someone Else', phone: other, phoneToken: v.body.phoneToken, role: 'rider' });
  assert(steal.status === 401, 'the sign-up pass only works for the number it was sent to');
  const reg = await call('/auth/register', { name: 'Grace Otp', phone, phoneToken: v.body.phoneToken, role: 'rider' });
  assert(reg.status === 200 && reg.body.token && reg.body.user.role === 'rider', 'new rider account created with no password');
  const pwLogin = await call('/auth/login', { phone, password: '' });
  assert(pwLogin.status === 401, 'that account cannot be opened with an empty password');

  // Existing number: code logs straight in
  const reg2 = await call('/auth/register', { name: 'Old Rider', phone: '078' + rnd().slice(0, 7), password: 'secret12', role: 'rider' });
  const p2 = reg2.body.user.phone;
  const s2 = await call('/auth/otp/send', { phone: p2 });
  assert(s2.body.exists === true && s2.body.role === 'rider', 'send tells the app the number already has a rider account');
  const v2 = await call('/auth/otp/verify', { phone: p2, code: s2.body.demoCode });
  assert(v2.status === 200 && v2.body.token && v2.body.user.id === reg2.body.user.id, 'right code on an existing number logs in');
  const me = await call('/me', null, v2.body.token);
  assert(me.status === 200 && me.body.user.phone === p2, 'the login token works');

  // Five wrong tries locks the code
  const p3 = '079' + rnd().slice(0, 7);
  const s3 = await call('/auth/otp/send', { phone: p3 });
  const bad = s3.body.demoCode === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await call('/auth/otp/verify', { phone: p3, code: bad });
  const locked = await call('/auth/otp/verify', { phone: p3, code: s3.body.demoCode });
  assert(locked.status === 400 && /Too many wrong tries/.test(locked.body.error), 'after five wrong tries even the right code is refused');

  // Other countries and Uganda landlines
  const ke = '+2547' + rnd();
  const sk = await call('/auth/otp/send', { phone: ke });
  assert(sk.status === 200 && sk.body.exists === false, 'a Kenyan number (+254) gets a code');
  const vk = await call('/auth/otp/verify', { phone: ke, code: sk.body.demoCode });
  const rk = await call('/auth/register', { name: 'Wanjiku K', phone: ke, phoneToken: vk.body.phoneToken, role: 'rider' });
  assert(rk.status === 200 && rk.body.user.phone === ke, 'Kenyan rider account stored as +254…');
  const ecK2 = await fetch(BASE + '/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + rk.body.token }, body: JSON.stringify({ emergencyContact: '0722 123 456' }) }).then((r) => r.json());
  assert(ecK2.user && ecK2.user.emergencyContact === '+254722123456', 'a local number typed by a Kenyan rider is read as Kenyan (+254)');
  const chk = async (phone) => (await call('/auth/check', { phone })).status;
  assert(await chk('+255712345678') === 200 && await chk('+255654123456') === 200, 'Tanzania numbers (+255 6x / 7x) accepted');
  assert(await chk('+250788123456') === 200 && await chk('+250722123456') === 200, 'Rwanda numbers (+250 78 / 72) accepted');
  assert(await chk('0200123456') === 200 && await chk('0414123456') === 200 && await chk('0393123456') === 200, 'Uganda landlines (0200, 0414, 0393) accepted');
  assert(await chk('+250612345678') === 400 && await chk('+254612345678') === 400, 'numbers that don’t exist in a country are refused');
  const old = await call('/auth/check', { phone: '0700000000' });
  assert(old.status === 200 && old.body.role === 'admin', 'existing Uganda numbers typed the old way still match their accounts');

  const badNum = await call('/auth/otp/send', { phone: '12345' });
  assert(badNum.status === 400, 'an invalid number gets no code');
  console.log(failed ? `${failed} OTP CHECK(S) FAILED` : 'ALL OTP CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
