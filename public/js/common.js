// Shared helpers for the rider, driver, admin and tracking pages.
(function () {
  const K = {};
  const APP = document.body.dataset.app || 'rider';
  const KEY = 'flytte_' + APP;
  // The app was called Kwata before Flytte: carry saved sign-ins and settings over once,
  // so nobody is signed out by the rename.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf('kwata_') === 0) {
        const n = 'flytte_' + k.slice(6);
        if (localStorage.getItem(n) === null) localStorage.setItem(n, localStorage.getItem(k));
        localStorage.removeItem(k);
      }
    }
  } catch {}
  K.KAMPALA = { lat: 0.3136, lng: 32.5811 };

  K.PLACES = [
    { name: 'Entebbe International Airport', address: 'Entebbe', lat: 0.0424, lng: 32.4435, icon: 'plane' },
    { name: 'Acacia Mall', address: 'Kisementi, Kololo', lat: 0.33659, lng: 32.58773 },
    { name: 'Garden City Mall', address: 'Yusuf Lule Road', lat: 0.3199, lng: 32.59212 },
    { name: 'Kampala Old Taxi Park', address: 'Central Division', lat: 0.31223, lng: 32.57696 },
    { name: 'Makerere University', address: 'Makerere', lat: 0.33515, lng: 32.56823 },
    { name: 'Mulago National Referral Hospital', address: 'Mulago', lat: 0.33893, lng: 32.57579 },
    { name: 'Village Mall Bugolobi', address: 'Bugolobi', lat: 0.32014, lng: 32.61766 },
    { name: 'Ntinda Trading Centre', address: 'Ntinda', lat: 0.3536, lng: 32.6142 },
    { name: 'Kampala Serena Hotel', address: 'Kintu Road, Nakasero', lat: 0.31923, lng: 32.58637 },
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
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
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
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    power: '<path d="M12 3v9M6.3 7.3a8 8 0 1 0 11.4 0"/>',
  };
  K.ic = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${name === 'star' && cls.includes('fill') ? P.star : P[name] || ''}</svg>`;
  K.starSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';

  // ---------- vehicle art ----------
  // Flytte's own vehicle illustrations: one side-on style, graphite/silver with a single gold accent.
  // Standard rides are light, Comfort is a black executive sedan, delivery is a parcel, airport a plane.
  const VEH = { boda: 'Boda boda', car: 'Car', comfort: 'Comfort SUV', parcel: 'Parcel', airport: 'Airport transfer' };
  K.ART = Object.fromEntries(Object.entries(VEH).map(([k, alt]) => [k, `<img class="art-img" src="/img/vehicles/${k}.svg" alt="" data-alt="${alt}" decoding="async">`]));
  Object.keys(VEH).forEach((k) => { const i = new Image(); i.src = `/img/vehicles/${k}.svg`; });
  K.artFor = (service, vehicleType) => K.ART[service] || (vehicleType === 'car' ? K.ART.car : K.ART.boda);

  // ---------- brand: pin logo & night skyline ----------
  K.logo = (pin = '#FFC400', k = '#141414', size = 64) => `<svg class="pin" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M32 3C19.3 3 9 13.1 9 25.6 9 42 32 61 32 61s23-19 23-35.4C55 13.1 44.7 3 32 3z" fill="${pin}"/>
    <g transform="translate(13.5 12.5) scale(.265)" fill="${k}"><path d="M14 18H46L43 28H11Z"/><path d="M6 38H42L39 48H3Z"/><path d="M14 58H38L35 68H11Z"/><path d="M52 6H78L60 94H34Z"/><path d="M74 6H138L133.5 28H69.5Z"/><path d="M66.6 42H120L115.9 62H62.5Z"/></g></svg>`;
  // The speed-K: three speed lines and a forward-leaning K (as on the Flytte delivery box).
  K.markSvg = (cls = '') => `<svg class="wm-k ${cls}" viewBox="0 0 140 100" aria-hidden="true">
    <defs><linearGradient id="kg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD84A"/><stop offset="1" stop-color="#FFB300"/></linearGradient></defs>
    <g class="wm-lines" fill="url(#kg)"><path class="l1" d="M14 18H46L43 28H11Z"/><path class="l2" d="M6 38H42L39 48H3Z"/><path class="l3" d="M14 58H38L35 68H11Z"/></g>
    <g class="wm-body" fill="url(#kg)"><path d="M52 6H78L60 94H34Z"/><path d="M74 6H138L133.5 28H69.5Z"/><path d="M66.6 42H120L115.9 62H62.5Z"/></g></svg>`;
  K.wordmark = (driver) => `<div class="wm" aria-label="Flytte${driver ? ' Driver' : ''}">
    <div class="wm-row">${K.markSvg()}<span class="wm-t">lytte</span></div>
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
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); localStorage.removeItem(KEY + '_out'); } catch {} },
    clear() { try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '_cache'); } catch {} },
  };
  K.token = () => (K.session.get() || {}).token;
  // Signed-in stays signed-in: if the phone cleared the app's saved sign-in, get it back from the
  // server's cookie copy. Skipped after the person logged out on this phone.
  K.resume = async function () {
    try { if (localStorage.getItem(KEY + '_out')) return false; } catch {}
    try {
      const r = await fetch('/api/auth/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: APP }) });
      const j = await r.json();
      if (j && j.session && j.session.token) { K.session.set(j.session); return true; }
    } catch {}
    return false;
  };
  // Log out only when the person chooses to.
  K.logout = async function () {
    try { localStorage.setItem(KEY + '_out', '1'); } catch {}
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: APP }) }); } catch {}
    K.session.clear(); location.reload();
  };
  // Start the app: signed in → start(); otherwise try to resume, then show sign-in.
  K.boot = function (start, showAuth) {
    if (K.token()) return start();
    K.resume().then((ok) => (ok ? start() : showAuth()));
  };

  // Last-known data (profile, settings, trips) so the app can draw instantly on open,
  // then refresh from the server. Tied to the signed-in account; cleared on log out.
  K.cache = {
    all() { const id = ((K.session.get() || {}).user || {}).id || null; try { const c = JSON.parse(localStorage.getItem(KEY + '_cache')); return c && c.u === id ? c : { u: id, d: {} }; } catch { return { u: id, d: {} }; } },
    get(name) { return this.all().d[name]; },
    set(name, value) { try { const c = this.all(); c.d[name] = value; localStorage.setItem(KEY + '_cache', JSON.stringify(c)); } catch {} },
  };

  K.api = async function (path, body, method, { timeout = 20000 } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = K.token();
    if (t) headers.Authorization = 'Bearer ' + t;
    let res;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), timeout); // never leave a button spinning forever
    try {
      res = await fetch('/api' + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Flytte is taking too long to respond. Check your connection and try again.'
        : navigator.onLine === false ? 'You’re offline. Check your data or Wi-Fi and try again.' : 'Couldn’t reach Flytte. Check your connection and try again.');
    } finally { if (timer) clearTimeout(timer); }
    if (res.status >= 500 && res.status !== 503) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'Something went wrong on our side. Please try again in a moment.');
    }
    const data = await res.json().catch(() => ({}));
    // A renewed sign-in from the server (sessions slide forward while the app is used).
    const nt = res.headers.get('X-Session-Token');
    if (nt && t) { const s = K.session.get(); if (s && s.token === t) { s.token = nt; K.session.set(s); } }
    // Sign out only when the server says the sign-in itself is no longer valid, never for a wrong code etc.
    if (res.status === 401 && t && data.code === 'SESSION') { K.session.clear(); location.reload(); }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { code: data.code, status: res.status });
    return data;
  };

  // ---------- formatting ----------
  K.ugx = (n) => 'UGX ' + Math.round(Number(n) || 0).toLocaleString('en-UG');
  K.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Countries Flytte serves; numbers go to the server as +<code><9 digits>.
  K.COUNTRIES = [
    { id: 'UG', cc: '256', flag: '🇺🇬', name: 'Uganda', ex: '772 123 456', re: /^(7\d{8}|[234]\d{8})$/ },
    { id: 'KE', cc: '254', flag: '🇰🇪', name: 'Kenya', ex: '712 345 678', re: /^[17]\d{8}$/ },
    { id: 'TZ', cc: '255', flag: '🇹🇿', name: 'Tanzania', ex: '712 345 678', re: /^[67]\d{8}$/ },
    { id: 'RW', cc: '250', flag: '🇷🇼', name: 'Rwanda', ex: '788 123 456', re: /^7[2389]\d{7}$/ },
  ];
  const byId = (id) => K.COUNTRIES.find((c) => c.id === id);
  K.country = (id) => { if (id && byId(id)) return byId(id); let v = null; try { v = localStorage.getItem('flytte_cc'); } catch {} return byId(v) || K.COUNTRIES[0]; };
  K.setCountry = (id) => { try { localStorage.setItem('flytte_cc', id); } catch {} };
  // Any form (+254 712…, 254712…, 0712…, 712…) → "+254712345678", or null if it isn't a valid number.
  K.e164 = (raw, id) => {
    const s = String(raw || '').trim(); let d = s.replace(/\D/g, ''); if (!d) return null;
    if (s.startsWith('00')) d = d.slice(2);
    let c = K.COUNTRIES.find((x) => d.startsWith(x.cc) && d.length === x.cc.length + 9), nsn;
    if (c) nsn = d.slice(c.cc.length); else { c = K.country(id); nsn = d.startsWith('0') ? d.slice(1) : d; }
    return c.re.test(nsn) ? '+' + c.cc + nsn : null;
  };
  K.validPhone = (raw, id) => !!K.e164(raw, id);
  K.countryOf = (e164) => K.COUNTRIES.find((c) => String(e164 || '').replace(/\D/g, '').startsWith(c.cc)) || K.COUNTRIES[0];
  // Uganda numbers read the local way (0772 123 456); other countries with their code (+254 712 345 678).
  K.prettyPhone = (e164) => {
    const d = String(e164 || '').replace(/\D/g, ''); const c = K.COUNTRIES.find((x) => d.startsWith(x.cc) && d.length === x.cc.length + 9);
    if (!c) return String(e164 || '');
    const n = d.slice(c.cc.length).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
    return c.id === 'UG' ? '0' + n : `+${c.cc} ${n}`;
  };
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

  // ---------- connection status ----------
  // A calm banner while the phone has no connection; it disappears by itself when it's back.
  K.netBanner = (on, text) => {
    let el = document.getElementById('netBanner');
    if (!on) { if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 250); } return; }
    if (!el) { el = document.createElement('div'); el.id = 'netBanner'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.classList.remove('out'); el.textContent = text;
  };
  addEventListener('offline', () => K.netBanner(true, 'You’re offline. Flytte will reconnect when your data or Wi-Fi is back.'));
  addEventListener('online', () => { K.netBanner(false); K.toast('Back online'); });
  if (navigator.onLine === false) setTimeout(() => K.netBanner(true, 'You’re offline. Flytte will reconnect when your data or Wi-Fi is back.'), 0);

  // iOS-style navigation: pages slide in from the right and back out to the right.
  K.reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  K.pop = (el, after) => {
    if (!el || el._popping) return; el._popping = true;
    el.classList.remove('push-in'); el.classList.add('push-out');
    setTimeout(() => { el.remove(); after && after(); }, K.reduced() ? 0 : 330);
  };

  // Light haptic tap (tab change, sheet snapping to a stop, swipe-to-dismiss). Android uses the
  // vibration API; iOS 18+ gives a system haptic when a switch control is toggled. Silent elsewhere.
  let hapSw;
  K.haptic = () => {
    try {
      if (K.reduced()) return;
      if (navigator.vibrate) { navigator.vibrate(8); return; }
      if (!/iP(hone|ad|od)/.test(navigator.userAgent)) return;
      if (!hapSw) {
        hapSw = document.createElement('label');
        hapSw.setAttribute('aria-hidden', 'true');
        hapSw.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
        hapSw.innerHTML = '<input type="checkbox" switch tabindex="-1">';
        document.body.appendChild(hapSw);
      }
      const keep = document.activeElement;
      hapSw.click();
      if (keep && keep !== document.activeElement && keep.focus) keep.focus({ preventScroll: true });
    } catch {}
  };

  // Tab bar: the glass lens slides to whichever tab is selected.
  const syncLens = (bar) => {
    if (!bar) return;
    const tabs = [...bar.querySelectorAll('[data-tab]')], i = tabs.findIndex((b) => b.getAttribute('aria-current') === 'page');
    bar.style.setProperty('--n', tabs.length || 1);
    if (i >= 0) bar.style.setProperty('--i', i);
  };
  new MutationObserver((muts) => {
    let bar = null;
    for (const m of muts) {
      if (m.type === 'attributes') { if (m.target.closest && m.target.getAttribute('aria-current') === 'page') { bar = m.target.closest('.tabbar'); if (bar && m.oldValue !== 'page' && bar._lensReady) K.haptic(); } }
      else for (const n of m.addedNodes) if (n.nodeType === 1) { const b = n.matches('.tabbar') ? n : n.querySelector && n.querySelector('.tabbar'); if (b) { syncLens(b); b._lensReady = true; } }
    }
    if (bar) syncLens(bar);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current'], attributeOldValue: true });

  // Navigation bars: the large title collapses into a small centred title once it scrolls under
  // the bar, and the scroll edge effect (soft blur under the bar) appears once content scrolls.
  document.addEventListener('scroll', (e) => {
    const p = e.target;
    if (!p.classList || !p.classList.contains('page')) return;
    const top = p.scrollTop, title = p.querySelector('.page-title');
    p.classList.toggle('edge', top > 2);
    if (!title) return;
    if (!p.classList.contains('nav-large') && !p.querySelector(':scope > .nav-bar')) {
      const bar = document.createElement('div'); bar.className = 'nav-bar'; bar.setAttribute('aria-hidden', 'true');
      bar.innerHTML = '<span></span>'; p.prepend(bar);
    }
    const bar = p.querySelector(':scope > .nav-bar > span');
    if (bar && bar.textContent !== title.textContent) bar.textContent = title.textContent;
    // The small title appears only once the large one has gone under the bar, never both at once
    // (and never during the rubber-band bounce at the top).
    const pr = p.getBoundingClientRect(), tr = title.getBoundingClientRect();
    const head = p.classList.contains('nav-large') && p.querySelector('.page-head');
    const barBottom = head ? head.getBoundingClientRect().bottom : pr.top + (parseFloat(getComputedStyle(p).paddingTop) || 0);
    p.classList.toggle('scrolled', top > 0 && tr.bottom <= barBottom + 2);
  }, true);

  K.modal = function (html, { drawer = false, onClose } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="${drawer ? 'drawer' : 'modal'}" role="dialog" aria-modal="true">${html}</div>`;
    const dlg = ov.firstElementChild, h = dlg.querySelector('h1, h2, h3');
    if (h) { h.id = h.id || 'dlg-' + Math.random().toString(36).slice(2, 8); dlg.setAttribute('aria-labelledby', h.id); }
    const opener = document.activeElement;
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', esc);
      if (opener && opener.isConnected && opener.focus) setTimeout(() => opener.focus({ preventScroll: true }), 0);
      ov.classList.add('closing');
      setTimeout(() => { ov.remove(); onClose && onClose(); }, K.reduced() ? 0 : 260);
    };
    const esc = (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return; // keep keyboard focus inside the dialog
      const f = [...dlg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
    // Swipe down to dismiss (from the top of the sheet, or anywhere when it's scrolled to the top).
    if (!drawer) {
      let d = null;
      dlg.addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) { d = null; return; }
        const t = e.touches[0];
        d = { y: t.clientY, x: t.clientX, dy: 0, on: false, s: [[performance.now(), t.clientY]], top: dlg.scrollTop <= 0, field: !!e.target.closest('input, textarea, select') };
      }, { passive: true });
      dlg.addEventListener('touchmove', (e) => {
        if (!d) return;
        const t = e.touches[0], dy = t.clientY - d.y, dx = t.clientX - d.x;
        if (!d.on) {
          if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
          if (!d.top || d.field || dy <= 0 || Math.abs(dx) > Math.abs(dy)) { d = null; return; }
          d.on = true; d.y = t.clientY; dlg.classList.add('dragging');
        }
        if (e.cancelable) e.preventDefault();
        d.dy = Math.max(0, t.clientY - d.y);
        d.s.push([performance.now(), t.clientY]); if (d.s.length > 6) d.s.shift();
        dlg.style.transform = `translate3d(0,${d.dy}px,0)`;
        ov.style.backgroundColor = `rgba(0,0,0,${0.2 * Math.max(0, 1 - d.dy / (dlg.offsetHeight || 1))})`;
      }, { passive: false });
      const end = () => {
        if (!d || !d.on) { d = null; return; }
        const a = d.s[0], b = d.s[d.s.length - 1], vel = (b[1] - a[1]) / Math.max(1, b[0] - a[0]);
        dlg.classList.remove('dragging');
        if (d.dy > Math.min(140, dlg.offsetHeight * 0.33) || vel > 0.6) {
          K.haptic();
          dlg.classList.add('dragged');
          dlg.style.transition = 'transform .28s cubic-bezier(.4,0,1,1)';
          dlg.style.transform = 'translate3d(0,110%,0)';
          close();
        } else {
          dlg.style.transition = 'transform .5s var(--spring-bounce)';
          dlg.style.transform = '';
          ov.style.backgroundColor = '';
        }
        d = null;
      };
      dlg.addEventListener('touchend', end);
      dlg.addEventListener('touchcancel', end);
    }
    const first = ov.querySelector('input, select, textarea, button:not([data-close])');
    // On phones, don't pop the keyboard open for a text box; focus the dialog itself instead.
    if (first && (first.tagName === 'BUTTON' || matchMedia('(pointer: fine)').matches)) first.focus({ preventScroll: true });
    else { dlg.tabIndex = -1; dlg.focus({ preventScroll: true }); }
    return { el: ov.firstElementChild, close };
  };

  // ---------- installed app ----------
  // With the map drawn under the status bar, iOS 26 stops the app a little above the
  // home bar (that strip is outside the app and can't be drawn on). When that
  // happens, don't add home-bar spacing on top, or the bottom bar floats up.
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (standalone) document.documentElement.classList.add('standalone');
  // Test build (/beta, /driver-beta): the installed app runs under the clock. iOS always draws the
  // clock white in that mode, so a soft shade sits behind it on light screens to keep it readable.
  const underClock = standalone && document.documentElement.classList.contains('under-clock');
  if (underClock) {
    const addScrim = () => { if (!document.querySelector('.sb-scrim')) { const d = document.createElement('div'); d.className = 'sb-scrim'; d.setAttribute('aria-hidden', 'true'); document.body.appendChild(d); } };
    document.body ? addScrim() : document.addEventListener('DOMContentLoaded', addScrim);
  }
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
  // Re-measure only when the screen really changes (rotation, window resize). The keyboard
  // opening shrinks the height and would make the menu bar jump if we re-measured then.
  let lastW = innerWidth, maxH = innerHeight;
  addEventListener('resize', () => {
    if (innerWidth !== lastW || innerHeight > maxH) { lastW = innerWidth; maxH = Math.max(maxH, innerHeight); fitInstalled(); }
  });
  addEventListener('orientationchange', () => setTimeout(() => { lastW = innerWidth; maxH = innerHeight; fitInstalled(); }, 300));

  // ---------- the strip below the app (iOS 26) ----------
  // When iOS cuts the installed app short, the band under it takes the page's
  // background colour. Keep that colour matched to whatever is at the bottom of
  // the screen, so the band blends in: dark screens, the map, or the white sheet.
  const STRIP_LIGHT = { dark: '#0E0E10', map: '#F8F5F0', sheet: '#FDFCFB', page: '#FFFFFF', grouped: '#F2F2F7' };
  const STRIP_DARK = { dark: '#0E0E10', map: '#1A1B1E', sheet: '#1C1C1E', page: '#000000', grouped: '#000000' };
  let STRIP = STRIP_LIGHT;
  let stripRaf;
  function syncStrip() {
    STRIP = document.documentElement.classList.contains('theme-dark') ? STRIP_DARK : STRIP_LIGHT;
    cancelAnimationFrame(stripRaf);
    stripRaf = requestAnimationFrame(() => {
      const q = (sel) => document.querySelector(sel);
      let c = STRIP.page;
      // The launch screen is white when signed in, so it only counts as dark on the signed-out launch,
      // and stops counting the moment it starts fading (otherwise the bottom fade flashes black).
      const darkLaunch = document.documentElement.classList.contains('launch-dark') && q('.splash:not(.out)');
      if (q('#req') || q('.onboard') || darkLaunch) c = STRIP.dark;
      else if (q('.page.grouped:not(.hidden)')) c = STRIP.grouped;
      else if (q('.page:not(.hidden)') || q('.onb')) c = STRIP.page;
      else if (q('#sheet.collapsed') || q('.sheet-dock.floating') || (q('#map') && !q('#sheet'))) c = STRIP.map;
      else if (q('#sheet')) c = STRIP.sheet;
      // The floating pill sits on a soft fade that runs down through the home-bar area and ends in
      // exactly this colour, so whatever iOS/Android paint below the app joins the fade seamlessly.
      const tabs = q('#tabs');
      if (tabs) {
        if (!(tabs.nextElementSibling && tabs.nextElementSibling.classList.contains('dock-edge'))) { const e = document.createElement('div'); e.className = 'dock-edge'; e.setAttribute('aria-hidden', 'true'); tabs.after(e); }
        if (!tabs.classList.contains('hidden') && c !== STRIP.dark) c = q('.page.grouped:not(.hidden)') ? STRIP.grouped : q('.page:not(.hidden)') ? STRIP.page : STRIP.map;
      }
      document.documentElement.style.setProperty('--edge', c);
      // Under the clock: no shade where the top of the screen is already dark.
      document.documentElement.classList.toggle('top-dark', !!(q('.splash:not(.out)') || q('#req') || q('.onboard') || q('.auth2')));
      // iOS colours the status-bar strip from the page background when the app opens and keeps it,
      // so the page background is never the dark splash colour (the splash covers the screen anyway).
      const bg = c === STRIP.dark && !document.documentElement.classList.contains('launch-dark') ? STRIP.page : c;
      if (document.documentElement.style.backgroundColor !== bg) { document.documentElement.style.backgroundColor = bg; document.body.style.backgroundColor = bg; }
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
    if (!sp || sp.classList.contains('out') || sp.dataset.going) return;
    sp.dataset.going = '1';
    // The full logo animation once a day; after that the app opens almost straight away.
    let quick = false;
    try { const last = Number(localStorage.getItem('flytte_opened')) || 0; quick = Date.now() - last < 12 * 3600e3; localStorage.setItem('flytte_opened', String(Date.now())); } catch {}
    const photoMode = document.documentElement.classList.contains('launch-dark') && sp.querySelector('.sp-photo');
    if (photoMode) return settleIntoSignIn(sp, quick);
    // Signed in: the launch screen is static, like a native one. It always stays long enough to
    // register (a split-second flash looks like a glitch), a little longer on the first open of the day.
    if (quick) sp.classList.add('repeat');
    const wait = Math.max(0, (quick ? 800 : 1100) - (performance.now() - T0));
    setTimeout(() => requestAnimationFrame(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 650); }), wait);
  };

  // Signed out: the launch photo becomes the sign-in page. The page is drawn underneath in the same
  // pose as the splash (full-screen photo, wordmark in the middle), the splash steps aside, and the
  // page settles into place: photo shrinks to its header, wordmark glides up, the card slides in.
  function settleIntoSignIn(sp, quick) {
    const img = sp.querySelector('.sp-photo img');
    const photoReady = img && !img.complete ? Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
    // Hold the launch photo for a moment from the instant the app opened (not from when the script ran),
    // so the eye settles on it before it moves, even when the installed app loads slowly.
    const hold = new Promise((r) => setTimeout(r, Math.max(350, (quick ? 1200 : 1700) - performance.now())));
    const pageReady = new Promise((r) => { const t0 = performance.now(); (function look() { const a = document.querySelector('.auth2'); if (a || performance.now() - t0 > 4000) r(a); else requestAnimationFrame(look); })(); });
    Promise.all([pageReady, photoReady, hold]).then(([auth]) => {
      if (!auth) { sp.classList.add('out'); setTimeout(() => sp.remove(), 300); return; }
      auth.querySelectorAll('.auth-body > *').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 8)));
      auth.classList.add('intro');
      void auth.offsetHeight;                       // lay out the intro pose before the splash leaves
      // Match the page to the splash exactly (logo position and size, photo zoom), so nothing jumps.
      const logo = auth.querySelector('.auth-logo'), lw = logo && logo.querySelector('.wm'), sw = sp.querySelector('.sp-mark .wm');
      const heroImg = auth.querySelector('.auth-hero img'), spImg = sp.querySelector('.sp-photo img');
      if (logo && lw && sw) {
        const a = sw.getBoundingClientRect(), b = lw.getBoundingClientRect();
        if (a.width && b.width) {
          const base = getComputedStyle(logo).transform, k = a.width / b.width;
          logo.style.transform = `translate(${(a.left + a.width / 2) - (b.left + b.width / 2)}px, ${(a.top + a.height / 2) - (b.top + b.height / 2)}px) ${base === 'none' ? '' : base} scale(${k})`;
        }
      }
      if (heroImg && spImg) { const t = getComputedStyle(spImg).transform; if (t && t !== 'none') heroImg.style.transform = t; }
      void auth.offsetHeight;
      sp.classList.add('out');                       // splash and page now look the same: a quick fade hides any seam
      setTimeout(() => {
        sp.remove();
        auth.classList.add('settle');
        requestAnimationFrame(() => { auth.classList.remove('intro'); if (logo) logo.style.transform = ''; if (heroImg) heroImg.style.transform = ''; });
        setTimeout(() => { auth.classList.remove('settle'); auth.querySelectorAll('.auth-body > *').forEach((el) => el.style.removeProperty('--i')); }, 2000);
      }, 200);
    });
  }

  // ---------- installable app ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; document.dispatchEvent(new Event('flytte:installable')); });
  K.standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  K.installCard = function (host, appName = 'Flytte', icon = '/icons/flytte-icon-192.png') {
    const key = 'flytte_install_dismissed_' + APP;
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
    document.addEventListener('flytte:installable', draw, { once: true });
  };

  // ---------- onboarding, sign up & log in (mockup screens 1–4, 14–16) ----------
  

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

  // In-app camera: photos are taken live, not picked from the gallery, so a driver's
  // photo and their vehicle's plate are what's really in front of the phone right now.
  // guide: 'face' (oval, front camera) or 'plate' (frame, back camera). Resolves to a JPEG
  // data URL, or null if the person closes it.
  K.camera = ({ guide = 'face', title = '', hint = '' } = {}) => new Promise((resolve) => {
    const face = guide === 'face';
    const ov = document.createElement('div');
    ov.className = 'cam'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title || 'Camera');
    ov.innerHTML = `<div class="cam-top"><button class="cam-x" data-x aria-label="Close">${K.ic('x')}</button><b>${K.esc(title)}</b><span></span></div>
      <div class="cam-view"><video playsinline autoplay muted ${face ? 'class="mirror"' : ''}></video><img alt="Your photo" hidden>
        ${face ? '<div class="cam-round" hidden><img alt="How riders will see you"><span>This is how riders will see you</span></div>' : ''}
        <div class="cam-guide ${face ? 'face' : 'plate'}" aria-hidden="true"></div>
        <p class="cam-msg" role="status">Starting the camera…</p></div>
      <p class="cam-hint">${K.esc(hint)}</p>
      <div class="cam-bar"><button class="cam-shot" data-shot aria-label="Take photo" disabled></button>
        <div class="cam-after" hidden><button class="btn btn-lg cam-retake" data-retake>Retake</button><button class="btn btn-primary btn-lg" data-use>Use photo</button></div></div>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video'), img = ov.querySelector('img'), msg = ov.querySelector('.cam-msg');
    const shot = ov.querySelector('[data-shot]'), after = ov.querySelector('.cam-after');
    let stream = null, photo = null;
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const close = (val) => { stop(); ov.remove(); document.removeEventListener('keydown', esc); resolve(val); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc);
    const start = async () => {
      msg.hidden = false; msg.textContent = 'Starting the camera…';
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = 'This browser can’t open the camera. Open Flytte Driver from your Home Screen, or in Safari or Chrome.'; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: face ? 'user' : { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
        video.srcObject = stream; await video.play().catch(() => {});
        msg.hidden = true; shot.disabled = false; shot.focus();
      } catch (e) {
        msg.textContent = e && e.name === 'NotAllowedError'
          ? 'Camera access is off. Allow the camera for Flytte in your phone’s settings, then try again.'
          : e && e.name === 'NotFoundError' ? 'No camera was found on this device.' : 'The camera couldn’t start. Close other apps using it and try again.';
      }
    };
    const round = ov.querySelector('.cam-round');
    shot.onclick = () => {
      const w = video.videoWidth, h = video.videoHeight; if (!w || !h) return;
      if (face) {
        // The face is lined up in the oval; the saved photo is a square around that oval, so it
        // sits centred in the round profile picture riders see.
        const view = video.getBoundingClientRect(), g = ov.querySelector('.cam-guide').getBoundingClientRect();
        const sc = Math.max(view.width / w, view.height / h);            // object-fit: cover
        const ox = (view.width - w * sc) / 2, oy = (view.height - h * sc) / 2;
        const cx = (g.left + g.width / 2 - view.left - ox) / sc, cy = (g.top + g.height / 2 - view.top - oy) / sc;
        let side = Math.min((g.height * 1.12) / sc, w, h);
        const sx = Math.max(0, Math.min(w - side, cx - side / 2)), sy = Math.max(0, Math.min(h - side, cy - side / 2));
        const c = document.createElement('canvas'); c.width = c.height = 640;
        c.getContext('2d').drawImage(video, sx, sy, side, side, 0, 0, 640, 640);
        photo = c.toDataURL('image/jpeg', 0.88);
        round.querySelector('img').src = photo; round.hidden = false; video.hidden = true;
      } else {
        const k = Math.min(1, 1000 / Math.max(w, h));
        const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        photo = c.toDataURL('image/jpeg', 0.85);
        img.src = photo; img.hidden = false; video.hidden = true;
      }
      ov.classList.add('taken');
      stop(); shot.hidden = true; after.hidden = false;
    };
    ov.querySelector('[data-retake]').onclick = () => { photo = null; img.hidden = true; if (round) round.hidden = true; ov.classList.remove('taken'); video.hidden = false; shot.hidden = false; after.hidden = true; shot.disabled = true; start(); };
    ov.querySelector('[data-use]').onclick = () => close(photo);
    ov.querySelector('[data-x]').onclick = () => close(null);
    start();
  });

  // Phone box with a country picker (the native list on phones).
  const phoneField = (id, val = '') => { const c = K.country(); return `<div class="phone-field"><label class="cc" title="Country code"><span class="cc-show" aria-hidden="true">${c.flag} +${c.cc}</span>
    <select class="cc-pick" data-for="${id}" aria-label="Country">${K.COUNTRIES.map((x) => `<option value="${x.id}"${x.id === c.id ? ' selected' : ''}>${x.flag} ${x.name} (+${x.cc})</option>`).join('')}</select></label>
    <input id="${id}" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="${c.ex}" value="${K.esc(val)}" data-cc="${c.id}" aria-describedby="${id}-hint" required></div><span class="sr-only" id="${id}-hint">Mobile number. You can start with 0.</span>`; };
  document.addEventListener('change', (e) => {
    const sel = e.target.closest && e.target.closest('.cc-pick'); if (!sel) return;
    const c = K.country(sel.value), inp = document.getElementById(sel.dataset.for);
    sel.parentElement.querySelector('.cc-show').textContent = `${c.flag} +${c.cc}`;
    if (inp) { inp.dataset.cc = c.id; inp.placeholder = c.ex; inp.focus(); }
    K.setCountry(c.id);
  });

  // Public app settings (support line, commission…), fetched once and shared.
  let cfgP = null;
  K.cfg = () => (cfgP = cfgP || K.api('/config').catch((e) => { cfgP = null; throw e; }));
  const supportLink = (label, cls = 'btn btn-primary btn-block btn-lg') => K.cfg().then((c) => c.supportPhone
    ? `<a class="${cls}" href="tel:${K.esc(c.supportPhone.replace(/\s/g, ''))}">${label} · ${K.esc(c.supportPhone)}</a>` : '').catch(() => '');

  const pwField = (id, auto, ph = '') => `<div class="pw-field"><input id="${id}" name="password" type="password" autocomplete="${auto}" minlength="6" placeholder="${ph}" required><button type="button" class="eye" aria-label="Show password">${K.ic('eye')}</button></div>`;

  // "Keep 88% of every fare", using the commission actually set in Admin.
  const fillKeep = (root) => root.querySelectorAll('[data-keep]').forEach((x) => K.cfg().then((c) => {
    if (Number.isFinite(c.commissionPct)) x.textContent = `${x.dataset.keep} ${100 - c.commissionPct}% of every fare`;
  }).catch(() => {}));

  K.authScreen = function (root, { role, onDone }) {
    let draft = {}, dir = 'fwd';
    K.ready();
    // Auth layout: photo header with the logo, white card that slides up with the form.
    const shell = (inner, back) => {
      // The very first screen arrives from the launch photo, so it doesn't also slide in.
      const first = !!document.querySelector('#splash:not(.out)');
      root.innerHTML = `<div class="auth2 ${first ? '' : dir === 'back' ? 'nav-back' : 'nav-fwd'}">
        <div class="auth-hero"><img src="/img/welcome.jpg" alt="" decoding="async"><div class="auth-shade"></div>
          ${back ? `<button class="glass-back" data-back aria-label="Back">${K.ic('back')}</button>` : ''}
          <div class="auth-logo">${K.wordmark(role === 'driver')}</div></div>
        <div class="auth-card">${inner}</div></div>`;
      dir = 'fwd';
      const b = root.querySelector('[data-back]'); if (b) b.onclick = () => { dir = 'back'; back(); };
      root.querySelectorAll('.pw-field .eye').forEach((eye) => eye.onclick = () => {
        const i = eye.previousElementSibling, show = i.type === 'password';
        i.type = show ? 'text' : 'password'; eye.innerHTML = K.ic(show ? 'eyeOff' : 'eye'); eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      });
      fillKeep(root);
      // Only jump into the first box on computers. On phones it opened the keyboard and
      // pushed the typing box over the opening animation.
      if (matchMedia('(pointer: fine)').matches && !document.querySelector('#splash')) {
        const f = root.querySelector('form'); if (f) setTimeout(() => { const i = f.querySelector('input'); i && i.focus({ preventScroll: true }); }, 500);
      }
    };
    // The number they typed, shown at the top of the next step with a way back to change it.
    const phoneChip = () => `<div class="phone-chip"><span class="flag" aria-hidden="true">${K.countryOf(draft.e164).flag}</span><span class="num">+${K.countryOf(draft.e164).cc} ${K.esc(K.prettyPhone(draft.e164).replace(/^\+\d+ /, '').replace(/^0/, ''))}</span><button type="button" class="link-btn" data-chg>Change</button></div>`;
    const bindChip = () => { const c = root.querySelector('[data-chg]'); if (c) c.onclick = () => { dir = 'back'; phoneStep(); }; };
    const wrongApp = { driver: 'This number belongs to a driver account. Open the Flytte Driver app to sign in.', rider: 'This number has a rider account. Use a different number to drive with Flytte.', admin: 'This is a staff account.' };
    const busy = (form, on) => { const btn = form.querySelector('button[type=submit]'); btn.disabled = on; btn.innerHTML = on ? '<span class="spin" aria-hidden="true"></span><span class="sr-only">Loading</span>' : btn.dataset.label; };
    const finish = async (out, { isNew } = {}) => {
      K.session.set(out);
      // New riders: optional email for receipts, right after the account is made (skippable).
      if (isNew && role === 'rider') {
        const c = await K.cfg().catch(() => ({}));
        if (c.emailReceipts) await new Promise((resolve) => {
          shell('<div class="auth-body" data-email></div>', null);
          K.emailFlow(root.querySelector('[data-email]'), { skip: 'Skip for now', onDone: (u) => { if (u) { out.user = u; K.session.set(out); } resolve(); } });
        });
      }
      if (role === 'rider') await K.askLocation(root);
      // Installed iPhone app: reopen once so iOS takes the white strip under the clock from the
      // white launch screen (the signed-out screens launched it dark).
      if (K.standalone() && /iP(hone|ad|od)/.test(navigator.userAgent) && role !== 'admin') { location.reload(); return; }
      onDone(out);
    };

    function signUp() {
      shell(`<form id="f" novalidate class="auth-body">
        <h1>Create your account</h1><p class="lead">Add your name to finish setting up.</p>
        ${phoneChip()}
        <label for="nm">Full name</label><input id="nm" name="name" autocomplete="name" placeholder="e.g. Grace Nalubega" value="${K.esc(draft.name || '')}" required>
        ${draft.phoneToken ? '' : `<label for="pw">Password</label>${pwField('pw', 'new-password', 'At least 6 characters')}`}
        ${(() => { let ref = ''; try { ref = localStorage.getItem('flytte_ref') || ''; } catch {} return ref
          ? `<label for="ic">Invite code</label><input id="ic" name="inviteCode" value="${K.esc(ref)}" style="text-transform:uppercase;font-weight:700;letter-spacing:.05em">`
          : `<button type="button" class="link-btn" id="icToggle" style="align-self:flex-start;margin-top:12px">Have an invite code?</button><div id="icWrap" class="hidden"><label for="ic">Invite code</label><input id="ic" name="inviteCode" placeholder="e.g. GRACE123" style="text-transform:uppercase;font-weight:700;letter-spacing:.05em"></div>`; })()}
        <p class="error" role="alert"></p>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Create account">Create account</button>
      </form>`, phoneStep);
      const f = root.querySelector('#f');
      bindChip();
      const it = root.querySelector('#icToggle'); if (it) it.onclick = () => { it.remove(); root.querySelector('#icWrap').classList.remove('hidden'); root.querySelector('#ic').focus(); };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        draft.name = f.nm.value.trim();
        if (draft.name.length < 2) { err.textContent = 'Enter your full name.'; f.nm.focus(); return; }
        if (f.pw && f.pw.value.length < 6) { err.textContent = 'Your password needs at least 6 characters.'; f.pw.focus(); return; }
        const inviteCode = f.ic && f.ic.value.trim() ? f.ic.value.trim().toUpperCase() : undefined;
        busy(f, true);
        try { const out = await K.api('/auth/register', { name: draft.name, phone: draft.e164, password: f.pw ? f.pw.value : undefined, phoneToken: draft.phoneToken, role: 'rider', inviteCode }); try { localStorage.removeItem('flytte_ref'); } catch {} await finish(out, { isNew: true }); }
        catch (ex) { if (/already has an account/.test(ex.message) && !draft.phoneToken) { passwordStep(); return; } if (/SMS code first/.test(ex.message)) { draft.phoneToken = null; phoneStep(); return; } err.textContent = ex.message; busy(f, false); }
      };
    }

    function driverForm() {
      shell(`<form id="f" novalidate class="auth-body">
        <h1>Your details</h1><p class="lead">These are verified before your first trip.</p>
        ${phoneChip()}
        <label for="nm">Full name</label><input id="nm" name="name" autocomplete="name" value="${K.esc(draft.name || '')}" required>
        ${draft.phoneToken ? '' : `<label for="pw">Create a password</label>${pwField('pw', 'new-password', 'At least 6 characters')}`}
        <label for="vt">What do you drive?</label><select id="vt" name="vehicleType"><option value="boda">Boda boda (motorcycle)</option><option value="car">Car</option></select>
        <div class="row"><div class="fill"><label for="pl">Number plate</label><input id="pl" name="plate" placeholder="UFA 123X" required></div>
          <div class="fill"><label for="co">Colour</label><input id="co" name="vehicleColor" placeholder="Red"></div></div>
        <label for="mk">Make and model</label><input id="mk" name="vehicleMake" placeholder="Bajaj Boxer / Toyota Premio">
        <label for="lc">Driving permit number</label><input id="lc" name="licenseNo" required>
        <label for="mm">Mobile Money for payouts</label><input id="mm" name="momoNumber" type="tel" placeholder="Same as your phone if empty">
        <label class="check-row"><input type="checkbox" name="woman" value="1"><span>I’m a woman driver<small>Riders can ask for a woman driver, for example at night. Optional; the Flytte team confirms it with your ID.</small></span></label>
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Continue" style="margin-top:8px">Continue</button>
      </form>`, phoneStep);
      const f = root.querySelector('#f');
      bindChip();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        const data = Object.fromEntries(new FormData(f).entries());
        data.phone = draft.phone; draft.name = (data.name || '').trim();
        if (draft.phoneToken) data.phoneToken = draft.phoneToken;
        const need = [[(data.name || '').trim().length >= 2, 'nm', 'Enter your full name.'],
          [!!draft.phoneToken || (data.password || '').length >= 6, 'pw', 'Your password needs at least 6 characters.'], [(data.plate || '').trim().length >= 4, 'pl', 'Enter the number plate.'], [(data.licenseNo || '').trim(), 'lc', 'Enter your driving permit number.'],
          [!data.momoNumber || K.validPhone(data.momoNumber, K.countryOf(draft.e164).id), 'mm', 'Enter a valid Mobile Money number, or leave it empty.']].find(([ok]) => !ok);
        if (need) { err.textContent = need[2]; f[need[1]].focus(); return; }
        data.phone = draft.e164; data.woman = data.woman === '1';
        if (data.momoNumber) data.momoNumber = K.e164(data.momoNumber, K.countryOf(draft.e164).id);
        busy(f, true);
        try { const out = await K.api('/auth/register', { ...data, role: 'driver' }); K.session.set(out); K.verifyDocs(root, { onDone: () => onDone(out) }); }
        catch (ex) { err.textContent = ex.message; busy(f, false); }
      };
    }

    // The first screen for riders and drivers: just the mobile number, then a one-time code
    // (on WhatsApp or by SMS). Existing numbers sign straight in; new numbers set up an account.
    function phoneStep() {
      const driver = role === 'driver';
      shell(`<form id="f" novalidate class="auth-body phone-first">
        <h1>${driver ? 'Drive with Flytte' : 'Welcome to Flytte'}</h1>
        <p class="lead">${driver ? 'Sign in, or apply to drive, with your mobile number.' : 'Sign in or create an account with your mobile number.'}</p>
        <label for="ph" class="sr-only">Mobile number</label>${phoneField('ph', draft.phone)}
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Continue">Continue</button>
        <p class="fine" data-fine>We’ll send a one-time code to verify your number.${driver ? ' New drivers are reviewed before their first trip.' : ''}</p>
        <p class="fine legal">By continuing, you agree to Flytte’s <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
      </form>`, null);
      const f = root.querySelector('#f');
      K.cfg().then((c) => { const t = root.querySelector('[data-fine]'); if (t && !c.smsLogin) t.textContent = `Existing accounts sign in with a password; new accounts are set up in a few steps.${driver ? ' New drivers are reviewed before their first trip.' : ''}`; }).catch(() => {});
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        const ph = f.ph.value.trim(), c = K.country(f.ph.dataset.cc), e164 = K.e164(ph, c.id);
        if (!e164) { err.textContent = `Enter a valid ${c.name} mobile number, e.g. 0${c.ex}.`; f.ph.focus(); return; }
        if (e164 !== draft.e164 || !draft.phoneToken) draft = { phone: ph, e164, name: draft.name };
        busy(f, true);
        try {
          const out = await K.api('/auth/check', { phone: e164 });
          if (out.exists && out.role !== role) { err.textContent = wrongApp[out.role] || 'This number can’t be used here.'; busy(f, false); return; }
          const cfg = await K.cfg().catch(() => ({}));
          if (cfg.smsLogin) {
            const chans = cfg.codeChannels && cfg.codeChannels.length ? cfg.codeChannels : ['sms'];
            const ch = chans.length > 1 ? await pickChannel(chans) : chans[0];
            if (!ch) { busy(f, false); return; }
            await sendCode(ch); codeStep(); return;
          }
          if (out.exists) passwordStep(); else if (driver) driverForm(); else signUp();
        } catch (ex) { err.textContent = ex.message; busy(f, false); }
      };
    }

    // Where should the code go? WhatsApp or SMS, asked each time (like Faras / Bolt).
    const WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z"/></svg>';
    const SMSI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 11h.01M12 11h.01M16 11h.01"/></svg>';
    const TGI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.7 4.3 3.4 11a.9.9 0 0 0 0 1.7l4.3 1.4 1.7 5.2c.2.6.9.8 1.4.4l2.4-2 4.3 3.2c.5.4 1.3.1 1.4-.5l3-14.1c.2-.8-.5-1.4-1.2-1Zm-3.2 3.4-7.6 6.8-.3 3.1-1.3-4.1 8.6-5.5c.4-.3.8.1.6-.3Z"/></svg>';
    // Where codes can go, in the order they're offered.
    const CH = {
      whatsapp: { name: 'WhatsApp', on: 'on WhatsApp', icon: WA, cls: 'ch-wa', sub: 'Works on Wi-Fi or mobile data' },
      telegram: { name: 'Telegram', on: 'in Telegram', icon: TGI, cls: 'ch-tg', sub: 'Delivered in the Telegram app' },
      sms: { name: 'SMS', on: 'by SMS', icon: SMSI, cls: 'ch-sms', sub: 'Standard text message' },
    };
    const pickChannel = (chans) => new Promise((resolve) => {
      let done = false;
      const m = K.modal(`<div class="ch-sheet"><h2>Verify your number</h2>
        <p class="muted">Choose how to receive your 6-digit code for <b>${K.esc(K.prettyPhone(draft.e164))}</b></p>
        ${Object.keys(CH).filter((k) => chans.includes(k)).map((k) => `<button class="ch-opt ${CH[k].cls}" data-ch="${k}"><span class="ch-ic">${CH[k].icon}</span><span class="grow"><b>${CH[k].name}</b><small>${CH[k].sub}</small></span>${K.ic('chev')}</button>`).join('')}</div>`,
        { onClose: () => { if (!done) resolve(null); } });
      m.el.querySelectorAll('[data-ch]').forEach((b) => b.onclick = () => { done = true; K.haptic(); m.close(); resolve(b.dataset.ch); });
    });

    // SMS code: sent to the number, valid for 5 minutes.
    let resendAt = 0, channel = 'sms';
    async function sendCode(ch = channel) {
      const out = await K.api('/auth/otp/send', { phone: draft.e164, channel: ch });
      channel = out.channel || ch;
      resendAt = Date.now() + (out.resendIn || 30) * 1000;
      if (out.demoCode) K.toast(`Test mode (no ${(CH[channel] || CH.sms).name} set up): your code is ${out.demoCode}`, 8000);
      return out;
    }
    function codeStep() {
      shell(`<form id="f" novalidate class="auth-body code-step">
        <h1>Enter your code</h1>
        <p class="lead">Sent ${(CH[channel] || CH.sms).on} to</p>
        ${phoneChip()}
        <label for="otp" class="sr-only">6-digit code</label>
        <div class="otp-wrap"><input id="otp" name="otp" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" spellcheck="false">
          <div class="otp-boxes" aria-hidden="true">${'<i></i>'.repeat(6)}</div></div>
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Continue">Continue</button>
        <p class="fine"><button type="button" class="link-btn" data-resend disabled></button></p>
        <p class="fine hidden ch-switch" data-switch-wrap></p>
      </form>`, phoneStep);
      bindChip();
      const f = root.querySelector('#f'), inp = f.otp, boxes = f.querySelectorAll('.otp-boxes i'), rs = f.querySelector('[data-resend]'), err = f.querySelector('.error');
      const paint = () => { const v = inp.value; boxes.forEach((b, i) => { b.textContent = v[i] || ''; b.classList.toggle('on', i === Math.min(v.length, 5) && document.activeElement === inp); }); };
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); err.textContent = ''; paint(); if (inp.value.length === 6) f.requestSubmit(); });
      inp.addEventListener('focus', paint); inp.addEventListener('blur', paint);
      setTimeout(() => inp.focus({ preventScroll: true }), 350);
      let tick;
      const timer = () => { const left = Math.ceil((resendAt - Date.now()) / 1000); rs.disabled = left > 0; rs.textContent = left > 0 ? `Resend code in 0:${String(left).padStart(2, '0')}` : 'Resend code'; if (left <= 0) clearInterval(tick); };
      tick = setInterval(timer, 1000); timer();
      rs.onclick = async () => { rs.disabled = true; try { await sendCode(); K.toast('Code resent'); inp.value = ''; paint(); } catch (ex) { err.textContent = ex.message; } clearInterval(tick); tick = setInterval(timer, 1000); timer(); };
      // Didn't arrive? Offer the other ways that are switched on.
      const swWrap = f.querySelector('[data-switch-wrap]');
      K.cfg().then((c) => {
        const others = Object.keys(CH).filter((k) => k !== channel && (c.codeChannels || []).includes(k));
        if (!others.length) return;
        swWrap.innerHTML = `Didn’t receive it? ${others.map((k) => `<button type="button" class="link-btn" data-switch="${k}">Use ${CH[k].name}</button>`).join(' · ')}`;
        swWrap.classList.remove('hidden');
        swWrap.querySelectorAll('[data-switch]').forEach((sw) => sw.onclick = async () => {
          if (Date.now() < resendAt) { err.textContent = `You can request a new code in ${Math.ceil((resendAt - Date.now()) / 1000)}s.`; return; }
          const to = sw.dataset.switch;
          sw.disabled = true; try { await sendCode(to); clearInterval(tick); dir = 'fwd'; codeStep(); K.toast(`Code sent ${CH[to].on}`); } catch (ex) { err.textContent = ex.message; sw.disabled = false; }
        });
      }).catch(() => {});
      // Android Chrome can read the code straight from the SMS.
      if ('OTPCredential' in window) { const ac = new AbortController(); f.addEventListener('submit', () => ac.abort(), { once: true }); navigator.credentials.get({ otp: { transport: ['sms'] }, signal: ac.signal }).then((c) => { if (c && c.code) { inp.value = c.code; paint(); f.requestSubmit(); } }).catch(() => {}); }
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (inp.value.length !== 6) { err.textContent = 'Enter all 6 digits.'; inp.focus(); return; }
        busy(f, true);
        try {
          const out = await K.api('/auth/otp/verify', { phone: draft.e164, code: inp.value });
          clearInterval(tick);
          if (out.token) {
            if (out.user.role !== role) throw new Error(wrongApp[out.user.role] || 'This account can’t be used here.');
            await finish(out); return;
          }
          draft.phoneToken = out.phoneToken;
          if (role === 'driver') driverForm(); else signUp();
        } catch (ex) { err.textContent = ex.message; busy(f, false); inp.value = ''; paint(); inp.focus(); }
      };
    }

    function passwordStep() {
      shell(`<form id="f" novalidate class="auth-body">
        <h1>Welcome back</h1><p class="lead">Enter your password to continue.</p>
        ${phoneChip()}
        <input type="tel" name="username" autocomplete="username" value="${K.esc(draft.e164)}" hidden>
        <label for="pw">Password</label>${pwField('pw', 'current-password')}
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="link-btn" data-forgot>Forgot password?</button></div>
        <p class="error" role="alert"></p>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Sign in">Sign in</button>
      </form>`, phoneStep);
      bindChip();
      const f = root.querySelector('#f');
      root.querySelector('[data-forgot]').onclick = forgot;
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        if (!f.pw.value) { err.textContent = 'Enter your password.'; f.pw.focus(); return; }
        busy(f, true);
        try {
          const out = await K.api('/auth/login', { phone: draft.e164, password: f.pw.value });
          if (out.user.role !== role) throw new Error(wrongApp[out.user.role] || 'This account can’t be used here.');
          await finish(out);
        } catch (ex) { err.textContent = /Wrong phone number or password/.test(ex.message) ? 'That password isn’t right. Try again, or tap “Forgot password?”.' : ex.message; busy(f, false); }
      };
    }

    async function forgot() {
      const call = await supportLink('Call support');
      K.modal(`<h2>Forgot your password?</h2>
        <p class="muted">${call ? 'Call Flytte support from the number you signed up with. We’ll confirm it’s you and set a new password.' : 'Password resets are done by the Flytte team for now. A support line will be listed here soon.'}</p>
        ${call}
        <button class="btn btn-block" style="margin-top:8px" data-close>Close</button>`);
    }

    // Staff sign in (admin): phone and password on one screen.
    function logIn() {
      shell(`<form id="f" novalidate class="auth-body">
        <h1>${role === 'driver' ? 'Welcome back, driver' : role === 'admin' ? 'Flytte Operations' : 'Welcome back'}</h1>
        <p class="lead">${role === 'admin' ? 'Staff sign in' : 'Log in to continue'}</p>
        <label for="ph">Phone number</label>${phoneField('ph', draft.phone)}
        <label for="pw">Password</label>${pwField('pw', 'current-password')}
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" class="link-btn" data-forgot>Forgot password?</button></div>
        <p class="error" role="alert"></p>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" type="submit" data-label="Sign in">Sign in</button>
      </form>`, null);
      const f = root.querySelector('#f');
      root.querySelector('[data-forgot]').onclick = forgot;
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = f.querySelector('.error'); err.textContent = '';
        draft.phone = f.ph.value.trim(); draft.e164 = K.e164(draft.phone, f.ph.dataset.cc);
        if (!draft.e164) { err.textContent = 'Enter a valid phone number, e.g. 0772 123456.'; f.ph.focus(); return; }
        if (!f.pw.value) { err.textContent = 'Enter your password.'; f.pw.focus(); return; }
        busy(f, true);
        try {
          const out = await K.api('/auth/login', { phone: draft.e164, password: f.pw.value });
          if (out.user.role !== role) throw new Error({ driver: 'This is a driver account. Use the Flytte Driver app.', rider: 'This number is a rider account. Use a different number for driving.', admin: 'This is a staff account.' }[out.user.role] || 'This account can’t be used here.');
          await finish(out);
        } catch (ex) { err.textContent = ex.message; busy(f, false); }
      };
    }

    // Riders and drivers open straight on the sign-in screen (no welcome slides first).
    if (role === 'driver' || role === 'rider') phoneStep();
    else logIn();
  };

  // Screen 4: location permission, asked once after sign up / log in.
  K.askLocation = (root) => new Promise(async (resolve) => {
    let state = 'prompt';
    try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch {}
    let asked = false; try { asked = !!localStorage.getItem('flytte_loc_asked'); } catch {}
    if (state !== 'prompt' || asked || !navigator.geolocation) return resolve();
    root.innerHTML = `<div class="onb nav-fwd" style="text-align:center">
      <div class="illu">${K.ic('pin').replace('class="i "', 'class="i" style="width:64px;height:64px;stroke-width:1.6"')}</div>
      <h1>Allow location access</h1>
      <p class="lead" style="max-width:30ch;margin:0 auto">We need your location to find the nearest drivers and give you the best service.</p>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-block btn-lg" id="al">Allow Location</button>
      <button class="btn btn-link btn-block" id="nn">Not Now</button></div>`;
    const done = () => { try { localStorage.setItem('flytte_loc_asked', '1'); } catch {} resolve(); };
    root.querySelector('#al').onclick = () => navigator.geolocation.getCurrentPosition(done, done, { timeout: 15000 });
    root.querySelector('#nn').onclick = done;
  });

  // Screen 16: driver identity documents.
  K.verifyDocs = async function (root, { onDone, back }) {
    const ICON = { national_id: 'idcard', license: 'card', vehicle: 'camera', photo: 'user' };
    const HINT = { national_id: 'Front of your National ID', license: 'Your driving permit', vehicle: 'Clear photo with the number plate', photo: 'A clear photo of your face' };
    const draw = async () => {
      let info;
      try { info = await K.api('/driver/documents'); }
      catch (e) {
        root.innerHTML = `<div class="onb nav-fwd" style="text-align:center"><div class="state-box" role="alert" style="margin-top:30vh"><b>Couldn’t load your documents</b><span>${K.esc(e.message)}</span><button class="btn btn-primary" id="again">Try again</button></div></div>`;
        root.querySelector('#again').onclick = draw;
        return;
      }
      const kinds = Object.keys(info.kinds);
      const allDone = kinds.every((k) => info.uploaded[k]);
      root.innerHTML = `<div class="onb nav-fwd">${back ? `<div class="onb-top"><button class="btn icon-btn btn-ghost" data-back aria-label="Back">${K.ic('back')}</button></div>` : '<div style="height:20px"></div>'}
        <h1>Verify your identity</h1><p class="lead">Upload the required documents to get verified.</p>
        ${kinds.map((k) => `<label class="doc ${info.uploaded[k] ? 'done' : ''}" for="f-${k}" style="margin:0 0 10px">
          <span class="ic">${K.ic(ICON[k] || 'camera')}</span><span class="grow"><span style="display:block">${K.esc(info.kinds[k])}</span><span class="tiny muted" style="font-weight:500">${HINT[k] || ''}</span></span>
          <span class="st">${info.uploaded[k] ? 'Uploaded ✓' : k === 'photo' ? 'Take photo' : 'Upload'}</span>
          ${k === 'photo' ? `<button type="button" id="f-${k}" data-cam="${k}" hidden></button>` : `<input type="file" id="f-${k}" data-k="${k}" accept="image/*" capture="environment" hidden>`}</label>`).join('')}
        <p class="error" id="err"></p>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-block btn-lg" id="go" ${allDone ? '' : 'disabled'}>Continue</button>
        <p class="fine" id="docHelp"></p></div>`;
      supportLink('Contact support', '').then((a) => { const h = root.querySelector('#docHelp'); if (h && a) h.innerHTML = 'Need help? ' + a; });
      const b = root.querySelector('[data-back]'); if (b) b.onclick = back;
      root.querySelectorAll('input[type=file]').forEach((inp) => inp.onchange = async () => {
        const file = inp.files[0]; if (!file) return;
        const st = inp.closest('.doc').querySelector('.st'); st.textContent = 'Uploading…';
        if (file.size > 25e6) { root.querySelector('#err').textContent = 'That file is too large. Choose a photo.'; return; }
        try { await K.api('/driver/documents', { kind: inp.dataset.k, image: await K.compressImage(file) }, 'POST', { timeout: 90000 }); draw(); }
        catch (ex) { root.querySelector('#err').textContent = ex.message; st.textContent = 'Try again'; }
      });
      root.querySelectorAll('[data-cam]').forEach((btn) => {
        const row = btn.closest('.doc');
        row.addEventListener('click', async (ev) => {
          ev.preventDefault();
          const img = await K.camera({ guide: 'face', title: 'Your profile photo', hint: 'Riders use this to recognise you. Face the light, look at the camera, no sunglasses, helmet or cap.' });
          if (!img) return;
          const st = row.querySelector('.st'); st.textContent = 'Uploading…';
          try { await K.api('/driver/documents', { kind: 'photo', image: img, live: true }, 'POST', { timeout: 90000 }); draw(); }
          catch (ex) { root.querySelector('#err').textContent = ex.message; st.textContent = 'Try again'; }
        });
      });
      root.querySelector('#go').onclick = onDone;
    };
    draw();
  };

  // ---------- maps ----------
  // ---------- language: English, Luganda or Kiswahili (translations live in i18n.js) ----------
  K.lang = () => window.FLYTTE_LANG || 'en';
  K.setLang = (l) => { try { localStorage.setItem('flytte_lang', l); } catch {} location.reload(); };

  // ---------- Settings (both apps): appearance, language, legal, delete account ----------
  // ---------- lock-screen alerts (Web Push) ----------
  // Shared by both apps. iOS only allows them once the app is on the Home Screen.
  K.push = (() => {
    const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const u8 = (b64) => { const pad = '='.repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
    const iosBrowser = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !K.standalone();
    async function current() {
      if (!supported() || Notification.permission !== 'granted') return null;
      try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch { return null; }
    }
    async function enable() {
      if (!supported()) throw new Error(iosBrowser() ? 'Add Flytte to your Home Screen first (Share → Add to Home Screen), then turn on alerts.' : 'This browser can’t show alerts.');
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Alerts are blocked. Allow notifications for Flytte in your phone settings.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) { const { key } = await K.api('/push/key'); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) }); }
      await K.api('/push/subscribe', { subscription: sub.toJSON() });
      return true;
    }
    async function disable() {
      const sub = await current();
      if (sub) { await K.api('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
    }
    return { supported, enable, disable, current, iosBrowser };
  })();

  // ---------- Email for receipts ----------
  // Two steps rendered into any host element: the address, then the 6-digit code from the email.
  // opts: { skip: label for a skip link (sign-up), onDone(user|null), current: existing email }
  K.emailFlow = function (host, { skip, onDone, current } = {}) {
    let addr = current || '', resendAt = 0, tick;
    const done = (u) => { clearInterval(tick); onDone && onDone(u); };
    const step1 = () => {
      host.innerHTML = `<form class="email-flow" novalidate>
        <h1>Add your email</h1>
        <p class="lead">Stay in the loop with your trips and your Flytte account.</p>
        <label for="em" class="sr-only">Email address</label>
        <input id="em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${K.esc(addr)}">
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Continue</button>
        ${skip ? `<button type="button" class="link-btn email-skip" data-skip>${K.esc(skip)}</button>` : ''}
      </form>`;
      const f = K.$('form', host), inp = K.$('#em', host), err = K.$('.error', host), btn = K.$('button[type=submit]', host);
      setTimeout(() => inp.focus({ preventScroll: true }), 450);
      const sk = K.$('[data-skip]', host); if (sk) sk.onclick = () => done(null);
      f.onsubmit = async (e) => {
        e.preventDefault(); err.textContent = '';
        const v = inp.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { err.textContent = 'Enter a valid email address.'; inp.focus(); return; }
        btn.disabled = true;
        try {
          const out = await K.api('/me/email', { email: v });
          if (out.already) { K.toast('That email is already confirmed'); done(null); return; }
          addr = out.email; resendAt = Date.now() + (out.resendIn || 30) * 1000;
          if (out.demoCode) K.toast(`Test mode: your email code is ${out.demoCode}`, 8000);
          step2();
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      };
    };
    const step2 = () => {
      host.innerHTML = `<form class="email-flow" novalidate>
        <h1>Check your email</h1>
        <p class="lead">Enter the 6-digit code we sent to <b>${K.esc(addr)}</b></p>
        <input id="ec" class="pin-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······" aria-label="6-digit code">
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Confirm email</button>
        <p class="fine"><button type="button" class="link-btn" data-resend disabled></button> · <button type="button" class="link-btn" data-change>Use a different email</button></p>
        ${skip ? `<button type="button" class="link-btn email-skip" data-skip>${K.esc(skip)}</button>` : ''}
      </form>`;
      const f = K.$('form', host), inp = K.$('#ec', host), err = K.$('.error', host), rs = K.$('[data-resend]', host);
      setTimeout(() => inp.focus({ preventScroll: true }), 450);
      const timer = () => { const left = Math.ceil((resendAt - Date.now()) / 1000); rs.disabled = left > 0; rs.textContent = left > 0 ? `Resend code in 0:${String(left).padStart(2, '0')}` : 'Resend code'; };
      clearInterval(tick); tick = setInterval(timer, 1000); timer();
      rs.onclick = async () => { rs.disabled = true; try { const out = await K.api('/me/email', { email: addr }); resendAt = Date.now() + (out.resendIn || 30) * 1000; if (out.demoCode) K.toast(`Test mode: your email code is ${out.demoCode}`, 8000); K.toast('Code resent'); } catch (ex) { err.textContent = ex.message; } timer(); };
      K.$('[data-change]', host).onclick = () => { clearInterval(tick); step1(); };
      const sk = K.$('[data-skip]', host); if (sk) sk.onclick = () => done(null);
      const go = async () => {
        err.textContent = '';
        try { const out = await K.api('/me/email/verify', { code: inp.value }); K.toast('Email confirmed'); done(out.user); }
        catch (ex) { err.textContent = ex.message; inp.value = ''; inp.focus(); }
      };
      inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); if (inp.value.length === 6) go(); };
      f.onsubmit = (e) => { e.preventDefault(); if (inp.value.length !== 6) { err.textContent = 'Enter all 6 digits.'; return; } go(); };
    };
    step1();
  };

  // ---------- Wallet lock: fingerprint / face (passkeys) ----------
  // Money leaves a locked wallet only after the phone's own fingerprint or face unlock (checked by
  // the server), or a one-time code as the fallback. Returns a short-lived "pass" for the request.
  K.walletLock = (() => {
    const toBuf = (s) => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); const raw = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer; };
    const b64u = (b) => { let x = ''; new Uint8Array(b).forEach((c) => { x += String.fromCharCode(c); }); return btoa(x).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    let avail = null;
    async function supported() {
      if (avail != null) return avail;
      try { avail = !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { avail = false; }
      return avail;
    }
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const bioName = () => (isIOS ? 'Face ID or Touch ID' : 'fingerprint or face unlock');
    const device = () => (isIOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'This device');
    // Registration options are fetched ahead of the tap, so the browser sees the tap as the trigger.
    let regOpts = null;
    async function prepare(pass) { try { regOpts = await K.api('/wallet/lock/options', pass ? { pass } : {}); } catch (e) { regOpts = null; throw e; } return regOpts; }
    async function create(opts) {
      const o = opts || regOpts; regOpts = null;
      if (!o) throw new Error('Try again.');
      const publicKey = { ...o, challenge: toBuf(o.challenge), user: { ...o.user, id: toBuf(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })) };
      const c = await navigator.credentials.create({ publicKey });
      const credential = { id: c.id, rawId: b64u(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment,
        response: { clientDataJSON: b64u(c.response.clientDataJSON), attestationObject: b64u(c.response.attestationObject), transports: c.response.getTransports ? c.response.getTransports() : [] },
        clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {} };
      return K.api('/wallet/lock/register', { credential, device: device() });
    }
    async function assert(o) {
      const publicKey = { ...o, challenge: toBuf(o.challenge), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: toBuf(c.id) })) };
      const c = await navigator.credentials.get({ publicKey });
      const credential = { id: c.id, rawId: b64u(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment,
        response: { clientDataJSON: b64u(c.response.clientDataJSON), authenticatorData: b64u(c.response.authenticatorData), signature: b64u(c.response.signature), userHandle: c.response.userHandle ? b64u(c.response.userHandle) : undefined },
        clientExtensionResults: c.getClientExtensionResults ? c.getClientExtensionResults() : {} };
      return (await K.api('/wallet/unlock', { credential })).pass;
    }
    // The confirm sheet: fingerprint/face first, a one-time code as the fallback. Resolves to a pass or null.
    function unlock({ amount, title } = {}) {
      return new Promise((resolve) => {
        let done = false, opts = null;
        const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
        const m = K.modal(`<div class="unlock">
          <div class="unlock-ic">${K.ic('lock')}</div>
          <h2>${K.esc(title || 'Confirm it’s you')}</h2>
          <p class="muted">${amount ? `Pay <b>${K.ugx(amount)}</b> from your Flytte Wallet.` : 'Your Flytte Wallet is locked.'}</p>
          <p class="error" role="alert"></p>
          <div data-step>
            <button class="btn btn-primary btn-block btn-lg" data-bio disabled>Use ${bioName()}</button>
            <button class="btn btn-ghost btn-block" data-code>Use a code instead</button>
          </div></div>`, { onClose: () => { if (!done) { done = true; resolve(null); } } });
        const err = K.$('.error', m.el), bio = K.$('[data-bio]', m.el);
        supported().then((ok) => ok ? K.api('/wallet/unlock/options', {}) : null).then((o) => {
          if (o && !o.none) { opts = o; bio.disabled = false; } else { bio.hidden = true; }
        }).catch(() => { bio.hidden = true; });
        bio.onclick = async () => {
          if (!opts) return;
          err.textContent = ''; bio.disabled = true;
          const o = opts; opts = null;
          try { finish(await assert(o)); }
          catch (e) {
            err.textContent = e.name === 'NotAllowedError' ? 'Not confirmed. Try again, or use a code.' : e.message;
            try { opts = await K.api('/wallet/unlock/options', {}); bio.disabled = !opts || !!opts.none; } catch {}
          }
        };
        K.$('[data-code]', m.el).onclick = async () => {
          const step = K.$('[data-step]', m.el);
          const u = K.session.get && K.session.get();
          const phone = u && u.user && u.user.phone;
          err.textContent = '';
          step.innerHTML = '<p class="small muted" style="margin:0 0 10px">Sending a code to your phone…</p>';
          let channel = 'sms';
          try { const c = await K.cfg(); if (c.codeChannels && c.codeChannels.length) channel = c.codeChannels.includes('sms') ? 'sms' : c.codeChannels[0]; } catch {}
          try {
            const out = await K.api('/auth/otp/send', { phone, channel });
            if (out.demoCode) K.toast(`Test mode: your code is ${out.demoCode}`, 8000);
          } catch (e) { step.innerHTML = ''; err.textContent = e.message; return; }
          step.innerHTML = `<label for="wc">Enter the 6-digit code we sent to ${K.esc(K.prettyPhone ? K.prettyPhone(phone) : phone)}</label>
            <input id="wc" class="pin-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······">
            <button class="btn btn-primary btn-block btn-lg" data-ok style="margin-top:12px">Confirm</button>`;
          const inp = K.$('#wc', m.el); setTimeout(() => inp.focus({ preventScroll: true }), 300);
          const go = async () => {
            err.textContent = '';
            try { finish((await K.api('/wallet/unlock/code', { code: inp.value })).pass); }
            catch (e) { err.textContent = e.message; }
          };
          K.$('[data-ok]', m.el).onclick = go;
          inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); if (inp.value.length === 6) go(); };
        };
      });
    }
    return { supported, prepare, create, unlock, bioName };
  })();

  K.openSettings = function ({ role = APP, onBack } = {}) {
    const page = document.createElement('div');
    page.className = 'page push-in grouped nav-large'; page.style.zIndex = 870;
    page.innerHTML = `<div class="page-inner"><div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Back">${K.ic('back')}</button><h2 aria-hidden="true">Settings</h2></div>
      <h1 class="page-title">Settings</h1><div data-body></div></div>`;
    (document.getElementById('app') || document.body).appendChild(page);
    K.$('[data-x]', page).onclick = () => K.pop(page, onBack);
    const body = K.$('[data-body]', page);
    let alertsOn = false;
    const draw = () => {
      const t = K.themePref(), l = K.lang();
      const alertNote = alertsOn ? 'On · we’ll tell you when your driver is close, has arrived, and when your trip ends.' : K.push.supported() ? 'Get a notification when your driver is close or has arrived, even with your phone locked.' : K.push.iosBrowser() ? 'Add Flytte to your Home Screen (Share → Add to Home Screen) to use trip alerts.' : 'Not available in this browser.';
      body.innerHTML = `
        ${role === 'rider' ? `<h3 class="set-h">Notifications</h3>
        <div class="set-card list"><button class="set-row" data-alerts role="switch" aria-checked="${alertsOn}" ${K.push.supported() ? '' : 'disabled'}><span class="grow"><b>Trip alerts</b><small>${alertNote}</small></span><span class="set-switch${alertsOn ? ' on' : ''}" aria-hidden="true"><i></i></span></button></div>` : ''}
        <h3 class="set-h">Appearance</h3>
        <div class="set-card"><div class="set-seg" role="radiogroup" aria-label="Appearance">
          ${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, n]) => `<button role="radio" aria-checked="${t === k}" data-theme="${k}">
            <span class="set-swatch sw-${k}" aria-hidden="true"><i></i><i></i></span>${n}</button>`).join('')}</div>
          <p class="set-note">${t === 'auto' ? 'Follows your phone’s light or dark setting.' : t === 'dark' ? 'Easier on the eyes at night.' : 'The classic Flytte look.'}</p></div>
        <h3 class="set-h">Language</h3>
        <div class="set-card list" role="radiogroup" aria-label="Language">
          ${[['en', 'English', 'English'], ['lg', 'Luganda', 'Oluganda'], ['sw', 'Kiswahili', 'Swahili']].map(([k, n, sub]) => `<button class="set-row" role="radio" aria-checked="${l === k}" data-lang="${k}"><span class="grow"><b>${n}</b><small>${sub}</small></span>${l === k ? K.ic('check') : ''}</button>`).join('')}
        </div>
        <h3 class="set-h">Legal</h3>
        <div class="set-card list">
          <a class="set-row" href="/terms" target="_blank" rel="noopener"><span class="grow"><b>Terms of Service</b></span>${K.ic('chev', 'sm')}</a>
          <a class="set-row" href="/privacy" target="_blank" rel="noopener"><span class="grow"><b>Privacy Policy</b></span>${K.ic('chev', 'sm')}</a>
        </div>
        <div class="set-card list" style="margin-top:22px"><button class="set-row danger" data-del><span class="grow"><b>Delete my account</b></span>${K.ic('chev', 'sm')}</button></div>
        <p class="set-foot">Flytte ${role === 'driver' ? 'Driver ' : ''}1.0</p>`;
      body.querySelectorAll('[data-theme]').forEach((b) => b.onclick = () => { K.haptic(); K.setTheme(b.dataset.theme); draw(); });
      body.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => { if (b.dataset.lang === K.lang()) return; K.haptic(); K.setLang(b.dataset.lang); });
      K.$('[data-del]', body).onclick = () => deleteAccount(role);
      const al = K.$('[data-alerts]', body);
      if (al) al.onclick = async () => {
        K.haptic(); al.disabled = true;
        try { if (alertsOn) { await K.push.disable(); alertsOn = false; } else { await K.push.enable(); alertsOn = true; K.toast('Trip alerts are on'); } }
        catch (e) { K.toast(e.message, 6000); }
        draw();
      };
    };
    draw();
    if (role === 'rider') K.push.current().then((sub) => { if (sub) { alertsOn = true; draw(); } });
    return page;
  };

  function deleteAccount(role) {
    const driver = role === 'driver';
    const m = K.modal(`<div class="del-sheet"><div class="del-ic">${K.ic('logout')}</div><h2>Delete your account?</h2>
      <p class="muted">This can’t be undone.</p>
      <ul class="del-list">
        <li>Your name, phone number${driver ? ', documents, photos' : ''}, saved places and emergency contact are erased.</li>
        <li>${driver ? 'You’ll stop getting requests straight away.' : 'Any Flytte Wallet balance and Rewards points are lost.'}</li>
        <li>Past trips and payments are kept only as anonymous records, as the law requires.</li>
        <li>You can sign up again later with the same number.</li>
      </ul>
      <p class="error" role="alert"></p>
      <button class="btn btn-block btn-lg btn-danger" data-go>Delete account</button>
      <button class="btn btn-block btn-lg btn-ghost" data-close>Keep my account</button></div>`);
    const go = K.$('[data-go]', m.el), err = K.$('.error', m.el);
    const run = async (forfeit) => {
      go.disabled = true; go.innerHTML = '<span class="spin"></span>Deleting…'; err.textContent = '';
      try {
        await K.api('/me/delete', { forfeit: !!forfeit });
        try { localStorage.removeItem('flytte_onboarded'); localStorage.setItem(KEY + '_out', '1'); } catch {}
        try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: APP }) }); } catch {}
        K.session.clear();
        m.close(); K.toast('Your account has been deleted.'); setTimeout(() => location.reload(), 900);
      } catch (e) {
        go.disabled = false; go.textContent = 'Delete account';
        if (/Wallet has/.test(e.message) && !forfeit) { err.textContent = e.message; go.textContent = 'Delete anyway'; go.onclick = () => run(true); return; }
        err.textContent = e.message;
      }
    };
    go.onclick = () => run(false);
  }

  // ---------- appearance: Light, Dark or Automatic (follows the phone) ----------
  // The choice is applied by a tiny script in each page's <head>, before the first frame.
  K.themePref = () => { try { return localStorage.getItem('flytte_theme') || 'light'; } catch { return 'light'; } };
  K.dark = () => document.documentElement.classList.contains('theme-dark');
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  K.applyTheme = function () {
    const p = K.themePref(), dark = p === 'dark' || (p === 'auto' && mqDark.matches), was = K.dark();
    document.documentElement.classList.toggle('theme-dark', dark);
    const meta = document.querySelector('meta[name=theme-color]'); if (meta && APP !== 'admin') meta.content = dark ? '#000000' : '#FFFFFF';
    if (was !== dark) (K._maps || []).forEach((g) => { try { g.setStyle(`https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`); } catch {} });
    if (typeof syncStrip === 'function') syncStrip();
  };
  K.setTheme = (p) => { try { localStorage.setItem('flytte_theme', p); } catch {} K.applyTheme(); };
  (mqDark.addEventListener ? mqDark.addEventListener('change', K.applyTheme) : mqDark.addListener(K.applyTheme));
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
        if (glMap) (K._maps = K._maps || []).push(glMap);
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

  // Place search runs on our server (src/places.js): Kampala landmarks, places riders use, then
  // OpenStreetMap. Returns the places; `.partial` is true when the map search didn't answer.
  K.search = async function (q, near) {
    const c = near || K.KAMPALA;
    const out = await K.api(`/places/search?${new URLSearchParams({ q, lat: c.lat.toFixed(4), lng: c.lng.toFixed(4) })}`, null, 'GET', { timeout: 8000 });
    return Object.assign(out.results || [], { partial: !!out.partial });
  };

  K.reverse = async function (lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
      const j = await r.json();
      const a = j.address || {};
      return [a.amenity || a.building || a.shop || a.road, a.suburb || a.neighbourhood || a.city_district || a.city].filter(Boolean).join(', ') || 'Pinned location';
    } catch { return 'Pinned location'; }
  };

  // Live connection for trip updates. If it drops while the phone is online, say so
  // after a short grace period (so brief blips stay invisible) and clear it on reconnect.
  K.socket = (token) => {
    if (typeof io !== 'function') { // opened offline before the live-connection library was saved: reload when back online
      addEventListener('online', () => location.reload(), { once: true });
      return { on() {}, emit(ev, data, cb) { if (typeof cb === 'function') cb({ ok: false, error: 'You’re offline.' }); }, connected: false };
    }
    const sock = io({ auth: { token }, transports: ['websocket', 'polling'] });
    let t;
    sock.on('disconnect', () => { clearTimeout(t); t = setTimeout(() => { if (!sock.connected && navigator.onLine !== false) K.netBanner(true, 'Reconnecting to Flytte…'); }, 4000); });
    sock.on('connect', () => { clearTimeout(t); if (navigator.onLine !== false) K.netBanner(false); });
    return sock;
  };

  // "6:40 pm": how people in Kampala say the time.
  K.clock = (d) => d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/^0/, '');

  K.share = async function (url, text) {
    if (navigator.share) { try { await navigator.share({ title: 'Flytte trip', text, url }); return; } catch {} }
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
  // Bottom sheet with iOS-style physics: drag from anywhere on it, flick to snap, rubber-band at the ends.
  // Snap points are offsets (px pushed down). sheet.snapPoints = () => ({ full: 0, mid: n, peek: n }) can be set per screen.
  K.draggableSheet = function (sheet) {
    if (sheet._drag) return;
    sheet._drag = true;
    let off = 0, snap = 'full', anim = false;
    const tabsPad = () => parseFloat(sheet.style.paddingBottom) || 0;
    const defaults = () => ({ full: 0, peek: Math.max(0, sheet.offsetHeight - 132 - tabsPad()) });
    const points = () => { const p = (sheet.snapPoints && sheet.snapPoints()) || defaults(); for (const k in p) p[k] = innerWidth >= 760 ? 0 : Math.max(0, Math.round(p[k])); return p; };
    const maxOff = () => Math.max(...Object.values(points()));
    const paint = (v, animate) => {
      off = v;
      sheet.style.transition = animate ? 'transform .55s var(--spring, cubic-bezier(.32,.72,0,1))' : 'none';
      sheet.style.transform = Math.abs(off) > 0.5 ? `translate3d(0,${off}px,0)` : '';
      sheet.classList.toggle('collapsed', snap === 'peek' && off > 0);
      sheet.classList.toggle('lifted', off > 1);
      if (off > 1 && sheet.scrollTop) sheet.scrollTop = 0;
      if (sheet.onSheetMove) sheet.onSheetMove(off, points());
    };
    const go = (name, animate = true) => {
      const p = points(); if (!(name in p)) name = 'full';
      const changed = name !== snap; snap = name;
      paint(p[name], animate);
      if (changed && sheet.onSnap) sheet.onSnap(name);
    };
    sheet.snapTo = go;
    sheet.snap = () => snap;
    sheet.resnap = () => go(snap, false);
    sheet.collapse = () => go('peek');
    sheet.expand = () => go('full');

    const nearest = (v, vel) => {
      const p = points(), list = Object.entries(p).sort((x, y) => x[1] - y[1]);
      // A quick flick moves one stop in that direction; otherwise land on the closest stop to where it would coast.
      if (Math.abs(vel) > 0.35) {
        if (vel > 0) return (list.find((e) => e[1] > v + 2) || list[list.length - 1])[0];
        return ([...list].reverse().find((e) => e[1] < v - 2) || list[0])[0];
      }
      const proj = v + vel * 160;
      return list.reduce((best, e) => (Math.abs(e[1] - proj) < Math.abs(best[1] - proj) ? e : best))[0];
    };
    const rubber = (v) => {
      const max = maxOff();
      if (v < 0) return -Math.min(28, Math.pow(-v, 0.7));
      if (v > max) return max + Math.pow(v - max, 0.7);
      return v;
    };

    // ---- touch (phones) ----
    let t0 = null;
    sheet.addEventListener('touchstart', (e) => {
      if (innerWidth >= 760 || e.touches.length > 1) { t0 = null; return; }
      const t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY, off, mode: null, grab: !!(e.target.closest && e.target.closest('.grabber')), samples: [[performance.now(), t.clientY]] };
      if (anim) paint(off, false);
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (!t0) return;
      const t = e.touches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
      if (!t0.mode) {
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        if (Math.abs(dx) > Math.abs(dy)) t0.mode = 'none';                       // sideways: let carousels scroll
        else if (off > 1 || (sheet.scrollTop <= 0 && dy > 0)) { t0.mode = 'sheet'; t0.y = t.clientY; t0.off = off; }
        else t0.mode = 'none';                                                 // scrolling the open sheet's content
      }
      if (t0.mode !== 'sheet') return;
      if (e.cancelable) e.preventDefault();
      t0.samples.push([performance.now(), t.clientY]); if (t0.samples.length > 6) t0.samples.shift();
      paint(rubber(t0.off + (t.clientY - t0.y)), false);
    }, { passive: false });
    const touchEnd = () => {
      if (!t0) return;
      const s = t0.samples, mode = t0.mode, grab = t0.grab; t0 = null;
      const was = snap;
      if (!mode && grab) { go(snap === 'full' ? (sheet.restSnap || 'peek') : 'full'); K.haptic(); return; } // tap the handle to cycle stops
      if (mode !== 'sheet') return;
      const a = s[0], b = s[s.length - 1], dt = Math.max(1, b[0] - a[0]);
      const vel = performance.now() - b[0] > 90 ? 0 : (b[1] - a[1]) / dt;
      go(nearest(Math.max(0, Math.min(maxOff(), off)), vel));
      if (snap !== was) K.haptic();
    };
    sheet.addEventListener('touchend', touchEnd);
    sheet.addEventListener('touchcancel', touchEnd);

    // ---- mouse (desktop testing): drag by the handle ----
    let m0 = null;
    sheet.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || innerWidth >= 760) return;
      if (e.clientY - sheet.getBoundingClientRect().top > 34) return;
      m0 = { y: e.clientY, off, moved: false, samples: [[performance.now(), e.clientY]] };
      sheet.setPointerCapture(e.pointerId);
    });
    sheet.addEventListener('pointermove', (e) => {
      if (!m0) return;
      if (Math.abs(e.clientY - m0.y) > 4) m0.moved = true;
      m0.samples.push([performance.now(), e.clientY]); if (m0.samples.length > 6) m0.samples.shift();
      paint(rubber(m0.off + e.clientY - m0.y), false);
    });
    const mouseEnd = () => {
      if (!m0) return;
      const { moved, samples: s } = m0; m0 = null;
      if (!moved) { go(snap === 'full' ? (sheet.restSnap || 'peek') : 'full'); return; }
      const a = s[0], b = s[s.length - 1];
      go(nearest(Math.max(0, Math.min(maxOff(), off)), (b[1] - a[1]) / Math.max(1, b[0] - a[0])));
    };
    sheet.addEventListener('pointerup', mouseEnd);
    sheet.addEventListener('pointercancel', mouseEnd);
    sheet.addEventListener('transitionstart', () => { anim = true; });
    sheet.addEventListener('transitionend', () => { anim = false; });
    // Size changes (content loading in) keep the sheet at the same stop; new screens reset to the screen's resting stop.
    if (window.ResizeObserver) new ResizeObserver(() => go(snap, false)).observe(sheet);
    // The grabber is a real control for VoiceOver and keyboards: it cycles between the stops.
    const grabA11y = () => { const g = sheet.querySelector('.grabber'); if (g && !g.hasAttribute('role')) { g.setAttribute('role', 'button'); g.tabIndex = 0; g.setAttribute('aria-label', 'Resize sheet'); } };
    sheet.addEventListener('keydown', (e) => { if (e.target.classList && e.target.classList.contains('grabber') && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(snap === 'full' ? (sheet.restSnap || 'peek') : 'full'); } });
    grabA11y();
    new MutationObserver(() => { grabA11y(); if (sheet._keep) return; go(sheet.restSnap || 'full', true); }).observe(sheet, { childList: true });
  };

  // Space the floating glass tab bar takes at the bottom (content scrolls under it).
  K.tabSpace = () => { const t = document.getElementById('tabs'); if (!t || t.classList.contains('hidden')) return 0; return Math.max(0, innerHeight - t.getBoundingClientRect().top) + 8; };
  K.underTabs = (sheet, on) => {
    // Wrap the sheet once in a "dock" that can end above the floating tab pill.
    let dock = sheet.parentElement;
    if (!dock.classList.contains('sheet-dock')) { dock = document.createElement('div'); dock.className = 'sheet-dock'; sheet.before(dock); dock.appendChild(sheet); }
    sheet.style.bottom = '';
    const floating = on && innerWidth < 760;
    dock.classList.toggle('floating', floating);
    if (floating) { dock.style.setProperty('--dock-b', Math.max(0, K.tabSpace() + 2) + 'px'); sheet.style.paddingBottom = '16px'; }
    else sheet.style.paddingBottom = on ? K.tabSpace() + 'px' : '';
  };
  addEventListener('resize', () => { const s = document.getElementById('sheet'); const d = s && s.parentElement; if (d && d.classList.contains('floating')) d.style.setProperty('--dock-b', Math.max(0, K.tabSpace() + 2) + 'px'); });

  // Skeleton placeholders (soft shimmering shapes) instead of "Loading…" text.
  K.skeleton = (kind = 'list', n = 4) => {
    const line = (w, h = 12, mt = 8) => `<i class="sk" style="width:${w};height:${h}px;margin-top:${mt}px"></i>`;
    const card = () => `<div class="sk-card"><i class="sk sk-ic"></i><span class="grow">${line('62%', 13, 0)}${line('38%', 10)}</span><i class="sk" style="width:64px;height:14px"></i></div>`;
    if (kind === 'title-list') return `${line('46%', 30, 6)}${line('58%', 34, 16)}${Array.from({ length: n }, card).join('')}`;
    if (kind === 'earnings') return `${line('44%', 30, 6)}${line('52%', 34, 16)}${line('60%', 34, 18)}<div class="sk-chart">${[40, 65, 30, 80, 55, 20, 90].map((h) => `<i class="sk" style="height:${h}%"></i>`).join('')}</div>${Array.from({ length: 3 }, () => line('100%', 14, 18)).join('')}`;
    return Array.from({ length: n }, card).join('');
  };

  K.SERVICE_LABEL = { boda: 'Boda', car: 'Car', comfort: 'Comfort', parcel: 'Parcel', airport: 'Airport' };
  K.PAY_LABEL = { cash: 'Cash', wallet: 'Flytte Wallet', momo: 'Mobile Money', card: 'Card' };
  K.PAY_ICON = { cash: 'cash', wallet: 'wallet', momo: 'momo', card: 'card' };

  window.K = K;
})();
