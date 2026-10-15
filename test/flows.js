// API checks for booking rules, payments that aren't available, webhooks and tracking privacy.
// Run against a server: BASE=http://localhost:3000 node test/flows.js
// To test "payments off", start a second server with PAYMENTS_DEMO=false (and no FLW keys).
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed++; };
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const rnd = () => String(Date.now()).slice(-7) + Math.floor(Math.random() * 10);
const A = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, B = { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' };

(async () => {
  const cfg = (await call('/config')).body;
  ok(typeof cfg.paymentsAvailable === 'boolean', `config says whether payments are available (${cfg.paymentsAvailable ? 'on' : 'off'})`);
  ok(cfg.supportPhone === null || /\d{9}/.test(cfg.supportPhone.replace(/\D/g, '')), `support phone is real or unset (${cfg.supportPhone || 'unset'})`);
  ok(cfg.supportPhone === null || cfg.supportPhone.replace(/\D/g, '') !== '256700000000', 'the old placeholder support number is never shown');

  // ---- input validation
  const bad1 = await call('/auth/register', { name: 'X', phone: '0772', password: '1', role: 'rider' });
  ok(bad1.status === 400, `register rejects bad input: “${bad1.body.error}”`);
  const bad2 = await call('/auth/register', { name: 'Ok Name', phone: '07' + rnd().slice(0, 8), password: 'secret12', role: 'admin' });
  ok(bad2.status === 400, 'nobody can sign themselves up as an admin');
  const parse = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  ok(parse.status === 400, 'broken JSON gets a 400, not a server error');

  const rider = (await call('/auth/register', { name: 'Flow Rider', phone: '078' + rnd().slice(1), password: 'secret12', role: 'rider' })).body;
  ok(!!rider.token, 'rider can sign up');

  // ---- pickup is required, must be real and different from the destination
  const noPick = await call('/fare/estimate', { drop: B }, rider.token);
  ok(noPick.status === 400 && /pickup/i.test(noPick.body.error), `no pickup → “${noPick.body.error}”`);
  const same = await call('/fare/estimate', { pickup: A, drop: { ...A, address: 'same' } }, rider.token);
  ok(same.status === 400 && /same place/i.test(same.body.error), 'pickup and destination at the same place are rejected');
  const far = await call('/fare/estimate', { pickup: { lat: 51.5, lng: -0.12 }, drop: B }, rider.token);
  ok(far.status === 400, 'a pickup outside the service area is rejected');
  const noPickTrip = await call('/trips', { service: 'boda', drop: B }, rider.token);
  ok(noPickTrip.status === 400, 'a ride cannot be requested without a pickup');
  const nearbyBad = await call('/drivers/nearby?lat=abc&lng=1', null, rider.token);
  ok(nearbyBad.status === 400, 'nearby drivers needs a real location');

  // ---- fare quote
  const q = await call('/fare/estimate', { pickup: A, drop: B, distanceKm: 3.2, durationMin: 9 }, rider.token);
  ok(q.status === 200 && q.body.options.length > 0 && q.body.options.every((o) => o.fare > 0 && o.payable <= o.fare), `fare quote: ${q.body.options.map((o) => `${o.id} UGX ${o.fare}`).join(', ')}`);
  ok(q.body.options.every((o) => o.fare % 100 === 0), 'fares are rounded to whole UGX hundreds');

  // ---- payments
  const momo = await call('/trips', { service: 'boda', paymentMethod: 'momo', pickup: A, drop: B, quoteId: q.body.quoteId }, rider.token);
  if (cfg.paymentsAvailable) {
    ok(momo.status === 200, 'payments on: a Mobile Money trip can be booked');
    if (momo.status === 200) await call(`/trips/${momo.body.id}/cancel`, {}, rider.token);
  } else {
    ok(momo.status === 400 && /aren’t available/.test(momo.body.error), `payments off: Mobile Money booking refused: “${momo.body.error}”`);
    const top = await call('/wallet/topup', { amount: 5000, method: 'momo' }, rider.token);
    ok(top.status === 503, 'payments off: wallet top-up refused (no free money)');
    const me = (await call('/me', null, rider.token)).body;
    ok(me.user.walletBalance === 0, 'payments off: wallet balance unchanged');
  }
  const topLow = await call('/wallet/topup', { amount: 10, method: 'momo' }, rider.token);
  ok(topLow.status === 400, 'top-up amount is validated');

  // ---- booking, tracking privacy, cancellation
  const q2 = await call('/fare/estimate', { pickup: A, drop: B }, rider.token);
  const trip = await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup: A, drop: B, quoteId: q2.body.quoteId, notes: '<script>x</script> gate 2' }, rider.token);
  ok(trip.status === 200 && trip.body.status === 'requested', 'cash ride requested');
  ok(!/[<>]/.test(trip.body.notes || ''), 'notes are cleaned of markup');
  const twice = await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup: A, drop: B }, rider.token);
  ok(twice.status === 400, 'a rider cannot request two rides at once');

  const track = await call(`/track/${trip.body.shareToken}`);
  ok(track.status === 200 && track.body.fare === undefined && track.body.pin === undefined && !(track.body.rider || {}).phone, 'shared tracking link hides fare, PIN and phone numbers');
  ok((track.body.rider || {}).name === 'Flow', 'shared tracking shows only the first name');
  const trackBad = await call('/track/not-a-token');
  ok(trackBad.status === 404, 'unknown tracking link → 404');

  // live tracking over the socket uses the same public view
  const viewer = io(BASE, { transports: ['websocket'] });
  const joined = await new Promise((res) => viewer.emit('track:join', { token: trip.body.shareToken }, res));
  ok(joined.ok && joined.trip.pin === undefined, 'live tracking joins without exposing the PIN');
  viewer.close();

  const other = (await call('/auth/register', { name: 'Other Rider', phone: '079' + rnd().slice(1), password: 'secret12', role: 'rider' })).body;
  const steal = await call(`/trips/${trip.body.id}/cancel`, {}, other.token);
  ok(steal.status === 403, 'another rider cannot cancel your trip');
  const payOther = await call(`/trips/${trip.body.id}/pay`, {}, other.token);
  ok(payOther.status === 403, 'another rider cannot pay or open your trip');
  const cancel = await call(`/trips/${trip.body.id}/cancel`, { reason: 'Changed my mind' }, rider.token);
  ok(cancel.status === 200, 'rider can cancel a waiting ride');
  const again = await call(`/trips/${trip.body.id}/cancel`, {}, rider.token);
  ok(again.status === 400, 'a cancelled ride cannot be cancelled twice');
  const payCancelled = await call(`/trips/${trip.body.id}/pay`, {}, rider.token);
  ok(payCancelled.status === 400, 'nothing to pay on a cancelled ride');

  // ---- payment callbacks and webhooks
  const hook = await fetch(BASE + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'verif-hash': 'guess' }, body: JSON.stringify({ data: { tx_ref: 'KWT-TOP-1-deadbeef' } }) });
  ok(hook.status === 401, 'payment webhook with a wrong signature is refused');
  const cb = await fetch(BASE + '/api/payments/callback?tx_ref=../../etc', { redirect: 'manual' });
  ok(cb.status === 302 && /payment=failed/.test(cb.headers.get('location')), 'payment callback with a bogus reference reports failure');

  // ---- roles
  const adminTry = await call('/admin/stats', null, rider.token);
  ok(adminTry.status === 403, 'riders cannot open admin data');
  const noToken = await call('/trips/active');
  ok(noToken.status === 401, 'protected routes need sign-in');
  const forged = await call('/me', null, 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwicm9sZSI6ImFkbWluIn0.bad');
  ok(forged.status === 401, 'a forged token is rejected');

  // ---- security headers
  const page = await fetch(BASE + '/');
  ok(page.headers.get('x-frame-options') === 'DENY' && /geolocation=\(self\)/.test(page.headers.get('permissions-policy') || ''), 'pages send anti-framing and permissions headers');
  ok(/\?v=/.test(await page.text()), 'scripts are version-stamped per deploy');

  console.log(failed ? `\n${failed} FLOW CHECK(S) FAILED` : '\nALL FLOW CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
