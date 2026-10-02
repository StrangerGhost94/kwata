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
  };
  K.ic = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${name === 'star' && cls.includes('fill') ? P.star : P[name] || ''}</svg>`;
  K.starSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';

  // ---------- vehicle art (side view, for ride options) ----------
  const sedan = (body, glass) => `
    <ellipse cx="60" cy="63" rx="50" ry="3.5" fill="#000" opacity=".13"/>
    <path d="M10 50c0-6 3-10 10-11l16-2c6-9 13-14 24-14h16c11 0 18 5 24 13l9 2c5 1 7 5 7 10v4c0 2-1 3-3 3H13c-2 0-3-1-3-3z" fill="${body}"/>
    <path d="M42 37c5-7 10-10 18-10h12c8 0 14 3 19 10z" fill="${glass}"/>
    <rect x="65" y="27" width="2.4" height="10" fill="${body}"/>
    <rect x="104" y="42" width="6" height="3" rx="1.5" fill="#FFD25A"/><rect x="11" y="43" width="4" height="3" rx="1.5" fill="#E33"/>
    <circle cx="33" cy="56" r="9" fill="#111"/><circle cx="33" cy="56" r="3.8" fill="#A3A3A3"/>
    <circle cx="90" cy="56" r="9" fill="#111"/><circle cx="90" cy="56" r="3.8" fill="#A3A3A3"/>`;
  const suv = `
    <ellipse cx="60" cy="63" rx="52" ry="3.5" fill="#000" opacity=".13"/>
    <path d="M9 52V38c0-4 2-6 6-7l12-2 8-9c2-2 4-3 7-3h38c4 0 6 1 8 4l8 9 7 2c4 1 6 4 6 8v12c0 2-1 3-3 3H12c-2 0-3-1-3-3z" fill="#1F1F1F"/>
    <path d="M33 30l7-8c1-1 2-2 4-2h16v10zM64 20h16c2 0 3 1 4 2l7 8H64z" fill="#5A6470"/>
    <rect x="106" y="38" width="6" height="3" rx="1.5" fill="#FFD25A"/>
    <circle cx="32" cy="56" r="9.5" fill="#0A0A0A"/><circle cx="32" cy="56" r="4" fill="#BDBDBD"/>
    <circle cx="91" cy="56" r="9.5" fill="#0A0A0A"/><circle cx="91" cy="56" r="4" fill="#BDBDBD"/>`;
  const boda = `
    <ellipse cx="60" cy="64" rx="46" ry="3.5" fill="#000" opacity=".13"/>
    <circle cx="28" cy="52" r="11" fill="none" stroke="#111" stroke-width="5"/>
    <circle cx="93" cy="52" r="11" fill="none" stroke="#111" stroke-width="5"/>
    <path d="M28 52 46 40h28l19 12" stroke="#4D4D4D" stroke-width="4" fill="none" stroke-linejoin="round"/>
    <path d="M44 33c8-4 22-5 32-2l6 9H46z" fill="#C8102E"/>
    <rect x="34" y="31" width="24" height="5" rx="2.5" fill="#111"/>
    <path d="M82 39 92 22" stroke="#111" stroke-width="3.5" stroke-linecap="round"/><path d="M88 22h8" stroke="#111" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M47 31 52 15c1-3 4-4 7-3l2 1" stroke="#1E5BC6" stroke-width="8" stroke-linecap="round" fill="none"/>
    <path d="M58 16 88 22" stroke="#1E5BC6" stroke-width="5" stroke-linecap="round"/>
    <path d="M50 31 62 42" stroke="#222" stroke-width="6" stroke-linecap="round"/>
    <circle cx="58" cy="8" r="7.5" fill="#E8B100" stroke="#111" stroke-width="1.5"/><path d="M60 6h6" stroke="#111" stroke-width="2"/>`;
  const parcel = `
    <ellipse cx="60" cy="64" rx="40" ry="3.5" fill="#000" opacity=".13"/>
    <path d="M28 26 60 14l32 12v30L60 68 28 56z" fill="#C9965B"/>
    <path d="M28 26 60 38l32-12" fill="none" stroke="#A97A42" stroke-width="2"/><path d="M60 38v30" stroke="#A97A42" stroke-width="2"/>
    <path d="M40 21.5 72 33.5v9l-6-2.2v-6L34 23.7z" fill="#EBD5AA"/>`;
  const airport = sedan('#2E2E2E', '#7A8794') + `<path d="M84 8h3l8 9h10a2.5 2.5 0 0 1 0 5H95l-8 9h-3l4-9h-7l-3 3h-3l2-5.5-2-5.5h3l3 3h7z" fill="#276EF1"/>`;
  K.ART = {
    boda: `<svg viewBox="0 0 120 72" aria-hidden="true">${boda}</svg>`,
    car: `<svg viewBox="0 0 120 72" aria-hidden="true">${sedan('#DADADA', '#2B2F33')}</svg>`,
    comfort: `<svg viewBox="0 0 120 72" aria-hidden="true">${suv}</svg>`,
    parcel: `<svg viewBox="0 0 120 72" aria-hidden="true">${parcel}</svg>`,
    airport: `<svg viewBox="0 0 120 72" aria-hidden="true">${airport}</svg>`,
  };
  K.artFor = (service, vehicleType) => K.ART[service] || (vehicleType === 'car' ? K.ART.car : K.ART.boda);

  // ---------- vehicle markers (top view) ----------
  const TOP = {
    car: '<svg viewBox="0 0 40 40"><rect x="12.5" y="4" width="15" height="32" rx="6" fill="#141414" stroke="#fff" stroke-width="1.6"/><path d="M14.5 12.5c2-2.2 9-2.2 11 0v4h-11z" fill="#8C96A0"/><path d="M14.5 29c2 1.6 9 1.6 11 0v-3.5h-11z" fill="#8C96A0"/><rect x="14.5" y="17" width="11" height="8" rx="1" fill="#222"/></svg>',
    boda: '<svg viewBox="0 0 40 40"><rect x="17" y="3" width="6" height="34" rx="3" fill="#141414" stroke="#fff" stroke-width="1.4"/><rect x="10" y="9" width="20" height="3.2" rx="1.6" fill="#141414" stroke="#fff" stroke-width="1"/><circle cx="20" cy="21" r="5.5" fill="#E8B100" stroke="#141414" stroke-width="1.8"/></svg>',
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

  K.modal = function (html, { drawer = false, onClose } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="${drawer ? 'drawer' : 'modal'}" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(ov);
    const first = ov.querySelector('input, button:not([data-close])');
    first && first.focus({ preventScroll: true });
    return { el: ov.firstElementChild, close };
  };

  // ---------- auth screen ----------
  const HERO = {
    rider: 'Go anywhere in Kampala.',
    driver: 'Drive when you want. Keep 88%.',
    admin: 'Operations',
  };
  K.authScreen = function (root, { role, onDone }) {
    let mode = 'login';
    const draw = () => {
      const reg = mode === 'register';
      root.innerHTML = `
      <div class="auth">
        <div class="auth-hero"><div class="wordmark">Kwata${role === 'driver' ? ' Driver' : ''}</div><h1>${HERO[role]}</h1></div>
        <div class="auth-card">
        ${role === 'admin' ? '' : `<div class="seg" role="group" aria-label="Sign in or create account">
          <button type="button" data-m="login" aria-pressed="${!reg}">Sign in</button>
          <button type="button" data-m="register" aria-pressed="${reg}">Create account</button></div>`}
        <form novalidate>
          ${reg ? `<label for="f-name">Full name</label><input id="f-name" name="name" autocomplete="name" required>` : ''}
          <label for="f-phone">Mobile number</label>
          <input id="f-phone" name="phone" type="tel" inputmode="tel" placeholder="0772 123456" autocomplete="tel" required>
          <label for="f-pass">Password</label>
          <input id="f-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="6" required>
          ${reg && role === 'driver' ? `
          <label for="f-vt">Vehicle</label>
          <select id="f-vt" name="vehicleType"><option value="boda">Boda boda (motorcycle)</option><option value="car">Car</option></select>
          <div class="row"><div class="fill"><label for="f-plate">Number plate</label><input id="f-plate" name="plate" placeholder="UFA 123X" required></div>
          <div class="fill"><label for="f-color">Colour</label><input id="f-color" name="vehicleColor" placeholder="Red"></div></div>
          <label for="f-make">Make and model</label><input id="f-make" name="vehicleMake" placeholder="Bajaj Boxer / Toyota Premio">
          <label for="f-lic">Driving permit number</label><input id="f-lic" name="licenseNo" required>
          <label for="f-momo">Mobile Money number for payouts</label><input id="f-momo" name="momoNumber" type="tel" placeholder="Same as above if empty">
          ` : ''}
          <p class="error" role="alert"></p>
          <button class="btn btn-primary btn-block btn-lg" type="submit">${reg ? 'Create account' : 'Continue'}</button>
        </form>
        ${role === 'rider' ? '<p class="small muted" style="margin-top:18px">Drive or deliver with Kwata? <a href="/driver"><b>Open the driver app</b></a></p>' : ''}
        ${role === 'driver' ? '<p class="small muted" style="margin-top:18px">Need a ride? <a href="/rider"><b>Open the rider app</b></a></p>' : ''}
        </div>
      </div>`;
      root.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; draw(); });
      const form = root.querySelector('form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        const err = form.querySelector('.error');
        const data = Object.fromEntries(new FormData(form).entries());
        btn.disabled = true; err.textContent = '';
        try {
          const out = reg ? await K.api('/auth/register', { ...data, role }) : await K.api('/auth/login', data);
          if (out.user.role !== role) throw new Error(role === 'driver' ? 'This number is a rider account. Create a driver account with a different number.' : role === 'admin' ? 'Not an admin account.' : 'This number is registered as a driver. Use the driver app.');
          K.session.set(out);
          onDone(out);
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      };
    };
    draw();
  };

  // ---------- maps ----------
  K.dark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  K.map = function (id, center = K.KAMPALA, zoom = 16) {
    const m = L.map(id, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], zoom);
    const style = K.dark() ? 'dark_all' : 'rastertiles/voyager';
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO',
    }).addTo(m);
    m.attributionControl.setPrefix(false);
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
      // OSRM assumes free roads; Kampala traffic is roughly 1.8x slower.
      return { km: rt.distance / 1000, min: (rt.duration / 60) * 1.8, coords: rt.geometry.coordinates.map(([x, y]) => [y, x]) };
    } catch {
      return { km: null, min: null, coords: [[a.lat, a.lng], [b.lat, b.lng]] };
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

  K.SERVICE_LABEL = { boda: 'Boda', car: 'Car', comfort: 'Comfort', parcel: 'Parcel', airport: 'Airport' };
  K.PAY_LABEL = { cash: 'Cash', wallet: 'Kwata Wallet', momo: 'Mobile Money', card: 'Card' };
  K.PAY_ICON = { cash: 'cash', wallet: 'wallet', momo: 'momo', card: 'card' };

  window.K = K;
})();
