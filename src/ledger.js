// Money movements. Every balance change also writes a row in `transactions`
// so the books can always be reconciled.
const { getSettings } = require('./pricing');

async function commissionFor(fare) {
  const s = await getSettings();
  return Math.round((fare * s.commissionPct) / 100);
}

// Called inside a db transaction when a driver completes a trip.
// `fare` is the full price; the rider pays `fare - discount` and Kwata covers the
// discount, so the driver always earns on the full fare.
async function settleCompletedTrip(t, trip) {
  const commission = await commissionFor(trip.fare);
  const discount = trip.discount || 0;
  const payable = trip.fare - discount;
  let method = trip.payment_method;
  let paymentStatus = 'pending';

  if (method === 'wallet') {
    const rider = await t.one('SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE', [trip.rider_id]);
    if (rider.wallet_balance >= payable) {
      await t.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [payable, trip.rider_id]);
      await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_payment',$2,$3,'Paid from wallet')",
        [trip.rider_id, -payable, trip.id]);
      await creditDriver(t, trip, commission);
      paymentStatus = 'paid';
    } else {
      method = 'cash'; // not enough balance at the end: driver collects cash
    }
  }

  if (method === 'cash') {
    // Driver already holds the cash (fare minus any discount). We take our commission
    // from their balance and pay them back the discount Kwata gave the rider.
    await t.query('UPDATE drivers SET earnings_balance = earnings_balance - $1 + $2 WHERE user_id = $3', [commission, discount, trip.driver_id]);
    await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'commission',$2,$3,'Commission on cash trip')",
      [trip.driver_id, -commission, trip.id]);
    if (discount) await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'promo_cover',$2,$3,'Rider discount paid by Kwata')",
      [trip.driver_id, discount, trip.id]);
    paymentStatus = 'paid';
  }

  await t.query(
    'UPDATE trips SET commission = $1, payment_method = $2, payment_status = $3 WHERE id = $4',
    [commission, method, paymentStatus, trip.id]
  );
  const growth = require('./growth');
  const referral = await growth.afterCompleted(t, trip);
  return { commission, method, paymentStatus, referral };
}

// Tip after the trip: from the wallet (goes straight to the driver, no commission)
// or in cash (recorded so the driver sees it).
async function tipDriver(t, trip, amount, method) {
  if (method === 'wallet') {
    const rider = await t.one('SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE', [trip.rider_id]);
    if (rider.wallet_balance < amount) return { error: 'Not enough in your wallet for that tip.' };
    await t.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [amount, trip.rider_id]);
    await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'tip',$2,$3,'Tip for your driver')", [trip.rider_id, -amount, trip.id]);
    await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [amount, trip.driver_id]);
    await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'tip',$2,$3,'Tip from rider')", [trip.driver_id, amount, trip.id]);
  } else {
    await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'tip_cash',0,$2,$3)", [trip.driver_id, trip.id, `Cash tip UGX ${amount.toLocaleString()}`]);
  }
  await t.query('UPDATE trips SET tip = $1, tip_method = $2 WHERE id = $3', [amount, method, trip.id]);
  return { ok: true };
}

async function creditDriver(t, trip, commission) {
  const net = trip.fare - commission;
  await t.query('UPDATE drivers SET earnings_balance = earnings_balance + $1 WHERE user_id = $2', [net, trip.driver_id]);
  await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_earning',$2,$3,$4)",
    [trip.driver_id, net, trip.id, `Fare ${trip.fare} less commission ${commission}`]);
}

// For mobile money / card trips once the payment is confirmed.
async function markTripPaid(t, tripId) {
  const trip = await t.one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId]);
  if (!trip || trip.payment_status === 'paid' || trip.status !== 'completed') return trip;
  await t.query("UPDATE trips SET payment_status = 'paid' WHERE id = $1", [tripId]);
  await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_payment',$2,$3,$4)",
    [trip.rider_id, -(trip.fare - (trip.discount || 0)), trip.id, `Paid by ${trip.payment_method}`]);
  await creditDriver(t, trip, trip.commission);
  return { ...trip, payment_status: 'paid' };
}

async function creditWallet(t, userId, amount, note) {
  await t.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [amount, userId]);
  await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'topup',$2,$3)", [userId, amount, note]);
}

module.exports = { settleCompletedTrip, markTripPaid, creditWallet, tipDriver };
