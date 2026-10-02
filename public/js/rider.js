// Kwata rider app — Uber-style flow:
// Home ("Where to?") → Search → Choose a ride → Confirm pickup → Matching → Live trip → Rate
(function () {
  const root = document.getElementById('root');
  const S = {
    view: 'home', pickup: null, drop: null, route: null, quote: null, gps: null,
    service: localStorage.getItem('kwata_service') || 'boda', payment: localStorage.getItem('kwata_pay') || 'cash',
    trip: null, user: null, config: null, recent: [], parcel: null, rating: 0, unread: 0, chatOpen: false, messages: [],
  };
  let map, sock, sheet, routeLayer, labels = [], driverMarker, meMarker, radarMarker, nearby = new Map(), revTimer, phaseKm = null, routedPhase = null;

  const params = new URLSearchParams(location.search);
  if (params.get('payment')) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => K.toast(params.get('payment') === 'success' ? 'Payment received' : 'Payment was not completed. Try again from your trip.'), 600);
  }

  if (!K.token()) K.authScreen(root, { role: 'rider', onDone: start });
  else start();

  async function start() {
    root.innerHTML = `
      <div class="app" id="app">
        <div id="map" aria-label="Map"></div>
        <div class="center-pin hidden" id="cpin" aria-hidden="true"><div class="head"></div><div class="stem"></div><div class="shadow"></div></div>
        <div class="topbar" id="topbar">
          <button class="btn icon-btn fab" id="backBtn" aria-label="Back" style="visibility:hidden">${K.ic('back')}</button>
          <span></span>
          <button class="btn icon-btn fab" id="locBtn" aria-label="Go to my location">${K.ic('locate')}</button>
        </div>
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
    map.on('movestart', () => K.$('#cpin').classList.add('lift'));
    map.on('moveend', () => { K.$('#cpin').classList.remove('lift'); onPinMove(); });
    K.$('#locBtn').onclick = () => locate(true);
    K.$('#backBtn').onclick = goBack;
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => openTab(b.dataset.tab));

    try {
      const [me, config, active, hist] = await Promise.all([K.api('/me'), K.api('/config'), K.api('/trips/active'), K.api('/trips/history').catch(() => [])]);
      S.user = me.user; S.config = config;
      buildRecent(hist);
      sock = K.socket(K.token());
      sock.on('trip:update', onTrip);
      sock.on('driver:location', (p) => { if (S.trip && p.tripId === S.trip.id) moveDriver(p); });
      sock.on('toast', (m) => K.toast(m.text));
      sock.on('chat:message', onChat);
      sock.on('connect', async () => { const a = await K.api('/trips/active').catch(() => null); if (a) onTrip(a); });
      if (active) onTrip(active); else {
        locate(false); render();
        let q = null; try { q = sessionStorage.getItem('kwata_q'); sessionStorage.removeItem('kwata_q'); } catch {}
        if (q) openSearch({ query: q });
      }
      setInterval(loadNearby, 8000);
    } catch (e) { sheet.innerHTML = `<p class="error">${K.esc(e.message)}</p><button class="btn btn-block" onclick="location.reload()">Try again</button>`; }
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
      if (S.view === 'home' || userAsked) map.setView(ll, 16);
      if (S.view === 'home' || !S.pickup) setPickup(S.gps.lat, S.gps.lng, 'Current location');
    }, () => { if (userAsked) K.toast('Turn on location so drivers can find you'); fallback(); }, { enableHighAccuracy: true, timeout: 10000 });
  }

  function setPickup(lat, lng, label) {
    S.pickup = { lat, lng, address: label || 'Finding address…' };
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      const addr = await K.reverse(lat, lng);
      if (S.pickup && S.pickup.lat === lat) {
        S.pickup.address = label === 'Current location' ? addr : addr;
        S.pickup.short = label;
        const el = K.$('#pickLabel'); if (el) el.textContent = addr;
      }
    }, 450);
    loadNearby();
  }

  function onPinMove() {
    const c = map.getCenter();
    if (S.view === 'pickup') {
      S.pickup = { lat: c.lat, lng: c.lng, address: 'Finding address…' };
      const el = K.$('#pinAddr'); if (el) el.textContent = 'Finding address…';
      clearTimeout(revTimer);
      revTimer = setTimeout(async () => { const a = await K.reverse(c.lat, c.lng); if (S.pickup.lat === c.lat) { S.pickup.address = a; const e2 = K.$('#pinAddr'); if (e2) e2.textContent = a; } }, 450);
    } else if (S.view === 'droppin') {
      S.pinDrop = { lat: c.lat, lng: c.lng, name: 'Pinned location' };
      const el = K.$('#pinAddr'); if (el) el.textContent = 'Finding address…';
      clearTimeout(revTimer);
      revTimer = setTimeout(async () => { const a = await K.reverse(c.lat, c.lng); if (S.pinDrop && S.pinDrop.lat === c.lat) { S.pinDrop.name = a; const e2 = K.$('#pinAddr'); if (e2) e2.textContent = a; } }, 450);
    }
  }

  async function loadNearby() {
    if (!['home', 'choose', 'pickup'].includes(S.view) || !S.pickup) { clearNearby(); return; }
    try {
      const list = await K.api(`/drivers/nearby?lat=${S.pickup.lat}&lng=${S.pickup.lng}`);
      const keep = new Set();
      list.forEach((d) => {
        keep.add(d.k);
        if (nearby.has(d.k)) nearby.get(d.k).moveTo(d.lat, d.lng, d.heading);
        else nearby.set(d.k, K.vehicle(map, d, d.vehicle === 'car' ? 'car' : 'boda', d.heading || Math.random() * 360));
      });
      for (const [k, m] of nearby) if (!keep.has(k)) { map.removeLayer(m); nearby.delete(k); }
    } catch {}
  }
  function clearNearby() { for (const m of nearby.values()) map.removeLayer(m); nearby.clear(); }

  // ---------- render ----------
  function render() {
    const v = S.view;
    K.$('#cpin').classList.toggle('hidden', !['pickup', 'droppin'].includes(v));
    K.$('#tabs').classList.toggle('hidden', v !== 'home');
    sheet.style.bottom = v === 'home' ? (K.$('#tabs').offsetHeight || 58) + 'px' : '';
    K.$('#backBtn').style.visibility = ['choose', 'pickup', 'droppin'].includes(v) ? 'visible' : 'hidden';
    sheet.classList.remove('sheet-enter'); void sheet.offsetWidth; sheet.classList.add('sheet-enter');
    ({ home: vHome, choose: vChoose, pickup: vPickup, droppin: vDropPin, searching: vSearching, trip: vTrip, done: vDone, none: vNone })[v]();
  }

  function goBack() {
    if (S.view === 'pickup') { S.view = 'choose'; showRoute(); render(); }
    else if (S.view === 'droppin') { S.view = 'home'; render(); openSearch(); }
    else reset();
  }

  function vHome() {
    clearRoute();
    const sp = S.user.savedPlaces || {};
    const tiles = S.config.services.map((s) => `<button class="tile" data-svc="${s.id}">${K.artFor(s.id, s.vehicle)}${K.esc(K.SERVICE_LABEL[s.id] || s.name)}</button>`).join('');
    sheet.innerHTML = `
      <div class="grabber"></div>
      <button class="whereto" id="whereBtn">${K.ic('search')}<span>Where to?</span></button>
      <div style="margin-top:6px">
        ${placeRow('home', sp.home)}
        ${placeRow('work', sp.work)}
        ${S.recent.map((r, i) => `<button class="lrow" data-recent="${i}"><span class="ic">${K.ic('clock')}</span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(r.name)}</span><span class="s">${K.esc(r.address)}</span></span></button>`).join('')}
      </div>
      <h3 style="margin:16px 0 10px">Suggestions</h3>
      <div class="tiles" style="grid-template-columns:repeat(${Math.min(5, S.config.services.length)},1fr)">${tiles}</div>`;
    K.$('#whereBtn').onclick = () => openSearch();
    sheet.querySelectorAll('[data-place]').forEach((b) => b.onclick = () => {
      const key = b.dataset.place, p = (S.user.savedPlaces || {})[key];
      if (p) chooseDrop({ name: key === 'home' ? 'Home' : 'Work', address: p.address, lat: p.lat, lng: p.lng });
      else openSearch({ saveAs: key });
    });
    sheet.querySelectorAll('[data-recent]').forEach((b) => b.onclick = () => chooseDrop(S.recent[+b.dataset.recent]));
    sheet.querySelectorAll('[data-svc]').forEach((b) => b.onclick = () => { setService(b.dataset.svc); openSearch(b.dataset.svc === 'airport' ? { preset: K.PLACES[0] } : {}); });
  }
  function placeRow(key, p) {
    const label = key === 'home' ? 'Home' : 'Work';
    return `<button class="lrow" data-place="${key}"><span class="ic">${K.ic(key === 'home' ? 'home' : 'work')}</span>
      <span class="grow"><span class="t">${label}</span><span class="s ellipsis" style="display:block">${p ? K.esc(p.address) : 'Add ' + label.toLowerCase() + ' address'}</span></span>${K.ic('chev', 'sm')}</button>`;
  }
  function setService(id) { S.service = id; try { localStorage.setItem('kwata_service', id); } catch {} }

  // ---------- full-screen search ----------
  let searchTimer;
  function openSearch(opts = {}) {
    if (opts.preset) { chooseDrop(opts.preset); return; }
    const saveAs = opts.saveAs;
    const page = document.createElement('div');
    page.className = 'page page-enter';
    page.style.zIndex = 870;
    page.innerHTML = `<div class="page-inner">
      <div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Close">${K.ic('back')}</button>
        <h3 style="margin:0">${saveAs ? 'Set ' + saveAs + ' address' : 'Plan your ride'}</h3></div>
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
    const close = () => page.remove();
    K.$('[data-x]', page).onclick = close;

    const rows = (items, heading, iconFn) => (heading ? `<p class="tiny faint bold" style="margin:14px 2px 2px">${heading}</p>` : '') +
      items.map((p, i) => `<button class="lrow" data-i="${i}"><span class="ic">${K.ic(iconFn ? iconFn(p) : 'pin')}</span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(p.name)}</span><span class="s ellipsis" style="display:block">${K.esc(p.address || '')}</span></span>${S.pickup && p.lat ? `<span class="tiny faint">${K.km(S.pickup, p).toFixed(1)} km</span>` : ''}</button>`).join('');
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
      res.innerHTML = rows(current, null, (p) => p._ic) +
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
          S.user = out.user; K.toast(`${saveAs === 'home' ? 'Home' : 'Work'} saved`); close(); render();
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
    sheet.style.bottom = '';
    sheet.innerHTML = `<div class="grabber"></div><h2>Choose a ride</h2><div class="progress indet"><i></i></div>`;
    K.$('#backBtn').style.visibility = 'visible';
    S.route = await K.route(S.pickup, S.drop);
    try {
      S.quote = await K.api('/fare/estimate', { pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.min });
      if (!S.quote.options.find((o) => o.id === S.service)) setService(S.quote.options[0].id);
      showRoute();
      render();
    } catch (e) { sheet.innerHTML = `<p class="error">${K.esc(e.message)}</p><button class="btn btn-block" id="b">Back</button>`; K.$('#b').onclick = reset; }
  }

  function showRoute() {
    clearRoute();
    routeLayer = K.drawRoute(map, S.route.coords);
    const etaPick = (S.quote && (S.quote.options.find((o) => o.id === S.service) || {}).etaMin) || null;
    labels.push(L.marker(S.route.coords[0], { icon: K.divIcon('<div class="pin-ci"></div>', [16, 16]) }).addTo(map));
    labels.push(L.marker(S.route.coords[S.route.coords.length - 1], { icon: K.divIcon('<div class="pin-sq"></div>', [16, 16]) }).addTo(map));
    labels.push(L.marker(S.route.coords[0], { icon: K.label(`${etaPick ? `<b>${etaPick}<br>min</b>` : ''}<span>${K.esc(shorten(S.pickup.short || S.pickup.address))}</span>`), interactive: false }).addTo(map));
    labels.push(L.marker(S.route.coords[S.route.coords.length - 1], { icon: K.label(`<span>${K.esc(shorten(S.drop.address))}</span>`), interactive: false }).addTo(map));
    fit(routeLayer.bounds());
  }
  const shorten = (s) => String(s || '').split(',')[0].slice(0, 26);
  function fit(bounds) {
    const pad = window.innerWidth >= 760 ? { paddingTopLeft: [460, 90], paddingBottomRight: [60, 60] } : { paddingTopLeft: [40, 90], paddingBottomRight: [40, sheet.offsetHeight + 30] };
    map.fitBounds(bounds, { ...pad, maxZoom: 16 });
  }
  function clearRoute() {
    if (routeLayer) routeLayer.remove(); routeLayer = null;
    labels.forEach((l) => map.removeLayer(l)); labels = [];
  }

  function vChoose() {
    const q = S.quote;
    const sel = q.options.find((o) => o.id === S.service);
    const etas = q.options.map((o) => o.etaMin).filter((x) => x != null);
    const fastest = etas.length ? Math.min(...etas) : null;
    const uniqueFastest = etas.filter((x) => x === fastest).length === 1;
    const arrive = (o) => K.clock((o.etaMin || 0) + q.durationMin);
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2 style="text-align:center;font-size:1.25rem;margin-bottom:10px">Choose a ride</h2>
      <div class="opts" role="radiogroup" aria-label="Ride type">
      ${q.options.map((o) => `
        <button class="opt" data-s="${o.id}" aria-pressed="${o.id === S.service}">
          <span class="art">${K.artFor(o.id, o.vehicle)}</span>
          <span class="grow">
            <span class="name">${K.esc(o.name.replace('Kwata ', ''))} ${o.seats ? `<span class="seats">${K.ic('person', 'sm')}${o.seats}</span>` : ''} ${uniqueFastest && o.etaMin === fastest ? '<span class="badge-fast">Fastest</span>' : ''}</span>
            <span class="meta">${o.etaMin != null ? `${arrive(o)} · ${o.etaMin} min away` : K.esc(o.blurb)}</span>
            ${o.surge > 1 ? `<span class="surge">Busy right now · fares are higher</span>` : ''}
          </span>
          <span class="price">${K.ugx(o.fare)}</span>
        </button>`).join('')}
      </div>
      ${S.service === 'parcel' ? `<button class="payrow" id="parcelRow">${K.ic('gift')}<span class="grow">${S.parcel ? `Package for ${K.esc(S.parcel.recipientName)}` : 'Add delivery details'}</span>${K.ic('chev', 'sm')}</button>` : ''}
      <button class="payrow" id="payRow">${K.ic(K.PAY_ICON[S.payment])}<span class="grow">${K.PAY_LABEL[S.payment]}${S.payment === 'wallet' ? ` · ${K.ugx(S.user.walletBalance)}` : ''}</span>${K.ic('chev', 'sm')}</button>
      <button class="btn btn-primary btn-block btn-lg" id="choose">Choose ${K.esc(sel.name.replace('Kwata ', ''))}</button>`;
    sheet.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
      if (b.dataset.s === S.service) { K.$('#choose').click(); return; }
      setService(b.dataset.s); showRoute(); render();
    });
    K.$('#payRow').onclick = openPayment;
    const pr = K.$('#parcelRow'); if (pr) pr.onclick = openParcel;
    K.$('#choose').onclick = () => {
      if (S.service === 'parcel' && !S.parcel) { openParcel(); return; }
      if (S.payment === 'wallet' && S.user.walletBalance < sel.fare) { K.toast('Not enough in your wallet. Top up or pick another way to pay.'); openPayment(); return; }
      S.view = 'pickup'; clearRoute(); map.setView([S.pickup.lat, S.pickup.lng], 18); render();
    };
  }

  function openPayment() {
    const opts = ['cash', 'momo', 'wallet', 'card'];
    const m = K.modal(`<h2>Payment</h2>
      ${opts.map((p) => `<button class="lrow" data-p="${p}"><span class="ic">${K.ic(K.PAY_ICON[p])}</span><span class="grow"><span class="t">${K.PAY_LABEL[p]}</span>
        <span class="s" style="display:block">${{ cash: 'Pay your driver at the end', momo: 'MTN or Airtel, prompt at the end', wallet: 'Balance ' + K.ugx(S.user.walletBalance), card: 'Visa or Mastercard' }[p]}</span></span>
        ${S.payment === p ? K.ic('check') : ''}</button>`).join('')}
      <button class="btn btn-block" style="margin-top:12px" id="topup">${K.ic('plus')} Add money to wallet</button>`);
    m.el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { S.payment = b.dataset.p; try { localStorage.setItem('kwata_pay', S.payment); } catch {} m.close(); render(); });
    K.$('#topup', m.el).onclick = () => { m.close(); openWallet(); };
  }

  function openParcel() {
    const p = S.parcel || {};
    const m = K.modal(`<h2>Delivery details</h2><p class="muted small">Your driver will call the recipient on arrival.</p>
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
      <h2 style="text-align:center;font-size:1.25rem">Confirm your pickup spot</h2>
      <p class="small muted" style="text-align:center">Drag the map to move the pin</p>
      <div class="lrow" style="cursor:default"><span class="ic">${K.ic('pin')}</span><span class="grow"><span class="t ellipsis" id="pinAddr" style="display:block">${K.esc(S.pickup.address)}</span></span></div>
      <p class="error" id="err"></p>
      <button class="btn btn-primary btn-block btn-lg" id="confirm">Confirm pickup</button>`;
    K.$('#confirm').onclick = book;
  }

  function vDropPin() {
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2 style="text-align:center;font-size:1.25rem">Set your destination</h2>
      <div class="lrow" style="cursor:default"><span class="ic">${K.ic('flag')}</span><span class="grow"><span class="t ellipsis" id="pinAddr" style="display:block">Move the map to your destination</span></span></div>
      <button class="btn btn-primary btn-block btn-lg" id="confirm" style="margin-top:8px">Confirm destination</button>`;
    onPinMove();
    K.$('#confirm').onclick = () => { if (S.pinDrop) chooseDrop(S.pinDrop); };
  }

  async function book() {
    const btn = K.$('#confirm'), err = K.$('#err');
    btn.disabled = true; err.textContent = '';
    if (S.pickup.address === 'Finding address…') S.pickup.address = 'Pinned location';
    const body = { service: S.service, paymentMethod: S.payment, pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.min };
    if (S.service === 'parcel') body.parcel = S.parcel;
    try { onTrip(await K.api('/trips', body)); }
    catch (e) { err.textContent = e.message; btn.disabled = false; }
  }

  function vSearching() {
    const t = S.trip;
    clearNearby();
    if (!radarMarker) radarMarker = L.marker([t.pickup.lat, t.pickup.lng], { icon: K.divIcon('<div class="radar"></div>', [160, 160]), interactive: false }).addTo(map);
    map.setView([t.pickup.lat, t.pickup.lng], 16);
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2 style="font-size:1.3rem">Connecting you to a driver</h2>
      <div class="progress indet"><i></i></div>
      <div class="row" style="margin-bottom:6px"><span class="opt" style="padding:0;width:auto"><span class="art">${K.artFor(t.service)}</span></span>
        <span class="grow"><b>${K.esc((S.config.services.find((s) => s.id === t.service) || {}).name || '')}</b><br><span class="small muted">${K.ugx(t.fare)} · ${K.PAY_LABEL[t.paymentMethod]}</span></span></div>
      ${tripStops(t)}
      <button class="btn btn-block" id="cancel" style="margin-top:10px">Cancel request</button>`;
    K.$('#cancel').onclick = cancelTrip;
  }

  const tripStops = (t) => `<div class="trip-list">
      <div class="lrow" style="cursor:default"><span class="ic"><span class="rb-dot"></span></span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(t.pickup.address)}</span><span class="s">Pickup</span></span></div>
      <div class="lrow" style="cursor:default"><span class="ic"><span class="rb-sq"></span></span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(t.drop.address)}</span><span class="s">Drop-off</span></span></div></div>`;

  function vNone() {
    removeRadar();
    sheet.innerHTML = `<div class="grabber"></div><h2>No drivers available</h2>
      <p class="muted">Every nearby driver is busy right now. Try again in a minute or choose another ride type.</p>
      <div class="row" style="margin-top:12px"><button class="btn fill" id="home">Back</button><button class="btn btn-primary fill" id="again">Try again</button></div>`;
    K.$('#home').onclick = reset;
    K.$('#again').onclick = () => { S.view = 'choose'; showRoute(); render(); };
  }

  function vTrip() {
    const t = S.trip, d = t.driver;
    removeRadar(); clearNearby();
    const toPickup = t.status !== 'in_progress';
    const loc = d.location;
    const target = toPickup ? t.pickup : t.drop;
    const mins = loc ? K.etaMin(loc, target) : null;
    let head, sub;
    if (t.status === 'accepted') { head = mins ? `Pickup in ${mins} min` : 'Driver is on the way'; sub = `Meet ${K.first(d.name)} at the pickup spot`; }
    else if (t.status === 'arrived') { head = 'Your driver has arrived'; sub = `Meet ${K.first(d.name)} now · ${K.esc(d.plate)}`; }
    else { head = `Heading to ${shorten(t.drop.address)}`; sub = mins ? `Arrive around ${K.clock(mins)}` : 'Enjoy the ride'; }
    const pct = phaseKm && loc ? Math.max(5, Math.min(100, 100 - (K.km(loc, target) / phaseKm) * 100)) : 8;
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="row"><div class="grow"><div class="eta-big" id="etaHead">${K.esc(head)}</div><div class="small muted" id="etaSub">${sub}</div></div>
        ${mins && t.status !== 'arrived' ? `<div class="eta-chip" id="etaChip">${mins}<small>min</small></div>` : ''}</div>
      <div class="progress"><i id="etaBar" style="width:${t.status === 'arrived' ? 100 : pct}%"></i></div>
      ${toPickup ? `<div class="pin-box"><span><b>Your PIN</b><br><span class="small muted">Share it with your driver to start</span></span><span class="pin">${t.pin}</span></div>` : ''}
      <div class="driver-block">
        <span class="car-art">${K.artFor(t.service, d.vehicleType)}</span>
        <span class="grow"><span class="plate" style="display:block">${K.esc(d.plate)}</span><span class="small muted">${K.esc(d.vehicle || K.SERVICE_LABEL[t.service])}</span></span>
        <span style="text-align:center"><span class="avatar">${K.initials(d.name)}<span class="star">★ ${d.rating || 'New'}</span></span><span class="tiny bold" style="display:block;margin-top:10px">${K.esc(K.first(d.name))}</span></span>
      </div>
      <div class="row">
        <button class="msg-pill" id="chatBtn">${K.ic('msg', 'sm')} Send a message…</button>
        ${d.phone ? `<a class="round" href="tel:${K.esc(d.phone)}" aria-label="Call driver">${K.ic('phone')}</a>` : ''}
      </div>
      <div class="trip-list" style="margin-top:12px">
        <button class="lrow" id="safety"><span class="ic shield">${K.ic('shield')}</span><span class="grow"><span class="t">Safety</span><span class="s" style="display:block">Share trip, emergency help</span></span>${K.ic('chev', 'sm')}</button>
        <button class="lrow" id="share"><span class="ic">${K.ic('share')}</span><span class="grow"><span class="t">Share trip status</span></span>${K.ic('chev', 'sm')}</button>
        <div class="lrow" style="cursor:default"><span class="ic"><span class="rb-sq"></span></span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(t.drop.address)}</span><span class="s">Drop-off</span></span></div>
        <div class="lrow" style="cursor:default"><span class="ic">${K.ic(K.PAY_ICON[t.paymentMethod])}</span><span class="grow"><span class="t">${K.ugx(t.fare)}</span><span class="s" style="display:block">${K.PAY_LABEL[t.paymentMethod]}</span></span></div>
        ${toPickup ? `<button class="lrow" id="cancel"><span class="ic">${K.ic('x')}</span><span class="t" style="color:var(--stop)">Cancel ride</span></button>` : ''}
      </div>`;
    K.$('#chatBtn').onclick = openChat;
    K.$('#safety').onclick = openSafetySheet;
    K.$('#share').onclick = () => K.share(location.origin + '/t/' + t.shareToken, `Follow my Kwata ride live: ${d.name}, ${d.plate}`);
    const c = K.$('#cancel'); if (c) c.onclick = cancelTrip;
    updateUnread();
    // route for this phase
    const phase = t.status === 'in_progress' ? 'drop' : 'pickup';
    if (routedPhase !== phase + t.id) {
      routedPhase = phase + t.id;
      clearRoute();
      const from = loc || (phase === 'drop' ? t.pickup : null);
      phaseKm = from ? Math.max(0.2, K.km(from, target)) : null;
      if (from) K.route(from, target).then((r) => {
        if (routedPhase !== phase + t.id) return;
        routeLayer = K.drawRoute(map, r.coords);
        labels.push(L.marker([target.lat, target.lng], { icon: K.divIcon(phase === 'drop' ? '<div class="pin-sq"></div>' : '<div class="pin-ci"></div>', [16, 16]) }).addTo(map));
        fit(routeLayer.bounds());
      });
      else map.setView([target.lat, target.lng], 16);
    }
    if (loc) moveDriver(loc, true);
  }

  function vDone() {
    const t = S.trip, d = t.driver || {};
    removeRadar(); clearRoute(); routedPhase = null;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    const needsPay = t.paymentStatus === 'pending' && ['momo', 'card'].includes(t.paymentMethod);
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2>${t.service === 'parcel' ? 'Your parcel was delivered' : 'You’ve arrived'}</h2>
      <p class="muted small">${K.esc(t.drop.address)}</p>
      <div class="row" style="align-items:baseline;margin:14px 0 2px"><span class="grow bold">Total</span><span class="money">${K.ugx(t.fare)}</span></div>
      <p class="small muted">${t.paymentMethod === 'cash' ? 'Pay your driver in cash.' : needsPay ? `Pay with ${K.PAY_LABEL[t.paymentMethod]} to finish.` : `Paid with ${K.PAY_LABEL[t.paymentMethod]}`}</p>
      ${needsPay ? `<button class="btn btn-gold btn-block btn-lg" id="pay">Pay ${K.ugx(t.fare)}</button><p class="error" id="err"></p>` : ''}
      ${!t.riderRated ? `
        <div style="text-align:center;margin-top:18px"><span class="avatar" style="margin:0 auto">${K.initials(d.name)}</span>
        <h3 style="margin-top:10px">How was your trip with ${K.esc(K.first(d.name))}?</h3></div>
        <div class="stars" role="radiogroup" aria-label="Rate your driver">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}" class="${n <= S.rating ? 'on' : ''}">${K.starSvg}</button>`).join('')}</div>
        <button class="btn btn-primary btn-block btn-lg" id="rate" ${S.rating ? '' : 'disabled'}>Done</button>
        ${!needsPay ? '<button class="btn btn-ghost btn-block" id="skip" style="margin-top:6px">Skip</button>' : ''}` : (!needsPay ? '<button class="btn btn-primary btn-block btn-lg" id="done">Done</button>' : '')}`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { S.rating = +b.dataset.n; render(); });
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
    ['done', 'skip'].forEach((id) => { const b = K.$('#' + id); if (b) b.onclick = reset; });
  }

  // ---------- trip events ----------
  function onTrip(t) {
    if (!t) return;
    if (S.trip && t.id < S.trip.id) return;
    const prev = S.trip && S.trip.status;
    S.trip = t;
    if (t.status === 'requested') S.view = 'searching';
    else if (['accepted', 'arrived', 'in_progress'].includes(t.status)) S.view = 'trip';
    else if (t.status === 'completed') S.view = 'done';
    else if (t.status === 'no_drivers') S.view = 'none';
    else if (t.status === 'cancelled') { if (t.cancelledBy === 'rider') { reset(); return; } S.view = 'none'; }
    if (prev !== t.status) {
      if (t.status === 'accepted') { K.toast(`${K.first(t.driver.name)} is on the way`); vibrate(); loadMessages(); }
      if (t.status === 'arrived') vibrate();
    }
    S.pickup = t.pickup; S.drop = t.drop;
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
    const chip = K.$('#etaChip'); if (chip) chip.innerHTML = `${mins}<small>min</small>`;
    const head = K.$('#etaHead');
    if (head && t.status === 'accepted') head.textContent = `Pickup in ${mins} min`;
    if (head && t.status === 'in_progress') { const sub = K.$('#etaSub'); if (sub) sub.textContent = `Arrive around ${K.clock(mins)}`; }
    const bar = K.$('#etaBar'); if (bar && phaseKm) bar.style.width = Math.max(5, Math.min(100, 100 - (K.km(p, target) / phaseKm) * 100)) + '%';
  }

  function removeRadar() { if (radarMarker) { map.removeLayer(radarMarker); radarMarker = null; } }

  async function cancelTrip() {
    const m = K.modal(`<h2>Cancel your ride?</h2><p class="muted">${S.trip.driver ? `${K.esc(K.first(S.trip.driver.name))} is already on the way.` : 'We’re still finding you a driver.'}</p>
      <button class="btn btn-danger btn-block btn-lg" id="yes">Cancel ride</button><button class="btn btn-block" style="margin-top:8px" data-close>Keep my ride</button>`);
    K.$('#yes', m.el).onclick = async () => {
      try { await K.api(`/trips/${S.trip.id}/cancel`, { reason: 'rider' }); m.close(); reset(); } catch (e) { K.toast(e.message); }
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
  function updateUnread() { const b = K.$('#chatBtn'); if (b) b.innerHTML = `${K.ic('msg', 'sm')} ${S.unread ? `<b style="color:var(--ink)">${S.unread} new message${S.unread > 1 ? 's' : ''}</b>` : 'Send a message…'}`; }
  function openChat() {
    S.chatOpen = true; S.unread = 0;
    const d = S.trip.driver;
    const page = document.createElement('div');
    page.className = 'page page-enter'; page.id = 'chatPage'; page.style.zIndex = 870;
    page.style.paddingBottom = 'calc(12px + env(safe-area-inset-bottom))';
    page.innerHTML = `<div class="page-inner chat">
      <div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Close chat">${K.ic('back')}</button>
        <span class="grow"><b>${K.esc(d.name)}</b><br><span class="small muted">${K.esc(d.plate)}</span></span>
        ${d.phone ? `<a class="round" href="tel:${K.esc(d.phone)}" aria-label="Call">${K.ic('phone')}</a>` : ''}</div>
      <div class="chat-log" id="log"></div>
      <div class="quick">${['I’m on my way', 'I’m at the pickup spot', 'Please call me', 'Okay, thanks'].map((q) => `<button data-q="${q}">${q}</button>`).join('')}</div>
      <form class="chat-input" id="cf"><input id="ci" placeholder="Message ${K.esc(K.first(d.name))}" autocomplete="off" aria-label="Message"><button class="btn btn-primary icon-btn" aria-label="Send">${K.ic('send')}</button></form></div>`;
    root.querySelector('#app').appendChild(page);
    const send = (text) => sock.emit('chat:send', { tripId: S.trip.id, text }, (r) => { if (!r.ok) K.toast(r.error || 'Message not sent'); });
    K.$('[data-x]', page).onclick = () => { page.remove(); S.chatOpen = false; updateUnread(); };
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
  function openSafetySheet() {
    const t = S.trip;
    const m = K.modal(`<h2>Safety</h2>
      <button class="lrow" id="s-share"><span class="ic shield">${K.ic('share')}</span><span class="grow"><span class="t">Share trip status</span><span class="s" style="display:block">Family can follow your ride live</span></span></button>
      <button class="lrow" id="s-ec"><span class="ic shield">${K.ic('person')}</span><span class="grow"><span class="t">Emergency contact</span><span class="s" style="display:block">${S.user.emergencyContact ? K.esc(S.user.emergencyContact) : 'Add someone we can alert'}</span></span></button>
      <div class="card small" style="margin:12px 0">Your PIN makes sure you get into the right vehicle. Check the plate <b>${K.esc(t.driver.plate)}</b> before you board.</div>
      <button class="btn btn-danger btn-block btn-lg" id="s-sos">${K.ic('sos')} Emergency assistance</button>`);
    K.$('#s-share', m.el).onclick = () => K.share(location.origin + '/t/' + t.shareToken, 'Follow my Kwata ride live');
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
          ${out.emergencyContact ? `<a class="btn btn-block" style="margin-top:8px" href="sms:${out.emergencyContact}?body=${encodeURIComponent('I need help. Follow my Kwata ride: ' + link)}">Text my emergency contact</a>` : ''}
          <button class="btn btn-block" style="margin-top:8px" id="sh">Share my live location</button>
          <button class="btn btn-ghost btn-block" data-close>Close</button>`);
        K.$('#sh', m.el).onclick = () => K.share(link, 'I need help. Follow my Kwata ride live');
      } catch (e) { K.toast(e.message); }
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => send(p.coords.latitude, p.coords.longitude), () => send(), { timeout: 5000 });
    else send();
  }

  function reset() {
    S.view = 'home'; S.drop = null; S.quote = null; S.route = null; S.trip = null; S.rating = 0; S.parcel = null;
    S.messages = []; S.unread = 0; routedPhase = null; phaseKm = null;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    removeRadar(); clearRoute();
    K.api('/me').then((m) => { S.user = m.user; }).catch(() => {});
    K.api('/trips/history').then((h) => { buildRecent(h); if (S.view === 'home') render(); }).catch(() => {});
    if (S.gps) { S.pickup = { ...S.gps, address: 'Current location', short: 'Current location' }; map.setView([S.gps.lat, S.gps.lng], 16); }
    else if (S.pickup) map.setView([S.pickup.lat, S.pickup.lng], 16);
    render();
  }

  // ---------- tabs: activity & account ----------
  function openTab(tab) {
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    document.querySelectorAll('.page[data-tabpage]').forEach((p) => p.remove());
    if (tab === 'home') return;
    const page = document.createElement('div');
    page.className = 'page'; page.dataset.tabpage = tab;
    page.innerHTML = '<div class="page-inner"><p class="muted">Loading…</p></div>';
    root.querySelector('#app').insertBefore(page, K.$('#tabs'));
    (tab === 'activity' ? drawActivity : drawAccount)(page.firstElementChild);
  }

  async function drawActivity(el) {
    const list = await K.api('/trips/history');
    const st = (t) => ({ completed: '', cancelled: 'Cancelled', no_drivers: 'No driver found' }[t.status] ?? t.status.replace('_', ' '));
    el.innerHTML = `<div class="page-title">Activity</div>
      ${list.length ? list.map((t) => `<div class="lrow" style="cursor:default;align-items:flex-start">
        <span style="width:64px;flex:none">${K.artFor(t.service)}</span>
        <span class="grow"><span class="t ellipsis" style="display:block">${K.esc(t.drop.address)}</span>
          <span class="s">${K.when(t.createdAt)} · ${K.ugx(t.fare)}</span>${st(t) ? `<span class="s" style="display:block;color:var(--stop)">${st(t)}</span>` : ''}</span></div>`).join('')
      : `<div class="card" style="margin-top:12px"><h3>No trips yet</h3><p class="muted small">Your past rides and deliveries will show here.</p><button class="btn btn-primary" id="first">Book a ride</button></div>`}`;
    const f = K.$('#first', el); if (f) f.onclick = () => { openTab('home'); openSearch(); };
  }

  function drawAccount(el) {
    const u = S.user;
    el.innerHTML = `
      <div class="row" style="margin:6px 0 18px"><div class="grow"><div class="page-title" style="margin:0">${K.esc(u.name)}</div>
        <span class="chip" style="margin-top:8px;cursor:default">★ ${u.rating || 'New rider'}</span></div>
        <span class="avatar" style="width:64px;height:64px;font-size:1.3rem">${K.initials(u.name)}</span></div>
      <div class="tiles" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        <button class="tile" data-a="wallet" style="padding:16px 4px">${K.ic('wallet')}Wallet</button>
        <button class="tile" data-a="safety" style="padding:16px 4px">${K.ic('shield')}Safety</button>
        <button class="tile" data-a="activity" style="padding:16px 4px">${K.ic('receipt')}Activity</button>
      </div>
      <div class="card row" style="margin-bottom:8px"><span class="grow"><b>Kwata Wallet</b><br><span class="small muted">Pay for rides without cash</span></span><b>${K.ugx(u.walletBalance)}</b></div>
      <button class="menu-item" data-a="home">${K.ic('home')}<span class="grow">Home<br><span class="small muted">${u.savedPlaces && u.savedPlaces.home ? K.esc(u.savedPlaces.home.address) : 'Add home'}</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="work">${K.ic('work')}<span class="grow">Work<br><span class="small muted">${u.savedPlaces && u.savedPlaces.work ? K.esc(u.savedPlaces.work.address) : 'Add work'}</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="safety">${K.ic('person')}<span class="grow">Emergency contact<br><span class="small muted">${u.emergencyContact ? K.esc(u.emergencyContact) : 'Not set'}</span></span>${K.ic('chev', 'sm')}</button>
      <a class="menu-item" href="tel:${K.esc(S.config.supportPhone)}">${K.ic('help')}<span class="grow">Help</span>${K.ic('chev', 'sm')}</a>
      <a class="menu-item" href="/driver">${K.ic('bolt')}<span class="grow">Earn by driving or delivering</span>${K.ic('chev', 'sm')}</a>
      <button class="menu-item" data-a="out">${K.ic('logout')}<span class="grow">Sign out</span></button>`;
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'wallet') openWallet();
      else if (a === 'safety') openEmergency();
      else if (a === 'activity') openTab('activity');
      else if (a === 'home' || a === 'work') { openTab('home'); openSearch({ saveAs: a }); }
      else if (a === 'out') { K.session.clear(); location.reload(); }
    });
  }

  async function openWallet() {
    const m = K.modal('<p class="muted">Loading wallet…</p>');
    const w = await K.api('/wallet');
    m.el.innerHTML = `
      <h2>Kwata Wallet</h2>
      <p class="money">${K.ugx(w.balance)}</p>
      <p class="small muted">Top up with Mobile Money once, and every ride pays itself.</p>
      <div class="chips">${[10000, 20000, 50000, 100000].map((a) => `<button class="chip" data-amt="${a}">${K.ugx(a)}</button>`).join('')}</div>
      <label for="amt">Amount</label><input id="amt" type="number" inputmode="numeric" min="1000" step="500" value="20000">
      <div class="row" style="margin-top:12px"><button class="btn btn-primary fill" data-m="momo">${K.ic('momo')} MTN / Airtel</button><button class="btn fill" data-m="card">${K.ic('card')} Card</button></div>
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
        const acc = document.querySelector('.page[data-tabpage="account"] .page-inner'); if (acc) drawAccount(acc);
        if (S.view === 'choose') render();
      } catch (e) { K.$('#err', m.el).textContent = e.message; b.disabled = false; }
    });
  }

  function openEmergency() {
    const m = K.modal(`<h2>Emergency contact</h2>
      <p class="muted small">If you press SOS during a trip, we’ll help you alert this person with your live location.</p>
      <label for="ec">Phone number</label><input id="ec" type="tel" placeholder="0772 123456" value="${K.esc(S.user.emergencyContact || '')}">
      <p class="error" id="err"></p>
      <button class="btn btn-primary btn-block btn-lg" id="save">Save</button>`);
    K.$('#save', m.el).onclick = async () => {
      try {
        const out = await K.api('/me', { emergencyContact: K.$('#ec', m.el).value }, 'PATCH');
        S.user = out.user; K.toast('Emergency contact saved'); m.close();
        const acc = document.querySelector('.page[data-tabpage="account"] .page-inner'); if (acc) drawAccount(acc);
      } catch (e) { K.$('#err', m.el).textContent = e.message; }
    };
  }
})();
