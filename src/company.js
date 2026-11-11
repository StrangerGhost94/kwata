// flytte.co/company: who is behind Flytte. A plain, public page with the company's legal details,
// for business checks (Dun & Bradstreet for a D-U-N-S number, Apple, Google, banks, partners).
// It is written out by the server (no scripts), so reviewers and crawlers see everything.
//
// Only what you set in Railway → Variables is shown; nothing is made up:
//   COMPANY_NAME        the registered legal name, exactly as on the certificate of incorporation
//   COMPANY_REG_NO      the registration number (URSB)
//   COMPANY_TIN         tax identification number (optional)
//   COMPANY_ADDRESS     the registered / physical address; use " | " between lines
//   COMPANY_FOUNDED     year or date of incorporation (optional)
//   COMPANY_DIRECTORS   names, comma-separated (optional)
//   COMPANY_EMAIL       default: SUPPORT_EMAIL, else support@flytte.co
//   COMPANY_PHONE       default: SUPPORT_PHONE
const env = (k) => String(process.env[k] || '').trim();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const F = ['M76.82 0V21.29C76.82 27.37 73.58 32.99 68.31 36.03L26.95 59.91C23.05 62.16 7.5 68.5 0 86.42V57.23C0 49.27 4.25 41.9 11.15 37.92L26.95 28.8Z',
  'M68.7 52.48V72.14C68.7 79.23 64.92 85.78 58.78 89.33L38.18 101.22C31.23 105.24 26.95 112.65 26.95 120.68V145.05H0V116.04C0 101.26 7.89 87.6 20.69 80.2L26.95 76.59Z'];

function details(supportPhone) {
  return {
    name: env('COMPANY_NAME'), regNo: env('COMPANY_REG_NO'), tin: env('COMPANY_TIN'),
    address: env('COMPANY_ADDRESS').split('|').map((x) => x.trim()).filter(Boolean),
    founded: env('COMPANY_FOUNDED'), directors: env('COMPANY_DIRECTORS').split(',').map((x) => x.trim()).filter(Boolean),
    email: env('COMPANY_EMAIL') || env('SUPPORT_EMAIL') || 'support@flytte.co',
    phone: env('COMPANY_PHONE') || supportPhone || '',
  };
}

function html(supportPhone, site) {
  const c = details(supportPhone), name = c.name || 'Flytte';
  const row = (k, v) => (v ? `<tr><th scope="row">${k}</th><td>${v}</td></tr>` : '');
  const ld = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Flytte', ...(c.name ? { legalName: c.name } : {}), url: site,
    logo: `${site}/icons/flytte-icon-512.png`, email: c.email, ...(c.phone ? { telephone: c.phone } : {}),
    ...(c.address.length ? { address: { '@type': 'PostalAddress', streetAddress: c.address.join(', '), addressCountry: 'UG' } } : {}),
    ...(c.founded ? { foundingDate: c.founded } : {}), areaServed: 'Kampala, Uganda' };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(name)} · Company information</title>
<meta name="description" content="${esc(name)} operates Flytte, the ride-hailing and delivery service in Kampala, Uganda. Company details and contacts.">
<link rel="canonical" href="${esc(site)}/company">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/legal.css">
<style>
  .co-table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; }
  .co-table th, .co-table td { text-align: left; vertical-align: top; padding: 11px 0; border-bottom: 1px solid var(--lg-line); }
  .co-table th { width: 38%; font-weight: 600; color: var(--lg-ink2); padding-right: 14px; }
  .co-table tr:last-child th, .co-table tr:last-child td { border-bottom: 0; }
  .co-links a { margin-right: 14px; white-space: nowrap; }
</style>
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="lg-top"><a href="/about"><svg width="11.7" height="22" viewBox="0 0 76.82 145.05" aria-hidden="true"><path fill="#073B42" d="${F[0]}"/><path fill="#0E6E73" d="${F[1]}"/></svg><span class="fl-word">flytte</span></a></header>
<main>
<h1>Company information</h1>
<p class="lg-date">${esc(name)}${c.name ? ', trading as Flytte' : ''}</p>

<div class="lg-sum"><b>What we do</b>
<p style="margin:0">${esc(name)} runs <strong>Flytte</strong>, a ride-hailing and delivery service in Kampala, Uganda. Riders book boda boda and car rides, parcel deliveries, errands and airport transfers in the Flytte app, and pay with cash, MTN or Airtel Mobile Money, card or an in-app wallet. Independent drivers take trips through the Flytte Driver app.</p></div>

<h2>Company details</h2>
<table class="co-table">
${row('Legal name', c.name && esc(c.name))}
${row('Trading name', 'Flytte')}
${row('Registration number', c.regNo && esc(c.regNo))}
${row('Tax identification number', c.tin && esc(c.tin))}
${row('Incorporated', c.founded && esc(c.founded))}
${row('Country', 'Uganda')}
${row(c.address.length ? 'Registered address' : '', c.address.map(esc).join('<br>'))}
${row('Directors', c.directors.map(esc).join('<br>'))}
${row('Business', 'Ride-hailing, delivery and related mobile payment services (passenger transport technology)')}
${row('Website', `<a href="${esc(site)}">${esc(site.replace(/^https?:\/\//, ''))}</a>`)}
</table>

<h2>Contact</h2>
<table class="co-table">
${row('Email', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`)}
${row('Phone', c.phone && `<a href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a>`)}
${row('Customer support', '<a href="/support">flytte.co/support</a>')}
</table>

<h2>Products</h2>
<ul>
  <li><b>Flytte</b>: the rider app for rides, parcels, errands and airport transfers.</li>
  <li><b>Flytte Driver</b>: the app for drivers and couriers.</li>
  <li><b>Flytte for Business</b> and <b>Flytte for Shops</b>: company accounts for staff rides and customer deliveries.</li>
</ul>

<h2>Policies</h2>
<p class="co-links"><a href="/terms">Terms of Service</a> <a href="/privacy">Privacy Policy</a> <a href="/delete-account">Delete your account</a> <a href="/about">About Flytte</a></p>
</main>
</body>
</html>
`;
}

module.exports = { details, html };
