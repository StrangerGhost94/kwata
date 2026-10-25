// Night-time trip sharing helpers: when a trip starts in the rider's night window, their emergency
// contact gets the driver, plate and live link. By SMS when EgoSMS is set up; otherwise (or if the SMS
// fails) the rider is offered the same message as a one-tap WhatsApp send.
// Status per trip (trips.night_share_status): 'sms' sent by SMS, 'whatsapp' offered on WhatsApp,
// 'failed' something went wrong before the rider could be told (still offered on WhatsApp in the app).

// From the rider's chosen time until 5 am, Kampala time (UTC+3, no daylight saving).
const inNight = (from, now = new Date()) => {
  const k = new Date(now.getTime() + 3 * 3600e3), mins = k.getUTCHours() * 60 + k.getUTCMinutes();
  const [h, m] = String(from || '21:00').split(':').map(Number), start = h * 60 + m;
  return mins >= start || mins < 5 * 60;
};

const first = (s) => String(s || '').trim().split(/\s+/)[0];
const liveLink = (t) => `${process.env.PUBLIC_URL || 'https://flytte.co'}/t/${t.share_token}`;

// The one message both channels send. t is a row from realtime.loadTrip.
function message(t) {
  const ride = ['car', 'comfort', 'airport'].includes(t.service) ? 'car' : 'boda';
  return `${first(t.rider_name)} is on a Flytte ${ride} (${t.plate || ''}, driver ${first(t.driver_name)}) to ${String(t.drop_address || '').split(',')[0]}. Follow live: ${liveLink(t)}`;
}

const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

// +256772123456 -> +256 772 123 456 (how the apps show numbers)
function pretty(phone) {
  const p = String(phone || '');
  const m = /^\+(\d{3})(\d{3})(\d{3})(\d{3})$/.exec(p);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}

// Monday 00:00 Kampala time, as a Date, for "this week" counts.
function weekStart(now = new Date()) {
  const k = new Date(now.getTime() + 3 * 3600e3);
  const back = (k.getUTCDay() + 6) % 7;
  const mon = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - back);
  return new Date(mon - 3 * 3600e3);
}

module.exports = { inNight, message, waLink, pretty, weekStart, liveLink };
