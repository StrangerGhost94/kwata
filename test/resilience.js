// Malformed messages from a signed-in client must never take the server down.
const { io } = require('socket.io-client');
const BASE = process.env.BASE || 'http://localhost:3000';
let failed = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) failed++; };
const alive = () => fetch(BASE + '/health').then((r) => r.ok).catch(() => false);

(async () => {
  const u = await (await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Resilience Rider', phone: '070' + String(Date.now()).slice(-7), password: 'secret12' }) })).json();
  const s = io(BASE, { auth: { token: u.token } });
  await new Promise((r) => s.on('connect', r));
  const r = await s.timeout(3000).emitWithAck('chat:send', { tripId: 'not-a-number', text: 'hi' }).catch(() => null);
  ok(r && r.ok === false, 'a chat message with a broken trip id gets ok:false');
  ok(await alive(), 'the server is still up after it');
  s.emit('track:join', { token: { $gt: '' } });
  s.emit('chat:send', null);
  await new Promise((res) => setTimeout(res, 500));
  ok(await alive(), 'odd payloads to other events don’t stop it either');
  s.close();
  console.log(failed ? `${failed} FAILED` : 'all resilience checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
