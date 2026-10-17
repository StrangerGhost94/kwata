// Sign-in codes in Telegram, through the Telegram Gateway API (gatewayapi.telegram.org).
// The code arrives in the person's Telegram app from Telegram's official "Verification Codes" chat.
// Needs TELEGRAM_GATEWAY_TOKEN (gateway.telegram.org → account → API token) in Railway → Variables.
// Cost: about $0.01 per delivered code, charged only when delivered; codes to your own number are free.
// Without the token, Telegram isn't offered on a live server; a local server prints codes in its log.
const LIVE = !!process.env.DATABASE_URL || process.env.NODE_ENV === 'production';
const API = process.env.TELEGRAM_GATEWAY_API || 'https://gatewayapi.telegram.org';

const configured = () => !!process.env.TELEGRAM_GATEWAY_TOKEN;
const enabled = () => configured() || !LIVE;
const demo = () => !configured() && !LIVE;

async function call(method, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TELEGRAM_GATEWAY_TOKEN}` },
      body: JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!out.ok) { const e = new Error(out.error || `HTTP ${r.status}`); e.code = out.error; throw e; }
    return out.result;
  } finally { clearTimeout(t); }
}

// Check first (free when the number has no Telegram), then send on the same request: one fee in total.
async function sendCode(phone, code, ttlSec = 300) {
  if (!configured()) {
    if (LIVE) throw new Error('Telegram is not set up.');
    console.log(`[telegram demo] to ${phone}: ${code} is your Flytte code.`);
    return { demo: true };
  }
  let check;
  try { check = await call('checkSendAbility', { phone_number: phone }); }
  catch (e) { console.error('Telegram check failed:', e.message); const x = new Error('no telegram'); x.noTelegram = true; throw x; }
  try {
    const sent = await call('sendVerificationMessage', { phone_number: phone, request_id: check.request_id, code, ttl: ttlSec });
    return { id: sent.request_id };
  } catch (e) { console.error('Telegram send failed:', e.message); throw new Error('Telegram not sent'); }
}

module.exports = { configured, enabled, demo, sendCode };
