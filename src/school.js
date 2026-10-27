// School runs: a parent sets up a plan once (child, home, school, days and times) and Flytte books the
// rides ahead of time, with only drivers vetted for children, the same driver every day when possible,
// and a handover code at the school gate:
//   - morning (home → school): the parent gives the usual pickup PIN; the school gives the driver the
//     plan's handover code when the child is handed over.
//   - afternoon (school → home): the school gives the driver the handover code before releasing the child
//     (that's the trip's PIN); the parent gives the delivery code at home.
const crypto = require('crypto');
const db = require('./db');
const { quote } = require('./pricing');

const kampala = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3);   // UTC fields of this = Kampala's clock
const atKampala = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+03:00`);
const code = () => String(crypto.randomInt(1000, 10000));

// Book the next day and a half of rides for every active plan (each leg once; safe to run often).
async function scheduleDue(now = new Date()) {
  const { rows: plans } = await db.query('SELECT p.*, u.phone AS parent_phone FROM ride_plans p JOIN users u ON u.id = p.parent_id WHERE p.active');
  let made = 0;
  for (const p of plans) {
    const days = String(p.days).split(',').map(Number);
    for (let add = 0; add <= 1; add++) {
      const k = kampala(new Date(now.getTime() + add * 86400e3));
      const dow = k.getUTCDay() === 0 ? 7 : k.getUTCDay();   // 1 = Monday … 7 = Sunday
      if (!days.includes(dow)) continue;
      const ymd = k.toISOString().slice(0, 10);
      for (const leg of ['morning', 'afternoon']) {
        if (!p[leg]) continue;
        const when = atKampala(ymd, p[leg]);
        const ahead = when.getTime() - now.getTime();
        if (ahead < 25 * 60e3 || ahead > 36 * 3600e3) continue;
        const home = { lat: p.home_lat, lng: p.home_lng, address: p.home_address }, school = { lat: p.school_lat, lng: p.school_lng, address: p.school_address };
        const [from, to] = leg === 'morning' ? [home, school] : [school, home];
        const q = await quote(from, to);
        const o = q.options.find((x) => x.id === 'car');
        if (!o) continue;
        const handover = p.handover_code;
        const r = await db.query(`INSERT INTO trips(rider_id, service, pickup_lat, pickup_lng, pickup_address, drop_lat, drop_lng, drop_address,
            distance_km, duration_min, fare, payment_method, pin, share_token, notes, scheduled_for, passenger, drop_code, status, plan_id, plan_leg)
          VALUES ($1,'car',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'scheduled',$18,$19)
          ON CONFLICT (plan_id, plan_leg, scheduled_for) WHERE plan_id IS NOT NULL DO NOTHING RETURNING id`,
        [p.parent_id, from.lat, from.lng, from.address, to.lat, to.lng, to.address, q.distanceKm, o.durationMin, o.regularFare, p.payment_method,
          leg === 'morning' ? code() : handover, crypto.randomBytes(12).toString('base64url'),
          `School run: ${p.child_name}. ${leg === 'morning' ? `Hand ${p.child_name} to ${p.school_contact_name || 'the school'} and ask them for the handover code.` : `Ask ${p.school_contact_name || 'the school'} for the handover code before ${p.child_name} gets in.`}`,
          when, JSON.stringify({ name: p.child_name, phone: p.parent_phone, child: true }), leg === 'morning' ? handover : code(), p.id, leg]);
        made += r.rows.length;
      }
    }
  }
  return made;
}

// After a school run is completed: that driver becomes the child's usual driver (if there isn't one yet).
async function afterCompleted(trip) {
  if (!trip.plan_id || !trip.driver_id) return;
  await db.query('UPDATE ride_plans SET preferred_driver_id = COALESCE(preferred_driver_id, $1) WHERE id = $2', [trip.driver_id, trip.plan_id]);
}

module.exports = { scheduleDue, afterCompleted, code, kampala };
