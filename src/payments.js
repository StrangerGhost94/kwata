// Payments.
//   - MTN / Airtel Mobile Money through Relworx (RELWORX_API_KEY + RELWORX_ACCOUNT_NO): Relworx sends a
//     PIN prompt to the payer's phone; the payment stays "pending" until Relworx's own status check says
//     it succeeded. Its webhook and a background check only trigger that check; nothing is credited from
//     what a webhook says.
//   - Cards (and Mobile Money when Relworx isn't set up) through Flutterwave Standard checkout (FLW_SECRET_KEY).
// Without either, local development runs in DEMO mode (payments succeed instantly so every flow can be
// tested). A live server (DATABASE_URL set) never fakes payments. PAYMENTS_DEMO=true/false overrides this.
const crypto = require('crypto');
const db = require('./db');
const ledger = require('./ledger');

const FLW_KEY = process.env.FLW_SECRET_KEY || '';
const FLW_HASH = process.env.FLW_WEBHOOK_HASH || '';
const RW_KEY = process.env.RELWORX_API_KEY || '';
const RW_ACC = process.env.RELWORX_ACCOUNT_NO || '';
const RW_URL = (process.env.RELWORX_URL || 'https://payments.relworx.com').replace(/\/+$/, '');
const enabled = () => !!FLW_KEY;
const relworx = () => !!(RW_KEY && RW_ACC);
const demo = () => {
  if (FLW_KEY || relworx()) return false;
  if (process.env.PAYMENTS_DEMO === 'true') return true;
  if (process.env.PAYMENTS_DEMO === 'false') return false;
  return !process.env.DATABASE_URL && process.env.NODE_ENV !== 'production'; // same "live" rule as src/auth.js
};
// Can riders pay by Mobile Money / card or top up their wallet right now?
const available = () => enabled() || relworx() || demo();
const cards = () => enabled() || demo();   // cards need Flutterwave
class PaymentsUnavailable extends Error {}

function newRef(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// `payer`: someone other than the account holder pays (a friend's share of a split fare).
// The number the payer chose for this payment ("network" is mtn or airtel; the number must be on it).
// It's remembered as their Mobile Money number. Returns { phone } (null when none was sent) or { error }.
const NET_PREFIX = { mtn: /^\+2567[678]\d{7}$/, airtel: /^\+2567[045]\d{7}$/ };
async function chosenPhone(user, body) {
  const b = body || {};
  if (!b.phone) return { phone: null };
  const d = String(b.phone).replace(/\D/g, '').replace(/^256/, '').replace(/^0/, '');
  const phone = /^7\d{8}$/.test(d) ? '+256' + d : null;
  const net = b.network === 'airtel' ? 'airtel' : b.network === 'mtn' ? 'mtn' : null;
  if (!phone) return { error: 'Enter a Ugandan mobile number, e.g. 0772 123456.' };
  if (net && !NET_PREFIX[net].test(phone)) return { error: net === 'mtn' ? 'That isn’t an MTN number. MTN numbers start with 076, 077 or 078.' : 'That isn’t an Airtel number. Airtel numbers start with 070, 074 or 075.' };
  if (!NET_PREFIX.mtn.test(phone) && !NET_PREFIX.airtel.test(phone)) return { error: 'Mobile Money works with MTN and Airtel Uganda numbers.' };
  const pref = NET_PREFIX.mtn.test(phone) ? 'mtn' : 'airtel';
  await db.query("UPDATE users SET pay_phone = $1, pay_pref = CASE WHEN pay_pref IN ('mtn','airtel') OR pay_pref IS NULL THEN $2 ELSE pay_pref END WHERE id = $3", [phone, pref, user.id]);
  user.pay_phone = phone;
  return { phone };
}

async function createCheckout({ user, amount, purpose, tripId, method, baseUrl, payer, companyId, phone }) {
  amount = Math.round(amount);
  if (!available()) throw new PaymentsUnavailable('Mobile Money and card payments aren’t available yet. Pay with cash for now.');
  if (!(amount > 0)) throw new PaymentsUnavailable('Nothing to pay.');
  if (method === 'card' && !cards()) throw new PaymentsUnavailable('Card payments aren’t available yet. Pay with MTN or Airtel Mobile Money.');
  if (method !== 'card' && relworx()) return relworxRequest({ user, amount, purpose, tripId, payer: payer || (phone ? { phone, name: user.name } : null), companyId });
  const tx_ref = newRef(purpose === 'topup' ? 'FLY-TOP' : purpose === 'debt' ? 'FLY-DBT' : purpose === 'split' ? 'FLY-SPL' : purpose === 'pass' ? 'FLY-PAS' : purpose === 'company' ? 'FLY-BIZ' : 'FLY-TRP');
  await db.query(
    'INSERT INTO payments(tx_ref, user_id, purpose, trip_id, amount, payer_name, company_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [tx_ref, user.id, purpose, tripId || null, amount, payer ? payer.name : null, companyId || null]
  );

  if (demo()) {
    await applyPayment(tx_ref, 'demo');
    return { demo: true, tx_ref, status: 'successful' };
  }

  const body = {
    tx_ref,
    amount,
    currency: 'UGX',
    redirect_url: `${baseUrl}/api/payments/callback`,
    payment_options: method === 'card' ? 'card' : 'mobilemoneyuganda',
    customer: payer ? {
      email: `${payer.phone.replace('+', '')}@riders.flytte.app`,
      phonenumber: payer.phone,
      name: payer.name,
    } : {
      email: user.email || `${user.phone.replace('+', '')}@riders.flytte.app`,
      phonenumber: user.phone,
      name: user.name,
    },
    customizations: {
      title: 'Flytte',
      description: purpose === 'topup' ? 'Flytte wallet top-up' : purpose === 'debt' ? 'Flytte commission payment' : purpose === 'split' ? 'Your share of a Flytte trip' : purpose === 'pass' ? 'Flytte Pass, 30 days' : purpose === 'company' ? 'Flytte for Business statement' : `Flytte trip #${tripId}`,
    },
  };
  const r = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FLW_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status !== 'success' || !data.data || !data.data.link) {
    await db.query("UPDATE payments SET status = 'failed' WHERE tx_ref = $1 AND status = 'pending'", [tx_ref]);
    console.error('Flutterwave checkout failed', r.status, data.message);
    throw new PaymentsUnavailable('We couldn’t start the payment. Try again in a moment, or pay with cash.');
  }
  return { demo: false, tx_ref, link: data.data.link };
}

// Confirm with Flutterwave directly — never trust the redirect alone.
async function verifyAndApply(tx_ref) {
  const p = await db.one('SELECT * FROM payments WHERE tx_ref = $1', [tx_ref]);
  if (!p) return { ok: false, reason: 'unknown payment' };
  if (p.status === 'successful') return { ok: true, payment: p };
  if (p.provider === 'relworx') return relworxVerify(p);
  if (!enabled()) return { ok: false, reason: 'payments disabled' };

  let data;
  try {
    const r = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`, {
      headers: { Authorization: `Bearer ${FLW_KEY}` },
    });
    data = await r.json().catch(() => ({}));
  } catch (e) {
    console.error('Flutterwave verify failed', e.message);
    return { ok: false, reason: 'unreachable' }; // stays pending; the webhook or a retry confirms it later
  }
  const d = data.data || {};
  if (data.status === 'success' && d.status === 'successful' && d.currency === 'UGX' && Number(d.amount) >= p.amount) {
    const payment = await applyPayment(tx_ref, String(d.id));
    return { ok: true, payment };
  }
  if (d.status === 'failed') await db.query("UPDATE payments SET status = 'failed' WHERE tx_ref = $1 AND status = 'pending'", [tx_ref]);
  return { ok: false, reason: d.status || 'not confirmed' };
}

// Idempotent: safe to call from the redirect AND the webhook.
async function applyPayment(tx_ref, providerRef) {
  return db.tx(async (t) => {
    const p = await t.one('SELECT * FROM payments WHERE tx_ref = $1 FOR UPDATE', [tx_ref]);
    if (!p || p.status === 'successful') return p;
    await t.query("UPDATE payments SET status = 'successful', provider_ref = $1 WHERE tx_ref = $2", [providerRef, tx_ref]);
    if (p.purpose === 'topup') {
      await ledger.creditWallet(t, p.user_id, p.amount, `Top-up ${tx_ref}`);
    } else if (p.purpose === 'debt') {
      // A driver paying the commission owed on cash trips.
      await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [p.amount, p.user_id]);
      await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'debt_payment',$2,$3)", [p.user_id, p.amount, `Paid to Flytte by Mobile Money (${tx_ref})`]);
    } else if (p.purpose === 'split') {
      // A friend's share of a split fare goes into the rider's wallet; the trip itself is paid as usual.
      await ledger.creditWallet(t, p.user_id, p.amount, `Split from ${p.payer_name || 'a friend'} (trip #${p.trip_id})`);
      await t.query('UPDATE fare_splits SET paid = paid + 1 WHERE trip_id = $1', [p.trip_id]);
    } else if (p.purpose === 'pass') {
      await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'pass',0,$2)", [p.user_id, `Flytte Pass paid by Mobile Money (${tx_ref})`]);
      await require('./pass').grant(t, p.user_id, p.amount, 'momo');
    } else if (p.purpose === 'company') {
      await require('./business').applyPayment(t, p);
    } else if (p.purpose === 'trip' && p.trip_id) {
      await ledger.markTripPaid(t, p.trip_id);
    }
    return { ...p, status: 'successful', newly: true };
  });
}

// Flutterwave signs webhooks with the secret hash set in its dashboard.
// ---------- Relworx (MTN / Airtel Mobile Money) ----------
const MSISDN = /^\+256(7\d{8})$/;   // Relworx collects UGX from Ugandan MTN and Airtel numbers
async function relworxCall(path, { method = 'GET', body } = {}) {
  const r = await fetch(RW_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.relworx.v2', Authorization: `Bearer ${RW_KEY}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// Send the PIN prompt. Returns { pending, tx_ref, phone, amount }: the app then waits for the status.
async function relworxRequest({ user, amount, purpose, tripId, payer, companyId }) {
  const phone = String((payer && payer.phone) || user.pay_phone || user.phone || '');
  if (!MSISDN.test(phone)) throw new PaymentsUnavailable('Mobile Money needs a Ugandan MTN or Airtel number, e.g. 0772 123456. Change it in Payment methods.');
  if (amount < 500) throw new PaymentsUnavailable('Mobile Money payments start at UGX 500.');
  const tx_ref = newRef({ topup: 'FLY-TOP', debt: 'FLY-DBT', split: 'FLY-SPL', pass: 'FLY-PAS', company: 'FLY-BIZ' }[purpose] || 'FLY-TRP');
  await db.query(
    "INSERT INTO payments(tx_ref, user_id, purpose, trip_id, amount, payer_name, company_id, provider, phone) VALUES ($1,$2,$3,$4,$5,$6,$7,'relworx',$8)",
    [tx_ref, user.id, purpose, tripId || null, amount, payer ? payer.name : null, companyId || null, phone]
  );
  const description = { topup: 'Flytte wallet top-up', debt: 'Flytte commission', split: 'Share of a Flytte trip', pass: 'Flytte Pass', company: 'Flytte for Business bill' }[purpose] || `Flytte trip ${tripId}`;
  let res;
  try { res = await relworxCall('/api/mobile-money/request-payment', { method: 'POST', body: { account_no: RW_ACC, reference: tx_ref, msisdn: phone, currency: 'UGX', amount, description } }); }
  catch (e) {
    console.error('Relworx request failed', e.message);
    await db.query("UPDATE payments SET status = 'failed', message = 'unreachable' WHERE tx_ref = $1", [tx_ref]);
    throw new PaymentsUnavailable('We couldn’t reach Mobile Money just now. Try again in a moment, or pay with cash.');
  }
  const d = res.data || {};
  if (res.status >= 400 || !d.success || !d.internal_reference) {
    console.error('Relworx refused the payment request', res.status, d.message);
    await db.query("UPDATE payments SET status = 'failed', message = $2 WHERE tx_ref = $1", [tx_ref, String(d.message || res.status).slice(0, 200)]);
    throw new PaymentsUnavailable(res.status === 429 ? 'Too many payment prompts to this number. Wait 10 minutes and try again.' : 'We couldn’t send the Mobile Money prompt. Check the number and try again, or pay with cash.');
  }
  await db.query('UPDATE payments SET provider_internal = $1 WHERE tx_ref = $2', [String(d.internal_reference).slice(0, 80), tx_ref]);
  return { pending: true, tx_ref, phone, amount };
}

// Ask Relworx how the payment went. Only its "success" in UGX for at least the amount asked credits anything.
async function relworxVerify(p) {
  if (p.status !== 'pending') return { ok: false, reason: p.status, message: p.message };
  if (!p.provider_internal) return { ok: false, reason: 'pending' };
  let res;
  try { res = await relworxCall(`/api/mobile-money/check-request-status?${new URLSearchParams({ internal_reference: p.provider_internal, account_no: RW_ACC })}`); }
  catch (e) { console.error('Relworx status check failed', e.message); return { ok: false, reason: 'unreachable' }; }
  await db.query('UPDATE payments SET checked_at = NOW() WHERE tx_ref = $1', [p.tx_ref]);
  const d = res.data || {};
  const status = String(d.status || d.request_status || '').toLowerCase();
  if (d.success && status === 'success') {
    if (String(d.currency).toUpperCase() !== 'UGX' || Number(d.amount) < p.amount) {
      console.error('Relworx payment did not match', p.tx_ref, d.currency, d.amount, p.amount);
      await db.query("UPDATE payments SET status = 'failed', message = 'amount mismatch' WHERE tx_ref = $1 AND status = 'pending'", [p.tx_ref]);
      return { ok: false, reason: 'failed', message: 'The payment didn’t match. Contact Flytte support.' };
    }
    const payment = await applyPayment(p.tx_ref, String(d.provider_transaction_id || p.provider_internal));
    return { ok: true, payment };
  }
  if (status === 'failed' || status === 'cancelled' || status === 'declined') {
    const message = String(d.message || 'The payment didn’t go through.').slice(0, 200);
    await db.query("UPDATE payments SET status = 'failed', message = $2 WHERE tx_ref = $1 AND status = 'pending'", [p.tx_ref, message]);
    return { ok: false, reason: 'failed', message };
  }
  return { ok: false, reason: 'pending' };
}

// Background check: pending Relworx payments are confirmed even if the app was closed; ones that never
// finish are given up on after 30 minutes. `settled(payment)` tells the app.
async function checkPending(settled) {
  if (!relworx()) return;
  await db.query("UPDATE payments SET status = 'expired' WHERE provider = 'relworx' AND status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes'");
  const { rows } = await db.query("SELECT tx_ref FROM payments WHERE provider = 'relworx' AND status = 'pending' AND (checked_at IS NULL OR checked_at < NOW() - INTERVAL '15 seconds') ORDER BY created_at LIMIT 25");
  for (const r of rows) {
    const out = await verifyAndApply(r.tx_ref).catch((e) => { console.error('payment check', e.message); return null; });
    if (out && out.ok && out.payment && out.payment.newly && settled) settled(out.payment);
  }
}

function webhookAuthentic(req) {
  const got = Buffer.from(String(req.headers['verif-hash'] || ''));
  const want = Buffer.from(FLW_HASH);
  return FLW_HASH.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { chosenPhone, enabled, relworx, cards, checkPending, demo, available, PaymentsUnavailable, createCheckout, verifyAndApply, webhookAuthentic, _applyPayment: applyPayment };
