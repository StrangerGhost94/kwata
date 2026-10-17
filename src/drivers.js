// Driver tools: ride alerts on a locked phone (Web Push), acceptance and
// cancellation rates, trip bonuses, and document expiry reminders.
const webpush = require('web-push');
const db = require('./db');
const { getSettings } = require('./pricing');

// ---------- Web Push ----------
// VAPID keys identify this server to the phone's push service. They come from
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set; otherwise they are made once and
// kept in the database so every restart (and every subscribed phone) keeps working.
let vapid = null;
async function vapidKeys() {
  if (vapid) return vapid;
  let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    const row = await db.one("SELECT value FROM app_keys WHERE key = 'vapid'");
    if (row) ({ pub, priv } = JSON.parse(row.value));
    else {
      const k = webpush.generateVAPIDKeys();
      pub = k.publicKey; priv = k.privateKey;
      await db.query("INSERT INTO app_keys(key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify({ pub, priv })]);
      const again = await db.one("SELECT value FROM app_keys WHERE key = 'vapid'"); // another instance may have won the race
      ({ pub, priv } = JSON.parse(again.value));
    }
  }
  // Push services want a way to reach the sender: VAPID_CONTACT, else this app's own address.
  const site = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  const contact = process.env.VAPID_CONTACT || (/^https:\/\//.test(site) ? site : 'mailto:support@example.com');
  webpush.setVapidDetails(contact, pub, priv);
  vapid = { pub, priv };
  return vapid;
}

async function subscribe(userId, sub) {
  const endpoint = String(sub && sub.endpoint || '');
  const keys = (sub && sub.keys) || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !keys.p256dh || !keys.auth) return false;
  await db.query(`INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
  [userId, endpoint, String(keys.p256dh).slice(0, 200), String(keys.auth).slice(0, 100)]);
  return true;
}
async function unsubscribe(userId, endpoint) {
  await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, String(endpoint || '')]);
}
async function hasPush(userId) {
  return !!(await db.one('SELECT 1 AS x FROM push_subscriptions WHERE user_id = $1 LIMIT 1', [userId]));
}

// Sends to every phone the user subscribed. Dead subscriptions are removed.
async function push(userId, payload, { ttl = 60, urgency = 'high' } = {}) {
  let rows;
  try { await vapidKeys(); rows = (await db.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId])).rows; }
  catch (e) { console.error('push setup', e.message); return 0; }
  let sent = 0;
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify(payload), { TTL: ttl, urgency });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [r.id]).catch(() => {});
      else console.error('push failed', e.statusCode || '', e.message);
    }
  }));
  return sent;
}

// ---------- Acceptance and cancellation ----------
// kinds: offer_accepted, offer_declined, offer_missed, driver_cancelled, no_show
function logEvent(driverId, tripId, kind) {
  return db.query('INSERT INTO driver_events(driver_id, trip_id, kind) VALUES ($1,$2,$3)', [driverId, tripId || null, kind]).catch((e) => console.error('driver event', e.message));
}

async function stats(driverId, days = 30) {
  const r = await db.one(`SELECT
      COUNT(*) FILTER (WHERE kind = 'offer_accepted')::int AS accepted,
      COUNT(*) FILTER (WHERE kind = 'offer_declined')::int AS declined,
      COUNT(*) FILTER (WHERE kind = 'offer_missed')::int AS missed,
      COUNT(*) FILTER (WHERE kind = 'driver_cancelled')::int AS cancelled
    FROM driver_events WHERE driver_id = $1 AND created_at > NOW() - ($2 || ' days')::interval`, [driverId, String(days)]);
  const offers = r.accepted + r.declined + r.missed;
  return {
    days, offers, accepted: r.accepted, declined: r.declined, missed: r.missed, cancelled: r.cancelled,
    acceptanceRate: offers ? Math.round((r.accepted / offers) * 100) : null,
    cancellationRate: r.accepted ? Math.round((r.cancelled / r.accepted) * 100) : null,
  };
}

// ---------- Bonuses ----------
// Periods follow Kampala time: a day runs midnight to midnight, a week Monday to Sunday.
const KLA = 3 * 3600e3;
function periodOf(kind, now = Date.now()) {
  const local = new Date(now + KLA);
  const day = local.toISOString().slice(0, 10);
  if (kind === 'day') {
    const start = Date.parse(day + 'T00:00:00Z') - KLA;
    return { key: day, start: new Date(start), end: new Date(start + 86400e3) };
  }
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  const start = Date.parse(day + 'T00:00:00Z') - KLA - dow * 86400e3;
  return { key: 'W' + new Date(start + KLA).toISOString().slice(0, 10), start: new Date(start), end: new Date(start + 7 * 86400e3) };
}

async function bonusProgress(driverId) {
  const s = await getSettings();
  const out = [];
  for (const b of s.bonuses.filter((x) => x.active && x.reward > 0)) {
    const p = periodOf(b.period);
    const c = await db.one("SELECT COUNT(*)::int AS n FROM trips WHERE driver_id = $1 AND status = 'completed' AND completed_at >= $2 AND completed_at < $3", [driverId, p.start, p.end]);
    const paid = await db.one('SELECT 1 AS x FROM bonus_payouts WHERE driver_id = $1 AND bonus_id = $2 AND period_key = $3', [driverId, b.id, p.key]);
    out.push({ id: b.id, title: b.title, trips: b.trips, reward: b.reward, period: b.period, done: Math.min(c.n, b.trips), paid: !!paid, endsAt: p.end });
  }
  return out;
}

// Called inside the completion transaction. Pays any bonus whose target was just reached.
async function payBonuses(t, driverId) {
  const s = await getSettings();
  const paid = [];
  for (const b of s.bonuses.filter((x) => x.active && x.reward > 0)) {
    const p = periodOf(b.period);
    const c = await t.one("SELECT COUNT(*)::int AS n FROM trips WHERE driver_id = $1 AND status = 'completed' AND completed_at >= $2 AND completed_at < $3", [driverId, p.start, p.end]);
    if (c.n < b.trips) continue;
    const row = await t.one('INSERT INTO bonus_payouts(driver_id, bonus_id, period_key, amount) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING amount', [driverId, b.id, p.key, b.reward]);
    if (!row) continue; // already paid this period
    await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [b.reward, driverId]);
    await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'bonus',$2,$3)", [driverId, b.reward, `Bonus: ${b.title}`]);
    paid.push({ title: b.title, reward: b.reward });
  }
  return paid;
}

// ---------- Documents ----------
const EXPIRING_KINDS = ['license', 'insurance'];
async function docAlerts(driverId) {
  const s = await getSettings();
  const { rows } = await db.query("SELECT kind, expires_on FROM driver_docs WHERE user_id = $1 AND expires_on IS NOT NULL", [driverId]);
  const today = new Date(Date.now() + KLA).toISOString().slice(0, 10);
  return rows.map((r) => {
    const exp = r.expires_on instanceof Date ? r.expires_on.toISOString().slice(0, 10) : String(r.expires_on).slice(0, 10);
    const days = Math.round((Date.parse(exp) - Date.parse(today)) / 86400e3);
    return { kind: r.kind, expiresOn: exp, days, expired: days < 0, soon: days >= 0 && days <= s.drivers.docReminderDays };
  }).filter((x) => x.expired || x.soon);
}

module.exports = { vapidKeys, subscribe, unsubscribe, hasPush, push, logEvent, stats, bonusProgress, payBonuses, periodOf, docAlerts, EXPIRING_KINDS };
