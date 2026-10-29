// Account page: profile edits, phone change by code, own saved places, ride preferences, night-time
// sharing, signed-in devices, monthly summary, reports and app ratings.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
async function call(path, body, token, method) {
  const r = await fetch(BASE + '/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function api(path, body, token, method) { const r = await call(path, body, token, method); if (r.status >= 400) throw new Error(path + ': ' + r.body.error); return r.body; }
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

(async () => {
  const phone = '077' + rnd().slice(1);
  const reg = await api('/auth/register', { name: 'Grace Nalubega', phone, password: 'secret1' });
  let tok = reg.token;

  // Profile
  let u = (await api('/me', { name: 'Grace N. Nalubega', photo: jpeg }, tok, 'PATCH')).user;
  ok(u.name === 'Grace N. Nalubega' && u.photo === jpeg && u.memberSince, 'name and photo can be changed; member-since is shared');
  ok((await call('/me', { photo: 'data:text/html;base64,PHNjcmlwdD4=' }, tok, 'PATCH')).status === 400, 'only images are accepted as a photo');

  // Phone change: code to the new number, then confirm.
  const newPhone = '0701' + rnd().slice(2);
  const sent = await api('/auth/otp/send', { phone: newPhone, channel: 'sms' });
  ok((await call('/me/phone', { phone: newPhone, code: '000000' === sent.demoCode ? '111111' : '000000' }, tok)).status === 400, 'a wrong code doesn’t change the number');
  ok((await call('/me/phone', { phone: newPhone, code: sent.demoCode }, tok)).status === 200, 'the right code changes the number');
  ok((await api('/auth/login', { phone: newPhone, password: 'secret1' })).user.id === reg.user.id, 'and the rider signs in with the new number');
  const other = await api('/auth/register', { name: 'Other', phone: '078' + rnd().slice(1), password: 'secret1' });
  ok((await call('/me/phone', { phone: other.user.phone, code: '123456' }, tok)).status === 400, 'a number that already has an account is refused');

  // Saved places of your own
  u = (await api('/me', { savedPlaces: { cmum: { lat: 0.3536, lng: 32.6142, address: 'Ntinda', label: 'Mum’s place' } } }, tok, 'PATCH')).user;
  ok(u.savedPlaces.cmum && u.savedPlaces.cmum.label === 'Mum’s place', 'a place with its own name is saved');
  ok((await call('/me', { savedPlaces: { cx: { lat: 0.35, lng: 32.61, address: 'X', label: '' } } }, tok, 'PATCH')).status === 400, 'it needs a name');
  const many = {}; for (let i = 0; i < 10; i++) many['cp' + i] = { lat: 0.33, lng: 32.58 + i / 1000, address: 'Spot ' + i, label: 'Spot ' + i };
  ok((await call('/me', { savedPlaces: many }, tok, 'PATCH')).status === 400, 'no more than 10 of your own places');

  // Ride preferences and night-time sharing
  u = (await api('/me', { ridePrefs: { service: 'car', womanDriver: true, note: 'Call me when you arrive' } }, tok, 'PATCH')).user;
  ok(u.ridePrefs.service === 'car' && u.ridePrefs.womanDriver === true && u.ridePrefs.note === 'Call me when you arrive', 'ride preferences are saved');
  ok((await call('/me', { nightShare: { on: true, from: '21:00' } }, tok, 'PATCH')).status === 400, 'night sharing needs an emergency contact first');
  u = (await api('/me', { emergencyContact: '0772' + rnd().slice(2), nightShare: { on: true, from: '00:00' } }, tok, 'PATCH')).user;
  ok(u.nightShare.on === true && u.nightShare.from === '00:00', 'night sharing is on (from midnight for this test)');

  // A trip that starts "at night" sends the link once.
  const admin = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const dPhone = '075' + rnd().slice(1);
  await api('/admin/drivers', { name: 'Night Driver', phone: dPhone, password: 'secret1', vehicleType: 'boda', plate: 'UFN 909N', licenseNo: 'DL9', vehicleMake: 'Bajaj', vehicleColor: 'Black' }, admin.token);
  const driver = await api('/auth/login', { phone: dPhone, password: 'secret1' });
  const ds = io(BASE, { auth: { token: driver.token } }); await new Promise((r) => ds.on('connect', r));
  ds.emit('driver:location', { lat: 0.3150, lng: 32.5800 }); await sleep(150); await ds.emitWithAck('driver:online', true);
  let want = null; ds.on('trip:offer', (o) => ds.emit('trip:respond', { tripId: o.id, accept: o.id === want }));
  tok = (await api('/auth/login', { phone: newPhone, password: 'secret1' })).token;
  const t = await api('/trips', { service: 'boda', paymentMethod: 'cash', pickup: { lat: 0.3136, lng: 32.5811, address: 'Kampala Road' }, drop: { lat: 0.3366, lng: 32.5877, address: 'Acacia Mall' }, distanceKm: 3.5, durationMin: 10 }, tok);
  want = t.id; for (let i = 0; i < 30 && (await api('/trips/active', null, tok)).status !== 'accepted'; i++) await sleep(100);
  await api(`/trips/${t.id}/arrived`, {}, driver.token); await api(`/trips/${t.id}/start`, { pin: t.pin }, driver.token);
  await sleep(400);
  const log = require('fs').readFileSync(process.env.SERVER_LOG || '/dev/null', 'utf8');
  ok(!process.env.SERVER_LOG || /Follow live: .*\/t\//.test(log.split('[sms demo]').filter((x) => x.includes('UFN 909N')).join('')), 'the emergency contact gets the live link by SMS');
  await api(`/trips/${t.id}/complete`, {}, driver.token);
  ds.close();

  // Monthly summary
  const sum = await api('/me/summary', null, tok);
  ok(sum.totals.trips === 1 && sum.totals.spent === t.fare - (t.discount || 0) && sum.trips[0].id === t.id && sum.allTime.trips === 1, 'this month: 1 trip, what was spent, and the trip for a statement');

  // Devices: a second sign-in shows up and can be signed out.
  const second = await api('/auth/login', { phone: newPhone, password: 'secret1' });
  let s = await api('/me/sessions', null, tok);
  ok(s.sessions.length >= 2 && s.sessions.some((x) => x.current) && /Android phone/.test(s.sessions[0].device), 'signed-in devices are listed, with this one marked');
  const other2 = s.sessions.find((x) => !x.current);
  await api(`/me/sessions/${other2.id}/revoke`, {}, tok);
  ok((await api('/me/sessions', null, tok)).sessions.every((x) => x.id !== other2.id), 'a device signed out from the list disappears from it');
  await api('/me/sessions/revoke-others', {}, tok);
  ok((await call('/me', null, second.token)).status === 401, 'after “sign out other devices” the other phone can’t use the account');
  ok((await call('/me', null, tok)).status === 200, 'and this phone stays signed in');

  // Reports and app rating
  ok(Array.isArray(await api('/me/reports', null, tok)), 'reports from all trips can be listed');
  ok((await call('/feedback', { stars: 9 }, tok)).status === 400 && (await call('/feedback', { stars: 5, note: 'Smooth ride' }, tok)).status === 200, 'Rate Flytte takes 1 to 5 stars');
  const fb = await api('/admin/feedback', null, admin.token);
  ok(fb.items.some((x) => x.note === 'Smooth ride'), 'the team sees the rating in admin');
  const cfg = await api('/config');
  ok(/^\d+\.\d+\.\d+/.test(cfg.version), 'the app version comes from the server');

  // "Write to us" in Help reaches the team in Admin → Customer help.
  ok((await call('/support/message', { message: 'hi' }, tok)).status === 400, 'a message that is too short is refused');
  await api('/support/message', { message: 'Can I pay for my mum’s rides from my wallet?' }, tok);
  const adm = await api('/auth/login', { phone: '0700000000', password: 'admin123' });
  const fbk = await api("/admin/feedback", null, adm.token);
  ok(fbk.messages.some((m) => /mum’s rides/.test(m.note)) && !fbk.items.some((m) => /mum’s rides/.test(m.note || '')), 'the message shows under Messages from Help, not as an app rating');

  console.log(failed ? `${failed} FAILED` : 'all account page checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
