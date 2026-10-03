// Kwata customer app (mockup screens 5–13):
// Home → Search → Choose a ride → Finding your rider → Rider found → On trip → Trip completed
(function () {
  const root = document.getElementById('root');
  const S = {
    view: 'home', pickup: null, drop: null, route: null, quote: null, gps: null,
    service: localStorage.getItem('kwata_service') || 'boda',
    trip: null, user: null, config: null, recent: [], parcel: null, rating: 0, unread: 0, chatOpen: false, messages: [],
  };
  let map, sock, sheet, routeLayer, labels = [], driverMarker, meMarker, nearby = new Map(), revTimer, phaseKm = null, routedPhase = null;

  const params = new URLSearchParams(location.search);
  // Invite links: /?ref=CODE fills the invite code on sign-up.
  if (params.get('ref')) { try { localStorage.setItem('kwata_ref', params.get('ref').toUpperCase().slice(0, 20)); } catch {} history.replaceState(null, '', location.pathname); }
  if (params.get('payment')) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => K.toast(params.get('payment') === 'success' ? 'Payment received' : 'Payment was not completed. Try again from your trip.'), 600);
  }

  if (!K.token()) K.authScreen(root, { role: 'rider', onDone: start });
  else start();

  // ---------- payment preference ----------
  const PAY = {
    mtn: { name: 'MTN Mobile Money', logo: '<span class="paylogo mtn">MTN</span>', method: 'momo' },
    airtel: { name: 'Airtel Money', logo: '<span class="paylogo airtel">a</span>', method: 'momo' },
    card: { name: 'Card', logo: `<span class="paylogo card">${K.ic('card', 'sm')}</span>`, method: 'card' },
    cash: { name: 'Cash', logo: `<span class="paylogo cash">${K.ic('cash', 'sm')}</span>`, method: 'cash' },
    wallet: { name: 'Kwata Wallet', logo: `<span class="paylogo wallet">${K.ic('wallet', 'sm')}</span>`, method: 'wallet' },
  };
  const pref = () => (PAY[S.user && S.user.payPref] ? S.user.payPref : 'cash');
  const payOfTrip = (t) => t.paymentMethod === 'momo' ? (S.user.payPref === 'airtel' ? 'airtel' : 'mtn') : t.paymentMethod;
  const prettyPhone = (p) => String(p || '').replace(/^\+256/, '0').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
  const who = (t) => (t.driver && t.driver.vehicleType === 'car') || ['car', 'comfort', 'airport'].includes(t.service) ? 'driver' : 'rider';
  const svcName = (id) => K.SERVICE_LABEL[id] || id;

  async function start() {
    root.innerHTML = `
      <div class="app" id="app">
        <div id="map" aria-label="Map"></div>
        <div class="center-pin hidden" id="cpin" aria-hidden="true">${K.logo('#FFC400', '#141414', 46)}</div>
        <div class="topbar" id="topbar"></div>
        <section class="sheet" id="sheet" aria-live="polite"></section>
        <nav class="tabbar" id="tabs" aria-label="Main">
          <button data-tab="home" aria-current="page">${K.ic('home')}Home</button>
          <button data-tab="activity">${K.ic('receipt')}Activity</button>
          <button data-tab="account">${K.ic('user')}Account</button>
        </nav>
      </div>`;
    sheet = K.$('#sheet');
    K.draggableSheet(sheet);
    map = K.map('map');
    map.on('moveend', onPinMove);
    map.on('dragstart', () => { if (S.view === 'home') S.mapTouched = true; });
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => openTab(b.dataset.tab));

    try {
      const [me, config, active, hist] = await Promise.all([K.api('/me'), K.api('/config'), K.api('/trips/active'), K.api('/trips/history').catch(() => [])]);
      S.user = me.user; S.config = config;
      loadGrowth(); loadUpcoming();
      S.history = hist || []; buildRecent(hist);
      sock = K.socket(K.token());
      sock.on('trip:update', onTrip);
      sock.on('driver:location', (p) => { if (S.trip && p.tripId === S.trip.id) moveDriver(p); });
      sock.on('toast', (m) => K.toast(m.text));
      sock.on('chat:message', onChat);
      sock.on('connect', async () => { const a = await K.api('/trips/active').catch(() => null); if (a) onTrip(a); });
      if (active) onTrip(active); else {
        locate(false); render();
        const svc = params.get('service');
        if (svc && S.config.services.some((x) => x.id === svc)) { setService(svc); history.replaceState(null, '', location.pathname); openSearch(svc === 'airport' ? { preset: K.PLACES[0] } : {}); }
        let q = null; try { q = sessionStorage.getItem('kwata_q'); sessionStorage.removeItem('kwata_q'); } catch {}
        if (q) openSearch({ query: q });
      }
      setInterval(loadNearby, 8000);
      K.ready();
    } catch (e) { K.ready(); sheet.innerHTML = `<p class="error">${K.esc(e.message)}</p><button class="btn btn-block" onclick="location.reload()">Try again</button>`; }
  }

  function buildRecent(hist) {
    const seen = new Set();
    S.recent = [];
    for (const t of hist || []) {
      const key = t.drop.address;
      if (seen.has(key) || t.status !== 'completed') continue;
      seen.add(key); S.recent.push({ name: t.drop.address, address: K.when(t.createdAt), lat: t.drop.lat, lng: t.drop.lng });
      if (S.recent.length >= 3) break;
    }
  }

  // ---------- location ----------
  function locate(userAsked) {
    const fallback = () => { if (!S.pickup) setPickup(K.KAMPALA.lat, K.KAMPALA.lng, null); };
    if (!navigator.geolocation) return fallback();
    navigator.geolocation.getCurrentPosition((p) => {
      S.gps = { lat: p.coords.latitude, lng: p.coords.longitude };
      const ll = [S.gps.lat, S.gps.lng];
      if (!meMarker) meMarker = L.marker(ll, { icon: K.divIcon('<div class="me-dot"></div>', [18, 18]), interactive: false, zIndexOffset: 500 }).addTo(map);
      else meMarker.setLatLng(ll);
      if (userAsked) S.mapTouched = false;
      if (S.view === 'home') centerOn(S.gps, 16, !!userAsked);
      else if (userAsked) map.setView(ll, 16, { animate: true });
      if (S.view === 'home' || !S.pickup) setPickup(S.gps.lat, S.gps.lng, 'Current location');
    }, () => { if (userAsked) K.toast('Turn on location so drivers can find you'); fallback(); }, { enableHighAccuracy: true, timeout: 10000 });
  }

  function setPickup(lat, lng, label) {
    S.pickup = { lat, lng, address: label || 'Finding address…', short: label };
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      const addr = await K.reverse(lat, lng);
      if (S.pickup && S.pickup.lat === lat) {
        S.pickup.address = addr;
        const el = K.$('#pickLabel'); if (el) el.textContent = addr;
      }
    }, 450);
    loadNearby();
  }

  function onPinMove() {
    if (S.view !== 'pickup' && S.view !== 'droppin') return;
    const c = map.getCenter();
    const el = K.$('#pinAddr'); if (el) el.textContent = 'Finding address…';
    if (S.view === 'pickup') S.pickup = { lat: c.lat, lng: c.lng, address: 'Finding address…' };
    else S.pinDrop = { lat: c.lat, lng: c.lng, name: 'Pinned location' };
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      const a = await K.reverse(c.lat, c.lng);
      if (S.view === 'pickup' && S.pickup.lat === c.lat) S.pickup.address = a;
      else if (S.view === 'droppin' && S.pinDrop && S.pinDrop.lat === c.lat) S.pinDrop.name = a;
      else return;
      const e2 = K.$('#pinAddr'); if (e2) e2.textContent = a;
    }, 450);
  }

  async function loadNearby() {
    if (!['home', 'choose', 'pickup'].includes(S.view) || !S.pickup) { clearNearby(); return; }
    try {
      const list = await K.api(`/drivers/nearby?lat=${S.pickup.lat}&lng=${S.pickup.lng}`);
      const keep = new Set();
      list.forEach((d) => {
        keep.add(d.k);
        if (nearby.has(d.k)) nearby.get(d.k).moveTo(d.lat, d.lng, d.heading);
        else { const v = K.vehicle(map, d, d.vehicle === 'car' ? 'car' : 'boda', d.heading || Math.random() * 360); v._kind = d.vehicle === 'car' ? 'car' : 'boda'; nearby.set(d.k, v); }
      });
      for (const [k, m] of nearby) if (!keep.has(k)) { map.removeLayer(m); nearby.delete(k); }
      if (S.view === 'home') paintEtas();
    } catch {}
  }
  function clearNearby() { for (const m of nearby.values()) map.removeLayer(m); nearby.clear(); }

  // ---------- render ----------
  function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function topbar() {
    const v = S.view, tb = K.$('#topbar');
    if (v === 'home') {
      tb.innerHTML = `<button class="hello-chip" id="me"><span class="avatar">${K.initials(S.user.name)}</span><span><small>${greeting()},</small><b>${K.esc(K.first(S.user.name))}</b></span></button>
        <button class="btn icon-btn fab" id="locBtn" aria-label="Go to my location">${K.ic('locate')}</button>`;
      K.$('#me').onclick = () => openTab('account');
    } else if (['choose', 'pickup', 'droppin', 'none'].includes(v)) {
      tb.innerHTML = `<button class="btn icon-btn fab" id="backBtn" aria-label="Back">${K.ic('back')}</button><button class="btn icon-btn fab" id="locBtn" aria-label="Go to my location">${K.ic('locate')}</button>`;
      K.$('#backBtn').onclick = goBack;
    } else if (v === 'trip' && S.trip.status === 'in_progress') {
      const mins = tripMins();
      tb.innerHTML = `<div class="trip-banner"><button class="round" id="bnSos" aria-label="Safety">${K.ic('shield')}</button>
        <span class="grow"><b>On trip</b><small id="bnTxt">${mins ? `Arriving in ${mins} min` : 'Heading to ' + K.esc(shorten(S.trip.drop.address))}</small></span>
        <button class="round" id="bnShare" aria-label="Share trip">${K.ic('share')}</button></div>`;
      K.$('#bnSos').onclick = openSafetySheet;
      K.$('#bnShare').onclick = shareTrip;
    } else if (v === 'trip') {
      tb.innerHTML = `<span></span><button class="btn icon-btn fab" id="safeBtn" aria-label="Safety">${K.ic('shield')}</button>`;
      K.$('#safeBtn').onclick = openSafetySheet;
    } else tb.innerHTML = '';
    const lb = K.$('#locBtn'); if (lb) lb.onclick = () => locate(true);
  }

  function render() {
    const v = S.view;
    K.$('#cpin').classList.toggle('hidden', !['pickup', 'droppin'].includes(v));
    K.$('#tabs').classList.toggle('hidden', v !== 'home');
    sheet.classList.toggle('home-card', v === 'home');
    K.underTabs(sheet, v === 'home');
    topbar();
    if (v !== S.lastView) { sheet.classList.remove('sheet-enter'); void sheet.offsetWidth; sheet.classList.add('sheet-enter'); }
    if (v !== 'home') leaveHomeSheet();
    S.lastView = v;
    ({ home: vHome, choose: vChoose, pickup: vPickup, droppin: vDropPin, searching: vSearching, trip: vTrip, done: vDone, none: vNone })[v]();
  }

  function goBack() {
    if (S.view === 'pickup') { S.view = 'choose'; showRoute(); render(); }
    else if (S.view === 'droppin') { S.view = 'home'; render(); openSearch(); }
    else reset();
  }

  // Screen 5: home. One clear job up top ("Where to?"), quick picks, services, then offers you swipe through.
  // The sheet rests at the services row so the map stays visible; drag or flick it up for everything else.
  const shortName = (a) => String(a || '').split(',')[0].trim();
  function vHome() {
    clearRoute();
    const ids = S.config.services.map((s) => s.id);
    const main = ['boda', 'car', 'comfort', 'parcel', 'airport'].filter((id) => ids.includes(id));
    const first = !S.homeShown; S.homeShown = true;
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="home ${first && !K.reduced() ? 'home-in' : ''}">
        <div id="upHost"></div>
        <div class="where">
          <button class="where-go" id="whereBtn">${K.ic('search')}<span>Where to?</span></button>
          <button class="when-pill ${S.when ? 'on' : ''}" id="homeWhen" aria-label="Pickup time">${K.ic('clock', 'sm')}<span>${S.when ? K.esc(whenLabel(S.when)) : 'Now'}</span>${K.ic('chevDown', 'sm')}</button>
        </div>
        <div class="quick" id="quickHost">${quickHtml()}</div>
        <div class="svc-strip" id="svcStrip">${main.map((id) => `<button class="svc-t" data-svc="${id}"><span class="tile">${K.ART[id]}</span><b>${svcName(id)}</b><small data-eta="${id}">&nbsp;</small></button>`).join('')}</div>
        <div id="foldMark"></div>
        <div id="forYou">${forYouHtml()}</div>
        <div id="installHost"></div>
      </div>`;
    upHtml();
    K.installCard(K.$('#installHost'));
    K.$('#whereBtn').onclick = () => openSearch();
    K.$('#homeWhen').onclick = () => openWhen(() => openSearch());
    sheet.querySelectorAll('[data-svc]').forEach((b) => b.onclick = () => { setService(b.dataset.svc); openSearch(b.dataset.svc === 'airport' ? { preset: K.PLACES[0] } : {}); });
    bindQuick(); bindForYou(); paintEtas();
    homeSheet();
  }

  function quickHtml() {
    const sp = S.user.savedPlaces || {};
    const chip = (attrs, ic, label, sub) => `<button class="q-chip" ${attrs}><span class="ic">${K.ic(ic, 'sm')}</span><span class="t"><b>${K.esc(label)}</b>${sub ? `<small>${K.esc(sub)}</small>` : ''}</span></button>`;
    return chip('data-place="home"', 'home', 'Home', sp.home ? shortName(sp.home.address) : 'Add') +
      chip('data-place="work"', 'work', 'Work', sp.work ? shortName(sp.work.address) : 'Add') +
      S.recent.slice(0, 3).map((r, i) => chip(`data-recent="${i}"`, 'clock', shorten(shortName(r.name), 22), '')).join('');
  }
  function bindQuick() {
    sheet.querySelectorAll('[data-place]').forEach((b) => b.onclick = () => {
      const key = b.dataset.place, p = (S.user.savedPlaces || {})[key];
      if (p) chooseDrop({ name: key === 'home' ? 'Home' : 'Work', address: p.address, lat: p.lat, lng: p.lng });
      else openSearch({ saveAs: key });
    });
    sheet.querySelectorAll('[data-recent]').forEach((b) => b.onclick = () => chooseDrop(S.recent[+b.dataset.recent]));
  }

  // Swipeable offer cards (only real offers: what the admin has switched on)
  function forYouHtml() {
    const ids = S.config.services.map((s) => s.id);
    const g = S.config.growth || {}, cards = [];
    if (S.growth && S.growth.firstRide) cards.push(`<div class="fy-card fy-offer"><span class="grow"><small>Welcome offer</small><b>${S.growth.firstRide.percent}% off your first ride</b><span>Up to ${K.ugx(S.growth.firstRide.max)} · applied automatically</span></span><span class="fy-art">${K.ic('gift')}</span></div>`);
    if (g.referral && g.referral.enabled && g.referral.referrer) cards.push(`<button class="fy-card fy-invite" data-fy="invite"><span class="grow"><small>Invite friends</small><b>Get ${K.ugx(g.referral.referrer)} per friend</b><span>They get ${K.ugx(g.referral.friend)} after their first trip</span></span><span class="fy-art emoji">🎁</span></button>`);
    if (ids.includes('parcel')) cards.push(`<button class="fy-card fy-parcel" data-svc2="parcel"><span class="grow"><small>Kwata Parcel</small><b>Send a package</b><span>Picked up and delivered across Kampala</span></span><span class="fy-art">${K.ART.parcel}</span></button>`);
    if (ids.includes('airport')) cards.push(`<button class="fy-card fy-air" data-svc2="airport"><span class="grow"><small>Airport transfer</small><b>Flying out of Entebbe?</b><span>Book now or schedule ahead, no surge</span></span><span class="fy-art">${K.ART.airport}</span></button>`);
    if (!cards.length) return '';
    return `<div class="section-label">For you</div><div class="fy-rail">${cards.join('')}</div>`;
  }
  function bindForYou() {
    sheet.querySelectorAll('[data-svc2]').forEach((b) => b.onclick = () => { setService(b.dataset.svc2); openSearch(b.dataset.svc2 === 'airport' ? { preset: K.PLACES[0] } : {}); });
    const ib = sheet.querySelector('[data-fy="invite"]'); if (ib) ib.onclick = () => openInvite();
  }
  function upHtml() {
    const host = K.$('#upHost'); if (!host) return;
    host.innerHTML = (S.upcoming || []).map((u) => `<div class="sched-card"><span class="ic">${K.ic('clock')}</span><span class="grow"><b>${whenLabel(u.scheduledFor)}</b><span>${K.esc(svcName(u.service))} to ${K.esc(shorten(u.drop.address, 30))}</span></span><button class="btn btn-sm btn-ghost" data-cancel-sched="${u.id}">Cancel</button></div>`).join('');
    host.querySelectorAll('[data-cancel-sched]').forEach((b) => b.onclick = () => cancelScheduled(+b.dataset.cancelSched));
  }
  // Update parts of the home in place (no flash, no jump) when data arrives.
  function patchHome(part) {
    if (S.view !== 'home' || !K.$('#forYou')) return;
    sheet._keep = true;
    if (part === 'up') upHtml();
    if (part === 'forYou') { K.$('#forYou').innerHTML = forYouHtml(); bindForYou(); }
    if (part === 'quick') { K.$('#quickHost').innerHTML = quickHtml(); bindQuick(); }
    sheet._keep = false;
  }

  // Live "2 min" under each service from the cars and bodas around you
  function paintEtas() {
    const near = { boda: Infinity, car: Infinity };
    if (S.pickup) for (const m of nearby.values()) { const p = m.pos(), k = m._kind === 'car' ? 'car' : 'boda'; near[k] = Math.min(near[k], K.km(S.pickup, p)); }
    const eta = (km, speed) => (Number.isFinite(km) ? Math.max(1, Math.round((km * 1.4 / speed) * 60 + 1)) + ' min' : '');
    const val = { boda: eta(near.boda, 22), parcel: eta(near.boda, 22), car: eta(near.car, 18), comfort: eta(near.car, 18), airport: eta(near.car, 18) };
    sheet.querySelectorAll('[data-eta]').forEach((el) => { const v = val[el.dataset.eta] || ''; if (el.textContent !== (v || ' ')) { el.textContent = v || ' '; el.classList.toggle('on', !!v); } });
  }

  // Resting heights for the home sheet
  function homeSheet() {
    sheet.restSnap = 'mid';
    sheet.snapPoints = () => {
      const H = sheet.offsetHeight, pad = parseFloat(sheet.style.paddingBottom) || 0;
      const fold = K.$('#foldMark'), where = K.$('.where');
      if (!fold || !where) return { full: 0 };
      const midShow = fold.offsetTop + 6 + pad, peekShow = where.offsetTop + where.offsetHeight + 14 + pad;
      return { full: 0, mid: Math.max(0, H - midShow), peek: Math.max(0, H - peekShow) };
    };
    sheet.onSheetMove = (off, p) => {
      // Dim the map and tuck the greeting away as the sheet opens fully.
      const k = p.mid ? Math.max(0, Math.min(1, 1 - off / p.mid)) : 0;
      const low = p.peek > p.mid ? Math.max(0, Math.min(1, (off - p.mid) / (p.peek - p.mid))) : 0;
      const app = K.$('#app'); if (app) { app.style.setProperty('--open', k.toFixed(3)); app.style.setProperty('--low', low.toFixed(3)); }
    };
    sheet.onSnap = () => { if (S.view === 'home' && S.gps && !S.mapTouched) centerOn(S.gps, map.getZoom(), true); };
    sheet._keep = true; sheet.snapTo('mid', false); sheet._keep = false;
  }
  function leaveHomeSheet() {
    sheet.restSnap = null; sheet.snapPoints = null; sheet.onSheetMove = null; sheet.onSnap = null;
    const app = K.$('#app'); if (app) { app.style.setProperty('--open', 0); app.style.setProperty('--low', 0); }
  }

  // Put a point in the middle of the map you can actually see (between the top bar and the sheet).
  function centerOn(ll, zoom, animate) {
    const size = map.getSize(), tb = K.$('#topbar'), top = tb && tb.firstElementChild ? tb.getBoundingClientRect().bottom : 70;
    const restTop = S.view === 'home' && sheet.snapPoints ? size.y - sheet.offsetHeight + (sheet.snapPoints()[sheet.snap()] || 0) : size.y * 0.55;
    const visibleMid = (top + Math.max(top + 80, restTop)) / 2;
    const shift = size.y / 2 - visibleMid;
    const z = zoom || map.getZoom();
    const c = map.unproject(map.project([ll.lat, ll.lng], z).add([0, shift]), z);
    map.setView(c, z, { animate: !!animate, duration: 0.5 });
  }
  function setService(id) { S.service = id; try { localStorage.setItem('kwata_service', id); } catch {} }

  // ---------- full-screen search ----------
  let searchTimer;
  function openSearch(opts = {}) {
    if (opts.preset) { chooseDrop(opts.preset); return; }
    const saveAs = opts.saveAs;
    const page = document.createElement('div');
    page.className = 'page push-in';
    page.style.zIndex = 870;
    page.innerHTML = `<div class="page-inner">
      <div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Close">${K.ic('back')}</button>
        <h2>${saveAs ? 'Set ' + saveAs + ' address' : S.service === 'parcel' ? 'Where should it go?' : 'Where are you going?'}</h2></div>
      ${saveAs ? '' : `<div class="route-box" style="margin-bottom:6px">
        <div class="rb-line" style="grid-row:span 2"><span class="rb-dot"></span><span class="rb-bar"></span><span class="rb-sq"></span></div>
        <input id="qPick" placeholder="Pickup location" value="${K.esc(S.pickup ? (S.pickup.short || S.pickup.address) : '')}" autocomplete="off" aria-label="Pickup">
        <input id="qDrop" placeholder="Where to?" autocomplete="off" aria-label="Destination">
      </div>`}
      ${saveAs ? '<input id="qDrop" placeholder="Search for an address" autocomplete="off" aria-label="Search">' : ''}
      <div id="res" style="margin-top:10px"></div></div>`;
    root.querySelector('#app').appendChild(page);
    let target = 'drop';
    const res = K.$('#res', page);
    const qDrop = K.$('#qDrop', page), qPick = K.$('#qPick', page);
    const close = () => K.pop(page);
    K.$('[data-x]', page).onclick = close;

    const rows = (items, iconFn) => items.map((p, i) => `<button class="lrow" data-i="${i}"><span class="ic">${K.ic(iconFn ? iconFn(p) : 'pin')}</span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(p.name)}</span><span class="s ellipsis" style="display:block">${K.esc(p.address || '')}</span></span>${S.pickup && p.lat ? `<span class="tiny faint">${K.km(S.pickup, p).toFixed(1)} km</span>` : ''}</button>`).join('');
    let current = [];
    const bind = () => res.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => pick(current[+b.dataset.i]));
    const showDefault = () => {
      const sp = S.user.savedPlaces || {};
      const saved = [];
      if (!saveAs && sp.home) saved.push({ name: 'Home', address: sp.home.address, lat: sp.home.lat, lng: sp.home.lng, _ic: 'home' });
      if (!saveAs && sp.work) saved.push({ name: 'Work', address: sp.work.address, lat: sp.work.lat, lng: sp.work.lng, _ic: 'work' });
      const recent = saveAs ? [] : S.recent.map((r) => ({ ...r, _ic: 'clock' }));
      const extra = target === 'pick' && S.gps ? [{ name: 'Current location', address: 'Use GPS', lat: S.gps.lat, lng: S.gps.lng, _ic: 'locate' }] : [];
      current = [...extra, ...saved, ...recent, ...K.PLACES.map((p) => ({ ...p, _ic: p.icon || 'pin' }))];
      res.innerHTML = rows(current, (p) => p._ic) +
        (!saveAs && target === 'drop' ? `<button class="lrow" id="onMap"><span class="ic">${K.ic('pin')}</span><span class="t">Set location on map</span></button>` : '');
      bind();
      const om = K.$('#onMap', page); if (om) om.onclick = () => { close(); S.view = 'droppin'; map.setView([S.pickup.lat, S.pickup.lng], 16); render(); };
    };
    const onInput = (el) => {
      clearTimeout(searchTimer);
      const text = el.value.trim();
      if (text.length < 3) { showDefault(); return; }
      searchTimer = setTimeout(async () => {
        res.innerHTML = `<p class="small faint" style="padding:12px 2px">Searching…</p>`;
        try { current = await K.search(text, S.pickup); res.innerHTML = current.length ? rows(current) : `<p class="small muted" style="padding:12px 2px">No places found. Try a landmark or the area name.</p>`; bind(); }
        catch { res.innerHTML = '<p class="error">Search is not responding. Check your connection.</p>'; }
      }, 400);
    };
    qDrop.oninput = () => onInput(qDrop);
    qDrop.onfocus = () => { target = 'drop'; showDefault(); };
    if (qPick) { qPick.onfocus = () => { target = 'pick'; qPick.select(); showDefault(); }; qPick.oninput = () => onInput(qPick); }

    async function pick(p) {
      if (saveAs) {
        try {
          const out = await K.api('/me', { savedPlaces: { [saveAs]: { lat: p.lat, lng: p.lng, address: p.name } } }, 'PATCH');
          S.user = out.user; K.toast(`${saveAs === 'home' ? 'Home' : 'Work'} saved`); close();
          if (opts.onSaved) opts.onSaved(); else if (S.view === 'home') render();
        } catch (e) { K.toast(e.message); }
        return;
      }
      if (target === 'pick') {
        S.pickup = { lat: p.lat, lng: p.lng, address: p.name, short: p.name };
        qPick.value = p.name; target = 'drop'; qDrop.focus(); return;
      }
      close();
      chooseDrop(p);
    }
    showDefault();
    if (opts.query) { qDrop.value = opts.query; onInput(qDrop); }
    setTimeout(() => qDrop.focus(), 60);
  }

  function chooseDrop(p) {
    S.drop = { lat: p.lat, lng: p.lng, address: p.name };
    if (/airport/i.test(p.name) && S.config.services.some((s) => s.id === 'airport')) setService('airport');
    prepareQuote();
  }

  async function prepareQuote() {
    if (!S.pickup) setPickup(K.KAMPALA.lat, K.KAMPALA.lng);
    S.view = 'choose';
    K.$('#tabs').classList.add('hidden');
    sheet.classList.remove('home-card');
    K.underTabs(sheet, false);
    leaveHomeSheet(); S.lastView = 'choose';
    topbar();
    sheet.innerHTML = `<div class="grabber"></div><h2>Choose a ride</h2><div class="bar indet"><i></i></div>`;
    S.route = await K.route(S.pickup, S.drop);
    try {
      S.quote = await K.api('/fare/estimate', { pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.freeMin, promoCode: S.promoCode || undefined });
      S.quote.at = Date.now();
      if (!S.quote.options.find((o) => o.id === S.service)) setService(S.quote.options[0].id);
      showRoute();
      render();
    } catch (e) { sheet.innerHTML = `<p class="error">${K.esc(e.message)}</p><button class="btn btn-block" id="b">Back</button>`; K.$('#b').onclick = reset; }
  }

  // Prices are locked for 2 minutes. If the rider is still deciding, quietly get a fresh lock.
  let quoteTimer;
  async function refreshQuote() {
    if (S.view !== 'choose' || !S.route) return;
    try {
      const q = await K.api('/fare/estimate', { pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.freeMin, promoCode: S.promoCode || undefined });
      q.at = Date.now(); S.quote = q;
      if (S.view === 'choose') render();
    } catch {}
  }
  setInterval(() => { if (S.view === 'choose' && S.quote && Date.now() - S.quote.at > 100e3) refreshQuote(); }, 10e3);

  function showRoute() {
    clearRoute();
    routeLayer = K.drawRoute(map, S.route.coords);
    const etaPick = (S.quote && (S.quote.options.find((o) => o.id === S.service) || {}).etaMin) || null;
    labels.push(L.marker(S.route.coords[0], { icon: K.divIcon('<div class="pin-ci"></div>', [18, 18]) }).addTo(map));
    labels.push(L.marker(S.route.coords[S.route.coords.length - 1], { icon: K.divIcon('<div class="pin-sq"></div>', [18, 18]) }).addTo(map));
    labels.push(L.marker(S.route.coords[0], { icon: K.label(`${etaPick ? `<b>${etaPick}<br>min</b>` : ''}<span>${K.esc(shorten(S.pickup.short || S.pickup.address))}</span>`), interactive: false }).addTo(map));
    labels.push(L.marker(S.route.coords[S.route.coords.length - 1], { icon: K.label(`<span>${K.esc(shorten(S.drop.address))}</span>`), interactive: false }).addTo(map));
    fit(routeLayer.bounds());
  }
  const shorten = (s, n = 26) => String(s || '').split(',')[0].slice(0, n);
  function fit(bounds) {
    const pad = window.innerWidth >= 760 ? { paddingTopLeft: [460, 90], paddingBottomRight: [60, 60] } : { paddingTopLeft: [40, 90], paddingBottomRight: [40, sheet.offsetHeight + 30] };
    map.fitBounds(bounds, { ...pad, maxZoom: 16 });
  }
  function clearRoute() {
    if (routeLayer) routeLayer.remove(); routeLayer = null;
    labels.forEach((l) => map.removeLayer(l)); labels = [];
  }

  const surgeText = (o) => {
    const r = o.surgeReasons || [];
    const why = r.includes('rain') && r.includes('demand') ? 'Rain and high demand' : r.includes('rain') ? 'Raining' : r.includes('demand') ? 'High demand nearby' : 'Busy right now';
    return `↑ ${why} · fares ×${o.surge}`;
  };

  // Scheduled rides are never surge-priced; discounts come off the price shown.
  const baseOf = (o) => (S.when ? o.regularFare : o.fare);
  const payOf = (o) => Math.max(0, baseOf(o) - (o.discount ? Math.min(o.discount, baseOf(o)) : 0));
  const priceHtml = (o) => {
    const base = baseOf(o), pay = payOf(o);
    const was = pay < base ? base : (!S.when && o.surge > 1 && o.regularFare < o.fare ? o.regularFare : null);
    return `${was ? `<span class="was">${K.ugx(was)}</span>` : ''}<span class="${pay < base ? 'deal-price' : ''}">${K.ugx(pay)}</span>`;
  };
  const whenLabel = (d) => {
    const t = new Date(d), today = new Date(), tm = new Date(Date.now() + 86400e3);
    const day = t.toDateString() === today.toDateString() ? 'Today' : t.toDateString() === tm.toDateString() ? 'Tomorrow' : t.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short' });
    return `${day} ${t.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })}`;
  };

  // Schedule for later (20 min to 7 days ahead)
  function openWhen(after) {
    const pad = (n) => String(n).padStart(2, '0');
    const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const min = new Date(Date.now() + 21 * 60e3), max = new Date(Date.now() + 7 * 86400e3);
    const at = (h, m, addDays) => { const d = new Date(); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); return d; };
    const quick = [['In 30 min', new Date(Date.now() + 30 * 60e3)], ['In 1 hour', new Date(Date.now() + 60 * 60e3)], ['Tomorrow 6:00', at(6, 0, 1)], ['Tomorrow 8:00', at(8, 0, 1)]];
    const m = K.modal(`<h2>When do you need it?</h2><p class="small muted">Scheduled rides are never surge-priced. We start finding your ${who({ service: S.service })} 10 minutes before.</p>
      <div class="chips" style="flex-wrap:wrap">${quick.map(([l], i) => `<button class="chip" data-q="${i}">${l}</button>`).join('')}</div>
      <label for="wt">Pick a date and time</label><input id="wt" type="datetime-local" min="${local(min)}" max="${local(max)}" value="${local(S.when ? new Date(S.when) : quick[0][1])}">
      <p class="error" id="err"></p>
      <button class="btn btn-primary btn-block btn-lg" id="set">Set pickup time</button>
      ${S.when ? '<button class="btn btn-block" id="now" style="margin-top:8px">Ride now instead</button>' : ''}`);
    m.el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { K.$('#wt', m.el).value = local(quick[+b.dataset.q][1]); });
    K.$('#set', m.el).onclick = () => {
      const d = new Date(K.$('#wt', m.el).value);
      if (!(d > min - 60e3) || d > max) { K.$('#err', m.el).textContent = 'Choose a time between 20 minutes and 7 days from now.'; return; }
      S.when = d.toISOString(); m.close(); render();
      if (after) setTimeout(after, 280);
    };
    const now = K.$('#now', m.el); if (now) now.onclick = () => { S.when = null; m.close(); render(); };
  }

  // Book for someone else
  function openWho() {
    const p = S.passenger || {};
    const m = K.modal(`<h2>Who’s riding?</h2><p class="small muted">Book for a parent, a child or a guest. The ${who({ service: S.service })} will call them, and you can send them the trip details and PIN.</p>
      <button class="pay-item ${S.passenger ? '' : 'on'}" id="me"><span class="avatar" style="width:34px;height:34px;font-size:.8rem">${K.initials(S.user.name)}</span><span class="grow"><b>Me</b><span>${K.esc(S.user.name)}</span></span></button>
      <label for="pn">Someone else’s name</label><input id="pn" placeholder="e.g. Mama Sarah" value="${K.esc(p.name || '')}">
      <label for="pp">Their phone number</label><input id="pp" type="tel" placeholder="0772 123456" value="${K.esc(p.phone || '')}">
      <p class="error" id="err"></p>
      <button class="btn btn-primary btn-block btn-lg" id="save">Book for them</button>`);
    K.$('#me', m.el).onclick = () => { S.passenger = null; m.close(); render(); };
    K.$('#save', m.el).onclick = () => {
      const v = { name: K.$('#pn', m.el).value.trim(), phone: K.$('#pp', m.el).value.trim() };
      if (v.name.length < 2 || v.phone.replace(/\D/g, '').length < 9) { K.$('#err', m.el).textContent = 'Add their name and a phone number the driver can call.'; return; }
      S.passenger = v; m.close(); render();
    };
  }

  // Promo codes
  function openPromo() {
    const m = K.modal(`<h2>Promo code</h2><p class="small muted">Got a code from Kwata or a friend? Add it here. One discount per trip: you always get the biggest one.</p>
      <label for="pc">Code</label><input id="pc" autocapitalize="characters" placeholder="e.g. KAMPALA20" value="${K.esc(S.promoCode || '')}" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">
      <p class="error" id="err"></p>
      <button class="btn btn-primary btn-block btn-lg" id="apply">Apply</button>
      ${S.promoCode ? '<button class="btn btn-block" id="rm" style="margin-top:8px">Remove code</button>' : ''}`);
    K.$('#apply', m.el).onclick = async () => {
      const code = K.$('#pc', m.el).value.trim().toUpperCase();
      if (!code) return;
      const btn = K.$('#apply', m.el); btn.disabled = true;
      try {
        const q = await K.api('/fare/estimate', { pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.freeMin, promoCode: code });
        const ok = q.options.some((o) => o.promoCode === code);
        if (!ok) { K.$('#err', m.el).textContent = q.promoError || 'That code doesn’t apply to this trip.'; btn.disabled = false; return; }
        S.promoCode = code; q.at = Date.now(); q._shown = true; S.quote = q; m.close(); render(); K.toast('Promo applied 🎉');
      } catch (e) { K.$('#err', m.el).textContent = e.message; btn.disabled = false; }
    };
    const rm = K.$('#rm', m.el); if (rm) rm.onclick = () => { S.promoCode = null; m.close(); refreshQuote(); };
  }

  // Screen 6: choose a ride
  function vChoose() {
    const q = S.quote;
    const sel = q.options.find((o) => o.id === S.service);
    const p = pref(), P = PAY[p];
    const meta = (o) => [o.etaMin != null ? `${o.etaMin} min` : 'No drivers nearby', o.seats ? `${o.seats} seat${o.seats > 1 ? 's' : ''}` : 'Up to 10 kg'].join(' · ');
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="row" style="margin-bottom:12px;align-items:baseline"><h2 style="margin:0" class="grow">Choose a ride</h2>
        <span class="tiny muted">${[q.raining ? '🌧 Raining' : '', { rush: 'Rush hour traffic', busy: 'Busy roads', clear: 'Clear roads' }[q.traffic] || ''].filter(Boolean).join(' · ')}</span></div>
      <div class="opts" role="radiogroup" aria-label="Ride type">
      ${q.options.map((o) => `
        <button class="opt" data-s="${o.id}" aria-pressed="${o.id === S.service}">
          <span class="art">${K.artFor(o.id, o.vehicle)}</span>
          <span class="grow"><span class="name" style="display:block">${K.esc(svcName(o.id))}</span>
            <span class="meta">${meta(o)}</span>${o.surge > 1 && !S.when ? `<span class="surge" style="display:block">${surgeText(o)}</span>` : ''}${o.discount ? `<span class="deal" style="display:block">${K.ic('tag', 'sm')} ${K.esc(o.promoLabel)}</span>` : ''}</span>
          <span class="price">${priceHtml(o)}</span>
          <span class="tick">${K.ic('check', 'sm')}</span>
        </button>`).join('')}
      </div>
      <button class="payrow" id="pickRow" style="padding-bottom:4px"><span class="dot-pick" style="margin:0 12px 0 11px"></span><span class="grow"><span class="tiny muted" style="display:block;font-weight:500">Pickup</span><span class="ellipsis" id="pickLabel" style="display:block">${K.esc(S.pickup.address)}</span></span><span class="small muted">Change</span></button>
      ${S.service === 'parcel' ? `<button class="payrow" id="parcelRow"><span class="paylogo wallet">${K.ic('gift', 'sm')}</span><span class="grow">${S.parcel ? `Package for ${K.esc(S.parcel.recipientName)}` : 'Add delivery details'}</span>${K.ic('chev', 'sm')}</button>` : ''}
      <div class="chip-row">
        <button class="pill-opt ${S.when ? 'on' : ''}" id="whenBtn">${K.ic('clock', 'sm')}<span>${S.when ? K.esc(whenLabel(S.when)) : 'Now'}</span>${K.ic('chevDown', 'sm')}</button>
        <button class="pill-opt ${S.passenger ? 'on' : ''}" id="whoBtn">${K.ic('person', 'sm')}<span>${S.passenger ? K.esc(K.first(S.passenger.name)) : 'For me'}</span>${K.ic('chevDown', 'sm')}</button>
        <button class="pill-opt ${S.promoCode ? 'on' : ''}" id="promoBtn">${K.ic('tag', 'sm')}<span>${S.promoCode ? K.esc(S.promoCode) : 'Promo'}</span></button>
      </div>
      <button class="payrow" id="payRow">${P.logo}<span class="grow">${P.name}${p === 'wallet' ? ` · ${K.ugx(S.user.walletBalance)}` : ''}${['mtn', 'airtel'].includes(p) ? `<span class="tiny muted" style="display:block;font-weight:500">${prettyPhone(S.user.payPhone)}</span>` : ''}</span>${K.ic('chev', 'sm')}</button>
      <div class="sheet-foot"><p class="tiny muted" style="margin:0;text-align:center">Upfront price · you pay what you see</p><p class="error" id="err" style="margin:0 0 6px;min-height:0"></p>
      <button class="btn btn-primary btn-block btn-lg" id="request">${S.when ? 'Schedule' : 'Request'} ${K.esc(svcName(sel.id))} · ${K.ugx(payOf(sel))}</button></div>`;
    sheet.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
      if (b.dataset.s === S.service) return;
      setService(b.dataset.s); showRoute(); render();
    });
    K.$('#payRow').onclick = () => openPayments({ onPick: render });
    K.$('#pickRow').onclick = () => { S.view = 'pickup'; clearRoute(); map.setView([S.pickup.lat, S.pickup.lng], 18); render(); };
    const pr = K.$('#parcelRow'); if (pr) pr.onclick = openParcel;
    K.$('#whenBtn').onclick = openWhen;
    K.$('#whoBtn').onclick = openWho;
    K.$('#promoBtn').onclick = openPromo;
    if (q.promoError && S.promoCode && !q._shown) { q._shown = true; K.toast(q.promoError, 4500); }
    K.$('#request').onclick = () => {
      if (S.service === 'parcel' && !S.parcel) { openParcel(); return; }
      if (p === 'wallet' && S.user.walletBalance < payOf(sel)) { K.toast('Not enough in your wallet. Top up or pick another way to pay.'); openPayments({ onPick: render }); return; }
      book();
    };
  }

  function openParcel() {
    const p = S.parcel || {};
    const m = K.modal(`<h2>Delivery details</h2><p class="muted small">Your rider will call the recipient on arrival.</p>
      <label for="pr-name">Recipient name</label><input id="pr-name" value="${K.esc(p.recipientName || '')}">
      <label for="pr-phone">Recipient phone</label><input id="pr-phone" type="tel" placeholder="0772 123456" value="${K.esc(p.recipientPhone || '')}">
      <label for="pr-item">What are you sending?</label><input id="pr-item" placeholder="e.g. Documents in an envelope" value="${K.esc(p.item || '')}">
      <p class="error" id="err"></p><button class="btn btn-primary btn-block btn-lg" id="save">Save details</button>`);
    K.$('#save', m.el).onclick = () => {
      const v = { recipientName: K.$('#pr-name', m.el).value.trim(), recipientPhone: K.$('#pr-phone', m.el).value.trim(), item: K.$('#pr-item', m.el).value.trim() };
      if (!v.recipientName || !v.recipientPhone || !v.item) { K.$('#err', m.el).textContent = 'Fill in all three fields.'; return; }
      S.parcel = v; m.close(); render();
    };
  }

  function vPickup() {
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2 style="text-align:center">Adjust your pickup</h2>
      <p class="small muted" style="text-align:center">Move the map to put the pin where you’ll wait</p>
      <div class="lrow" style="cursor:default"><span class="ic">${K.ic('pin')}</span><span class="grow"><span class="t ellipsis" id="pinAddr" style="display:block">${K.esc(S.pickup.address)}</span></span></div>
      <div class="sheet-foot"><button class="btn btn-primary btn-block btn-lg" id="confirm">Confirm pickup</button></div>`;
    K.$('#confirm').onclick = () => {
      if (S.pickup.address === 'Finding address…') S.pickup.address = 'Pinned location';
      S.pickup.short = null;
      prepareQuote();
    };
  }

  function vDropPin() {
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2 style="text-align:center">Set your destination</h2>
      <div class="lrow" style="cursor:default"><span class="ic">${K.ic('flag')}</span><span class="grow"><span class="t ellipsis" id="pinAddr" style="display:block">Move the map to your destination</span></span></div>
      <div class="sheet-foot"><button class="btn btn-primary btn-block btn-lg" id="confirm">Confirm destination</button></div>`;
    onPinMove();
    K.$('#confirm').onclick = () => { if (S.pinDrop) chooseDrop(S.pinDrop); };
  }

  async function book() {
    const btn = K.$('#request'), err = K.$('#err');
    btn.disabled = true; btn.textContent = 'Requesting…'; err.textContent = '';
    if (S.pickup.address === 'Finding address…') S.pickup.address = 'Pinned location';
    const opt = S.quote.options.find((o) => o.id === S.service);
    const body = { service: S.service, paymentMethod: PAY[pref()].method, pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.freeMin, quoteId: S.quote.quoteId, expectedFare: opt && baseOf(opt), promoCode: S.promoCode || undefined, scheduledFor: S.when || undefined, passenger: S.passenger || undefined };
    if (S.service === 'parcel') body.parcel = S.parcel;
    try { onTrip(await K.api('/trips', body)); }
    catch (e) {
      btn.disabled = false; btn.textContent = `Request ${svcName(S.service)}`;
      if (/Prices have just changed/.test(e.message)) { K.toast(e.message, 5000); refreshQuote(); return; }
      err.textContent = e.message;
    }
  }

  // Screen 7: finding your rider
  function vSearching() {
    const t = S.trip;
    clearNearby(); clearRoute();
    labels.push(L.marker([t.pickup.lat, t.pickup.lng], { icon: K.divIcon('<div class="radar"></div>', [160, 160]), interactive: false }).addTo(map));
    labels.push(L.marker([t.pickup.lat, t.pickup.lng], { icon: K.divIcon('<div class="pin-ci"></div>', [18, 18]), interactive: false }).addTo(map));
    map.setView([t.pickup.lat, t.pickup.lng], 16);
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="finding">
        <h2>Finding your ${who(t)}…</h2>
        <p class="small muted">Connecting you to the nearest ${svcName(t.service).toLowerCase()} ${who(t)}</p>
        <div class="ring-wrap">
          <svg class="ring" viewBox="0 0 150 150" aria-hidden="true"><circle cx="75" cy="75" r="68" fill="none" stroke="var(--surface-2)" stroke-width="7"/><circle cx="75" cy="75" r="68" fill="none" stroke="var(--brand)" stroke-width="7" stroke-linecap="round" stroke-dasharray="110 330"/></svg>
          <div class="center">${K.artFor(t.service)}</div>
        </div>
        <p class="small muted">${K.ugx(t.payable)} · ${PAY[payOfTrip(t)].name}</p>
      </div>
      <div class="sheet-foot"><button class="btn btn-outline btn-block btn-lg" id="cancel">Cancel</button></div>`;
    K.$('#cancel').onclick = cancelTrip;
  }

  function vNone() {
    clearRoute();
    sheet.innerHTML = `<div class="grabber"></div>
      <div class="finding"><div class="illu" style="width:110px;height:110px;margin:6px auto 16px"><span style="width:80px;height:54px;display:block">${K.artFor(S.trip ? S.trip.service : S.service)}</span></div>
      <h2>No ${S.trip ? who(S.trip) : 'driver'}s free right now</h2>
      <p class="muted">Everyone nearby is busy. Try again in a minute or choose another ride type.</p></div>
      <div class="sheet-foot"><div class="row"><button class="btn fill" id="home">Back</button><button class="btn btn-primary fill" id="again">Try again</button></div></div>`;
    K.$('#home').onclick = reset;
    K.$('#again').onclick = () => prepareQuote();
  }

  function tripMins() {
    const t = S.trip; if (!t || !t.driver || !t.driver.location) return null;
    return K.etaMin(t.driver.location, t.status === 'in_progress' ? t.drop : t.pickup);
  }
  const photo = (d, cls = 'photo') => `<span class="${cls}">${d.photo ? `<img src="${K.esc(d.photo)}" alt="">` : K.initials(d.name)}</span>`;
  const stars = (r, n) => `<span class="rating"><span class="star-ic">★</span><b>${r || 'New'}</b>${n ? ` (${n} trip${n > 1 ? 's' : ''})` : ''}</span>`;
  const pinDigits = (pin) => `<span class="pin-code" aria-label="PIN ${pin}">${String(pin).split('').map((d) => `<span>${d}</span>`).join('')}</span>`;

  // ---------- trip extras: discount, passenger, parcel delivery code, tips ----------
  const fareHtml = (t) => (t.discount ? `<span class="was" style="display:inline;margin-right:6px">${K.ugx(t.fare)}</span>${K.ugx(t.payable)}` : K.ugx(t.fare));
  function extrasHtml(t) {
    let h = '';
    if (t.passenger) h += `<div class="extra-box"><span class="grow"><b>Riding: ${K.esc(t.passenger.name)}</b><br><span class="small muted">The ${who(t)} will call ${K.esc(K.first(t.passenger.name))} at pickup</span></span><button class="btn btn-sm btn-primary" data-sendpass>Send details</button></div>`;
    if (t.dropCode && t.service === 'parcel' && t.parcel) h += `<div class="extra-box"><span class="grow"><b>Delivery code ${pinDigits(t.dropCode)}</b><br><span class="small muted">${K.esc(K.first(t.parcel.recipientName))} gives this to the rider to receive the parcel</span></span><button class="btn btn-sm btn-primary" data-sendcode>Send</button></div>`;
    return h;
  }
  const sms = (phone, text) => { location.href = `sms:${phone}${/iphone|ipad/i.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`; };
  function bindExtras(t) {
    const link = location.origin + '/t/' + t.shareToken;
    const d = t.driver || {};
    const sp = sheet.querySelector('[data-sendpass]');
    if (sp) sp.onclick = () => sms(t.passenger.phone, `Hi ${K.first(t.passenger.name)}, I booked you a Kwata ${svcName(t.service).toLowerCase()}.${d.name ? ` ${K.first(d.name)} is coming in ${d.vehicle || ''} ${d.plate || ''}.` : ''} Your PIN is ${t.pin}: tell it to the ${who(t)} to start. Follow live: ${link}`);
    const sc = sheet.querySelector('[data-sendcode]');
    if (sc) sc.onclick = () => sms(t.parcel.recipientPhone, `Hi ${K.first(t.parcel.recipientName)}, a Kwata parcel is on its way to you (${t.parcel.item}). Give the rider this delivery code when it arrives: ${t.dropCode}. Track it: ${link}`);
  }
  function tipHtml(t) {
    if (!t.driver) return '';
    if (t.tip) return `<p class="small" style="margin:4px 0 10px">💛 You tipped ${K.esc(K.first(t.driver.name))} ${K.ugx(t.tip)}. Thank you!</p>`;
    return `<div class="tip-box"><b>Tip ${K.esc(K.first(t.driver.name))}?</b><span class="small muted"> 100% goes to your ${who(t)}</span>
      <div class="tip-chips">${[500, 1000, 2000].map((a) => `<button class="chip" data-tip="${a}">${K.ugx(a)}</button>`).join('')}<button class="chip" data-tip="other">Other</button></div></div>`;
  }
  function bindTip(t) {
    sheet.querySelectorAll('[data-tip]').forEach((b) => b.onclick = async () => {
      let amount = b.dataset.tip === 'other' ? Math.round(Number(prompt('Tip amount in UGX', '3000'))) : +b.dataset.tip;
      if (!amount) return;
      const canWallet = S.user.walletBalance >= amount;
      const m = K.modal(`<h2>Tip ${K.ugx(amount)}</h2><p class="small muted">How would you like to give it?</p>
        ${canWallet ? `<button class="pay-item" data-m="wallet">${PAY.wallet.logo}<span class="grow"><b>From my Kwata Wallet</b><span>Sent to ${K.esc(K.first(t.driver.name))} instantly</span></span></button>` : ''}
        <button class="pay-item" data-m="cash">${PAY.cash.logo}<span class="grow"><b>In cash</b><span>Hand it to ${K.esc(K.first(t.driver.name))} now</span></span></button>
        <button class="btn btn-block" data-close style="margin-top:6px">Cancel</button>`);
      m.el.querySelectorAll('[data-m]').forEach((x) => x.onclick = async () => {
        try {
          await K.api(`/trips/${t.id}/tip`, { amount, method: x.dataset.m });
          if (x.dataset.m === 'wallet') S.user.walletBalance -= amount;
          S.trip.tip = amount; S.trip.tipMethod = x.dataset.m; m.close(); K.toast('💛 Thank you for the tip!'); render();
        } catch (e) { K.toast(e.message); }
      });
    });
  }

  // Screens 8 & 9: rider found / on trip
  function vTrip() {
    const t = S.trip, d = t.driver;
    clearNearby();
    const mins = tripMins();
    const pct = t.status === 'arrived' ? 100 : phaseKm && d.location ? Math.max(5, Math.min(100, 100 - (K.km(d.location, t.status === 'in_progress' ? t.drop : t.pickup) / phaseKm) * 100)) : 8;
    const callBtn = (cls) => d.phone ? `<a class="${cls}" href="tel:${K.esc(d.phone)}" aria-label="Call">${K.ic('phone')}${cls === 'act' ? ' Call' : ''}</a>` : '';
    if (t.status === 'in_progress') {
      sheet.innerHTML = `
        <div class="grabber"></div>
        <div class="driver-card">${photo(d)}
          <span class="grow"><b style="display:block">${K.esc(d.name)}</b>${stars(d.rating, d.trips)}<span class="small muted" style="display:block">${K.esc(d.vehicle || svcName(t.service))} · <span class="plate-chip">${K.esc(d.plate)}</span></span></span>
          ${callBtn('round go')}<button class="round brand" id="chatBtn" aria-label="Message">${K.ic('msg')}</button></div>
        <div class="bar" style="margin:14px 0 4px"><i id="etaBar" style="width:${pct}%"></i></div>
        <div class="stops">
          <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>From</small><b class="ellipsis">${K.esc(t.pickup.address)}</b></span></div>
          <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>To</small><b class="ellipsis">${K.esc(t.drop.address)}</b></span></div>
        </div>
        ${extrasHtml(t)}
        <div class="fare-row"><span class="muted">Total fare</span><b>${fareHtml(t)}</b></div>
        <div class="sheet-foot"><div class="row"><button class="btn fill" id="share">${K.ic('share', 'sm')} Share trip</button><button class="btn btn-danger-soft fill" id="sos" style="margin-top:0">${K.ic('sos', 'sm')} SOS</button></div></div>`;
      K.$('#share').onclick = shareTrip;
      K.$('#sos').onclick = sos;
    } else {
      const arrived = t.status === 'arrived';
      sheet.innerHTML = `
        <div class="grabber"></div>
        <h2 style="font-size:1.15rem">${arrived ? `Your ${who(t)} has arrived` : `Your ${who(t)} is on the way`}</h2>
        <div class="driver-card" style="margin-top:12px">${photo(d)}
          <span class="grow"><b style="display:block">${K.esc(d.name)}</b>${stars(d.rating, d.trips)}<span class="small muted" style="display:block">${K.esc(d.vehicle || svcName(t.service))}</span></span>
          <span style="text-align:right"><span class="plate-chip">${K.esc(d.plate)}</span><span style="display:block;width:70px;height:44px;margin-top:4px">${K.artFor(t.service, d.vehicleType)}</span></span></div>
        <div class="eta-line"><span id="etaTxt">${arrived ? `Meet ${K.esc(K.first(d.name))} now` : mins ? `Arriving in ${mins} min` : 'On the way'}</span><span class="small muted" style="font-weight:600">${t.service === 'parcel' ? 'Parcel pickup' : 'Pickup'}</span></div>
        <div class="bar"><i id="etaBar" style="width:${pct}%"></i></div>
        <div class="act-row">${callBtn('act') || '<span></span>'}<button class="act" id="chatBtn">${K.ic('msg')} Message</button></div>
        <div class="pin-box"><span><b>${t.passenger ? `${K.esc(K.first(t.passenger.name))}’s trip PIN` : 'Your trip PIN'}</b><br><span class="small muted">${t.passenger ? 'Send it to them below' : `Tell your ${who(t)} to start`}</span></span>${pinDigits(t.pin)}</div>
        ${extrasHtml(t)}
        <div class="stops">
          <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>Pickup</small><b class="ellipsis">${K.esc(t.pickup.address)}</b></span></div>
          <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>Drop-off</small><b class="ellipsis">${K.esc(t.drop.address)}</b></span></div>
        </div>
        <div class="fare-row"><span class="row" style="gap:8px">${PAY[payOfTrip(t)].logo}<span class="muted">${PAY[payOfTrip(t)].name}</span></span><b>${fareHtml(t)}</b></div>
        <div class="sheet-foot"><button class="btn btn-danger btn-block btn-lg" id="cancel">Cancel ride</button></div>`;
      K.$('#cancel').onclick = cancelTrip;
    }
    K.$('#chatBtn').onclick = openChat;
    bindExtras(t);
    updateUnread();
    // route for this phase
    const phase = t.status === 'in_progress' ? 'drop' : 'pickup';
    const target = phase === 'drop' ? t.drop : t.pickup;
    if (routedPhase !== phase + t.id) {
      routedPhase = phase + t.id;
      clearRoute();
      const from = d.location || (phase === 'drop' ? t.pickup : null);
      phaseKm = from ? Math.max(0.2, K.km(from, target)) : null;
      labels.push(L.marker([target.lat, target.lng], { icon: K.divIcon(phase === 'drop' ? '<div class="pin-sq"></div>' : '<div class="pin-ci"></div>', [18, 18]) }).addTo(map));
      if (from) K.route(from, target).then((r) => {
        if (routedPhase !== phase + t.id) return;
        routeLayer = K.drawRoute(map, r.coords);
        fit(routeLayer.bounds());
      });
      else map.setView([target.lat, target.lng], 16);
    }
    if (d.location) moveDriver(d.location, true);
  }

  // Screen 10: trip completed
  function vDone() {
    const t = S.trip, d = t.driver || {};
    clearRoute(); routedPhase = null;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    const needsPay = t.paymentStatus === 'pending' && ['momo', 'card'].includes(t.paymentMethod);
    const P = PAY[payOfTrip(t)];
    const colors = ['#FFC400', '#141414', '#12A150', '#FF8A00', '#2F6BFF'];
    const confetti = Array.from({ length: 26 }, (_, i) => `<i style="background:${colors[i % 5]};--x:${Math.round(Math.cos(i * 0.9) * (90 + (i % 4) * 30))}px;--y:${Math.round(Math.sin(i * 0.9) * 60 - 20)}px;--r:${i * 47}deg;animation-delay:${(i % 6) * 0.03}s"></i>`).join('');
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="done-wrap">
        <div class="confetti">${confetti}</div>
        <div class="check-big">${K.ic('check')}</div>
        <h2>${t.service === 'parcel' ? 'Parcel delivered!' : 'Trip completed!'}</h2>
        <p class="small muted">${t.service === 'parcel' ? 'Your package has arrived' : 'You have arrived at your destination'}</p>
        <div class="fare-card">
          <span class="small muted">${t.paymentMethod === 'cash' ? 'Pay in cash' : needsPay ? 'Amount due' : 'Total paid'}</span>
          <div class="amt">${K.ugx(t.payable)}</div>
          ${t.discount ? `<span class="deal" style="display:block;margin-top:2px">${K.ic('tag', 'sm')} You saved ${K.ugx(t.discount)}${t.promoLabel ? ' · ' + K.esc(t.promoLabel) : ''}</span>` : ''}
          <span class="row" style="justify-content:center;gap:8px;margin-top:6px">${P.logo}<span class="small bold">${P.name}</span></span>
          ${t.pointsEarned ? `<span class="points-pill">★ +${t.pointsEarned} Kwata Rewards point${t.pointsEarned > 1 ? 's' : ''}</span>` : ''}
        </div>
        ${tipHtml(t)}
        ${!t.riderRated ? `
          <h3 style="margin-top:6px">Rate your ${who(t)}</h3>
          <div class="row" style="justify-content:center;gap:8px">${photo(d, 'photo')}<span style="text-align:left"><b>${K.esc(d.name || '')}</b><br><span class="small muted">${K.esc(d.plate || '')}</span></span></div>
          <div class="stars" role="radiogroup" aria-label="Rate your ${who(t)}">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}" class="${n <= S.rating ? 'on' : ''}">${K.starSvg}</button>`).join('')}</div>` : ''}
        <button class="btn btn-link btn-block" id="details" style="min-height:36px">View details</button>
      </div>
      <div class="sheet-foot">
        ${needsPay ? `<p class="error" id="err" style="margin:0 0 6px;min-height:0"></p><button class="btn btn-primary btn-block btn-lg" id="pay">Pay ${K.ugx(t.payable)}</button>` : ''}
        ${!t.riderRated ? `<button class="btn ${needsPay ? '' : 'btn-primary'} btn-block btn-lg" id="rate" ${S.rating ? '' : 'disabled'}>Rate ${who(t)}</button>` : (!needsPay ? '<button class="btn btn-primary btn-block btn-lg" id="done">Done</button>' : '')}
      </div>`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => {
      S.rating = +b.dataset.n;
      sheet.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', +x.dataset.n <= S.rating));
      K.$('#rate').disabled = false;
    });
    const pay = K.$('#pay');
    if (pay) pay.onclick = async () => {
      pay.disabled = true;
      try {
        const out = await K.api(`/trips/${t.id}/pay`, {});
        if (out.link) location.href = out.link; else { K.toast('Payment received'); S.trip.paymentStatus = 'paid'; render(); }
      } catch (e) { K.$('#err').textContent = e.message; pay.disabled = false; }
    };
    const rate = K.$('#rate');
    if (rate) rate.onclick = async () => {
      rate.disabled = true;
      await K.api(`/trips/${t.id}/rate`, { stars: S.rating }).catch(() => {});
      S.trip.riderRated = true; S.rating = 0;
      if (needsPay) render(); else { K.toast('Thanks for riding with Kwata'); reset(); }
    };
    const dn = K.$('#done'); if (dn) dn.onclick = reset;
    K.$('#details').onclick = () => tripDetails(t);
    bindTip(t);
  }

  function tripDetails(t) {
    const d = t.driver || {};
    const P = PAY[payOfTrip(t)] || PAY.cash;
    K.modal(`<h2>Trip details</h2>
      <p class="small muted">${K.when(t.createdAt)}</p>
      <div class="stops">
        <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>From</small><b>${K.esc(t.pickup.address)}</b></span></div>
        <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>To</small><b>${K.esc(t.drop.address)}</b></span></div>
      </div>
      <div class="kv"><span>Service</span><b>${svcName(t.service)}</b></div>
      ${d.name ? `<div class="kv"><span>${who(t) === 'rider' ? 'Rider' : 'Driver'}</span><b>${K.esc(d.name)} · ${K.esc(d.plate || '')}</b></div>` : ''}
      ${t.distanceKm ? `<div class="kv"><span>Distance</span><b>${Number(t.distanceKm).toFixed(1)} km</b></div>` : ''}
      <div class="kv"><span>Payment</span><b>${P.name}${t.paymentStatus === 'paid' ? ' · Paid' : t.paymentStatus === 'pending' && t.paymentMethod !== 'cash' ? ' · Not paid' : ''}</b></div>
      ${t.scheduledFor ? `<div class="kv"><span>Scheduled for</span><b>${whenLabel(t.scheduledFor)}</b></div>` : ''}
      ${t.passenger ? `<div class="kv"><span>Passenger</span><b>${K.esc(t.passenger.name)}</b></div>` : ''}
      <div class="kv"><span>Fare</span><b>${K.ugx(t.fare)}</b></div>
      ${t.discount ? `<div class="kv"><span>${K.esc(t.promoLabel || 'Discount')}</span><b class="pos">−${K.ugx(t.discount)}</b></div>` : ''}
      ${t.tip ? `<div class="kv"><span>Tip (${t.tipMethod === 'wallet' ? 'wallet' : 'cash'})</span><b>${K.ugx(t.tip)}</b></div>` : ''}
      <div class="big-total"><span class="bold">You paid</span><b>${K.ugx(t.payable + (t.tip || 0))}</b></div>
      <button class="btn btn-block" style="margin-top:14px" data-close>Close</button>`);
  }

  // ---------- trip events ----------
  function onTrip(t) {
    if (!t) return;
    if (S.trip && t.id < S.trip.id) return;
    const prev = S.trip && S.trip.status;
    S.trip = t;
    if (t.status === 'scheduled') {
      K.toast(`🕐 ${svcName(t.service)} scheduled for ${whenLabel(t.scheduledFor)}`, 4500);
      S.trip = null; reset(); loadUpcoming(); return;
    }
    if (t.status === 'requested') S.view = 'searching';
    else if (['accepted', 'arrived', 'in_progress'].includes(t.status)) S.view = 'trip';
    else if (t.status === 'completed') S.view = 'done';
    else if (t.status === 'no_drivers') S.view = 'none';
    else if (t.status === 'cancelled') { if (t.cancelledBy === 'rider') { reset(); return; } S.view = 'none'; K.toast(`Your ${who(t)} cancelled. Try again.`); }
    if (prev !== t.status) {
      if (t.status === 'accepted') { K.toast(`${K.first(t.driver.name)} is on the way`); vibrate(); loadMessages(); }
      if (t.status === 'arrived') vibrate();
    }
    S.pickup = t.pickup; S.drop = t.drop;
    document.querySelectorAll('.page[data-tabpage]').forEach((p) => p.remove());
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === 'home' ? 'page' : 'false'));
    render();
  }
  const vibrate = () => { try { navigator.vibrate && navigator.vibrate([120, 80, 120]); } catch {} };

  function moveDriver(p, quiet) {
    if (!S.trip || !S.trip.driver) return;
    if (!driverMarker) driverMarker = K.vehicle(map, p, S.trip.driver.vehicleType === 'car' ? 'car' : 'boda', p.heading || 0);
    else driverMarker.moveTo(p.lat, p.lng, p.heading);
    S.trip.driver.location = p;
    if (quiet || S.view !== 'trip') return;
    const t = S.trip, target = t.status === 'in_progress' ? t.drop : t.pickup;
    const mins = K.etaMin(p, target);
    const et = K.$('#etaTxt'); if (et && t.status === 'accepted') et.textContent = `Arriving in ${mins} min`;
    const bn = K.$('#bnTxt'); if (bn) bn.textContent = `Arriving in ${mins} min`;
    const bar = K.$('#etaBar'); if (bar && phaseKm && t.status !== 'arrived') bar.style.width = Math.max(5, Math.min(100, 100 - (K.km(p, target) / phaseKm) * 100)) + '%';
  }

  async function cancelTrip() {
    const t = S.trip;
    const m = K.modal(`<h2>Cancel your ride?</h2><p class="muted">${t.driver ? `${K.esc(K.first(t.driver.name))} is already on the way.` : `We’re still finding you a ${who(t)}.`}</p>
      <button class="btn btn-danger btn-block btn-lg" id="yes">Yes, cancel</button><button class="btn btn-block" style="margin-top:8px" data-close>Keep my ride</button>`);
    K.$('#yes', m.el).onclick = async () => {
      try { await K.api(`/trips/${t.id}/cancel`, { reason: 'rider' }); m.close(); reset(); } catch (e) { K.toast(e.message); }
    };
  }

  // ---------- chat ----------
  async function loadMessages() {
    if (!S.trip) return;
    try { S.messages = await K.api(`/trips/${S.trip.id}/messages`); } catch { S.messages = []; }
  }
  function onChat(m) {
    if (!S.trip || m.tripId !== S.trip.id) return;
    if (!S.messages.find((x) => x.at === m.at && x.text === m.text)) S.messages.push(m);
    if (S.chatOpen) drawChat();
    else if (m.from !== 'rider') { S.unread++; updateUnread(); K.toast(`${m.name}: ${m.text}`); vibrate(); }
  }
  function updateUnread() {
    const b = K.$('#chatBtn'); if (!b) return;
    const dot = b.querySelector('.dot');
    if (S.unread && !dot) b.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    if (!S.unread && dot) dot.remove();
  }
  function openChat() {
    S.chatOpen = true; S.unread = 0; updateUnread();
    const d = S.trip.driver;
    const page = document.createElement('div');
    page.className = 'page push-in'; page.id = 'chatPage'; page.style.zIndex = 870;
    page.style.paddingBottom = 'calc(12px + env(safe-area-inset-bottom))';
    page.innerHTML = `<div class="page-inner chat">
      <div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Close chat">${K.ic('back')}</button>
        ${photo(d, 'avatar')}<span class="grow"><b>${K.esc(d.name)}</b><br><span class="small muted">${K.esc(d.plate)}</span></span>
        ${d.phone ? `<a class="round go" href="tel:${K.esc(d.phone)}" aria-label="Call">${K.ic('phone')}</a>` : ''}</div>
      <div class="chat-log" id="log"></div>
      <div class="quick">${['I’m on my way', 'I’m at the pickup spot', 'Please call me', 'Okay, thanks'].map((q) => `<button data-q="${q}">${q}</button>`).join('')}</div>
      <form class="chat-input" id="cf"><input id="ci" placeholder="Message ${K.esc(K.first(d.name))}" autocomplete="off" aria-label="Message"><button class="btn btn-primary icon-btn" aria-label="Send">${K.ic('send')}</button></form></div>`;
    root.querySelector('#app').appendChild(page);
    const send = (text) => sock.emit('chat:send', { tripId: S.trip.id, text }, (r) => { if (!r.ok) K.toast(r.error || 'Message not sent'); });
    K.$('[data-x]', page).onclick = () => { S.chatOpen = false; updateUnread(); K.pop(page); };
    page.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => send(b.dataset.q));
    K.$('#cf', page).onsubmit = (e) => { e.preventDefault(); const v = K.$('#ci', page).value.trim(); if (v) { send(v); K.$('#ci', page).value = ''; } };
    drawChat();
  }
  function drawChat() {
    const log = K.$('#log'); if (!log) return;
    log.innerHTML = S.messages.length ? S.messages.map((m) => `<div class="bubble ${m.from === 'rider' ? 'me' : ''}">${K.esc(m.text)}<span class="at">${new Date(m.at).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')
      : `<p class="small muted" style="text-align:center;margin:auto">Messages are only visible to you and ${K.esc(K.first(S.trip.driver.name))} during this trip.</p>`;
    log.scrollTop = log.scrollHeight;
  }

  // ---------- safety ----------
  const shareTrip = () => K.share(location.origin + '/t/' + S.trip.shareToken, `Follow my Kwata trip live: ${S.trip.driver.name}, ${S.trip.driver.plate}`);
  function openSafetySheet() {
    const t = S.trip;
    const m = K.modal(`<h2>Safety</h2>
      <button class="lrow" id="s-share"><span class="ic">${K.ic('share')}</span><span class="grow"><span class="t">Share trip status</span><span class="s" style="display:block">Family can follow your trip live</span></span></button>
      <button class="lrow" id="s-ec"><span class="ic">${K.ic('person')}</span><span class="grow"><span class="t">Emergency contact</span><span class="s" style="display:block">${S.user.emergencyContact ? K.esc(prettyPhone(S.user.emergencyContact)) : 'Add someone we can alert'}</span></span></button>
      <div class="card small" style="margin:12px 0">Your PIN makes sure you get on the right ${t.driver.vehicleType === 'car' ? 'car' : 'boda'}. Check the plate <b>${K.esc(t.driver.plate)}</b> before you board.</div>
      <button class="btn btn-danger btn-block btn-lg" id="s-sos">${K.ic('sos')} Emergency assistance</button>`);
    K.$('#s-share', m.el).onclick = shareTrip;
    K.$('#s-ec', m.el).onclick = () => { m.close(); openEmergency(); };
    K.$('#s-sos', m.el).onclick = () => { m.close(); sos(); };
  }

  async function sos() {
    const send = async (lat, lng) => {
      try {
        const out = await K.api(`/trips/${S.trip.id}/sos`, { lat, lng });
        const link = location.origin + '/t/' + out.shareToken;
        const m = K.modal(`<h2>Help is being alerted</h2>
          <p>The Kwata safety team has your live location and trip details.</p>
          <a class="btn btn-danger btn-block btn-lg" href="tel:999">Call Police (999)</a>
          ${out.emergencyContact ? `<a class="btn btn-block" style="margin-top:8px" href="sms:${out.emergencyContact}?body=${encodeURIComponent('I need help. Follow my Kwata trip: ' + link)}">Text my emergency contact</a>` : ''}
          <button class="btn btn-block" style="margin-top:8px" id="sh">Share my live location</button>
          <button class="btn btn-ghost btn-block" data-close>Close</button>`);
        K.$('#sh', m.el).onclick = () => K.share(link, 'I need help. Follow my Kwata trip live');
      } catch (e) { K.toast(e.message); }
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => send(p.coords.latitude, p.coords.longitude), () => send(), { timeout: 5000 });
    else send();
  }

  function reset() {
    S.view = 'home'; S.drop = null; S.quote = null; S.route = null; S.trip = null; S.rating = 0; S.parcel = null;
    S.when = null; S.passenger = null; S.promoCode = null; S.tipped = false;
    loadGrowth();
    S.messages = []; S.unread = 0; routedPhase = null; phaseKm = null;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    clearRoute();
    K.api('/me').then((m) => { S.user = m.user; }).catch(() => {});
    K.api('/trips/history').then((h) => { S.history = h; buildRecent(h); if (S.view === 'home') render(); }).catch(() => {});
    if (S.gps) { S.pickup = { ...S.gps, address: 'Current location', short: 'Current location' }; map.setView([S.gps.lat, S.gps.lng], 16); setPickup(S.gps.lat, S.gps.lng, 'Current location'); }
    else if (S.pickup) map.setView([S.pickup.lat, S.pickup.lng], 16);
    render();
  }

  // ---------- growth: offers, upcoming rides, invite friends, rewards ----------
  async function loadGrowth() { try { S.growth = await K.api('/me/growth'); patchHome('forYou'); } catch {} }
  async function loadUpcoming() { try { S.upcoming = await K.api('/trips/upcoming'); patchHome('up'); } catch {} }
  function cancelScheduled(id) {
    const m = K.modal(`<h2>Cancel scheduled ride?</h2><p class="muted">There’s no charge for cancelling a scheduled ride.</p>
      <button class="btn btn-danger btn-block btn-lg" id="yes">Cancel ride</button><button class="btn btn-block" style="margin-top:8px" data-close>Keep it</button>`);
    K.$('#yes', m.el).onclick = async () => { try { await K.api(`/trips/${id}/cancel`, {}); m.close(); K.toast('Scheduled ride cancelled'); loadUpcoming(); } catch (e) { K.toast(e.message); } };
  }

  async function openInvite(onBack) {
    const sp = subPage('Invite friends', onBack);
    const draw = (g) => {
      const rf = g.referral;
      sp.body.innerHTML = `<div class="invite-hero"><div class="gift-big">🎁</div>
          <h2>Give ${K.ugx(rf.friend)}, get ${K.ugx(rf.referrer)}</h2>
          <p class="muted">Share your code. When a friend signs up with it and takes their first trip, you both get Kwata Wallet credit.</p></div>
        <div class="code-box"><span class="tiny muted">Your invite code</span><b>${K.esc(g.code)}</b></div>
        <button class="btn btn-primary btn-block btn-lg" id="share">${K.ic('share', 'sm')} Share my invite</button>
        <div class="stats3" style="margin-top:18px"><div><b>${g.friends.joined}</b><span>Friends joined</span></div><div><b>${g.friends.rode}</b><span>Took a trip</span></div><div><b>${K.ugx(g.earned).replace('UGX ', '')}</b><span>Earned (UGX)</span></div></div>
        <p class="tiny faint">Credit arrives in your wallet automatically and pays for your next trips. One reward per new friend.</p>`;
      K.$('#share', sp.page).onclick = () => K.share(g.link, `Ride with me on Kwata! Use my code ${g.code} when you sign up and get ${K.ugx(rf.friend)} after your first trip.`);
    };
    sp.body.innerHTML = K.skeleton('list', 2);
    if (S.growth) draw(S.growth);
    try { S.growth = await K.api('/me/growth'); draw(S.growth); } catch (e) { if (!S.growth) sp.body.innerHTML = `<p class="error">${K.esc(e.message)}</p>`; }
  }

  async function openRewards(onBack) {
    const sp = subPage('Kwata Rewards', onBack);
    const draw = (g) => {
      const rw = g.rewards, t = g.tier;
      const pct = Math.min(100, Math.round((g.points / rw.redeemPoints) * 100));
      const tierPct = t.next ? Math.min(100, Math.round((g.lifetimePoints / t.at) * 100)) : 100;
      sp.body.innerHTML = `<div class="rewards-card tier-${t.name.toLowerCase()}"><span class="tiny">${t.name} member</span><b>${g.points}</b><span>points</span>
          <div class="bar" style="background:rgba(255,255,255,.25);margin:12px 0 4px"><i style="width:${pct}%;background:#fff"></i></div>
          <span class="tiny">${g.points >= rw.redeemPoints ? 'Ready to redeem!' : `${rw.redeemPoints - g.points} more points for ${K.ugx(rw.redeemValue)}`}</span></div>
        <button class="btn btn-primary btn-block btn-lg" id="redeem" ${g.points >= rw.redeemPoints ? '' : 'disabled'}>Redeem ${rw.redeemPoints} points for ${K.ugx(rw.redeemValue)}</button>
        <h3 style="margin-top:20px">How it works</h3>
        <div class="kv"><span>Earn</span><b>${rw.pointsPer1000} point for every UGX 1,000 you pay</b></div>
        <div class="kv"><span>Redeem</span><b>${rw.redeemPoints} points = ${K.ugx(rw.redeemValue)} wallet credit</b></div>
        <div class="kv"><span>${t.next ? `Next level: ${t.next}` : 'Top level'}</span><b>${t.next ? `${g.lifetimePoints}/${t.at} lifetime points` : 'You’re Gold ✨'}</b></div>
        <div class="bar" style="margin-top:8px"><i style="width:${tierPct}%"></i></div>`;
      K.$('#redeem', sp.page).onclick = async () => {
        try { const out = await K.api('/rewards/redeem', {}); S.user.walletBalance = out.walletBalance; K.toast(`🎉 ${K.ugx(rw.redeemValue)} added to your wallet`); S.growth = await K.api('/me/growth'); draw(S.growth); }
        catch (e) { K.toast(e.message); }
      };
    };
    sp.body.innerHTML = K.skeleton('list', 2);
    if (S.growth) draw(S.growth);
    try { S.growth = await K.api('/me/growth'); draw(S.growth); } catch (e) { if (!S.growth) sp.body.innerHTML = `<p class="error">${K.esc(e.message)}</p>`; }
  }

  // ---------- tabs: activity & account (screens 11–13) ----------
  function openTab(tab) {
    if (tab !== 'home' && S.view !== 'home') return;
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    document.querySelectorAll('.page[data-tabpage]').forEach((p) => p.remove());
    if (tab === 'home') return;
    const page = document.createElement('div');
    page.className = 'page tab-in'; page.dataset.tabpage = tab;
    page.innerHTML = `<div class="page-inner">${K.skeleton('title-list')}</div>`;
    root.querySelector('#app').insertBefore(page, K.$('#tabs'));
    (tab === 'activity' ? drawActivity : drawAccount)(page.firstElementChild);
  }

  function subPage(title, onBack) {
    const page = document.createElement('div');
    page.className = 'page push-in'; page.style.zIndex = 860;
    page.innerHTML = `<div class="page-inner"><div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Back">${K.ic('back')}</button><h2>${title}</h2></div><div data-body></div></div>`;
    root.querySelector('#app').appendChild(page);
    K.$('[data-x]', page).onclick = () => K.pop(page, onBack);
    return { page, body: K.$('[data-body]', page), close: () => K.pop(page) };
  }

  // Shows saved trips instantly, then quietly refreshes from the server.
  async function drawActivity(el, filter = 'all', fresh = false) {
    if (!fresh && S.history) {
      paintActivity(el, filter, S.history);
      K.api('/trips/history').then((h) => { const changed = JSON.stringify(h) !== JSON.stringify(S.history); S.history = h; if (changed && el.isConnected) paintActivity(el, el.dataset.filter || filter, h); }).catch(() => {});
      return;
    }
    try { S.history = await K.api('/trips/history'); } catch (e) { el.innerHTML = `<p class="error">${K.esc(e.message)}</p>`; return; }
    paintActivity(el, filter, S.history);
  }
  function paintActivity(el, filter, list) {
    el.dataset.filter = filter;
    const shown = list.filter((t) => filter === 'all' || (filter === 'parcel' ? t.service === 'parcel' : t.service !== 'parcel'));
    const st = (t) => (t.status === 'scheduled' ? [`Scheduled · ${whenLabel(t.scheduledFor)}`, 'warn'] : { completed: ['Completed', 'ok'], cancelled: ['Cancelled', 'bad'], no_drivers: ['No driver found', 'bad'] }[t.status] || [t.status.replace('_', ' '), 'warn']);
    el.innerHTML = `<div class="page-title">Activity</div>
      <div class="seg-tabs">${[['all', 'All'], ['ride', 'Rides'], ['parcel', 'Deliveries']].map(([k, l]) => `<button data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div>
      ${shown.length ? shown.map((t, i) => `<button class="trip-card" data-t="${i}" style="width:100%;cursor:pointer;text-align:left">
        <span class="ic">${K.artFor(t.service)}</span>
        <span class="grow"><span class="t ellipsis" style="display:block">${K.esc(shorten(t.drop.address, 34))}</span>
          <span class="s" style="display:block">${K.when(t.createdAt)}</span><span class="badge ${st(t)[1]}" style="margin-top:4px">${st(t)[0]}</span></span>
        <span class="p">${K.ugx(t.payable ?? t.fare)}</span></button>`).join('')
      : `<div class="empty"><div class="illu">${K.ART[filter === 'parcel' ? 'parcel' : 'boda']}</div><h3>No ${filter === 'parcel' ? 'deliveries' : 'trips'} yet</h3><p class="small">Your ${filter === 'parcel' ? 'deliveries' : 'rides and deliveries'} will show here.</p><button class="btn btn-primary" id="first">${filter === 'parcel' ? 'Send a parcel' : 'Book a ride'}</button></div>`}`;
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => paintActivity(el, b.dataset.f, S.history || []));
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => tripDetails(shown[+b.dataset.t]));
    const f = K.$('#first', el); if (f) f.onclick = () => { openTab('home'); if (filter === 'parcel') setService('parcel'); openSearch(); };
  }

  function drawAccount(el) {
    const u = S.user, P = PAY[pref()];
    el.innerHTML = `
      <div class="page-title">Account</div>
      <div class="profile-head"><span class="photo">${K.initials(u.name)}</span>
        <span class="grow"><b style="font-size:1.2rem;display:block">${K.esc(u.name)}</b><span class="small muted">${K.esc(prettyPhone(u.phone))}</span><br>
          <span class="verified">★ ${u.rating || 'New'} rider rating</span></span></div>
      <button class="menu-item" data-a="invite"><span class="ic" style="background:var(--brand-soft)">🎁</span><span class="grow">Invite friends<br><span class="small muted">Get ${K.ugx((S.config.growth || { referral: {} }).referral.referrer || 0)} for each friend</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="rewards"><span class="ic" style="background:var(--brand-soft)">★</span><span class="grow">Kwata Rewards<br><span class="small muted">${S.growth ? `${S.growth.points} points · ${S.growth.tier.name}` : 'Earn points on every trip'}</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="pay"><span class="ic">${K.ic('card')}</span><span class="grow">Payment methods<br><span class="small muted">${P.name}</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="places"><span class="ic">${K.ic('pin')}</span><span class="grow">Saved places</span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="wallet"><span class="ic">${K.ic('wallet')}</span><span class="grow">Kwata Wallet<br><span class="small muted">${K.ugx(u.walletBalance)}</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="safety"><span class="ic">${K.ic('shield')}</span><span class="grow">Safety<br><span class="small muted">${u.emergencyContact ? 'Emergency contact ' + K.esc(prettyPhone(u.emergencyContact)) : 'Add an emergency contact'}</span></span>${K.ic('chev', 'sm')}</button>
      <a class="menu-item" href="tel:${K.esc(S.config.supportPhone)}"><span class="ic">${K.ic('help')}</span><span class="grow">Help & Support</span>${K.ic('chev', 'sm')}</a>
      <button class="menu-item" data-a="out" style="color:var(--stop)"><span class="ic" style="background:var(--stop-soft);color:var(--stop)">${K.ic('logout')}</span><span class="grow">Log out</span></button>
      <p class="tiny faint" style="text-align:center;margin-top:18px">Kwata 1.0 · ${K.screen.view || innerHeight}/${K.screen.full || '–'}/${K.screen.inset ?? '–'}/${K.screen.pad ?? '–'}</p>`;
    const redraw = () => drawAccount(el);
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'pay') openPayments({ onBack: redraw });
      else if (a === 'invite') openInvite(redraw);
      else if (a === 'rewards') openRewards(redraw);
      else if (a === 'places') openPlaces(redraw);
      else if (a === 'wallet') openWallet(redraw);
      else if (a === 'safety') openEmergency(redraw);
      else if (a === 'out') { K.session.clear(); location.reload(); }
    });
  }

  // Screen 13: payment methods
  function openPayments({ onPick, onBack } = {}) {
    const sp = subPage('Payment methods', onBack);
    const draw = () => {
      const cur = pref();
      const sub = { mtn: prettyPhone(S.user.payPhone), airtel: prettyPhone(S.user.payPhone), card: 'Visa or Mastercard, paid at the end', cash: 'Pay your rider or driver directly', wallet: 'Balance ' + K.ugx(S.user.walletBalance) };
      sp.body.innerHTML = `<p class="small muted" style="margin:0 0 12px">Your default is used for every trip. Change it any time.</p>
        ${Object.keys(PAY).map((k) => `<button class="pay-item ${k === cur ? 'on' : ''}" data-p="${k}">${PAY[k].logo}<span class="grow"><b>${PAY[k].name}</b><span>${sub[k]}</span></span>${k === cur ? '<span class="default-badge">Default</span>' : ''}</button>`).join('')}
        <button class="btn btn-outline btn-block" id="num" style="margin-top:6px">${K.ic('momo', 'sm')} Change Mobile Money number</button>
        <button class="btn btn-outline btn-block" id="top" style="margin-top:8px">${K.ic('plus', 'sm')} Add money to wallet</button>
        ${S.config.paymentsLive ? '' : '<p class="tiny faint" style="margin-top:10px">Test mode: Mobile Money and card payments complete instantly without charging you.</p>'}`;
      sp.body.querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => {
        try { S.user = (await K.api('/me', { payPref: b.dataset.p }, 'PATCH')).user; } catch (e) { K.toast(e.message); return; }
        if (onPick) { sp.close(); onPick(); } else draw();
      });
      K.$('#num', sp.page).onclick = () => {
        const m = K.modal(`<h2>Mobile Money number</h2><p class="small muted">We send MTN or Airtel payment prompts to this number.</p>
          <label for="mm">Phone number</label><input id="mm" type="tel" inputmode="tel" value="${K.esc(prettyPhone(S.user.payPhone))}">
          <p class="error" id="err"></p><button class="btn btn-primary btn-block btn-lg" id="sv">Save</button>`);
        K.$('#sv', m.el).onclick = async () => {
          try { S.user = (await K.api('/me', { payPhone: K.$('#mm', m.el).value }, 'PATCH')).user; m.close(); draw(); K.toast('Number saved'); }
          catch (e) { K.$('#err', m.el).textContent = e.message; }
        };
      };
      K.$('#top', sp.page).onclick = () => openWallet(draw);
    };
    draw();
  }

  function openPlaces(onBack) {
    const sp = subPage('Saved places', onBack);
    const draw = () => {
      const p = S.user.savedPlaces || {};
      sp.body.innerHTML = ['home', 'work'].map((k) => `<div class="menu-item" style="cursor:default"><span class="ic">${K.ic(k === 'home' ? 'home' : 'work')}</span>
        <span class="grow">${k === 'home' ? 'Home' : 'Work'}<br><span class="small muted">${p[k] ? K.esc(p[k].address) : 'Not set'}</span></span>
        <button class="btn btn-sm" data-set="${k}">${p[k] ? 'Change' : 'Add'}</button>${p[k] ? `<button class="btn btn-sm btn-ghost" data-del="${k}" aria-label="Remove">${K.ic('x', 'sm')}</button>` : ''}</div>`).join('');
      sp.body.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => openSearch({ saveAs: b.dataset.set, onSaved: draw }));
      sp.body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        try { S.user = (await K.api('/me', { savedPlaces: { [b.dataset.del]: null } }, 'PATCH')).user; draw(); } catch (e) { K.toast(e.message); }
      });
    };
    draw();
  }

  async function openWallet(after) {
    const m = K.modal(`<h2>Kwata Wallet</h2><p class="money">${K.ugx(S.user.walletBalance)}</p>${K.skeleton('list', 3)}`);
    let w; try { w = await K.api('/wallet'); } catch (e) { K.$('.sk-card', m.el) && (m.el.querySelectorAll('.sk-card').forEach((x) => x.remove())); return; }
    if (!m.el.isConnected) return;
    m.el.innerHTML = `
      <h2>Kwata Wallet</h2>
      <p class="money">${K.ugx(w.balance)}</p>
      <p class="small muted">Top up once with Mobile Money and pay for trips in one tap.</p>
      <div class="chips">${[10000, 20000, 50000, 100000].map((a) => `<button class="chip" data-amt="${a}">${K.ugx(a)}</button>`).join('')}</div>
      <label for="amt">Amount</label><input id="amt" type="number" inputmode="numeric" min="1000" step="500" value="20000">
      <div class="row" style="margin-top:12px"><button class="btn btn-primary fill" data-m="momo">MTN / Airtel</button><button class="btn fill" data-m="card">${K.ic('card', 'sm')} Card</button></div>
      ${S.config.paymentsLive ? '' : '<p class="tiny faint" style="margin-top:8px">Test mode: top-ups are added instantly without charging you.</p>'}
      <p class="error" id="err"></p>
      ${w.transactions.length ? `<h3>History</h3>${w.transactions.map((x) => `<div class="tx"><span>${K.esc(x.note || x.type)}<br><span class="tiny faint">${K.when(x.created_at)}</span></span><span class="${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${K.ugx(x.amount)}</span></div>`).join('')}` : ''}`;
    m.el.querySelectorAll('[data-amt]').forEach((b) => b.onclick = () => { K.$('#amt', m.el).value = b.dataset.amt; });
    m.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const out = await K.api('/wallet/topup', { amount: +K.$('#amt', m.el).value, method: b.dataset.m });
        if (out.link) { location.href = out.link; return; }
        S.user.walletBalance = out.balance; K.toast('Wallet topped up'); m.close();
        after && after();
        if (S.view === 'choose') render();
      } catch (e) { K.$('#err', m.el).textContent = e.message; b.disabled = false; }
    });
  }

  function openEmergency(after) {
    const m = K.modal(`<h2>Emergency contact</h2>
      <p class="muted small">If you press SOS during a trip, we’ll help you alert this person with your live location.</p>
      <label for="ec">Phone number</label><input id="ec" type="tel" placeholder="0772 123456" value="${K.esc(prettyPhone(S.user.emergencyContact || ''))}">
      <p class="error" id="err"></p>
      <button class="btn btn-primary btn-block btn-lg" id="save">Save</button>`);
    K.$('#save', m.el).onclick = async () => {
      try {
        const out = await K.api('/me', { emergencyContact: K.$('#ec', m.el).value }, 'PATCH');
        S.user = out.user; K.toast('Emergency contact saved'); m.close();
        after && after();
      } catch (e) { K.$('#err', m.el).textContent = e.message; }
    };
  }
})();
