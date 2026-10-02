// MTN / Airtel Mobile Money and card payments via Flutterwave Standard checkout.
// Without FLW_SECRET_KEY the app runs in DEMO mode: payments succeed instantly
// so you can test every flow before signing a payment contract.
const crypto = require('crypto');
const db = require('./db');
const ledger = require('./ledger');

const FLW_KEY = process.env.FLW_SECRET_KEY || '';
const FLW_HASH = process.env.FLW_WEBHOOK_HASH || '';
const enabled = () => !!FLW_KEY;

function newRef(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function createCheckout({ user, amount, purpose, tripId, method, baseUrl }) {
  amount = Math.round(amount);
  const tx_ref = newRef(purpose === 'topup' ? 'KWT-TOP' : 'KWT-TRP');
  await db.query(
    'INSERT INTO payments(tx_ref, user_id, purpose, trip_id, amount) VALUES ($1,$2,$3,$4,$5)',
    [tx_ref, user.id, purpose, tripId || null, amount]
  );

  if (!enabled()) {
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
      email: user.email || `${user.phone.replace('+', '')}@riders.kwata.app`,
      phonenumber: user.phone,
      name: user.name,
    },
    customizations: {
      title: 'Kwata',
      description: purpose === 'topup' ? 'Kwata wallet top-up' : `Kwata trip #${tripId}`,
    },
  };
  const r = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${FLW_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status !== 'success') {
    throw new Error(data.message || 'Could not start payment. Try again.');
  }
  return { demo: false, tx_ref, link: data.data.link };
}

// Confirm with Flutterwave directly — never trust the redirect alone.
async function verifyAndApply(tx_ref) {
  const p = await db.one('SELECT * FROM payments WHERE tx_ref = $1', [tx_ref]);
  if (!p) return { ok: false, reason: 'unknown payment' };
  if (p.status === 'successful') return { ok: true, payment: p };
  if (!enabled()) return { ok: false, reason: 'payments disabled' };

  const r = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`, {
    headers: { Authorization: `Bearer ${FLW_KEY}` },
  });
  const data = await r.json().catch(() => ({}));
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

function webhookAuthentic(req) {
  return FLW_HASH && req.headers['verif-hash'] === FLW_HASH;
}

module.exports = { enabled, createCheckout, verifyAndApply, webhookAuthentic };
