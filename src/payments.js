// MTN / Airtel Mobile Money and card payments via Flutterwave Standard checkout.
// Without FLW_SECRET_KEY, local development runs in DEMO mode (payments succeed
// instantly so every flow can be tested). A live server (DATABASE_URL set) never
// fakes payments: Mobile Money, card and wallet top-ups are switched off until the
// Flutterwave keys are added. PAYMENTS_DEMO=true/false overrides this.
const crypto = require('crypto');
const db = require('./db');
const ledger = require('./ledger');

const FLW_KEY = process.env.FLW_SECRET_KEY || '';
const FLW_HASH = process.env.FLW_WEBHOOK_HASH || '';
const enabled = () => !!FLW_KEY;
const demo = () => {
  if (FLW_KEY) return false;
  if (process.env.PAYMENTS_DEMO === 'true') return true;
  if (process.env.PAYMENTS_DEMO === 'false') return false;
  return !process.env.DATABASE_URL && process.env.NODE_ENV !== 'production'; // same "live" rule as src/auth.js
};
// Can riders pay by Mobile Money / card or top up their wallet right now?
const available = () => enabled() || demo();
class PaymentsUnavailable extends Error {}

function newRef(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function createCheckout({ user, amount, purpose, tripId, method, baseUrl }) {
  amount = Math.round(amount);
  if (!available()) throw new PaymentsUnavailable('Mobile Money and card payments aren’t available yet. Pay with cash for now.');
  if (!(amount > 0)) throw new PaymentsUnavailable('Nothing to pay.');
  const tx_ref = newRef(purpose === 'topup' ? 'FLY-TOP' : 'FLY-TRP');
  await db.query(
    'INSERT INTO payments(tx_ref, user_id, purpose, trip_id, amount) VALUES ($1,$2,$3,$4,$5)',
    [tx_ref, user.id, purpose, tripId || null, amount]
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
    customer: {
      email: user.email || `${user.phone.replace('+', '')}@riders.flytte.app`,
      phonenumber: user.phone,
      name: user.name,
    },
    customizations: {
      title: 'Flytte',
      description: purpose === 'topup' ? 'Flytte wallet top-up' : `Flytte trip #${tripId}`,
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
    } else if (p.purpose === 'trip' && p.trip_id) {
      await ledger.markTripPaid(t, p.trip_id);
    }
    return { ...p, status: 'successful' };
  });
}

// Flutterwave signs webhooks with the secret hash set in its dashboard.
function webhookAuthentic(req) {
  const got = Buffer.from(String(req.headers['verif-hash'] || ''));
  const want = Buffer.from(FLW_HASH);
  return FLW_HASH.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { enabled, demo, available, PaymentsUnavailable, createCheckout, verifyAndApply, webhookAuthentic, _applyPayment: applyPayment };
