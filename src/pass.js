// Flytte Pass: a monthly subscription. While active, every ride is at the normal (never busy-time)
// price, a percentage off up to a cap, and late cancellations are free. Paid from the Flytte Wallet or
// by Mobile Money; renews itself from the wallet when that's switched on and the wallet covers it.
const db = require('./db');
const { getSettings } = require('./pricing');

async function active(userId, at = new Date()) {
  if (!userId) return null;
  return db.one("SELECT * FROM passes WHERE user_id = $1 AND status = 'active' AND starts_at <= $2 AND ends_at > $2 ORDER BY ends_at DESC LIMIT 1", [userId, at]);
}

// Start a pass, or add a period to the one running (inside a transaction).
async function grant(t, userId, price, via) {
  const s = await getSettings();
  const cur = await t.one("SELECT * FROM passes WHERE user_id = $1 AND status = 'active' AND ends_at > NOW() ORDER BY ends_at DESC LIMIT 1 FOR UPDATE", [userId]);
  if (cur) {
    const p = await t.one("UPDATE passes SET ends_at = ends_at + ($1 || ' days')::interval WHERE id = $2 RETURNING *", [String(s.pass.days), cur.id]);
    return p;
  }
  return t.one("INSERT INTO passes(user_id, starts_at, ends_at, price, paid_via) VALUES ($1, NOW(), NOW() + ($2 || ' days')::interval, $3, $4) RETURNING *", [userId, String(s.pass.days), price, via]);
}

// Pay from the wallet: take the price, record it, and start (or extend) the pass.
async function buyWithWallet(userId) {
  const s = await getSettings();
  if (!s.pass.enabled) return { error: 'Flytte Pass isn’t available right now.' };
  const price = s.pass.price;
  let out;
  await db.tx(async (t) => {
    const u = await t.one('SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (u.wallet_balance < price) { out = { error: `Your wallet has UGX ${u.wallet_balance.toLocaleString()}. Flytte Pass is UGX ${price.toLocaleString()}.` }; return; }
    await t.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [price, userId]);
    await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'pass',$2,'Flytte Pass, 30 days')", [userId, -price]);
    out = { pass: await grant(t, userId, price, 'wallet') };
  });
  return out;
}

// The pass in the app: dates, renewal, and what it has saved so far.
async function summary(userId) {
  const s = await getSettings();
  const p = await active(userId);
  const offer = { price: s.pass.price, days: s.pass.days, percent: s.pass.percent, maxDiscount: s.pass.maxDiscount, enabled: s.pass.enabled };
  if (!p) {
    const last = await db.one('SELECT ends_at FROM passes WHERE user_id = $1 ORDER BY ends_at DESC LIMIT 1', [userId]);
    return { active: false, offer, endedAt: last ? last.ends_at : null };
  }
  const saved = await db.one("SELECT COALESCE(SUM(pass_saving), 0)::int AS n, COUNT(*) FILTER (WHERE pass_saving > 0)::int AS trips FROM trips WHERE rider_id = $1 AND status = 'completed' AND completed_at >= $2", [userId, p.starts_at]);
  return { active: true, offer, startsAt: p.starts_at, endsAt: p.ends_at, autoRenew: p.auto_renew, saved: saved.n, trips: saved.trips };
}

// Runs every few minutes: renew passes that ended (wallet permitting), close the rest.
async function renewDue(notify) {
  const { rows } = await db.query("SELECT * FROM passes WHERE status = 'active' AND ends_at <= NOW() LIMIT 100");
  const s = await getSettings();
  for (const p of rows) {
    let renewed = false;
    if (p.auto_renew && s.pass.enabled) {
      await db.tx(async (t) => {
        const u = await t.one('SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE', [p.user_id]);
        const still = await t.one("SELECT id FROM passes WHERE id = $1 AND status = 'active' FOR UPDATE", [p.id]);
        if (!still || u.wallet_balance < s.pass.price) return;
        await t.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [s.pass.price, p.user_id]);
        await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'pass',$2,'Flytte Pass renewed, 30 days')", [p.user_id, -s.pass.price]);
        await t.query("UPDATE passes SET ends_at = ends_at + ($1 || ' days')::interval WHERE id = $2", [String(s.pass.days), p.id]);
        renewed = true;
      });
    }
    if (!renewed) await db.query("UPDATE passes SET status = 'expired' WHERE id = $1 AND status = 'active'", [p.id]);
    if (notify) notify(p.user_id, renewed ? 'Your Flytte Pass renewed for another 30 days.' : 'Your Flytte Pass has ended. Renew it any time in Account.');
  }
}

module.exports = { active, grant, buyWithWallet, summary, renewDue };
