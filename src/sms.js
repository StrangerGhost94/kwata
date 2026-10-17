// SMS sign-in codes, sent through EgoSMS (Pahappa, Kampala).
// Set EGOSMS_USERNAME and EGOSMS_PASSWORD (Comms → Settings → API Settings) in Railway → Variables, and
// EGOSMS_SENDER once your sender ID (e.g. Flytte) is approved; until then the account's default senders are used.
// Without them, a live server keeps password sign-in; a local server prints codes in its log instead.
const LIVE = !!process.env.DATABASE_URL || process.env.NODE_ENV === 'production';
const URL = process.env.EGOSMS_URL || 'https://comms.egosms.co/api/v1/json/'; // EgoSMS Comms API (developers.pahappa.com)

const configured = () => !!(process.env.EGOSMS_USERNAME && process.env.EGOSMS_PASSWORD);
const enabled = () => configured() || !LIVE;
const demo = () => !configured() && !LIVE;

async function send(phone, message) {
  const number = String(phone).replace(/^\+/, '');
  if (!configured()) {
    if (LIVE) throw new Error('SMS is not set up.');
    console.log(`[sms demo] to ${number}: ${message}`);
    return { demo: true };
  }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(URL, {
      method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'SendSms',
        userdata: { username: process.env.EGOSMS_USERNAME, password: process.env.EGOSMS_PASSWORD },
        msgdata: [{ number, message, priority: 0, ...(process.env.EGOSMS_SENDER ? { senderid: process.env.EGOSMS_SENDER } : {}) }],
      }),
    });
    const out = await r.json().catch(() => ({}));
    // Failures still come back as HTTP 200, so the Status field decides.
    if (!r.ok || out.Status !== 'OK') { console.error('EgoSMS failed:', r.status, out.Message || ''); throw new Error('SMS not sent'); }
    return { cost: out.Cost, balance: out.Balance };
  } finally { clearTimeout(t); }
}

module.exports = { configured, enabled, demo, send };
