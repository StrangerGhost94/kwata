// School runs: a plan books the rides ahead at the normal price, only drivers vetted for children get
// them, the school gives the handover code, and the first driver becomes the usual driver, offered first.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function api(path, body, token, method) { const r = await call(path, body, token, method); if (r.status >= 400) throw new Error(path + ': ' + r.body.error); return r.body; }
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const home = { lat: 0.3536, lng: 32.6142, address: 'Ntinda, home' }, school = { lat: 0.3330, lng: 32.5900, address: 'Kitante Primary School' };
const hhmm = (ms) => new Date(Date.now() + ms + 3 * 3600e3).toISOString().slice(11, 16);   // Kampala clock

(async () => {
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const parent = await api('/auth/register', { name: 'School Parent', phone: '077' + rnd().slice(1), password: 'secret1' });
  ok((await call('/school/plans', { child: 'Amani', home, school, days: [], morning: '07:00' }, parent.token)).status === 400, 'a plan needs school days');

  // Two car drivers right at home: only one is vetted for children.
  const mk = async (name, plate) => {
    const phone = '075' + rnd().slice(1);
    const d = await api('/admin/drivers', { name, phone, password: 'secret1', vehicleType: 'car', plate, licenseNo: 'DL9', vehicleMake: 'Toyota', vehicleColor: 'Silver' }, admin.token);
    const s = await api('/auth/login', { phone, password: 'secret1' });
    return { ...s, id: s.user.id };
  };
  const plain = await mk('Plain Driver', 'UBP 111P'), vetted = await mk('Vetted Driver', 'UBV 222V');
  await api(`/admin/drivers/${vetted.id}/school`, { school: true }, admin.token);
  const offers = { plain: [], vetted: [] };
  const online = async (d, key) => {
    const s = io(BASE, { auth: { token: d.token } }); await new Promise((r) => s.on('connect', r));
    s.emit('driver:location', { lat: 0.3540, lng: 32.6140 }); await sleep(150); await s.emitWithAck('driver:online', true);
    s.on('trip:offer', (o) => { offers[key].push(o.id); s.emit('trip:respond', { tripId: o.id, accept: key === 'vetted' }); });
    return s;
  };
  const s1 = await online(plain, 'plain'), s2 = await online(vetted, 'vetted');

  // Today's day and a time 40 minutes from now, so the morning run is booked straight away.
  const dow = ((new Date(Date.now() + 3 * 3600e3).getUTCDay() + 6) % 7) + 1;
  const p = await api('/school/plans', { child: 'Amani', home, school, days: [dow], morning: hhmm(40 * 60e3), contactName: 'Teacher Grace', contactPhone: '0772' + rnd().slice(0, 6), payment: 'cash' }, parent.token);
  ok(p.id && /^\d{4}$/.test(p.handoverCode) && p.driver === null, 'the plan is set up with a handover code for the school');
  ok(p.next.length === 1 && p.next[0].leg === 'morning', 'the next ride is booked ahead');
  const up = await api('/trips/upcoming', null, parent.token);
  const row = up.find((t) => t.id === p.next[0].id);
  ok(row && row.service === 'car' && row.status === 'scheduled', 'it shows in the parent’s upcoming rides');

  // Start it now and see who gets it.
  await api(`/admin/trips/${p.next[0].id}/search-now`, {}, admin.token);
  let t = null;
  for (let i = 0; i < 40; i++) { t = await api('/trips/active', null, parent.token); if (t && t.status === 'accepted') break; await sleep(150); }
  ok(t && t.status === 'accepted' && t.driver.id === vetted.id, 'only the vetted driver is offered the school run');
  ok(!offers.plain.includes(p.next[0].id), 'the driver who isn’t vetted never sees it');
  ok(t.passenger && t.passenger.name === 'Amani' && t.school && t.school.leg === 'morning', 'the trip is for the child, marked as a school run');
  ok(t.dropCode === p.handoverCode, 'the drop-off code is the school’s handover code');

  const dv = await api('/trips/active', null, vetted.token);
  ok(dv.school && dv.needsDropCode, 'the driver is told it’s a school run and needs the handover code');
  await api(`/trips/${t.id}/arrived`, {}, vetted.token);
  await api(`/trips/${t.id}/start`, { pin: t.pin }, vetted.token);
  ok((await call(`/trips/${t.id}/complete`, { code: '0000' === p.handoverCode ? '1111' : '0000' }, vetted.token)).status === 400, 'the child can’t be dropped without the school’s code');
  await api(`/trips/${t.id}/complete`, { code: p.handoverCode }, vetted.token);
  await sleep(300);
  const plans = await api('/school/plans', null, parent.token);
  ok(plans[0].driver && plans[0].driver.id === vetted.id, 'that driver becomes the usual driver');

  // Pause: future rides are cancelled. Resume books them again.
  let q = await api(`/school/plans/${p.id}`, { active: false }, parent.token, 'PATCH');
  ok(!q.active && q.next.length === 0, 'pausing cancels the booked rides');
  q = await api(`/school/plans/${p.id}`, { newDriver: true }, parent.token, 'PATCH');
  ok(q.driver === null, 'the parent can ask for a different driver');

  s1.close(); s2.close();
  console.log(failed ? `${failed} FAILED` : 'all school run checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
