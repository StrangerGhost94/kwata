// Trip receipts by email. Sent a few minutes after a trip is completed and paid, so a tip is
// included, and only once per trip. A background check every minute finds trips that are due,
// so nothing is lost if the server restarts.
const db = require('./db');
const email = require('./email');

const DELAY_SEC = Number(process.env.RECEIPT_DELAY_SEC || 300);
const SVC = { boda: 'Flytte Boda', car: 'Flytte Car', comfort: 'Flytte Comfort', parcel: 'Flytte Parcel', airport: 'Flytte Airport' };
const PAY = { cash: 'Cash', wallet: 'Flytte Wallet', momo: 'Mobile Money', card: 'Card' };
const ugx = (n) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-UG');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Links and the logo in emails point at the public site (never a *.railway.app address).
const site = () => { const u = process.env.EMAIL_SITE_URL || process.env.PUBLIC_URL || ''; return /^https:\/\//.test(u) && !/railway\.app/.test(u) ? u.replace(/\/$/, '') : 'https://flytte.co'; };
// The real Flytte wordmark (gold F + white "lytte"), for the dark email header.
const logo = () => `<img src="${site()}/img/email-logo.png?v=1" width="112" height="36" alt="Flytte" style="display:block;border:0;height:36px;width:112px">`;

function build(t) {
  const no = `FLY-${String(t.id).padStart(6, '0')}`;
  const when = new Date(t.completed_at || t.created_at);
  const date = when.toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const discount = t.discount || 0, tip = t.tip || 0;
  const total = t.fare - discount + tip;
  const rows = [['Trip fare', ugx(t.fare)], ...(discount ? [[t.promo_label || 'Discount', '−' + ugx(discount)]] : []), ...(tip ? [['Tip for ' + String(t.driver_name || 'your driver').split(' ')[0], ugx(tip)]] : [])];
  const first = String(t.rider_name || '').trim().split(/\s+/)[0] || 'there';
  const subject = `Your Flytte receipt · ${date}`;
  const text = [`Hi ${first}, thanks for riding with Flytte.`, '', `Receipt ${no} · ${date}`, `${SVC[t.service] || 'Flytte'}: ${t.pickup_address} → ${t.drop_address}`,
    ...rows.map(([a, b]) => `${a}: ${b}`), `Total: ${ugx(total)} (${PAY[t.payment_method] || t.payment_method})`,
    t.driver_name ? `Driver: ${t.driver_name}${t.plate ? ' · ' + t.plate : ''}` : '', '', `Need help with this trip? Open Activity in the Flytte app.`, site()].filter((x) => x !== '').join('\n');
  const tr = (a, b, strong) => `<tr><td style="padding:9px 0;color:#6b6b70;font-size:14px;border-bottom:1px solid #f0f0f2">${esc(a)}</td><td align="right" style="padding:9px 0;font-size:14px;border-bottom:1px solid #f0f0f2;${strong ? 'font-weight:700;color:#141414' : 'color:#141414'}">${esc(b)}</td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141414">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:#141414;padding:20px 24px">${logo()}</td></tr>
<tr><td style="padding:26px 24px 8px">
<p style="margin:0 0 4px;font-size:15px;color:#6b6b70">Thanks for riding, ${esc(first)}</p>
<p style="margin:0;font-size:34px;font-weight:800;letter-spacing:-.03em">${ugx(total)}</p>
<p style="margin:4px 0 0;font-size:13px;color:#6b6b70">${esc(PAY[t.payment_method] || t.payment_method)} · Paid · ${esc(date)}</p></td></tr>
<tr><td style="padding:18px 24px 4px">
<p style="margin:0 0 2px;font-size:12px;color:#8e8e93;text-transform:uppercase;letter-spacing:.06em;font-weight:700">From</p><p style="margin:0 0 12px;font-size:15px;font-weight:600">${esc(t.pickup_address)}</p>
<p style="margin:0 0 2px;font-size:12px;color:#8e8e93;text-transform:uppercase;letter-spacing:.06em;font-weight:700">To</p><p style="margin:0;font-size:15px;font-weight:600">${esc(t.drop_address)}</p></td></tr>
<tr><td style="padding:14px 24px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rows.map(([a, b]) => tr(a, b)).join('')}
${tr('Total', ugx(total), true)}
${tr('Service', `${SVC[t.service] || 'Flytte'}${t.distance_km ? ' · ' + Number(t.distance_km).toFixed(1) + ' km' : ''}`)}
${t.driver_name ? tr('Driver', `${t.driver_name}${t.plate ? ' · ' + t.plate : ''}`) : ''}
</table></td></tr>
<tr><td style="padding:16px 24px 26px;font-size:13px;color:#6b6b70;line-height:1.5">Receipt ${no}. Something wrong with this trip, or left something behind? Open <b>Activity</b> in the Flytte app and tap <b>Get help</b>.</td></tr>
</table>
<p style="font-size:12px;color:#8e8e93;margin:16px 0 0">Flytte · Kampala, Uganda · <a href="${esc(site())}" style="color:#8e8e93">${esc(site().replace(/^https?:\/\//, ''))}</a><br>You get receipts because you added this email in Flytte. Turn them off in Account → Email.</p>
</td></tr></table></body></html>`;
  return { subject, html, text };
}

async function sendDue({ delaySec = DELAY_SEC } = {}) {
  if (!email.enabled()) return 0;
  const { rows } = await db.query(`SELECT t.*, r.name AS rider_name, r.email AS rider_email, d.name AS driver_name, dv.plate
    FROM trips t JOIN users r ON r.id = t.rider_id LEFT JOIN users d ON d.id = t.driver_id LEFT JOIN drivers dv ON dv.user_id = t.driver_id
    WHERE t.status = 'completed' AND t.payment_status = 'paid' AND t.receipt_sent_at IS NULL
      AND r.email IS NOT NULL AND r.email_verified = TRUE AND r.email_receipts = TRUE AND r.deleted_at IS NULL
      AND t.completed_at < NOW() - ($1 || ' seconds')::interval AND t.completed_at > NOW() - INTERVAL '2 days'
    ORDER BY t.id LIMIT 25`, [String(delaySec)]);
  let n = 0;
  for (const t of rows) {
    // Claim it first so two servers never send the same receipt twice.
    const claim = await db.one('UPDATE trips SET receipt_sent_at = NOW() WHERE id = $1 AND receipt_sent_at IS NULL RETURNING id', [t.id]);
    if (!claim) continue;
    try { await email.send({ to: t.rider_email, ...build(t), tag: 'receipt' }); n++; }
    catch (e) { console.error('receipt email', t.id, e.message); await db.query('UPDATE trips SET receipt_sent_at = NULL WHERE id = $1', [t.id]).catch(() => {}); }
  }
  return n;
}

function start() {
  const tick = () => sendDue().catch((e) => console.error('receipts', e.message));
  setTimeout(tick, 20e3);
  return setInterval(tick, Number(process.env.RECEIPT_TICK_MS || 60e3));
}

module.exports = { logo, site, build, sendDue, start };
