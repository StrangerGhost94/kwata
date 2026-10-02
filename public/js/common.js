// Shared helpers for the rider, driver, admin and tracking pages.
(function () {
  const K = {};
  const APP = document.body.dataset.app || 'rider';
  const KEY = 'kwata_' + APP;
  K.KAMPALA = { lat: 0.3136, lng: 32.5811 };

  K.PLACES = [
    { name: 'Entebbe Airport', address: 'Entebbe International Airport', lat: 0.0424, lng: 32.4435 },
    { name: 'Acacia Mall', address: 'Acacia Mall, Kisementi', lat: 0.3383, lng: 32.5873 },
    { name: 'Garden City', address: 'Garden City Mall, Yusuf Lule Rd', lat: 0.3181, lng: 32.5917 },
    { name: 'Old Taxi Park', address: 'Old Taxi Park, Kampala', lat: 0.3127, lng: 32.5766 },
    { name: 'Makerere', address: 'Makerere University', lat: 0.3355, lng: 32.5682 },
    { name: 'Mulago', address: 'Mulago National Referral Hospital', lat: 0.3379, lng: 32.5757 },
    { name: 'Village Mall', address: 'Village Mall, Bugolobi', lat: 0.3177, lng: 32.6165 },
    { name: 'Ntinda', address: 'Ntinda Trading Centre', lat: 0.3536, lng: 32.6142 },
  ];

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
      throw new Error('No internet connection. Check your data and try again.');
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
  K.when = (d) => new Date(d).toLocaleString('en-UG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  K.$ = (sel, root) => (root || document).querySelector(sel);

  let toastTimer;
  K.toast = function (text, ms = 3500) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text; el.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  };

  K.modal = function (html, { drawer = false, onClose } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="${drawer ? 'drawer' : 'modal'}" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => { ov.remove(); onClose && onClose(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(ov);
    const first = ov.querySelector('input, button:not([data-close])');
    first && first.focus();
    return { el: ov.firstElementChild, close };
  };

  // ---------- auth screen ----------
  K.authScreen = function (root, { role, onDone, title }) {
    let mode = 'login';
    const draw = () => {
      const reg = mode === 'register';
      root.innerHTML = `
      <div class="auth"><div class="auth-card">
        <div class="checker"></div>
        <h1>${K.esc(title)}</h1>
        ${role === 'admin' ? '' : `<div class="seg" role="group" aria-label="Sign in or create account">
          <button type="button" data-m="login" aria-pressed="${!reg}">Sign in</button>
          <button type="button" data-m="register" aria-pressed="${reg}">Create account</button></div>`}
        <form novalidate>
          ${reg ? `<label for="f-name">Full name</label><input id="f-name" name="name" autocomplete="name" required>` : ''}
          <label for="f-phone">Phone number</label>
          <input id="f-phone" name="phone" type="tel" inputmode="tel" placeholder="0772 123456" autocomplete="tel" required>
          <label for="f-pass">Password</label>
          <input id="f-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" minlength="6" required>
          ${reg && role === 'driver' ? `
          <label for="f-vt">What do you drive?</label>
          <select id="f-vt" name="vehicleType"><option value="boda">Boda boda (motorcycle)</option><option value="car">Car</option></select>
          <div class="row"><div><label for="f-plate">Number plate</label><input id="f-plate" name="plate" placeholder="UFA 123X" required></div>
          <div><label for="f-color">Colour</label><input id="f-color" name="vehicleColor" placeholder="Red"></div></div>
          <label for="f-make">Make and model</label><input id="f-make" name="vehicleMake" placeholder="Bajaj Boxer / Toyota Premio">
          <label for="f-lic">Driving permit number</label><input id="f-lic" name="licenseNo" required>
          <label for="f-momo">Mobile Money number for payouts</label><input id="f-momo" name="momoNumber" type="tel" placeholder="Same as phone if empty">
          ` : ''}
          <p class="error" role="alert"></p>
          <button class="btn btn-primary btn-block" type="submit">${reg ? 'Create account' : 'Sign in'}</button>
        </form>
        ${role === 'rider' ? '<p class="small muted" style="margin-top:14px">Drive with Kwata? <a href="/driver">Open the driver app</a></p>' : ''}
        ${role === 'driver' ? '<p class="small muted" style="margin-top:14px">Need a ride? <a href="/rider">Open the rider app</a></p>' : ''}
      </div></div>`;
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
          if (out.user.role !== role) throw new Error(role === 'driver' ? 'This is a rider account. Create a driver account with a different number.' : role === 'admin' ? 'Not an admin account.' : 'This number is registered as a driver. Use the driver app.');
          K.session.set(out);
          onDone(out);
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
      };
    };
    draw();
  };

  // ---------- maps ----------
  K.map = function (id, center = K.KAMPALA, zoom = 15) {
    const m = L.map(id, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    return m;
  };
  K.icon = (html, cls = 'mk') => L.divIcon({ className: '', html: `<div class="${cls}">${html}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
  K.vehicleEmoji = (v) => (v === 'car' ? '🚗' : '🏍️');

  K.route = async function (a, b) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url);
      const j = await r.json();
      const rt = j.routes && j.routes[0];
      if (!rt) throw new Error('no route');
      // OSRM assumes free-flowing roads; Kampala traffic is roughly 1.8x slower.
      return { km: rt.distance / 1000, min: (rt.duration / 60) * 1.8, coords: rt.geometry.coordinates.map(([x, y]) => [y, x]) };
    } catch {
      return { km: null, min: null, coords: [[a.lat, a.lng], [b.lat, b.lng]] };
    }
  };

  K.search = async function (q) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ug&limit=6&viewbox=32.35,0.55,32.85,0.0&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    return j.map((x) => {
      const parts = x.display_name.split(', ');
      return { name: parts[0], address: parts.slice(1, 4).join(', '), lat: +x.lat, lng: +x.lon };
    });
  };

  K.reverse = async function (lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
      const j = await r.json();
      const a = j.address || {};
      return [a.road || a.amenity || a.building, a.suburb || a.neighbourhood || a.city_district || a.city].filter(Boolean).join(', ') || j.display_name || 'Pinned location';
    } catch { return 'Pinned location'; }
  };

  K.socket = (token) => io({ auth: { token }, transports: ['websocket', 'polling'] });

  K.share = async function (url, text) {
    if (navigator.share) { try { await navigator.share({ title: 'Kwata trip', text, url }); return; } catch {} }
    try { await navigator.clipboard.writeText(url); K.toast('Trip link copied. Paste it to a friend.'); }
    catch { prompt('Copy this link', url); }
  };

  K.SERVICE_LABEL = { boda: 'Boda', car: 'Car', comfort: 'Comfort', parcel: 'Parcel', airport: 'Airport' };
  K.PAY_LABEL = { cash: 'Cash', wallet: 'Kwata Wallet', momo: 'Mobile Money', card: 'Card' };

  window.K = K;
})();
