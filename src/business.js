// Flytte for Business and Flytte for Shops.
// A company account pays for its staff's rides at the end of the month instead of each person paying.
//   - Admins add staff by phone and give each a monthly budget (0 = no limit).
//   - A business trip is paid to the driver like a wallet trip; the company owes it (balance_due),
//     up to its credit limit, and pays the statement by Mobile Money.
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
      shop: c.shop_lat ? { address: c.shop_address, lat: c.shop_lat, lng: c.shop_lng } : null });
  }
  return out;
}

// May this person charge `amount` to the company now? Returns { company } or { error }.
async function canCharge(userId, companyId, amount) {
  const m = await db.one(`SELECT c.*, m.role, m.monthly_budget FROM company_members m JOIN companies c ON c.id = m.company_id
    WHERE m.user_id = $1 AND m.active AND ($2::int IS NULL OR c.id = $2) AND c.status = 'active' ORDER BY c.id LIMIT 1`, [userId, companyId || null]);
  if (!m) return { error: 'You’re not on a Flytte for Business account.' };
  if (m.monthly_budget > 0) {
    const used = await spentThisMonth(m.id, userId);
    if (used + amount > m.monthly_budget) return { error: `This ride would go over your monthly budget at ${m.name} (UGX ${Math.max(0, m.monthly_budget - used).toLocaleString()} left). Pay another way.` };
  }
  const open = await db.one(`SELECT COALESCE(SUM(fare - discount), 0)::int AS n FROM trips WHERE company_id = $1 AND payment_method = 'business' AND status IN ('requested','accepted','arrived','in_progress','scheduled')`, [m.id]);
  if (m.balance_due + open.n + amount > m.credit_limit) return { error: `${m.name} has reached its account limit. Ask your company admin to pay the statement.` };
  return { company: m };
}

// Inside the completion transaction: the driver is paid as for a wallet trip, the company owes the fare.
async function chargeTrip(t, trip, commission) {
  const amount = payable(trip);
  await t.query('UPDATE companies SET balance_due = balance_due + $1 WHERE id = $2', [amount, trip.company_id]);
  await t.query("INSERT INTO company_ledger(company_id, trip_id, user_id, amount, kind, note) VALUES ($1,$2,$3,$4,'trip',$5)",
    [trip.company_id, trip.id, trip.rider_id, amount, `${trip.pickup_address} → ${trip.drop_address}`]);
  await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_payment',0,$2,'Paid by your company account')", [trip.rider_id, trip.id]);
  const net = trip.fare - commission;
  await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [net, trip.driver_id]);
  await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_earning',$2,$3,$4)", [trip.driver_id, net, trip.id, `Fare ${trip.fare} less commission ${commission} (business account)`]);
}

// A statement payment confirmed by Flutterwave (or the local demo).
async function applyPayment(t, p) {
  if (!p.company_id) return;
  await t.query('UPDATE companies SET balance_due = GREATEST(0, balance_due - $1) WHERE id = $2', [p.amount, p.company_id]);
  await t.query("INSERT INTO company_ledger(company_id, user_id, amount, kind, note) VALUES ($1,$2,$3,'payment',$4)", [p.company_id, p.user_id, -p.amount, `Paid by Mobile Money (${p.tx_ref})`]);
}

async function adminOf(userId, companyId) {
  return db.one(`SELECT c.* FROM company_members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = $1 AND m.company_id = $2 AND m.role = 'admin' AND m.active`, [userId, companyId]);
}

// The month's trips for the dashboard and the CSV statement.
async function trips(companyId, from, to) {
  const { rows } = await db.query(`SELECT t.id, t.created_at, t.completed_at, t.status, t.service, t.pickup_address, t.drop_address, t.fare, t.discount, t.merchant, t.parcel, t.share_token,
      u.name AS rider_name, u.phone AS rider_phone FROM trips t JOIN users u ON u.id = t.rider_id
    WHERE t.company_id = $1 AND t.created_at >= $2 AND t.created_at < $3 ORDER BY t.id DESC LIMIT 1000`, [companyId, from, to]);
  return rows;
}

module.exports = { monthStart, slugFor, myCompanies, canCharge, chargeTrip, applyPayment, adminOf, trips, spentThisMonth };
