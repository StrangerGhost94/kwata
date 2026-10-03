// Growth features: discounts (first ride + promo codes), invite-a-friend rewards
// and Kwata Rewards points. Kwata pays for every discount; drivers are always
// paid on the full fare.
const crypto = require('crypto');
const db = require('./db');
const { getSettings } = require('./pricing');

const LIVE = "('requested','accepted','arrived','in_progress','completed','scheduled')";
const round100 = (n) => Math.round(n / 100) * 100;

// ---------- invite codes ----------
async function ensureReferralCode(user, q = db) {
  if (user.referral_code) return user.referral_code;
  const base = String(user.name || 'KWATA').replace(/[^a-z]/gi, '').toUpperCase().slice(0, 5) || 'KWATA';
  for (let i = 0; i < 8; i++) {
    const code = base + crypto.randomInt(10, 1000);
    const taken = await q.one('SELECT id FROM users WHERE referral_code = $1', [code]);
    if (!taken) { await q.query('UPDATE users SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL', [code, user.id]); return code; }
  }
  const code = 'K' + crypto.randomBytes(4).toString('hex').toUpperCase();
  await q.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, user.id]);
  return code;
}
async function userByReferral(code) {
  if (!code) return null;
  return db.one('SELECT id, name FROM users WHERE referral_code = $1 AND role = $2', [String(code).trim().toUpperCase(), 'rider']);
}

// ---------- discounts ----------
async function firstRideEligible(userId) {
  const r = await db.one(`SELECT COUNT(*)::int AS n FROM trips WHERE rider_id = $1 AND status IN ${LIVE}`, [userId]);
  return r.n === 0;
}

// Works out the best single discount for a fare. A promo code beats the first-ride offer
// only if it is bigger. Returns { discount, label, code } or { error }.
async function discountFor(userId, service, fare, code) {
  const s = await getSettings();
  let best = { discount: 0, label: null, code: null };
  const fr = s.growth.firstRide;
  const first = fr.enabled && fr.percent > 0 && await firstRideEligible(userId);
  if (first) best = { discount: round100(Math.min(fr.max, (fare * fr.percent) / 100)), label: `First ride: ${fr.percent}% off`, code: null };

  if (code) {
    const c = String(code).trim().toUpperCase();
    const p = await db.one('SELECT * FROM promos WHERE code = $1', [c]);
    const fail = (m) => (best.discount ? { ...best, promoError: m } : { error: m, ...best });
    if (!p || !p.active) return fail('That promo code isn’t valid.');
    if (p.expires_at && new Date(p.expires_at) < new Date()) return fail('That promo code has expired.');
    if (p.services && !p.services.split(',').includes(service)) return fail('That code doesn’t work for this ride type.');
    if (p.first_ride_only && !first && !(await firstRideEligible(userId))) return fail('That code is for first rides only.');
    if (fare < p.min_fare) return fail(`That code needs a fare of at least UGX ${p.min_fare.toLocaleString()}.`);
    const used = await db.one(`SELECT COUNT(*)::int AS all_uses, COUNT(*) FILTER (WHERE rider_id = $2)::int AS mine FROM trips WHERE promo_code = $1 AND status IN ${LIVE}`, [c, userId]);
    if (p.max_uses && used.all_uses >= p.max_uses) return fail('That promo code has been fully used.');
    if (used.mine >= p.per_user) return fail('You’ve already used that promo code.');
    let d = p.kind === 'flat' ? p.value : (fare * p.value) / 100;
    if (p.max_discount) d = Math.min(d, p.max_discount);
    d = round100(Math.min(d, fare));
    const label = p.kind === 'flat' ? `${c}: UGX ${p.value.toLocaleString()} off` : `${c}: ${p.value}% off`;
    if (d >= best.discount) best = { discount: d, label, code: c };
    else best.promoError = 'Your first-ride discount is bigger, so we kept that.';
  }
  best.discount = Math.max(0, Math.min(best.discount, fare));
  return best;
}

// ---------- after a trip is completed (inside the settlement transaction) ----------
async function afterCompleted(t, trip) {
  const s = await getSettings();
  const paid = trip.fare - (trip.discount || 0);
  // Kwata Rewards points
  if (s.growth.rewards.enabled && s.growth.rewards.pointsPer1000 > 0) {
    const pts = Math.floor(paid / 1000) * s.growth.rewards.pointsPer1000;
    if (pts > 0) {
      await t.query('UPDATE users SET points = points + $1, lifetime_points = lifetime_points + $1 WHERE id = $2', [pts, trip.rider_id]);
      await t.query('UPDATE trips SET points_earned = $1 WHERE id = $2', [pts, trip.id]);
    }
  }
  // Invite-a-friend: both get wallet credit when the friend finishes their first trip.
  const rf = s.growth.referral;
  const rider = await t.one('SELECT id, name, referred_by, referral_rewarded FROM users WHERE id = $1 FOR UPDATE', [trip.rider_id]);
  if (rf.enabled && rider.referred_by && !rider.referral_rewarded) {
    await t.query('UPDATE users SET referral_rewarded = TRUE WHERE id = $1', [rider.id]);
    if (rf.friend > 0) await credit(t, rider.id, rf.friend, 'Welcome reward: you joined with an invite');
    if (rf.referrer > 0) await credit(t, rider.referred_by, rf.referrer, `Invite reward: ${String(rider.name).split(' ')[0]} took their first trip`);
    return { referrerId: rider.referred_by, referrerReward: rf.referrer };
  }
  return null;
}

async function credit(t, userId, amount, note) {
  await t.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [amount, userId]);
  await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'reward',$2,$3)", [userId, amount, note]);
}

function tier(lifetime) {
  if (lifetime >= 300) return { name: 'Gold', next: null, at: 300 };
  if (lifetime >= 100) return { name: 'Silver', next: 'Gold', at: 300 };
  return { name: 'Bronze', next: 'Silver', at: 100 };
}

module.exports = { ensureReferralCode, userByReferral, discountFor, firstRideEligible, afterCompleted, credit, tier };
