// Sign-in codes on WhatsApp, through Meta's WhatsApp Cloud API (graph.facebook.com).
// Needs, in Railway → Variables:
//   WHATSAPP_TOKEN     a permanent System User access token (Meta Business → System users)
//   WHATSAPP_PHONE_ID  the "Phone number ID" of Flytte's WhatsApp sender (WhatsApp Manager → API setup)
//   WHATSAPP_TEMPLATE  an approved AUTHENTICATION template with a "Copy code" button (default: flytte_code)
//   WHATSAPP_LANG      the template's language code (default: en)
// Without them, WhatsApp isn't offered on a live server; a local server prints codes in its log instead.
const LIVE = !!process.env.DATABASE_URL || process.env.NODE_ENV === 'production';
const API = process.env.WHATSAPP_API || 'https://graph.facebook.com/v21.0';

const configured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const enabled = () => configured() || !LIVE;
const demo = () => !configured() && !LIVE;

async function sendCode(phone, code) {
  const to = String(phone).replace(/^\+/, '');
  if (!configured()) {
    if (LIVE) throw new Error('WhatsApp is not set up.');
    console.log(`[whatsapp demo] to ${to}: ${code} is your Flytte code.`);
    return { demo: true };
  }
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(`${API}/${encodeURIComponent(process.env.WHATSAPP_PHONE_ID)}/messages`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE || 'flytte_code',
          language: { code: process.env.WHATSAPP_LANG || 'en' },
          // Authentication templates take the code twice: once for the text, once for the copy-code button.
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !(out.messages && out.messages.length)) {
      console.error('WhatsApp failed:', r.status, (out.error && out.error.message) || '');
      throw new Error('WhatsApp not sent');
    }
    return { id: out.messages[0].id };
  } finally { clearTimeout(t); }
}

module.exports = { configured, enabled, demo, sendCode };
