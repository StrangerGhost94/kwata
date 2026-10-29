// Flytte for Business and Flytte for Shops.
// A company account pays for its staff's rides instead of each person paying.
//   - The admin tops up the company wallet by Mobile Money; staff rides are paid from it.
//   - If Flytte has given the account credit, what the wallet can't cover goes on the bill (balance_due)
//     up to the credit limit, paid later by Mobile Money. New accounts are prepaid (no credit).
//   - Admins add staff by phone (people not on Flytte yet join when they sign up with that number),
//     give each a monthly budget (0 = no limit), and can limit ride types or require a trip reason.
//   - A business trip is paid to the driver like a wallet trip. Late-cancel and no-show fees on a
//     business trip are the company's too.
// A shop ("merchant") is the same account with a shop address: staff send deliveries to customers,
// and customers can ask for one through the shop's own link (/shop/<slug>), e.g. sent on WhatsApp.
const crypto = require('crypto');
const db = require('./db');

const monthStart = (d = new Date()) => {
  const k = new Date(d.getTime() + 3 * 3600e3);   // Kampala's month
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - 3 * 3600e3);
};
const payable = (t) => t.fare - (t.discount || 0);

async function slugFor(name) {
  const base = String(name).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'shop';
  for (let i = 0; i < 5; i++) {
    const s = i ? `${base}-${crypto.randomInt(100, 999)}` : base;
    if (!(await db.one('SELECT id FROM companies WHERE slug = $1', [s]))) return s;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

async function spentThisMonth(companyId, userId) {
  const r = await db.one(`SELECT COALESCE(SUM(fare - discount), 0)::int AS n FROM trips
    WHERE company_id = $1 AND rider_id = $2 AND payment_method = 'business' AND status IN ('requested','accepted','arrived','in_progress','completed','scheduled') AND created_at >= $3`, [companyId, userId, monthStart()]);
  return r.n;
}

// Every company this person belongs to, with their own budget and what they've used this month.
async function myCompanies(userId) {
  const { rows } = await db.query(`SELECT c.*, m.role, m.monthly_budget FROM company_members m JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = $1 AND m.active AND c.status = 'active' ORDER BY c.id`, [userId]);
  const out = [];
  for (const c of rows) {
    out.push({ id: c.id, kind: c.kind, name: c.name, slug: c.slug, role: c.role, budget: c.monthly_budget, spent: await spentThisMonth(c.id, userId),
      allowedServices: allowedList(c), requireReason: !!c.require_reason, funded: await available(c) > 0,
      shop: c.shop_lat ? { address: c.shop_address, lat: c.shop_lat, lng: c.shop_lng } : null });
  }
  return out;
}

const SVC_NAME = { boda: 'Boda', car: 'Car', comfort: 'Comfort', parcel: 'Parcel', airport: 'Airport', errand: 'Errand' };
const allowedList = (c) => (c.allowed_services ? String(c.allowed_services).split(',').filter(Boolean) : null);
// Money still to come out for business trips booked but not finished.
async function openTotal(companyId) {
  const r = await db.one(`SELECT COALESCE(SUM(fare - discount), 0)::int AS n FROM trips WHERE company_id = $1 AND payment_method = 'business' AND status IN ('requested','accepted','arrived','in_progress','scheduled')`, [companyId]);
  return r.n;
}
// What the account can still spend: wallet plus unused credit, less trips already booked.
async function available(c) {
  return (c.wallet_balance || 0) + Math.max(0, (c.credit_limit || 0) - (c.balance_due || 0)) - await openTotal(c.id);
}

// May this person charge `amount` to the company now? Returns { company } or { error }.
async function canCharge(userId, companyId, amount, service) {
  const m = await db.one(`SELECT c.*, m.role, m.monthly_budget FROM company_members m JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = $1 AND m.active AND ($2::int IS NULL OR c.id = $2) AND c.status = 'active' ORDER BY c.id LIMIT 1`, [userId, companyId || null]);
  if (!m) return { error: 'You’re not on a Flytte for Business account.' };
  if (m.monthly_budget > 0) {
    const used = await spentThisMonth(m.id, userId);
    if (used + amount > m.monthly_budget) return { error: `This ride would go over your monthly budget at ${m.name} (UGX ${Math.max(0, m.monthly_budget - used).toLocaleString()} left). Pay another way.` };
  }
  const allowed = allowedList(m);
  if (service && allowed && !allowed.includes(service)) return { error: `${m.name} allows ${allowed.map((x) => SVC_NAME[x] || x).join(', ')} rides on the company account. Choose one of those, or pay another way.` };
  if (await available(m) < amount) {
    notifyLow(m, true).catch(() => {});
    return { error: `${m.name}’s company wallet doesn’t have enough for this ride. Ask your company admin to top it up, or pay another way.` };
  }
  return { company: m };
}

// Take `amount` from the company: wallet first, the rest on the bill (credit). Inside a transaction.
async function take(t, companyId, amount) {
  const c = await t.one('SELECT wallet_balance FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
  const fromWallet = Math.min(Math.max(0, c.wallet_balance), amount);
  await t.query('UPDATE companies SET wallet_balance = wallet_balance - $1, balance_due = balance_due + $2 WHERE id = $3', [fromWallet, amount - fromWallet, companyId]);
  return { fromWallet, onCredit: amount - fromWallet };
}

// Inside the completion transaction: the driver is paid as for a wallet trip; the company pays the fare.
async function chargeTrip(t, trip, commission) {
  const amount = payable(trip);
  const split = await take(t, trip.company_id, amount);
  await t.query("INSERT INTO company_ledger(company_id, trip_id, user_id, amount, kind, note) VALUES ($1,$2,$3,$4,'trip',$5)",
    [trip.company_id, trip.id, trip.rider_id, amount, `${trip.pickup_address} → ${trip.drop_address}${split.onCredit ? ` (UGX ${split.onCredit.toLocaleString()} on credit)` : ''}`]);
  await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_payment',0,$2,'Paid by your company account')", [trip.rider_id, trip.id]);
  const net = trip.fare - commission;
  await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [net, trip.driver_id]);
  await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_earning',$2,$3,$4)", [trip.driver_id, net, trip.id, `Fare ${trip.fare} less commission ${commission} (business account)`]);
}

// A late-cancel or no-show fee on a business trip: paid by the company to the driver. Returns the fee.
async function chargeFee(t, trip, fee, kind) {
  if (!fee || !trip.company_id || !trip.driver_id) return 0;
  const c = await t.one('SELECT * FROM companies WHERE id = $1', [trip.company_id]);
  if (!c || (c.wallet_balance || 0) + Math.max(0, (c.credit_limit || 0) - (c.balance_due || 0)) < fee) return 0;
  await take(t, trip.company_id, fee);
  const label = kind === 'no_show' ? 'No-show fee' : 'Cancellation fee';
  await t.query("INSERT INTO company_ledger(company_id, trip_id, user_id, amount, kind, note) VALUES ($1,$2,$3,$4,'fee',$5)", [trip.company_id, trip.id, trip.rider_id, fee, `${label}: the driver was on the way`]);
  await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [fee, trip.driver_id]);
  await t.query(`INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,$2,$3,$4,$5)`, [trip.driver_id, kind === 'no_show' ? 'no_show_fee' : 'cancel_fee', fee, trip.id, `${label} from the company account`]);
  return fee;
}

// A Mobile Money payment for the company: a wallet top-up, or paying off the credit bill.
async function applyPayment(t, p) {
  if (!p.company_id) return;
  if (p.purpose === 'company_topup') {
    await t.query('UPDATE companies SET wallet_balance = wallet_balance + $1, low_alert_at = NULL WHERE id = $2', [p.amount, p.company_id]);
    await t.query("INSERT INTO company_ledger(company_id, user_id, amount, kind, note) VALUES ($1,$2,$3,'topup',$4)", [p.company_id, p.user_id, -p.amount, `Wallet top-up by Mobile Money (${p.tx_ref})`]);
    return;
  }
  await t.query('UPDATE companies SET balance_due = GREATEST(0, balance_due - $1) WHERE id = $2', [p.amount, p.company_id]);
  await t.query("INSERT INTO company_ledger(company_id, user_id, amount, kind, note) VALUES ($1,$2,$3,'payment',$4)", [p.company_id, p.user_id, -p.amount, `Bill paid by Mobile Money (${p.tx_ref})`]);
}

// Tell the admins when the wallet runs low (at most once a day, or when a ride is refused).
async function notifyLow(c, refused) {
  const { getSettings } = require('./pricing');
  const s = await getSettings();
  const fresh = await db.one('SELECT * FROM companies WHERE id = $1', [c.id]);
  if (!fresh) return;
  if (!refused && (fresh.wallet_balance >= s.business.lowBalance || fresh.credit_limit > 0)) return;
  if (fresh.low_alert_at && Date.now() - new Date(fresh.low_alert_at).getTime() < (refused ? 3 * 3600e3 : 24 * 3600e3)) return;
  await db.query('UPDATE companies SET low_alert_at = NOW() WHERE id = $1', [c.id]);
  const { rows } = await db.query("SELECT user_id FROM company_members WHERE company_id = $1 AND role = 'admin' AND active", [c.id]);
  const rt = require('./realtime'), dtools = require('./drivers');
  const text = refused ? `${fresh.name}: a staff ride was refused because the company wallet is low. Top it up in Account → Flytte for Business.` : `${fresh.name}’s company wallet is low (UGX ${fresh.wallet_balance.toLocaleString()}). Top it up so staff can keep riding.`;
  for (const m of rows) {
    rt.notify(m.user_id, 'toast', { text });
    dtools.push(m.user_id, { app: 'rider', type: 'biz', title: 'Company wallet is low', body: text }, { ttl: 86400, urgency: 'normal' }).catch(() => {});
  }
}

// Someone invited by phone has just signed up: put them on the account(s).
async function claimInvites(userId, phone) {
  const { rows } = await db.query('DELETE FROM company_invites WHERE phone = $1 RETURNING *', [phone]);
  for (const i of rows) {
    await db.query(`INSERT INTO company_members(company_id, user_id, role, monthly_budget) VALUES ($1,$2,$3,$4) ON CONFLICT (company_id, user_id) DO UPDATE SET active = TRUE`, [i.company_id, userId, i.role, i.monthly_budget]);
  }
  return rows.length;
}

// Staff removed or the account paused: their booked (scheduled) work rides are called off.
async function cancelScheduled(companyId, userId) {
  const { rows } = await db.query(`UPDATE trips SET status = 'cancelled', cancelled_by = 'system', cancel_reason = 'Company account change'
    WHERE company_id = $1 AND payment_method = 'business' AND status = 'scheduled' AND ($2::int IS NULL OR rider_id = $2) RETURNING id, rider_id`, [companyId, userId || null]);
  const rt = require('./realtime');
  for (const t of rows) rt.notify(t.rider_id, 'toast', { text: 'A scheduled work ride was cancelled because the company account changed.' });
  return rows.length;
}

async function adminOf(userId, companyId) {
  return db.one(`SELECT c.* FROM company_members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = $1 AND m.company_id = $2 AND m.role = 'admin' AND m.active`, [userId, companyId]);
}

// The month's trips for the dashboard and the CSV statement.
async function trips(companyId, from, to) {
  const { rows } = await db.query(`SELECT t.id, t.created_at, t.completed_at, t.status, t.service, t.pickup_address, t.drop_address, t.fare, t.discount, t.merchant, t.parcel, t.share_token, t.trip_reason, t.cancel_fee, t.no_show_fee,
      u.name AS rider_name, u.phone AS rider_phone FROM trips t JOIN users u ON u.id = t.rider_id
    WHERE t.company_id = $1 AND t.created_at >= $2 AND t.created_at < $3 ORDER BY t.id DESC LIMIT 1000`, [companyId, from, to]);
  return rows;
}

module.exports = { monthStart, slugFor, myCompanies, canCharge, chargeTrip, chargeFee, applyPayment, adminOf, trips, spentThisMonth, available, allowedList, notifyLow, claimInvites, cancelScheduled, SVC_NAME };
