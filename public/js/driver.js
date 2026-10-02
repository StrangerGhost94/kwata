// Kwata driver app — Uber-driver style: GO button, request card with countdown ring,
// navigation banner, slide-to-confirm actions, in-trip chat.
(function () {
  const root = document.getElementById('root');
  const S = { user: null, driver: null, online: false, offer: null, trip: null, loc: null, manual: false, earnings: null, rating: 0, config: null, messages: [], unread: 0, chatOpen: false };
  let map, sock, sheet, me, targetMarker, routeLayer, watchId, offerTimer, wakeLock, lastSent = 0, routedFor = null;

  if (!K.token()) K.authScreen(root, { role: 'driver', onDone: start });
  else start();

  async function start() {
    root.innerHTML = `
      <div class="app" id="app">
        <div id="map" aria-label="Map"></div>
        <div class="topbar">
          <button class="btn icon-btn fab" id="menuBtn" aria-label="Open menu">${K.ic('menu')}</button>
          <button class="pill-chip" id="earnPill" aria-label="Today's earnings"><span class="dot-live" id="liveDot"></span><span id="earnTxt">UGX 0</span></button>
          <button class="btn icon-btn fab" id="locBtn" aria-label="Centre on me">${K.ic('locate')}</button>
        </div>
        <div class="nav-banner hidden" id="navBanner"></div>
        <button class="go-btn hidden" id="goBtn" aria-label="Go online">GO</button>
        <section class="sheet" id="sheet" aria-live="polite"></section>
      </div>`;
    sheet = K.$('#sheet');
    K.draggableSheet(sheet);
    map = K.map('map');
    map.on('click', (e) => { if (S.manual) setLoc(e.latlng.lat, e.latlng.lng); });
    K.$('#menuBtn').onclick = openMenu;
    K.$('#earnPill').onclick = openEarnings;
    K.$('#locBtn').onclick = () => S.loc && map.setView([S.loc.lat, S.loc.lng], 16);
    K.$('#goBtn').onclick = () => setOnline(true);

    const [me0, config] = await Promise.all([K.api('/me'), K.api('/config')]);
    S.user = me0.user; S.driver = me0.driver; S.config = config;
    if (S.driver.status !== 'approved') { renderPending(); return; }

    sock = K.socket(K.token());
    sock.on('connect', async () => {
      if (S.online) sock.emit('driver:online', true, () => {});
      if (S.loc) sock.emit('driver:location', S.loc);
      const a = await K.api('/trips/active').catch(() => null);
      if (a) onTrip(a);
    });
    sock.on('trip:offer', onOffer);
    sock.on('trip:offer_expired', ({ id }) => { if (S.offer && S.offer.id === id) { S.offer = null; clearInterval(offerTimer); clearTarget(); render(); } });
    sock.on('trip:update', onTrip);
    sock.on('toast', (m) => K.toast(m.text));
    sock.on('chat:message', onChat);
    sock.on('driver:forced_offline', () => { S.online = false; render(); K.toast('You were taken offline by Kwata support.'); });
    sock.on('driver:status', () => location.reload());

    startGps();
    await loadEarnings();
    const active = await K.api('/trips/active');
    if (active) onTrip(active); else render();
  }

  function renderPending() {
    const msg = {
      pending: ['You’re almost on the road', 'Bring your driving permit, logbook and National ID to the Kwata office to finish verification. We approve within 24 hours of your visit.'],
      suspended: ['Your account is paused', 'Call driver support to find out why and how to get back on the road.'],
      rejected: ['We couldn’t approve your account', 'Call driver support for details.'],
    }[S.driver.status] || ['Account not active', ''];
    root.innerHTML = `<div class="auth"><div class="auth-hero"><div class="wordmark">Kwata Driver</div><h1>${msg[0]}</h1></div>
      <div class="auth-card"><p>${msg[1]}</p>
      <div class="card row" style="margin:14px 0"><span style="width:90px">${K.artFor(null, S.driver.vehicleType)}</span><span class="grow"><b>${K.esc(S.driver.plate)}</b><br><span class="small muted">${K.esc(S.driver.vehicleMake || '')}</span></span><span class="badge warn">${S.driver.status}</span></div>
      <a class="btn btn-primary btn-block btn-lg" href="tel:${K.esc(S.config.supportPhone)}">Call driver support</a>
      <button class="btn btn-ghost btn-block" id="out" style="margin-top:8px">Sign out</button></div></div>`;
    K.$('#out').onclick = () => { K.session.clear(); location.reload(); };
  }

  // ---------- GPS ----------
  function startGps() {
    if (!navigator.geolocation) return useManual();
    watchId = navigator.geolocation.watchPosition(
      (p) => { S.manual = false; setLoc(p.coords.latitude, p.coords.longitude, p.coords.heading); },
      () => useManual(),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }
  function useManual() {
    if (S.manual) return;
    S.manual = true;
    K.toast('Location is off. Turn it on, or tap the map to set your position.', 6000);
    if (!S.loc) setLoc(K.KAMPALA.lat, K.KAMPALA.lng);
  }
  function setLoc(lat, lng, heading) {
    const first = !S.loc;
    S.loc = { lat, lng, heading: Number.isFinite(heading) ? heading : null };
    if (!me) me = K.vehicle(map, S.loc, S.driver.vehicleType === 'car' ? 'car' : 'boda', heading || 0);
    else me.moveTo(lat, lng, S.loc.heading);
    if (first) map.setView([lat, lng], 16);
    const now = Date.now();
    if (sock && (now - lastSent > 2500 || S.manual)) { sock.emit('driver:location', S.loc); lastSent = now; }
    updateNav();
  }

  // ---------- online ----------
  function setOnline(on) {
    if (!on) { S.online = false; sock.emit('driver:online', false, () => {}); releaseWake(); render(); return; }
    if (!S.loc) { K.toast('Waiting for your location…'); return; }
    sock.emit('driver:online', true, (res) => {
      if (!res.ok) { K.toast(res.error); return; }
      S.online = true; keepAwake(); render();
    });
  }
  async function keepAwake() { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
  function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }
  async function loadEarnings() {
    try { S.earnings = await K.api('/driver/earnings'); } catch {}
    const t = K.$('#earnTxt'); if (t && S.earnings) t.textContent = K.ugx(S.earnings.today.net);
  }

  // ---------- views ----------
  function render() {
    K.$('#liveDot').classList.toggle('on', S.online || !!S.trip);
    const go = K.$('#goBtn');
    const showGo = !S.online && !S.trip && !S.offer;
    go.classList.toggle('hidden', !showGo);
    sheet.classList.remove('sheet-enter'); void sheet.offsetWidth; sheet.classList.add('sheet-enter');
    if (S.offer) vOffer();
    else if (S.trip) (S.trip.status === 'completed' ? vDone : vTrip)();
    else vHome();
    updateNav();
    if (showGo) requestAnimationFrame(() => { go.style.bottom = (sheet.offsetHeight + 18) + 'px'; });
  }

  function vHome() {
    clearTarget();
    const e = S.earnings || { today: { net: 0, trips: 0 }, week: { net: 0, trips: 0 }, balance: 0 };
    sheet.innerHTML = `
      <div class="grabber"></div>
      ${S.online
        ? `<div class="row"><div class="grow"><h2 style="margin:0;font-size:1.3rem">Finding trips</h2><span class="small muted">Requests near you will appear here</span></div>
             <button class="btn icon-btn" id="off" aria-label="Go offline" style="background:var(--stop);color:#fff">${K.ic('x')}</button></div>
           <div class="progress indet"><i></i></div>`
        : `<h2 style="margin:0;font-size:1.3rem;text-align:center">You’re offline</h2>
           <p class="small muted" style="text-align:center;margin-top:4px">Tap GO to start getting requests. You keep ${100 - S.config.commissionPct}% of every fare.</p>`}
      <div class="stat-row">
        <div class="stat"><span class="tiny muted">Today</span><b>${K.ugx(e.today.net)}</b><span class="tiny muted">${e.today.trips} trip${e.today.trips === 1 ? '' : 's'}</span></div>
        <div class="stat"><span class="tiny muted">Last 7 days</span><b>${K.ugx(e.week.net)}</b><span class="tiny muted">${e.week.trips} trips</span></div>
      </div>
      ${S.manual ? '<p class="tiny faint" style="text-align:center">Tap the map to set your position.</p>' : ''}`;
    const off = K.$('#off'); if (off) off.onclick = () => setOnline(false);
  }

  function onOffer(o) {
    if (S.trip && S.trip.status !== 'completed') return;
    if (S.trip && S.trip.status === 'completed') S.trip = null;
    S.offer = o; S.offer.left = o.expiresIn;
    try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400]); } catch {}
    beep();
    clearInterval(offerTimer);
    offerTimer = setInterval(() => {
      if (!S.offer) return clearInterval(offerTimer);
      S.offer.left -= 1;
      const fg = K.$('#ringFg'); if (fg) fg.style.strokeDashoffset = 176 * (1 - Math.max(0, S.offer.left) / S.offer.expiresIn);
      const tx = K.$('#ringTx'); if (tx) tx.textContent = Math.max(0, S.offer.left);
      if (S.offer.left <= 0) { S.offer = null; clearInterval(offerTimer); clearTarget(); render(); }
    }, 1000);
    showTarget(o.pickup, 'pickup');
    render();
  }

  function vOffer() {
    const o = S.offer;
    const pickMin = Math.max(1, Math.round((o.pickupKm * 1.3 / 20) * 60));
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="row" style="align-items:flex-start">
        <div class="grow">
          <span class="badge" style="background:var(--ink);color:var(--on-ink)">${K.esc(K.SERVICE_LABEL[o.service])}${o.paymentMethod === 'cash' ? ' · Cash' : ''}</span>
          <div class="offer-fare" style="margin-top:10px">${K.ugx(o.earning)}</div>
          <div class="small muted" style="margin-top:4px">${o.rider.rating ? '★ ' + o.rider.rating : 'New rider'} · fare ${K.ugx(o.fare)}</div>
        </div>
        <svg class="ring" viewBox="0 0 64 64" aria-label="Seconds left"><circle class="bg" cx="32" cy="32" r="28"/><circle class="fg" id="ringFg" cx="32" cy="32" r="28" stroke-dasharray="176" style="stroke-dashoffset:${176 * (1 - o.left / o.expiresIn)}"/>
          <text id="ringTx" x="32" y="38" text-anchor="middle" font-weight="800" font-size="18" fill="currentColor">${o.left}</text></svg>
      </div>
      <div class="trip-list" style="margin-top:14px">
        <div class="lrow" style="cursor:default"><span class="ic"><span class="rb-dot"></span></span><span class="grow"><span class="t">${pickMin} min (${o.pickupKm} km) away</span><span class="s ellipsis" style="display:block">${K.esc(o.pickup.address)}</span></span></div>
        <div class="lrow" style="cursor:default"><span class="ic"><span class="rb-sq"></span></span><span class="grow"><span class="t">${Math.round(o.durationMin)} min (${o.distanceKm.toFixed(1)} km) trip</span><span class="s ellipsis" style="display:block">${K.esc(o.drop.address)}</span></span></div>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="yes" style="margin-top:12px">Accept</button>
      <button class="btn btn-ghost btn-block" id="no" style="margin-top:6px">Decline</button>`;
    K.$('#yes').onclick = () => respond(true);
    K.$('#no').onclick = () => respond(false);
  }

  function respond(accept) {
    const id = S.offer.id;
    clearInterval(offerTimer);
    sock.emit('trip:respond', { tripId: id, accept }, (res) => {
      S.offer = null;
      if (!res.ok) { K.toast(res.error); clearTarget(); render(); return; }
      if (!accept) { clearTarget(); render(); }
    });
  }

  function onTrip(t) {
    if (t.status === 'cancelled' || t.status === 'requested') {
      if (S.trip && S.trip.id === t.id) {
        if (t.cancelledBy === 'rider') K.toast('The rider cancelled this trip.');
        S.trip = null; routedFor = null; clearTarget(); render();
      }
      return;
    }
    if (S.trip && t.id < S.trip.id) return;
    const isNew = !S.trip || S.trip.id !== t.id;
    S.trip = t; S.offer = null;
    if (isNew) { S.messages = []; S.unread = 0; K.api(`/trips/${t.id}/messages`).then((m) => { S.messages = m; }).catch(() => {}); }
    if (t.status === 'completed') loadEarnings();
    render();
  }

  function navLink(p) { return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=${S.driver.vehicleType === 'boda' ? 'two-wheeler' : 'driving'}`; }

  function updateNav() {
    const nb = K.$('#navBanner');
    if (!nb) return;
    const t = S.trip;
    if (!t || t.status === 'completed') { nb.classList.add('hidden'); return; }
    const target = t.status === 'in_progress' ? t.drop : t.pickup;
    const km = S.loc ? K.km(S.loc, target) : null;
    nb.classList.remove('hidden');
    nb.innerHTML = `${K.ic('nav')}
      <div class="grow"><div class="dist">${km != null ? (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km') : '—'}</div>
      <div class="small ellipsis" style="opacity:.85">${t.status === 'in_progress' ? 'Drop off at ' : t.status === 'arrived' ? 'Waiting at ' : 'Pick up at '}${K.esc(String(target.address).split(',')[0])}</div></div>
      <a class="btn btn-sm" href="${navLink(target)}" target="_blank" rel="noopener" style="background:#fff;color:#000">Navigate</a>`;
  }

  function vTrip() {
    const t = S.trip;
    const toPickup = t.status !== 'in_progress';
    const target = toPickup ? t.pickup : t.drop;
    showTarget(target, toPickup ? 'pickup' : 'drop');
    const parcel = t.parcel ? `<div class="card small" style="margin:10px 0">${K.ic('gift', 'sm')} <b>${K.esc(t.parcel.item)}</b><br>Deliver to ${K.esc(t.parcel.recipientName)} · <a href="tel:${K.esc(t.parcel.recipientPhone)}"><b>${K.esc(t.parcel.recipientPhone)}</b></a></div>` : '';
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="row">
        <span class="avatar">${K.initials(t.rider.name)}<span class="star">★ ${t.rider.rating || 'New'}</span></span>
        <span class="grow" style="padding-left:4px"><b style="font-size:1.15rem">${K.esc(t.rider.name)}</b><br><span class="small muted">${K.esc(K.SERVICE_LABEL[t.service])} · ${K.ugx(t.fare)} ${t.paymentMethod === 'cash' ? 'cash' : 'by ' + K.PAY_LABEL[t.paymentMethod]}</span></span>
        <button class="round" id="chatBtn" aria-label="Message rider">${K.ic('msg')}${S.unread ? '<span class="badge-dot"></span>' : ''}</button>
        ${t.rider.phone ? `<a class="round" href="tel:${K.esc(t.rider.phone)}" aria-label="Call rider">${K.ic('phone')}</a>` : ''}
      </div>
      ${parcel}
      ${t.status === 'arrived' || t.status === 'accepted' ? `
        <div id="pinWrap" class="${t.status === 'arrived' ? '' : 'hidden'}">
          <label for="pin" style="text-align:center">Enter rider’s PIN to start</label>
          <input id="pin" class="pin-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····" aria-label="Rider PIN">
        </div>` : ''}
      ${t.status === 'in_progress' && t.paymentMethod === 'cash' ? `<div class="card row" style="margin:12px 0"><span class="grow">Collect cash at drop-off</span><b>${K.ugx(t.fare)}</b></div>` : ''}
      <p class="error" id="err"></p>
      <div id="action"></div>
      <div class="row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm fill" id="sos">${K.ic('shield', 'sm')} Safety</button>
        ${toPickup ? '<button class="btn btn-ghost btn-sm fill" id="cancel">Cancel trip</button>' : ''}
      </div>`;
    const action = K.$('#action');
    if (t.status === 'accepted') K.slider(action, { label: 'Slide when you arrive', onDone: () => step('arrived') });
    else if (t.status === 'arrived') {
      action.innerHTML = '<button class="btn btn-primary btn-block btn-lg" id="start">Start trip</button>';
      K.$('#start').onclick = () => step('start', { pin: K.$('#pin').value });
      const pin = K.$('#pin'); pin.oninput = () => { if (pin.value.length === 4) K.$('#start').focus(); };
    } else if (t.status === 'in_progress') K.slider(action, { label: t.service === 'parcel' ? 'Slide to complete delivery' : 'Slide to complete trip', cls: 'red', onDone: () => step('complete') });
    K.$('#chatBtn').onclick = openChat;
    K.$('#sos').onclick = safety;
    const c = K.$('#cancel'); if (c) c.onclick = cancelTrip;
  }

  async function step(action, body) {
    K.$('#err').textContent = '';
    try { await K.api(`/trips/${S.trip.id}/${action}`, body || {}); }
    catch (e) { K.$('#err').textContent = e.message; const s = K.$('#action'); if (s && s.reset) s.reset(); }
  }

  function cancelTrip() {
    const m = K.modal(`<h2>Cancel this trip?</h2><p class="muted">The rider will be matched with another driver. Frequent cancellations lower your standing.</p>
      <button class="btn btn-danger btn-block btn-lg" id="yes">Cancel trip</button><button class="btn btn-block" style="margin-top:8px" data-close>Keep trip</button>`);
    K.$('#yes', m.el).onclick = async () => {
      try { await K.api(`/trips/${S.trip.id}/cancel`, {}); m.close(); S.trip = null; routedFor = null; clearTarget(); render(); } catch (e) { K.toast(e.message); }
    };
  }

  function safety() {
    const m = K.modal(`<h2>Safety</h2><p class="muted">Our safety team is available 24/7.</p>
      <button class="btn btn-danger btn-block btn-lg" id="sos">${K.ic('sos')} Send emergency alert</button>
      <a class="btn btn-block" href="tel:999" style="margin-top:8px">Call Police (999)</a>
      <a class="btn btn-block" href="tel:${K.esc(S.config.supportPhone)}" style="margin-top:8px">Call driver support</a>`);
    K.$('#sos', m.el).onclick = async () => {
      await K.api(`/trips/${S.trip.id}/sos`, S.loc || {}).catch(() => {});
      m.close(); K.toast('Alert sent. Our safety team has your location.', 6000);
    };
  }

  function vDone() {
    const t = S.trip;
    clearTarget();
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2 style="text-align:center">${t.service === 'parcel' ? 'Delivery complete' : 'Trip complete'}</h2>
      ${t.paymentMethod === 'cash'
        ? `<div class="card" style="text-align:center;margin:10px 0"><span class="small muted">Collect cash</span><div class="money">${K.ugx(t.fare)}</div><span class="small muted">You earned ${K.ugx(t.earning)}</span></div>`
        : `<div class="card" style="text-align:center;margin:10px 0"><span class="small muted">You earned</span><div class="money">${K.ugx(t.earning)}</div><span class="small muted">${t.paymentStatus === 'paid' ? 'Added to your balance' : 'Added once the rider pays by ' + K.PAY_LABEL[t.paymentMethod]}</span></div>`}
      ${!t.driverRated ? `<h3 style="text-align:center;margin-top:14px">Rate ${K.esc(K.first(t.rider.name))}</h3>
        <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} stars" class="${n <= S.rating ? 'on' : ''}">${K.starSvg}</button>`).join('')}</div>` : ''}
      <button class="btn btn-primary btn-block btn-lg" id="next">${S.online ? 'Find next trip' : 'Done'}</button>`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { S.rating = +b.dataset.n; vDone(); });
    K.$('#next').onclick = async () => {
      if (S.rating && !t.driverRated) await K.api(`/trips/${t.id}/rate`, { stars: S.rating }).catch(() => {});
      S.rating = 0; S.trip = null; routedFor = null; render();
    };
  }

  // ---------- map ----------
  async function showTarget(p, kind) {
    const key = `${kind}:${p.lat},${p.lng}`;
    if (routedFor === key) return;
    routedFor = key;
    clearTarget(true);
    targetMarker = L.marker([p.lat, p.lng], { icon: K.divIcon(kind === 'drop' ? '<div class="pin-sq"></div>' : '<div class="pin-ci"></div>', [16, 16]) }).addTo(map);
    if (!S.loc) return;
    const r = await K.route(S.loc, p);
    if (routedFor !== key) return;
    routeLayer = K.drawRoute(map, r.coords);
    const pad = window.innerWidth >= 760 ? { paddingTopLeft: [460, 120], paddingBottomRight: [60, 60] } : { paddingTopLeft: [40, 170], paddingBottomRight: [40, sheet.offsetHeight + 30] };
    map.fitBounds(routeLayer.bounds(), { ...pad, maxZoom: 17 });
  }
  function clearTarget(keepKey) {
    if (targetMarker) map.removeLayer(targetMarker); targetMarker = null;
    if (routeLayer) routeLayer.remove(); routeLayer = null;
    if (!keepKey) routedFor = null;
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .22, .44].forEach((d, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = [880, 1175, 1568][i]; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(.22, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + d + .25);
        o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .26);
      });
    } catch {}
  }

  // ---------- chat ----------
  function onChat(m) {
    if (!S.trip || m.tripId !== S.trip.id) return;
    if (!S.messages.find((x) => x.at === m.at && x.text === m.text)) S.messages.push(m);
    if (S.chatOpen) drawChat();
    else if (m.from !== 'driver') { S.unread++; K.toast(`${m.name}: ${m.text}`); try { navigator.vibrate && navigator.vibrate(150); } catch {} if (S.trip.status !== 'completed') vTrip(); }
  }
  function openChat() {
    S.chatOpen = true; S.unread = 0;
    const r = S.trip.rider;
    const page = document.createElement('div');
    page.className = 'page page-enter';
    page.style.paddingBottom = 'calc(12px + env(safe-area-inset-bottom))';
    page.innerHTML = `<div class="page-inner chat">
      <div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Close chat">${K.ic('back')}</button>
        <span class="grow"><b>${K.esc(r.name)}</b><br><span class="small muted">Rider</span></span>
        ${r.phone ? `<a class="round" href="tel:${K.esc(r.phone)}" aria-label="Call">${K.ic('phone')}</a>` : ''}</div>
      <div class="chat-log" id="log"></div>
      <div class="quick">${['I’m on my way', 'I’ve arrived', 'I’m in traffic, 5 minutes', 'Please come to the main road'].map((q) => `<button data-q="${q}">${q}</button>`).join('')}</div>
      <form class="chat-input" id="cf"><input id="ci" placeholder="Message ${K.esc(K.first(r.name))}" autocomplete="off" aria-label="Message"><button class="btn btn-primary icon-btn" aria-label="Send">${K.ic('send')}</button></form></div>`;
    root.querySelector('#app').appendChild(page);
    const send = (text) => sock.emit('chat:send', { tripId: S.trip.id, text }, (res) => { if (!res.ok) K.toast(res.error || 'Message not sent'); });
    K.$('[data-x]', page).onclick = () => { page.remove(); S.chatOpen = false; if (S.trip && S.trip.status !== 'completed') vTrip(); };
    page.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => send(b.dataset.q));
    K.$('#cf', page).onsubmit = (e) => { e.preventDefault(); const v = K.$('#ci', page).value.trim(); if (v) { send(v); K.$('#ci', page).value = ''; } };
    drawChat();
  }
  function drawChat() {
    const log = K.$('#log'); if (!log) return;
    log.innerHTML = S.messages.length ? S.messages.map((m) => `<div class="bubble ${m.from === 'driver' ? 'me' : ''}">${K.esc(m.text)}<span class="at">${new Date(m.at).toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('')
      : '<p class="small muted" style="text-align:center;margin:auto">Messages are only visible during this trip.</p>';
    log.scrollTop = log.scrollHeight;
  }

  // ---------- menu & earnings ----------
  function openMenu() {
    const m = K.modal(`
      <div class="row" style="margin-bottom:14px"><span class="avatar">${K.initials(S.user.name)}</span>
        <span class="grow"><b style="font-size:1.15rem">${K.esc(S.user.name)}</b><br><span class="small muted">★ ${S.user.rating || 'New'} · <span class="plate-tag">${K.esc(S.driver.plate)}</span></span></span></div>
      <button class="menu-item" data-a="earn">${K.ic('trend')}<span class="grow">Earnings & cash out</span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="trips">${K.ic('receipt')}<span class="grow">Trip history</span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="manual">${K.ic('pin')}<span class="grow">${S.manual ? 'Use phone GPS' : 'Set position on map (testing)'}</span></button>
      <a class="menu-item" href="tel:${K.esc(S.config.supportPhone)}">${K.ic('help')}<span class="grow">Driver support</span>${K.ic('chev', 'sm')}</a>
      <button class="menu-item" data-a="out">${K.ic('logout')}<span class="grow">Sign out</span></button>`, { drawer: true });
    m.el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      m.close();
      ({
        earn: openEarnings, trips: openTrips,
        manual: () => { if (S.manual) { S.manual = false; startGps(); } else { S.manual = true; navigator.geolocation && navigator.geolocation.clearWatch(watchId); K.toast('Tap the map to move your position.'); render(); } },
        out: () => { if (S.online) setOnline(false); K.session.clear(); location.reload(); },
      })[b.dataset.a]();
    });
  }

  async function openEarnings() {
    const m = K.modal('<p class="muted">Loading…</p>');
    await loadEarnings();
    const e = S.earnings;
    m.el.innerHTML = `
      <h2>Earnings</h2>
      <div class="stat-row"><div class="stat"><span class="tiny muted">Today</span><b>${K.ugx(e.today.net)}</b><span class="tiny muted">${e.today.trips} trips</span></div><div class="stat"><span class="tiny muted">Last 7 days</span><b>${K.ugx(e.week.net)}</b><span class="tiny muted">${e.week.trips} trips</span></div></div>
      <div class="card"><span class="small muted">Balance you can cash out</span><div class="money">${K.ugx(e.balance)}</div>
      ${e.balance < 0 ? '<p class="small" style="margin:6px 0 0">Negative because our commission on cash trips is taken here. It clears from your next Mobile Money or wallet trips.</p>' : ''}</div>
      <label for="wamt">Cash out to ${K.esc(e.momoNumber)}</label>
      <div class="row"><input id="wamt" class="fill" type="number" inputmode="numeric" min="${S.config.minWithdrawal}" value="${Math.max(0, e.balance)}"><button class="btn btn-primary" id="wd">Cash out</button></div>
      <p class="error" id="err"></p>
      ${e.withdrawals.length ? `<h3>Cash outs</h3>${e.withdrawals.map((w) => `<div class="tx"><span>${K.when(w.created_at)}</span><span>${K.ugx(w.amount)} <span class="badge ${w.status === 'paid' ? 'ok' : w.status === 'rejected' ? 'bad' : 'warn'}">${w.status}</span></span></div>`).join('')}` : ''}
      <h3 style="margin-top:14px">Activity</h3>
      ${e.transactions.length ? e.transactions.map((x) => `<div class="tx"><span>${K.esc(x.note || x.type)}<br><span class="tiny faint">${K.when(x.created_at)}</span></span><span class="${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${K.ugx(x.amount)}</span></div>`).join('') : '<p class="small muted">Complete your first trip to see earnings here.</p>'}`;
    K.$('#wd', m.el).onclick = async () => {
      try { await K.api('/driver/withdraw', { amount: +K.$('#wamt', m.el).value }); K.toast('Cash out requested'); m.close(); await loadEarnings(); render(); }
      catch (err) { K.$('#err', m.el).textContent = err.message; }
    };
  }

  async function openTrips() {
    const m = K.modal('<p class="muted">Loading…</p>');
    const list = await K.api('/trips/history');
    m.el.innerHTML = `<h2>Trip history</h2>
      ${list.length ? list.map((t) => `<div class="lrow" style="cursor:default"><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(t.drop.address)}</span><span class="s">${K.when(t.createdAt)} · ${K.PAY_LABEL[t.paymentMethod]}</span></span><b>${t.status === 'completed' ? K.ugx(t.earning) : `<span class="badge bad">${t.status}</span>`}</b></div>`).join('') : '<p class="muted">Go online to get your first trip.</p>'}`;
  }
})();
