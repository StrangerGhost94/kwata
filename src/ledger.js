// Money movements. Every balance change also writes a row in `transactions`
// so the books can always be reconciled.
const { getSettings } = require('./pricing');

async function commissionFor(fare) {
  const s = await getSettings();
  return Math.round((fare * s.commissionPct) / 100);
}

// Called inside a db transaction when a driver completes a trip.
async function settleCompletedTrip(t, trip) {
  const commission = await commissionFor(trip.fare);
  let method = trip.payment_method;
  let paymentStatus = 'pending';

  if (method === 'wallet') {
    const rider = await t.one('SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE', [trip.rider_id]);
    if (rider.wallet_balance >= trip.fare) {
      await t.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [trip.fare, trip.rider_id]);
      await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'trip_payment',$2,$3,'Paid from wallet')",
        [trip.rider_id, -trip.fare, trip.id]);
      await creditDriver(t, trip, commission);
      paymentStatus = 'paid';
    } else {
      method = 'cash'; // not enough balance at the end: driver collects cash
    }
  }

  if (method === 'cash') {
    // Driver already holds the cash; we take our commission from their balance.
    await t.query('UPDATE drivers SET earnings_balance = earnings_balance - $1 WHERE user_id = $2', [commission, trip.driver_id]);
    await t.query("INSERT INTO transactions(user_id, type, amount, trip_id, note) VALUES ($1,'commission',$2,$3,'Commission on cash trip')",
      [trip.driver_id, -commission, trip.id]);
    paymentStatus = 'paid';
  }

  await t.query(
    'UPDATE trips SET commission = $1, payment_method = $2, payment_status = $3 WHERE id = $4',
    [commission, method, paymentStatus, trip.id]
  );
  return { commission, method, paymentStatus };
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
    [trip.rider_id, -trip.fare, trip.id, `Paid by ${trip.payment_method}`]);
  await creditDriver(t, trip, trip.commission);
  return { ...trip, payment_status: 'paid' };
}

async function creditWallet(t, userId, amount, note) {
  await t.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [amount, userId]);
  await t.query("INSERT INTO transactions(user_id, type, amount, note) VALUES ($1,'topup',$2,$3)", [userId, amount, note]);
}

module.exports = { settleCompletedTrip, markTripPaid, creditWallet };
