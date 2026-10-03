// Shared helpers for the rider, driver, admin and tracking pages.
(function () {
  const K = {};
  const APP = document.body.dataset.app || 'rider';
  const KEY = 'kwata_' + APP;
  K.KAMPALA = { lat: 0.3136, lng: 32.5811 };

  K.PLACES = [
    { name: 'Entebbe International Airport', address: 'Entebbe', lat: 0.0424, lng: 32.4435, icon: 'plane' },
    { name: 'Acacia Mall', address: 'Kisementi, Kololo', lat: 0.3383, lng: 32.5873 },
    { name: 'Garden City Mall', address: 'Yusuf Lule Road', lat: 0.3181, lng: 32.5917 },
    { name: 'Kampala Old Taxi Park', address: 'Central Division', lat: 0.3127, lng: 32.5766 },
    { name: 'Makerere University', address: 'Makerere', lat: 0.3355, lng: 32.5682 },
    { name: 'Mulago National Referral Hospital', address: 'Mulago', lat: 0.3379, lng: 32.5757 },
    { name: 'Village Mall Bugolobi', address: 'Bugolobi', lat: 0.3177, lng: 32.6165 },
    { name: 'Ntinda Trading Centre', address: 'Ntinda', lat: 0.3536, lng: 32.6142 },
    { name: 'Kampala Serena Hotel', address: 'Kintu Road, Nakasero', lat: 0.3164, lng: 32.5841 },
  ];

  // ---------- icons ----------
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
    work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    phone: '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    msg: '<path d="M4 5h16v11H8l-4 4z"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-3v3"/><circle cx="16.5" cy="13.5" r="1.3"/>',
    momo: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    locate: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
    logout: '<path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="m4 12 16-8-6 16-2-7z"/>',
    person: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
    nav: '<path d="m12 3 7 18-7-4-7 4z"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    plane: '<path d="M10 3h1l4 7h5a1.5 1.5 0 0 1 0 3h-5l-4 7h-1l1.5-7H7l-2 2.5H4l1-4-1-4h1L7 10h4.5z"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13M12 8c-2-4-6-4-6-1.5S10 8 12 8c2 0 6 1 6-1.5S14 4 12 8"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    sos: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    bell: '<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M6 16c.6-1.6 1.7-2.3 3-2.3s2.4.7 3 2.3M14 10h4M14 13h3"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.6 15 1.7 1.7 0 0 0 2 14H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    power: '<path d="M12 3v9M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  };
  K.ic = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${name === 'star' && cls.includes('fill') ? P.star : P[name] || ''}</svg>`;
  K.starSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';

  // ---------- vehicle art ----------
  // Premium 3D vehicle art: Microsoft Fluent 3D (MIT licence, see /img/vehicles/LICENSE-fluentui-emoji.txt)
  const VEH = { boda: 'Boda boda', car: 'Car', comfort: 'Comfort SUV', parcel: 'Parcel', airport: 'Airport transfer' };
  K.ART = Object.fromEntries(Object.entries(VEH).map(([k, alt]) => [k, `<img class="art-img" src="/img/vehicles/${k}.png" alt="" data-alt="${alt}" decoding="async">`]));
  Object.keys(VEH).forEach((k) => { const i = new Image(); i.src = `/img/vehicles/${k}.png`; });
  K.artFor = (service, vehicleType) => K.ART[service] || (vehicleType === 'car' ? K.ART.car : K.ART.boda);

  // ---------- brand: pin logo & night skyline ----------
  K.logo = (pin = '#FFC400', k = '#141414', size = 64) => `<svg class="pin" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 3C19.3 3 9 13.1 9 25.6 9 42 32 61 32 61s23-19 23-35.4C55 13.1 44.7 3 32 3z" fill="${pin}"/>
    <path d="M25.5 14v23M25.5 27.5 37.5 14M29.5 23.5l9 13.5" stroke="${k}" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
  // The speed-K: three speed lines and a forward-leaning K (as on the Kwata delivery box).
  K.markSvg = (cls = '') => `<svg class="wm-k ${cls}" viewBox="0 0 140 100" aria-hidden="true">
    <defs><linearGradient id="kg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD84A"/><stop offset="1" stop-color="#FFB300"/></linearGradient></defs>
    <g class="wm-lines" fill="url(#kg)"><path class="l1" d="M14 18H46L43 28H11Z"/><path class="l2" d="M6 38H42L39 48H3Z"/><path class="l3" d="M14 58H38L35 68H11Z"/></g>
    <g class="wm-body" fill="url(#kg)"><path d="M52 6H78L60 94H34Z"/><path d="M66 50L110 6H138L80 60Z"/><path d="M64 52L88 48L122 94H94Z"/></g></svg>`;
  K.wordmark = (driver) => `<div class="wm" aria-label="Kwata${driver ? ' Driver' : ''}">
    <div class="wm-row">${K.markSvg()}<span class="wm-t">wata</span></div>
    ${driver ? '<div class="wm-sub">DRIVER</div>' : ''}
    <div class="wm-tag">${(driver ? ['EARN', 'DRIVE', 'GROW'] : ['FAST', 'SAFE', 'LOCAL']).join('<i>•</i>')}</div></div>`;

  K.skyline = function (seed = 7) {
    let x = seed; const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
    let blds = '', wins = '', px = -10;
    while (px < 400) {
      const w = 18 + rnd() * 34, h = 50 + rnd() * 150, y = 220 - h;
      blds += `<rect x="${px.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h + 90}" fill="${rnd() > .5 ? '#121214' : '#17171A'}"/>`;
      if (rnd() > .7) blds += `<rect x="${(px + w / 2 - 1).toFixed(1)}" y="${(y - 18).toFixed(1)}" width="2" height="18" fill="#17171A"/>`;
      for (let wy = y + 8; wy < 214; wy += 10) for (let wx = px + 4; wx < px + w - 5; wx += 7) {
        const r = rnd();
        if (r > .62) wins += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="3" height="4" fill="${r > .9 ? '#FFFFFF' : '#FFC400'}" opacity="${(.25 + rnd() * .6).toFixed(2)}"/>`;
      }
      px += w + 2 + rnd() * 4;
    }
    return `<svg viewBox="0 0 390 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs><linearGradient id="sk${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E0E10" stop-opacity="0"/><stop offset=".55" stop-color="#2A1F05" stop-opacity=".55"/><stop offset="1" stop-color="#0E0E10"/></linearGradient>
      <filter id="gl${seed}" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs>
      <rect width="390" height="300" fill="url(#sk${seed})"/>
      ${blds}${wins}
      <rect y="218" width="390" height="82" fill="#0E0E10"/>
      <path d="M-20 300 C 90 250, 200 236, 410 232" stroke="#FFC400" stroke-width="6" fill="none" filter="url(#gl${seed})" opacity=".85"/>
      <path d="M-20 300 C 90 250, 200 236, 410 232" stroke="#FFE38A" stroke-width="2" fill="none"/>
      <path d="M-20 286 C 110 254, 230 246, 410 244" stroke="#FF8A00" stroke-width="3" fill="none" filter="url(#gl${seed})" opacity=".6"/>
    </svg>`;
  };

  // ---------- vehicle markers (top view) ----------
  const TOP = {
    car: '<svg viewBox="0 0 40 40"><rect x="12.5" y="4" width="15" height="32" rx="6" fill="#141414" stroke="#fff" stroke-width="1.6"/><path d="M14.5 12.5c2-2.2 9-2.2 11 0v4h-11z" fill="#8C96A0"/><path d="M14.5 29c2 1.6 9 1.6 11 0v-3.5h-11z" fill="#8C96A0"/><rect x="14.5" y="17" width="11" height="8" rx="1" fill="#222"/></svg>',
    boda: '<svg viewBox="0 0 40 40"><rect x="17" y="3" width="6" height="34" rx="3" fill="#141414" stroke="#fff" stroke-width="1.4"/><rect x="10" y="9" width="20" height="3.2" rx="1.6" fill="#141414" stroke="#fff" stroke-width="1"/><circle cx="20" cy="21" r="5.5" fill="#FFC400" stroke="#141414" stroke-width="1.8"/></svg>',
  };
  function bearing(a, b) {
    const toR = (d) => d * Math.PI / 180, toD = (r) => r * 180 / Math.PI;
    const y = Math.sin(toR(b.lng - a.lng)) * Math.cos(toR(b.lat));
    const x = Math.cos(toR(a.lat)) * Math.sin(toR(b.lat)) - Math.sin(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.cos(toR(b.lng - a.lng));
    return (toD(Math.atan2(y, x)) + 360) % 360;
  }
  // A marker that glides between GPS updates and turns to face its direction of travel.
  K.vehicle = function (map, ll, type = 'car', heading = 0) {
    const icon = L.divIcon({ className: '', html: `<div class="veh">${TOP[type] || TOP.car}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] });
    const m = L.marker([ll.lat, ll.lng], { icon, interactive: false, zIndexOffset: 900 }).addTo(map);
    let cur = { lat: ll.lat, lng: ll.lng }, rot = heading || 0, raf;
    const setRot = () => { const el = m.getElement(); const v = el && el.querySelector('.veh'); if (v) v.style.transform = `rotate(${rot}deg)`; };
    setTimeout(setRot);
    m.moveTo = (lat, lng, hdg) => {
      const to = { lat, lng };
      const dist = Math.abs(to.lat - cur.lat) + Math.abs(to.lng - cur.lng);
      if (dist > 0.000015) {
        let b = Number.isFinite(hdg) && hdg !== null ? hdg : bearing(cur, to);
        let diff = ((b - rot + 540) % 360) - 180; rot = rot + diff; setRot();
      }
      cancelAnimationFrame(raf);
      const from = { ...cur }, t0 = performance.now(), dur = dist > 0.02 ? 0 : 1000;
      const step = (t) => {
        const k = dur ? Math.min(1, (t - t0) / dur) : 1;
        cur = { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
        m.setLatLng([cur.lat, cur.lng]);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    m.pos = () => cur;
    return m;
  };

  // ---------- session ----------
  K.session = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
    clear() { try { localStorage.removeItem(KEY); } catch {} },
  };
  K.token = () => (K.session.get() || {}).token;

  K.api = async function (path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    const t = K.token();
    if (t) headers.Authorization = 'Bearer ' + t;
    let res;
    try {
      res = await fetch('/api' + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('No connection. Check your data and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && t) { K.session.clear(); location.reload(); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  };

  // ---------- formatting ----------
  K.ugx = (n) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-UG');
  K.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  K.initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  K.first = (name) => String(name || '').split(' ')[0];
  K.when = (d) => new Date(d).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  K.clock = (minsFromNow) => new Date(Date.now() + minsFromNow * 60e3).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
  K.$ = (sel, root) => (root || document).querySelector(sel);
  K.km = (a, b) => {
    const R = 6371, toR = (x) => x * Math.PI / 180;
    const h = Math.sin(toR(b.lat - a.lat) / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(toR(b.lng - a.lng) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  K.etaMin = (a, b) => Math.max(1, Math.round(((K.km(a, b) * 1.3) / 20) * 60));

  let toastTimer;
  K.toast = function (text, ms = 3500) {
    let el = document.getElementById('toast');
    if (el) el.remove();
    el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status');
    el.textContent = text; document.body.appendChild(el);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), ms);
  };

  // iOS-style navigation: pages slide in from the right and back out to the right.
  K.reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  K.pop = (el, after) => {
    if (!el || el._popping) return; el._popping = true;
    el.classList.remove('push-in'); el.classList.add('push-out');
    setTimeout(() => { el.remove(); after && after(); }, K.reduced() ? 0 : 330);
  };

  K.modal = function (html, { drawer = false, onClose } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="${drawer ? 'drawer' : 'modal'}" role="dialog" aria-modal="true">${html}</div>`;
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', esc);
      ov.classList.add('closing');
      setTimeout(() => { ov.remove(); onClose && onClose(); }, K.reduced() ? 0 : 260);
    };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
    const first = ov.querySelector('input, button:not([data-close])');
    first && first.focus({ preventScroll: true });
    return { el: ov.firstElementChild, close };
  };

  // ---------- installed app ----------
  // With the map drawn under the status bar, iOS 26 stops the app a little above the
  // home bar (that strip is outside the app and can't be drawn on). When that
  // happens, don't add home-bar spacing on top, or the bottom bar floats up.
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (standalone) document.documentElement.classList.add('standalone');
  // Normal case: the app reaches the bottom edge, so keep the standard home-bar spacing.
  // iOS 26 bug case: the app's view is shorter than the full screen (the "large
  // viewport", 100lvh). Only then is the home-bar strip outside the app, and only
  // then do we drop the extra spacing. Never guess from screen.height.
  K.screen = {};
  function fitInstalled() {
    try {
      const probe = (h) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;top:0;left:0;width:1px;height:${h};visibility:hidden;pointer-events:none`; document.body.appendChild(d); const v = d.offsetHeight; d.remove(); return v; };
      const lvh = probe('100lvh') || innerHeight, inset = probe('env(safe-area-inset-bottom)');
      const short = standalone ? Math.max(0, lvh - innerHeight) : 0;
      const pad = Math.max(0, inset - short);
      document.documentElement.style.setProperty('--sab', pad + 'px');
      K.screen = { view: innerHeight, full: lvh, inset, pad, standalone };
    } catch {}
  }
  if (!document.body) document.addEventListener('DOMContentLoaded', fitInstalled);
  fitInstalled();
  addEventListener('resize', fitInstalled);
  addEventListener('orientationchange', () => setTimeout(fitInstalled, 300));

  // ---------- the strip below the app (iOS 26) ----------
  // When iOS cuts the installed app short, the band under it takes the page's
  // background colour. Keep that colour matched to whatever is at the bottom of
  // the screen, so the band blends in: dark screens, the map, or the white sheet.
  const STRIP = { dark: '#0E0E10', map: '#F8F5F0', sheet: '#FDFCFB', page: '#FFFFFF' };
  let stripRaf;
  function syncStrip() {
    cancelAnimationFrame(stripRaf);
    stripRaf = requestAnimationFrame(() => {
      const q = (sel) => document.querySelector(sel);
      let c = STRIP.page;
      const splash = q('#splash:not(.out)') || q('.splash');
      if (q('#req') || q('.onboard') || splash) c = STRIP.dark;
      else if (q('.page:not(.hidden)') || q('.onb')) c = STRIP.page;
      else if (q('#sheet.collapsed') || (q('#map') && !q('#sheet'))) c = STRIP.map;
      else if (q('#sheet')) c = STRIP.sheet;
      document.documentElement.style.backgroundColor = c;
      document.body.style.backgroundColor = c;
    });
  }
  new MutationObserver(syncStrip).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  syncStrip();

  // ---------- screen info (open any page with ?debug=screen to see it) ----------
  // The app runs edge to edge with a normal status bar, so the standard
  // env(safe-area-inset-bottom) spacing lands exactly like native iPhone apps.
  if (/[?&]debug=screen/.test(location.search)) addEventListener('load', () => setTimeout(() => {
    const p = document.createElement('div'); p.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom)';
    document.body.appendChild(p);
    K.toast(JSON.stringify({ inset: p.offsetHeight, innerHeight, screenH: screen.height, standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches }), 15000);
    p.remove();
  }, 1500));

  // ---------- launch splash ----------
  const T0 = performance.now();
  K.ready = function () {
    const sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('out')) return;
    const wait = Math.max(0, 2100 - (performance.now() - T0)); // let the logo animation finish
    setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 800); }, wait);
  };

  // ---------- installable app ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; document.dispatchEvent(new Event('kwata:installable')); });
  K.standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  K.installCard = function (host, appName = 'Kwata', icon = '/icons/icon-192.png') {
    const key = 'kwata_install_dismissed_' + APP;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let dismissed = false; try { dismissed = !!localStorage.getItem(key); } catch {}
    if (K.standalone() || dismissed || !host) return;
    const draw = () => {
      if (!installEvt && !isIOS) return;
      host.innerHTML = `<div class="install"><img src="${icon}" alt=""><span class="grow"><b>Get the ${K.esc(appName)} app</b><br><span class="tiny" style="opacity:.75">${installEvt ? 'Opens instantly from your home screen' : 'Tap Share, then “Add to Home Screen”'}</span></span>
        ${installEvt ? '<button class="btn" data-i>Install</button>' : ''}<button class="x" data-x aria-label="Dismiss">${K.ic('x', 'sm')}</button></div>`;
      const b = host.querySelector('[data-i]');
      if (b) b.onclick = async () => { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => ({})); installEvt = null; if (r.outcome === 'accepted') host.innerHTML = ''; };
      host.querySelector('[data-x]').onclick = () => { try { localStorage.setItem(key, '1'); } catch {} host.innerHTML = ''; };
    };
    draw();
    document.addEventListener('kwata:installable', draw, { once: true });
  };

  // ---------- onboarding, sign up & log in (mockup screens 1–4, 14–16) ----------
  K.splashMarkup = (driver) => `<div class="splash-glow"></div><div class="splash-logo">${K.wordmark(driver)}</div>`;

  // Shrink a photo in the browser so uploads are quick on mobile data.
  K.compressImage = (file, max = 1280, quality = 0.8) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('That file isn’t a photo we can read.'));
    img.src = URL.createObjectURL(file);
  });

  const phoneField = (id, val = '') => `<div class="phone-field"><span class="cc">🇺🇬 +256 ${K.ic('chevDown', 'sm')}</span><input id="${id}" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="7XX XXX XXX" value="${K.esc(val)}" required></div>`;
  const toLocal = (raw) => { const d = String(raw || '').replace(/\D/g, ''); return d.startsWith('256') ? d : d.startsWith('0') ? d : '0' + d; };

  K.authScreen = function (root, { role, onDone }) {
    let draft = {}, dir = 'fwd';
    K.ready();
    const shell = (inner, back) => {
      root.innerHTML = `<div class="onb ${dir === 'back' ? 'nav-back' : 'nav-fwd'}">${back ? `<div class="onb-top"><button class="btn icon-btn btn-ghost" data-back aria-label="Back">${K.ic('back')}</button></div>` : '<div style="height:20px"></div>'}${inner}</div>`;
      dir = 'fwd';
      const b = root.querySelector('[data-back]'); if (b) b.onclick = () => { dir = 'back'; back(); };
      const f = root.querySelector('form'); if (f) setTimeout(() => { const i = f.querySelector('input'); i && i.focus({ preventScroll: true }); }, 80);
    };
    const busy = (form, on) => { const btn = form.querySelector('button[type=submit]'); btn.disabled = on; btn.textContent = on ? 'Please wait…' : btn.dataset.label; };
    const finish = async (out) => {
      K.session.set(out);
      if (role === 'rider') await K.askLocation(root);
      onDone(out);
    };

    // Rider onboarding slides
    // Welcome screens: the Kwata rider photo, the wordmark, and swipeable text.
    const hero = (driver, slides, ctaLabel) => {
      root.innerHTML = `<div class="onboard hero">
        <div class="hero-photo"><img src="/img/onboarding.jpg" alt="" decoding="async"></div>
        <div class="hero-logo">${K.wordmark(driver)}</div>
        <div class="slides" id="sl">${slides.map(([a, b2, p]) => `<div class="slide"><h1>${a}<br><span>${b2}</span></h1><p>${p}</p></div>`).join('')}</div>
        ${slides.length > 1 ? `<div class="dots">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
        <div class="cta"><button class="btn btn-primary btn-block btn-lg" id="go">${ctaLabel}</button><button class="btn btn-link" id="li">Log In</button></div></div>`;
      const sl = root.querySelector('#sl'), dots = root.querySelectorAll('.dots i');
      sl.addEventListener('scroll', () => { const i = Math.round(sl.scrollLeft / sl.clientWidth); dots.forEach((d, j) => d.classList.toggle('on', i === j)); }, { passive: true });
    };
    function onboarding() {
      hero(false, [
        ['Rides & deliveries,', 'made simple.', 'Boda, car or parcel across Kampala. Kwata gets you there fast, safe and reliable.'],
        ['Send anything,', 'tracked all the way.', 'Documents, food, phones. Follow your parcel live from pickup to the door.'],
        ['Safer from', 'the first metre.', 'Every trip starts with your PIN, and family can follow along live.'],
      ], 'Get Started');
      const seen = () => { try { localStorage.setItem('kwata_onboarded', '1'); } catch {} };
      root.querySelector('#go').onclick = () => { seen(); signUp(); };
      root.querySelector('#li').onclick = () => { seen(); logIn(); };
    }

    // Driver welcome (screen 14)
    function driverWelcome() {
      hero(true, [['Your boda,', 'your income.', 'Pick up rides and deliveries near you, keep 88% of every fare, and cash out to Mobile Money.']], 'Get Started');
      root.querySelector('#go').onclick = becomeDriver;
      root.querySelector('#li').onclick = logIn;
    }

    function becomeDriver() {
      shell(`<div class="grow" style="display:flex;flex-direction:column">
        <div class="illu" style="width:190px;height:130px;border-radius:24px;margin:10px auto 22px">${K.ART.boda}</div>
        <h1>Become a driver</h1><p class="lead">Join drivers earning with Kwata. Keep 88% of every fare.</p>
        <ul class="checklist"><li>Quick registration</li><li>Flexible hours</li><li>Secure payments to Mobile Money</li></ul>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" id="go">Continue</button>
        <p class="fine">Already have an account? <button data-li>Log In</button></p></div>`, driverWelcome);
      root.querySelector('#go').onclick = driverForm;
      root.querySelector('[data-li]').onclick = logIn;
    }

    function signUp() {
      shell(`<form id="f" novalidate class="grow" style="display:flex;flex-direction:column">
        <h1>Create your account</h1><p class="lead">Get started in seconds</p>
        <label for="nm">Full name</label><input id="nm" name="name" autocomplete="name" placeholder="John Doe" value="${K.esc(draft.name || '')}" required>
        <label for="ph">Phone number</label>${phoneField('ph', draft.phone)}
        <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="At least 6 characters" required>
        <p class="error" role="alert"></p>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Continue">Continue</button>
        <p class="fine">Already have an account? <button type="button" data-li>Log In</button></p>
        <p class="fine" style="margin-top:4px">By continuing you agree to Kwata’s terms and privacy policy.</p>
      </form>`, onboarding);
      const f = root.querySelector('#f');
      root.querySelector('[data-li]').onclick = logIn;
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        draft = { name: f.nm.value.trim(), phone: f.ph.value.trim() };
        busy(f, true);
        try { await finish(await K.api('/auth/register', { name: draft.name, phone: toLocal(draft.phone), password: f.pw.value, role: 'rider' })); }
        catch (ex) { err.innerHTML = /already has an account/.test(ex.message) ? `This number already has an account. <a href="#" data-li2>Log in instead</a>` : K.esc(ex.message); busy(f, false); const l = err.querySelector('[data-li2]'); if (l) l.onclick = (ev) => { ev.preventDefault(); logIn(); }; }
      };
    }

    function driverForm() {
      shell(`<form id="f" novalidate class="grow" style="display:flex;flex-direction:column">
        <h1>Your details</h1><p class="lead">We’ll check these before your first trip.</p>
        <label for="nm">Full name</label><input id="nm" name="name" autocomplete="name" required>
        <label for="ph">Phone number</label>${phoneField('ph')}
        <label for="pw">Create a password</label><input id="pw" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="At least 6 characters" required>
        <label for="vt">What do you drive?</label><select id="vt" name="vehicleType"><option value="boda">Boda boda (motorcycle)</option><option value="car">Car</option></select>
        <div class="row"><div class="fill"><label for="pl">Number plate</label><input id="pl" name="plate" placeholder="UFA 123X" required></div>
          <div class="fill"><label for="co">Colour</label><input id="co" name="vehicleColor" placeholder="Red"></div></div>
        <label for="mk">Make and model</label><input id="mk" name="vehicleMake" placeholder="Bajaj Boxer / Toyota Premio">
        <label for="lc">Driving permit number</label><input id="lc" name="licenseNo" required>
        <label for="mm">Mobile Money for payouts</label><input id="mm" name="momoNumber" type="tel" placeholder="Same as your phone if empty">
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Continue" style="margin-top:8px">Continue</button>
      </form>`, becomeDriver);
      const f = root.querySelector('#f');
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        const data = Object.fromEntries(new FormData(f).entries());
        data.phone = toLocal(data.phone);
        busy(f, true);
        try { const out = await K.api('/auth/register', { ...data, role: 'driver' }); K.session.set(out); K.verifyDocs(root, { onDone: () => onDone(out) }); }
        catch (ex) { err.textContent = ex.message; busy(f, false); }
      };
    }

    function logIn() {
      shell(`<form id="f" novalidate class="grow" style="display:flex;flex-direction:column">
        <h1>${role === 'driver' ? 'Welcome back, driver' : role === 'admin' ? 'Kwata Operations' : 'Welcome back'}</h1>
        <p class="lead">Log in with your phone number</p>
        <label for="ph">Phone number</label>${phoneField('ph', draft.phone)}
        <label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
        <p class="error" role="alert"></p>
        <p class="small muted">Forgot your password? Call Kwata support and we’ll reset it.</p>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Log In">Log In</button>
        ${role === 'admin' ? '' : `<p class="fine">${role === 'driver' ? 'New driver?' : 'New to Kwata?'} <button type="button" data-su>${role === 'driver' ? 'Become a driver' : 'Create account'}</button></p>`}
      </form>`, role === 'rider' ? onboarding : role === 'driver' ? driverWelcome : null);
      const f = root.querySelector('#f');
      const su = root.querySelector('[data-su]'); if (su) su.onclick = role === 'driver' ? becomeDriver : signUp;
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        draft.phone = f.ph.value.trim();
        busy(f, true);
        try {
          const out = await K.api('/auth/login', { phone: toLocal(draft.phone), password: f.pw.value });
          if (out.user.role !== role) throw new Error({ driver: 'This is a driver account. Use the Kwata Driver app.', rider: 'This number is a rider account. Use a different number for driving.', admin: 'This is a staff account.' }[out.user.role] || 'This account can’t be used here.');
          await finish(out);
        } catch (ex) { err.textContent = ex.message; busy(f, false); }
      };
    }

    let onboarded = false; try { onboarded = !!localStorage.getItem('kwata_onboarded'); } catch {}
    if (role === 'driver') driverWelcome();
    else if (role === 'rider' && !onboarded) onboarding();
    else logIn();
  };

  // Screen 4: location permission, asked once after sign up / log in.
  K.askLocation = (root) => new Promise(async (resolve) => {
    let state = 'prompt';
    try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch {}
    let asked = false; try { asked = !!localStorage.getItem('kwata_loc_asked'); } catch {}
    if (state !== 'prompt' || asked || !navigator.geolocation) return resolve();
    root.innerHTML = `<div class="onb nav-fwd" style="text-align:center">
      <div class="illu">${K.ic('pin').replace('class="i "', 'class="i" style="width:64px;height:64px;stroke-width:1.6"')}</div>
      <h1>Allow location access</h1>
      <p class="lead" style="max-width:30ch;margin:0 auto">We need your location to find the nearest drivers and give you the best service.</p>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-block btn-lg" id="al">Allow Location</button>
      <button class="btn btn-link btn-block" id="nn">Not Now</button></div>`;
    const done = () => { try { localStorage.setItem('kwata_loc_asked', '1'); } catch {} resolve(); };
    root.querySelector('#al').onclick = () => navigator.geolocation.getCurrentPosition(done, done, { timeout: 15000 });
    root.querySelector('#nn').onclick = done;
  });

  // Screen 16: driver identity documents.
  K.verifyDocs = async function (root, { onDone, back }) {
    const ICON = { national_id: 'idcard', license: 'card', vehicle: 'camera', photo: 'user' };
    const HINT = { national_id: 'Front of your National ID', license: 'Your driving permit', vehicle: 'Clear photo with the number plate', photo: 'A clear photo of your face' };
    const draw = async () => {
      let info = { kinds: {}, uploaded: {} };
      try { info = await K.api('/driver/documents'); } catch {}
      const kinds = Object.keys(info.kinds);
      const allDone = kinds.every((k) => info.uploaded[k]);
      root.innerHTML = `<div class="onb nav-fwd">${back ? `<div class="onb-top"><button class="btn icon-btn btn-ghost" data-back aria-label="Back">${K.ic('back')}</button></div>` : '<div style="height:20px"></div>'}
        <h1>Verify your identity</h1><p class="lead">Upload the required documents to get verified.</p>
        ${kinds.map((k) => `<label class="doc ${info.uploaded[k] ? 'done' : ''}" for="f-${k}" style="margin:0 0 10px">
          <span class="ic">${K.ic(ICON[k] || 'camera')}</span><span class="grow"><span style="display:block">${K.esc(info.kinds[k])}</span><span class="tiny muted" style="font-weight:500">${HINT[k] || ''}</span></span>
          <span class="st">${info.uploaded[k] ? 'Uploaded ✓' : 'Upload'}</span>
          <input type="file" id="f-${k}" data-k="${k}" accept="image/*" ${k === 'photo' ? 'capture="user"' : 'capture="environment"'} hidden></label>`).join('')}
        <p class="error" id="err"></p>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" id="go" ${allDone ? '' : 'disabled'}>Continue</button>
        <p class="fine">Need help? <a href="tel:+256700000000">Contact Support</a></p></div>`;
      const b = root.querySelector('[data-back]'); if (b) b.onclick = back;
      root.querySelectorAll('input[type=file]').forEach((inp) => inp.onchange = async () => {
        const file = inp.files[0]; if (!file) return;
        const st = inp.closest('.doc').querySelector('.st'); st.textContent = 'Uploading…';
        try { await K.api('/driver/documents', { kind: inp.dataset.k, image: await K.compressImage(file) }); draw(); }
        catch (ex) { root.querySelector('#err').textContent = ex.message; st.textContent = 'Try again'; }
      });
      root.querySelector('#go').onclick = onDone;
    };
    draw();
  };

  // ---------- maps ----------
  K.dark = () => false; // the brand is designed light-first, like the mockups
  const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
  // Crisp vector streets (OpenFreeMap, free, no API key). Falls back to plain
  // OpenStreetMap tiles on old phones without WebGL.
  K.map = function (id, center = K.KAMPALA, zoom = 16) {
    const m = L.map(id, { zoomControl: false, attributionControl: true, zoomSnap: 0.25 }).setView([center.lat, center.lng], zoom);
    const osm = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    if (webgl && L.maplibreGL) {
      try {
        const gl = L.maplibreGL({
          style: `https://tiles.openfreemap.org/styles/${K.dark() ? 'dark' : 'liberty'}`,
          attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenStreetMap',
        }).addTo(m);
        const glMap = gl.getMaplibreMap && gl.getMaplibreMap();
        if (glMap) glMap.on('error', (e) => { if (!m._fellBack && /style|Failed to fetch/i.test(String(e && e.error && e.error.message))) { m._fellBack = true; m.removeLayer(gl); osm(); } });
      } catch { osm(); }
    } else osm();
    m.attributionControl.setPrefix(false);
    // Keep the map filling its box when the screen rotates or the window resizes.
    const box = document.getElementById(id);
    if (window.ResizeObserver && box) new ResizeObserver(() => m.invalidateSize({ pan: false })).observe(box);
    setTimeout(() => m.invalidateSize({ pan: false }), 300);
    return m;
  };
  K.divIcon = (html, size = [20, 20], anchor) => L.divIcon({ className: '', html, iconSize: size, iconAnchor: anchor || [size[0] / 2, size[1] / 2] });
  K.icon = (html) => K.divIcon(`<div style="font-size:22px">${html}</div>`, [30, 30]);
  K.label = (html, dir = 'left') => L.divIcon({ className: '', html: `<div class="map-label">${html}</div>`, iconSize: null, iconAnchor: dir === 'left' ? [-14, 18] : [-14, 18] });
  K.vehicleEmoji = (v) => (v === 'car' ? '🚗' : '🏍️');

  K.route = async function (a, b) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      const j = await r.json();
      const rt = j.routes && j.routes[0];
      if (!rt) throw new Error('no route');
      // OSRM assumes empty roads (freeMin). The server adds Kampala traffic for prices;
      // `min` is a rough traffic-adjusted figure for ETAs shown on the map.
      return { km: rt.distance / 1000, freeMin: rt.duration / 60, min: (rt.duration / 60) * 1.8, coords: rt.geometry.coordinates.map(([x, y]) => [y, x]) };
    } catch {
      return { km: null, freeMin: null, min: null, coords: [[a.lat, a.lng], [b.lat, b.lng]] };
    }
  };

  // Draws a route the premium way: a thick line that "draws itself" from start to end.
  K.drawRoute = function (map, coords, { animate = true, color } = {}) {
    const c = color || (K.dark() ? '#FFFFFF' : '#000000');
    const casing = L.polyline(coords, { color: K.dark() ? '#000' : '#FFF', weight: 9, opacity: .9 }).addTo(map);
    const line = L.polyline(animate ? [coords[0]] : coords, { color: c, weight: 5 }).addTo(map);
    if (animate && coords.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      let i = 1; const step = Math.max(1, Math.ceil(coords.length / 40));
      const tick = () => { i = Math.min(coords.length, i + step); line.setLatLngs(coords.slice(0, i)); if (i < coords.length) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    } else line.setLatLngs(coords);
    return { remove: () => { map.removeLayer(casing); map.removeLayer(line); }, bounds: () => casing.getBounds() };
  };

  K.search = async function (q, near) {
    const c = near || K.KAMPALA;
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ug&limit=7&viewbox=${c.lng - 0.35},${c.lat + 0.3},${c.lng + 0.35},${c.lat - 0.3}&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    return j.map((x) => {
      const parts = x.display_name.split(', ');
      return { name: parts[0], address: parts.slice(1, 4).join(', '), lat: +x.lat, lng: +x.lon };
    });
  };

  K.reverse = async function (lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
      const j = await r.json();
      const a = j.address || {};
      return [a.amenity || a.building || a.shop || a.road, a.suburb || a.neighbourhood || a.city_district || a.city].filter(Boolean).join(', ') || 'Pinned location';
    } catch { return 'Pinned location'; }
  };

  K.socket = (token) => io({ auth: { token }, transports: ['websocket', 'polling'] });

  K.share = async function (url, text) {
    if (navigator.share) { try { await navigator.share({ title: 'Kwata trip', text, url }); return; } catch {} }
    try { await navigator.clipboard.writeText(url); K.toast('Trip link copied'); }
    catch { prompt('Copy this link', url); }
  };

  // Slide-to-confirm control (driver actions). Calls onDone when slid to the end.
  K.slider = function (el, { label, cls = '', onDone }) {
    el.className = 'slider ' + cls;
    el.innerHTML = `<div class="label">${K.esc(label)}</div><div class="knob" role="button" tabindex="0" aria-label="${K.esc(label)}">${K.ic('arrowR')}</div>`;
    const knob = el.querySelector('.knob');
    let startX = 0, x = 0, dragging = false, done = false;
    const max = () => el.clientWidth - knob.offsetWidth - 10;
    const set = (v) => { x = Math.max(0, Math.min(max(), v)); knob.style.transform = `translateX(${x}px)`; el.querySelector('.label').style.opacity = 1 - x / max(); };
    const finish = () => { if (done) return; done = true; set(max()); onDone && onDone(); };
    knob.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX - x; knob.setPointerCapture(e.pointerId); knob.style.transition = 'none'; });
    knob.addEventListener('pointermove', (e) => { if (dragging) set(e.clientX - startX); });
    knob.addEventListener('pointerup', () => {
      dragging = false; knob.style.transition = 'transform .2s';
      if (x > max() * 0.82) finish(); else set(0);
    });
    knob.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); } });
    // simple tap also works for accessibility / desktop users
    knob.addEventListener('dblclick', finish);
    el.reset = () => { done = false; set(0); };
    return el;
  };

  // Bottom sheet you can drag down to reveal the map (and back up), with snap.
  K.draggableSheet = function (sheet) {
    if (sheet._drag) return;
    sheet._drag = true;
    let startY = 0, startOff = 0, off = 0, dragging = false, moved = false;
    // Collapsed, the sheet still shows its top (grabber + first row) above the floating tab bar.
    const peek = () => Math.max(0, sheet.offsetHeight - 132 - (parseFloat(sheet.style.paddingBottom) || 0));
    const set = (v, anim) => {
      off = Math.max(0, Math.min(peek(), v));
      sheet.style.transition = anim ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
      sheet.style.transform = off ? `translateY(${off}px)` : '';
      sheet.classList.toggle('collapsed', off > 0);
    };
    sheet.collapse = () => set(peek(), true);
    sheet.expand = () => set(0, true);
    sheet.addEventListener('pointerdown', (e) => {
      if (innerWidth >= 760) return;
      const r = sheet.getBoundingClientRect();
      if (e.clientY - r.top > 34) return; // only the handle area
      dragging = true; moved = false; startY = e.clientY; startOff = off;
      sheet.setPointerCapture(e.pointerId);
    });
    sheet.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const d = e.clientY - startY;
      if (Math.abs(d) > 4) moved = true;
      set(startOff + d);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) { set(off > 0 ? 0 : peek(), true); return; }
      set(off > peek() * 0.35 ? peek() : 0, true);
    };
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
    // Any new content opens the sheet again.
    new MutationObserver(() => { if (off) set(0, true); }).observe(sheet, { childList: true });
  };

  // Space the floating glass tab bar takes at the bottom (content scrolls under it).
  K.tabSpace = () => { const t = document.getElementById('tabs'); if (!t || t.classList.contains('hidden')) return 0; return Math.max(0, innerHeight - t.getBoundingClientRect().top) + 8; };
  K.underTabs = (sheet, on) => { sheet.style.bottom = ''; sheet.style.paddingBottom = on ? K.tabSpace() + 'px' : ''; };

  K.SERVICE_LABEL = { boda: 'Boda', car: 'Car', comfort: 'Comfort', parcel: 'Parcel', airport: 'Airport' };
  K.PAY_LABEL = { cash: 'Cash', wallet: 'Kwata Wallet', momo: 'Mobile Money', card: 'Card' };
  K.PAY_ICON = { cash: 'cash', wallet: 'wallet', momo: 'momo', card: 'card' };

  window.K = K;
})();
