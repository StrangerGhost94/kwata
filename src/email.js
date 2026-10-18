// Email through Resend (resend.com), the same service as the user's other apps.
// Set RESEND_API_KEY and EMAIL_FROM (e.g. "Flytte <receipts@flytte.co>") in Railway → Variables, after
// flytte.co is verified as a sending domain in Resend. Without them a local server prints emails to its
// log (demo), and a live server simply doesn't offer email.
const LIVE = !!process.env.DATABASE_URL || process.env.NODE_ENV === 'production';
const configured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const enabled = () => configured() || !LIVE;
const demo = () => !configured() && !LIVE;
const sent = []; // demo outbox (tests read it)

async function send({ to, subject, html, text, tag }) {
  if (!configured()) {
    if (LIVE) throw new Error('Email is not set up.');
    sent.push({ to, subject, html, text, tag, at: Date.now() }); if (sent.length > 50) sent.shift();
    console.log(`[email demo] to ${to}: ${subject}`);
    return { demo: true };
  }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text, ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}), ...(tag ? { tags: [{ name: 'type', value: tag }] } : {}) }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.message || `Resend error ${r.status}`);
    return { id: out.id };
  } finally { clearTimeout(t); }
}

module.exports = { configured, enabled, demo, send, _outbox: sent };
