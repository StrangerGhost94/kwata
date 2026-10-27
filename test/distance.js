// Far-away trips: each service has a longest trip. A pin dropped hundreds of km away isn't offered as a boda
// (or at all), and booking it is refused, with a message that says how far it is.
const BASE = process.env.BASE || 'http://localhost:3000';
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token) {
  const r = await fetch(BASE + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const kampala = { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' };
(async () => {
  const rider = (await call('/auth/register', { name: 'Far Rider', phone: '077' + rnd().slice(1), password: 'secret1' })).body;
  const town = await call('/fare/estimate', { pickup: kampala, drop: { lat: 0.3326, lng: 32.5686, address: 'Wandegeya' } }, rider.token);
  ok(town.status === 200 && town.body.options.some((o) => o.id === 'boda'), 'a trip across town offers a boda');

  const jinja = await call('/fare/estimate', { pickup: kampala, drop: { lat: 0.4244, lng: 33.2042, address: 'Jinja' } }, rider.token);
  ok(jinja.status === 200 && !jinja.body.options.some((o) => o.id === 'boda') && jinja.body.options.some((o) => o.id === 'car'), 'Kampala to Jinja (~80 km) offers cars, not a boda');
  const boda = await call('/trips', { service: 'boda', paymentMethod: 'cash', pickup: kampala, drop: { lat: 0.4244, lng: 33.2042, address: 'Jinja' } }, rider.token);
  ok(boda.status === 400 && /up to 45 km/.test(boda.body.error), `booking that boda is refused: “${boda.body.error}”`);

  const far = await call('/fare/estimate', { pickup: kampala, drop: { lat: -0.6072, lng: 30.6545, address: 'Pinned location' } }, rider.token);
  ok(far.status === 400 && /Check that the pin/.test(far.body.error), `a pin ~250 km away isn't priced: “${far.body.error}”`);
  console.log(failed ? `${failed} FAILED` : 'all distance checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
