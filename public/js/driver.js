// Kwata Driver app (mockup screens 14–20):
// Welcome → Become a driver → Verify documents → Home (Go Online) → Ride request → Active trip → Earnings / Profile
(function () {
  const root = document.getElementById('root');
  const S = { user: null, driver: null, online: false, offer: null, trip: null, loc: null, manual: false, earnings: null, rating: 0, config: null, messages: [], unread: 0, chatOpen: false, tab: 'home', hasPhoto: false };
  let map, sock, sheet, me, targetMarker, routeLayer, watchId, offerTimer, wakeLock, lastSent = 0, routedFor = null;

  if (!K.token()) K.authScreen(root, { role: 'driver', onDone: start });
  else start();

  const prettyPhone = (p) => String(p || '').replace(/^\+256/, '0').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
  const photoUrl = () => (S.hasPhoto ? `/api/drivers/${S.user.id}/photo?v=${S.photoV || 1}` : null);
  const photo = (cls = 'photo') => `<span class="${cls}">${photoUrl() ? `<img src="${photoUrl()}" alt="">` : K.initials(S.user.name)}</span>`;
  const fmtKm = (km) => (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km');
  const customer = (t) => (t.service === 'parcel' ? 'sender' : 'customer');

  async function start() {
    root.innerHTML = '<div class="onb"><p class="muted" style="margin:auto">Loading…</p></div>';
    let me0, config, docs;
    try { [me0, config, docs] = await Promise.all([K.api('/me'), K.api('/config'), K.api('/driver/documents').catch(() => ({ uploaded: {} }))]); }
    catch (e) { K.ready(); root.innerHTML = `<div class="onb"><p class="error">${K.esc(e.message)}</p><button class="btn btn-block" onclick="location.reload()">Try again</button></div>`; return; }
    S.user = me0.user; S.driver = me0.driver; S.config = config; S.docs = docs; S.hasPhoto = !!(docs.uploaded || {}).photo;
    K.ready();
    if (!S.driver || S.driver.status !== 'approved') { renderPending(); return; }

    root.innerHTML = `
      <div class="app" id="app">
        <div id="map" aria-label="Map"></div>
        <div class="topbar" id="topbar"></div>
        <section class="sheet" id="sheet" aria-live="polite"></section>
        <nav class="tabbar" id="tabs" aria-label="Main">
          <button data-tab="home" aria-current="page">${K.ic('home')}Home</button>
          <button data-tab="earnings">${K.ic('chart')}Earnings</button>
          <button data-tab="profile">${K.ic('user')}Profile</button>
        </nav>
      </div>`;
    sheet = K.$('#sheet');
    K.draggableSheet(sheet);
    map = K.map('map');
    map.on('click', (e) => { if (S.manual) setLoc(e.latlng.lat, e.latlng.lng); });
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => openTab(b.dataset.tab));

    sock = K.socket(K.token());
    sock.on('connect', async () => {
      if (S.online) sock.emit('driver:online', true, () => {});
      if (S.loc) sock.emit('driver:location', S.loc);
      const a = await K.api('/trips/active').catch(() => null);
      if (a) onTrip(a);
    });
    sock.on('trip:offer', onOffer);
    sock.on('trip:offer_expired', ({ id }) => { if (S.offer && S.offer.id === id) closeOffer(); });
    sock.on('trip:update', onTrip);
    sock.on('toast', (m) => K.toast(m.text));
    sock.on('chat:message', onChat);
    sock.on('driver:forced_offline', () => { S.online = false; render(); K.toast('You were taken offline by Kwata support.'); });
    sock.on('driver:status', () => location.reload());

    startGps();
    await loadEarnings();
    const active = await K.api('/trips/active').catch(() => null);
    if (active) onTrip(active); else render();
  }

  // ---------- application status (screen 16 + review) ----------
  async function renderPending() {
    const st = S.driver ? S.driver.status : 'pending';
    if (st === 'pending') {
      let info = { kinds: {}, uploaded: {} };
      try { info = await K.api('/driver/documents'); } catch {}
      const missing = Object.keys(info.kinds).filter((k) => !info.uploaded[k]);
      if (missing.length) { K.verifyDocs(root, { onDone: renderPending }); return; }
    }
    const msg = {
      pending: ['Application under review', 'Thanks! We’re checking your documents. Most drivers are approved within 24 hours. We may call you to confirm a few details.'],
      suspended: ['Your account is paused', 'Call driver support to find out why and how to get back on the road.'],
      rejected: ['We couldn’t approve your account', 'Call driver support for details.'],
    }[st] || ['Account not active', ''];
    root.innerHTML = `<div class="onb onb-enter" style="text-align:center">
      <div class="illu" style="margin-top:30px">${st === 'pending' ? `<span style="width:110px;height:70px;display:block">${K.artFor(null, S.driver.vehicleType)}</span>` : K.ic('shield').replace('class="i "', 'class="i" style="width:60px;height:60px;stroke-width:1.6"')}</div>
      <h1>${msg[0]}</h1><p class="lead" style="max-width:32ch;margin:0 auto 18px">${msg[1]}</p>
      <div style="text-align:left">
        <div class="kv"><span>Vehicle</span><b>${K.esc([S.driver.vehicleColor, S.driver.vehicleMake].filter(Boolean).join(' ') || (S.driver.vehicleType === 'car' ? 'Car' : 'Boda boda'))}</b></div>
        <div class="kv"><span>Number plate</span><b>${K.esc(S.driver.plate)}</b></div>
        <div class="kv"><span>Documents</span><b style="color:var(--go)">All uploaded ✓</b></div>
        <div class="kv"><span>Status</span><b><span class="badge ${st === 'pending' ? 'warn' : 'bad'}">${st === 'pending' ? 'In review' : st}</span></b></div>
      </div>
      <div class="spacer"></div>
      ${st === 'pending' ? '<button class="btn btn-primary btn-block btn-lg" id="check">Check again</button>' : ''}
      <a class="btn btn-outline btn-block btn-lg" style="margin-top:8px" href="tel:${K.esc(S.config.supportPhone)}">Call driver support</a>
      <button class="btn btn-link btn-block" id="docs">Update my documents</button>
      <button class="btn btn-link btn-block" id="out" style="color:var(--stop)">Log out</button></div>`;
    const c = K.$('#check'); if (c) c.onclick = () => location.reload();
    K.$('#docs').onclick = () => K.verifyDocs(root, { onDone: renderPending, back: renderPending });
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
    updateBanner();
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
  async function loadEarnings() { try { S.earnings = await K.api('/driver/earnings'); } catch {} }

  // ---------- render ----------
  function topbar() {
    const tb = K.$('#topbar'), t = S.trip;
    if (t && t.status !== 'completed') {
      tb.innerHTML = '<div class="trip-banner" id="banner"></div>';
      updateBanner();
      return;
    }
    tb.innerHTML = `<div class="drv-head">${photo()}<span><b>${K.esc(S.user.name)}</b><span class="rating"><span class="star-ic">★</span><b>${S.user.rating || 'New'}</b></span></span>
        <span class="online-pill ${S.online ? 'on' : ''}" style="margin-left:6px"><i></i>${S.online ? 'Online' : 'Offline'}</span></div>
      <button class="btn icon-btn fab" id="locBtn" aria-label="Centre on me">${K.ic('locate')}</button>`;
    K.$('#locBtn').onclick = () => S.loc && map.setView([S.loc.lat, S.loc.lng], 16);
  }

  function render() {
    const inTrip = !!S.trip;
    K.$('#tabs').classList.toggle('hidden', inTrip);
    sheet.style.bottom = inTrip ? '' : (K.$('#tabs').offsetHeight || 58) + 'px';
    topbar();
    sheet.classList.remove('sheet-enter'); void sheet.offsetWidth; sheet.classList.add('sheet-enter');
    if (S.trip) (S.trip.status === 'completed' ? vDone : vTrip)();
    else vHome();
    if (S.offer) vOffer(); else { const r = K.$('#req'); if (r) r.remove(); }
  }

  // Screen 17: home
  // Like Uber/Bolt "high demand" alerts: tell drivers when their area pays more.
  function demandHtml() {
    const d = S.demand; if (!d) return '';
    const mine = d[S.driver.vehicleType === 'car' ? 'car' : 'boda'];
    if (!mine || mine.mult <= 1) return d.raining ? '<div class="demand-chip">🌧 It’s raining. Riders need you, so stay safe out there.</div>' : '';
    const why = mine.reasons.includes('rain') && mine.reasons.includes('demand') ? 'Rain and high demand near you' : mine.reasons.includes('rain') ? 'Raining: fares are higher' : 'High demand near you';
    return `<div class="demand-chip">${K.ic('trend', 'sm')} ${why}<b>×${mine.mult}</b></div>`;
  }
  async function loadDemand() {
    if (!S.loc || S.trip) return;
    try { S.demand = await K.api(`/drivers/demand?lat=${S.loc.lat}&lng=${S.loc.lng}`); } catch { return; }
    const el = K.$('#demand'); if (el) el.innerHTML = demandHtml();
  }
  setInterval(loadDemand, 60e3); setTimeout(loadDemand, 3000);

  function vHome() {
    clearTarget();
    const e = S.earnings || { today: { net: 0, trips: 0 }, balance: 0 };
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div id="installHost"></div>
      ${S.online ? `<div class="online-banner"><span class="pulse"></span><span class="grow">You’re online<br><span class="tiny" style="opacity:.7;font-weight:500">Ride requests near you will pop up here</span></span></div>` : ''}
      <div id="demand">${demandHtml()}</div>
      <button class="earn-card" id="earn"><span><small>Today’s earnings</small><b>${K.ugx(e.today.net)}</b></span>${K.ic('chev')}</button>
      <div class="stats3">
        <div><b>${e.today.trips}</b><span>Trips today</span></div>
        <div><b>★ ${S.user.rating || '–'}</b><span>Rating</span></div>
        <div><b>${K.ugx(e.balance).replace('UGX ', '')}</b><span>Balance (UGX)</span></div>
      </div>
      <div class="sheet-foot">${S.online
        ? `<button class="btn btn-go btn-block btn-lg" id="off">${K.ic('power')} Go Offline</button>`
        : `<button class="btn btn-primary btn-block btn-lg" id="on">${K.ic('power')} Go Online</button>
           <p class="tiny muted" style="text-align:center;margin:6px 0 0">You keep ${100 - S.config.commissionPct}% of every fare.</p>`}</div>
      ${S.manual ? '<p class="tiny faint" style="text-align:center;margin-top:8px">Tap the map to set your position.</p>' : ''}`;
    K.$('#earn').onclick = () => openTab('earnings');
    const on = K.$('#on'); if (on) on.onclick = () => setOnline(true);
    const off = K.$('#off'); if (off) off.onclick = () => setOnline(false);
    K.installCard(K.$('#installHost'), 'Kwata Driver', '/icons/driver-192.png');
  }

  // Screen 18: new ride request
  function onOffer(o) {
    if (S.trip && S.trip.status !== 'completed') return;
    if (S.trip && S.trip.status === 'completed') S.trip = null;
    S.offer = o; S.offer.left = o.expiresIn;
    openTab('home');
    try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400]); } catch {}
    beep();
    clearInterval(offerTimer);
    offerTimer = setInterval(() => {
      if (!S.offer) return clearInterval(offerTimer);
      S.offer.left -= 1;
      const fg = K.$('#ringFg'); if (fg) fg.style.strokeDashoffset = 151 * (1 - Math.max(0, S.offer.left) / S.offer.expiresIn);
      const tx = K.$('#ringTx'); if (tx) tx.textContent = Math.max(0, S.offer.left);
      if (S.offer.left <= 0) closeOffer();
    }, 1000);
    showTarget(o.pickup, 'pickup');
    render();
  }
  function closeOffer() { S.offer = null; clearInterval(offerTimer); clearTarget(); render(); }

  function vOffer() {
    const o = S.offer;
    const pickMin = Math.max(1, Math.round((o.pickupKm * 1.3 / 20) * 60));
    let el = K.$('#req');
    if (!el) { el = document.createElement('div'); el.id = 'req'; el.className = 'req'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-label', 'New ride request'); root.querySelector('#app').appendChild(el); }
    el.innerHTML = `
      <svg class="timer" viewBox="0 0 54 54" aria-label="Seconds left"><circle class="bg" cx="27" cy="27" r="24"/><circle class="fg" id="ringFg" cx="27" cy="27" r="24" stroke-dasharray="151" style="stroke-dashoffset:${151 * (1 - o.left / o.expiresIn)}"/>
        <text id="ringTx" x="27" y="33" text-anchor="middle" font-weight="800" font-size="17" fill="#fff">${o.left}</text></svg>
      <h2>New ${o.service === 'parcel' ? 'delivery' : 'ride'} request</h2>
      <div class="req-card">
        <div class="away">${K.ic('nav')}<span class="grow">${pickMin} min away</span><span class="small muted" style="font-weight:600">${o.pickupKm} km</span></div>
        <div class="row" style="margin:6px 0 2px"><span class="avatar" style="width:38px;height:38px;font-size:.8rem">${K.initials(o.rider.name)}</span>
          <span class="grow"><b>${K.esc(K.first(o.rider.name))}</b><br><span class="rating"><span class="star-ic">★</span><b>${o.rider.rating || 'New'}</b></span></span>
          <span class="badge" style="background:var(--ink);color:#fff">${K.esc(K.SERVICE_LABEL[o.service])}</span></div>
        <div class="stops">
          <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>Pickup</small><b class="ellipsis">${K.esc(o.pickup.address)}</b></span></div>
          <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>Destination · ${o.distanceKm.toFixed(1)} km, ${Math.round(o.durationMin)} min</small><b class="ellipsis">${K.esc(o.drop.address)}</b></span></div>
        </div>
        <div class="est"><small>You earn</small><b>${K.ugx(o.earning)}</b>
          <span class="small muted" style="display:block">Fare ${K.ugx(o.fare)} · ${o.paymentMethod === 'cash' ? 'Cash' : K.PAY_LABEL[o.paymentMethod]}</span></div>
      </div>
      <div class="spacer" style="flex:1"></div>
      <div class="btns"><button class="btn btn-danger btn-lg" id="no">Decline</button><button class="btn btn-primary btn-lg" id="yes">Accept</button></div>`;
    K.$('#yes', el).onclick = () => respond(true);
    K.$('#no', el).onclick = () => respond(false);
  }

  function respond(accept) {
    const id = S.offer.id;
    clearInterval(offerTimer);
    K.$('#yes').disabled = K.$('#no').disabled = true;
    sock.emit('trip:respond', { tripId: id, accept }, (res) => {
      S.offer = null;
      if (!res.ok) { K.toast(res.error); clearTarget(); render(); return; }
      if (!accept) { clearTarget(); render(); }
    });
  }

  function onTrip(t) {
    if (t.status === 'cancelled' || t.status === 'requested') {
      if (S.trip && S.trip.id === t.id) {
        if (t.cancelledBy === 'rider') K.toast(`The ${customer(t)} cancelled this trip.`);
        S.trip = null; routedFor = null; clearTarget(); render();
      }
      return;
    }
    if (S.trip && t.id < S.trip.id) return;
    const isNew = !S.trip || S.trip.id !== t.id;
    S.trip = t; S.offer = null; clearInterval(offerTimer);
    if (isNew) { S.messages = []; S.unread = 0; K.api(`/trips/${t.id}/messages`).then((m) => { S.messages = m; }).catch(() => {}); openTab('home'); }
    if (t.status === 'completed') loadEarnings();
    render();
  }

  function navLink(p) { return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=${S.driver.vehicleType === 'boda' ? 'two-wheeler' : 'driving'}`; }

  function updateBanner() {
    const nb = K.$('#banner'), t = S.trip;
    if (!nb || !t || t.status === 'completed') return;
    const target = t.status === 'in_progress' ? t.drop : t.pickup;
    const km = S.loc ? K.km(S.loc, target) : null;
    const head = t.status === 'in_progress' ? (t.service === 'parcel' ? 'Delivering' : 'On trip') : t.status === 'arrived' ? 'Waiting at pickup' : 'Head to pickup';
    nb.innerHTML = `<span class="round" aria-hidden="true">${K.ic('nav')}</span>
      <span class="grow"><b>${head}${km != null && t.status !== 'arrived' ? ` · ${fmtKm(km)}` : ''}</b><small class="ellipsis" style="display:block">${K.esc(String(target.address).split(',')[0])}${km != null && t.status !== 'arrived' ? ` · ${K.etaMin(S.loc, target)} min` : ''}</small></span>
      <a class="btn btn-primary btn-sm" href="${navLink(target)}" target="_blank" rel="noopener">Navigate</a>`;
  }

  // Screen 19: active trip
  function vTrip() {
    const t = S.trip, r = t.rider;
    const toPickup = t.status !== 'in_progress';
    showTarget(toPickup ? t.pickup : t.drop, toPickup ? 'pickup' : 'drop');
    const parcel = t.parcel ? `<div class="card small" style="margin:10px 0">${K.ic('gift', 'sm')} <b>${K.esc(t.parcel.item)}</b><br>Deliver to ${K.esc(t.parcel.recipientName)} · <a href="tel:${K.esc(t.parcel.recipientPhone)}"><b>${K.esc(prettyPhone(t.parcel.recipientPhone))}</b></a></div>` : '';
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="driver-card"><span class="photo">${K.initials(r.name)}</span>
        <span class="grow"><b style="display:block">${K.esc(r.name)}</b><span class="rating"><span class="star-ic">★</span><b>${r.rating || 'New'}</b>${r.trips ? ` (${r.trips} trips)` : ''}</span>
          <span class="small muted" style="display:block">${K.esc(K.SERVICE_LABEL[t.service])} · ${t.paymentMethod === 'cash' ? 'Cash' : K.PAY_LABEL[t.paymentMethod]}</span></span>
        ${r.phone ? `<a class="round go" href="tel:${K.esc(r.phone)}" aria-label="Call ${customer(t)}">${K.ic('phone')}</a>` : ''}
        <button class="round brand" id="chatBtn" aria-label="Message ${customer(t)}">${K.ic('msg')}${S.unread ? '<span class="dot"></span>' : ''}</button></div>
      ${parcel}
      <div class="stops">
        <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>Pickup</small><b class="ellipsis">${K.esc(t.pickup.address)}</b></span></div>
        <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>Destination</small><b class="ellipsis">${K.esc(t.drop.address)}</b></span></div>
      </div>
      <div class="fare-row"><span class="muted">${t.paymentMethod === 'cash' ? 'Collect in cash' : 'Fare'}</span><b>${K.ugx(t.fare)}</b></div>
      ${t.status === 'arrived' ? `
        <label for="pin" style="text-align:center">Ask the ${customer(t)} for their 4-digit PIN</label>
        <input id="pin" class="pin-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····" aria-label="Trip PIN">` : ''}
      <div class="sheet-foot"><p class="error" id="err" style="margin:0 0 6px;min-height:0"></p>
      <div id="action"></div>
      <div class="row" style="margin-top:6px">
        <button class="btn btn-ghost btn-sm fill" id="sos">${K.ic('shield', 'sm')} Safety</button>
        ${toPickup ? '<button class="btn btn-ghost btn-sm fill" id="cancel" style="color:var(--stop)">Cancel trip</button>' : ''}
      </div></div>`;
    const action = K.$('#action');
    if (t.status === 'accepted') K.slider(action, { label: 'Slide when you arrive', onDone: () => step('arrived') });
    else if (t.status === 'arrived') {
      action.innerHTML = '<button class="btn btn-primary btn-block btn-lg" id="start">Start trip</button>';
      K.$('#start').onclick = () => step('start', { pin: K.$('#pin').value });
      const pin = K.$('#pin'); pin.oninput = () => { pin.value = pin.value.replace(/\D/g, ''); if (pin.value.length === 4) K.$('#start').focus(); };
    } else if (t.status === 'in_progress') K.slider(action, { label: t.service === 'parcel' ? 'Slide to complete delivery' : 'Slide to complete trip', cls: 'dark', onDone: () => step('complete') });
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
    const m = K.modal(`<h2>Cancel this trip?</h2><p class="muted">The ${customer(S.trip)} will be matched with someone else. Frequent cancellations lower your standing.</p>
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
      <div class="done-wrap">
        <div class="check-big">${K.ic('check')}</div>
        <h2>${t.service === 'parcel' ? 'Delivery complete' : 'Trip complete'}</h2>
        <div class="fare-card">
          ${t.paymentMethod === 'cash'
            ? `<span class="small muted">Collect cash</span><div class="amt">${K.ugx(t.fare)}</div><span class="small muted">You earned ${K.ugx(t.earning)}</span>`
            : `<span class="small muted">You earned</span><div class="amt">${K.ugx(t.earning)}</div><span class="small muted">${t.paymentStatus === 'paid' ? 'Added to your balance' : 'Added once the ' + customer(t) + ' pays by ' + K.PAY_LABEL[t.paymentMethod]}</span>`}
        </div>
        ${!t.driverRated ? `<h3>Rate ${K.esc(K.first(t.rider.name))}</h3>
          <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} stars" class="${n <= S.rating ? 'on' : ''}">${K.starSvg}</button>`).join('')}</div>` : ''}
      </div>
      <div class="sheet-foot"><button class="btn btn-primary btn-block btn-lg" id="next">${S.online ? 'Find next trip' : 'Done'}</button></div>`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => {
      S.rating = +b.dataset.n;
      sheet.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', +x.dataset.n <= S.rating));
    });
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
    targetMarker = L.marker([p.lat, p.lng], { icon: K.divIcon(kind === 'drop' ? '<div class="pin-sq"></div>' : '<div class="pin-ci"></div>', [18, 18]) }).addTo(map);
    if (!S.loc) return;
    const r = await K.route(S.loc, p);
    if (routedFor !== key) return;
    routeLayer = K.drawRoute(map, r.coords);
    const pad = window.innerWidth >= 760 ? { paddingTopLeft: [460, 120], paddingBottomRight: [60, 60] } : { paddingTopLeft: [40, 110], paddingBottomRight: [40, sheet.offsetHeight + 30] };
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
    page.className = 'page page-enter'; page.style.zIndex = 870;
    page.style.paddingBottom = 'calc(12px + env(safe-area-inset-bottom))';
    page.innerHTML = `<div class="page-inner chat">
      <div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Close chat">${K.ic('back')}</button>
        <span class="avatar">${K.initials(r.name)}</span><span class="grow"><b>${K.esc(r.name)}</b><br><span class="small muted">${customer(S.trip) === 'sender' ? 'Sender' : 'Customer'}</span></span>
        ${r.phone ? `<a class="round go" href="tel:${K.esc(r.phone)}" aria-label="Call">${K.ic('phone')}</a>` : ''}</div>
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

  // ---------- tabs: earnings & profile (screen 20) ----------
  function openTab(tab) {
    if (tab !== 'home' && S.trip) return;
    S.tab = tab;
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    document.querySelectorAll('.page[data-tabpage]').forEach((p) => p.remove());
    if (tab === 'home') { if (!S.trip && sheet) vHome(); return; }
    const page = document.createElement('div');
    page.className = 'page'; page.dataset.tabpage = tab;
    page.innerHTML = '<div class="page-inner"><p class="muted">Loading…</p></div>';
    root.querySelector('#app').insertBefore(page, K.$('#tabs'));
    (tab === 'earnings' ? drawEarnings : drawProfile)(page.firstElementChild);
  }

  async function drawEarnings(el) {
    await loadEarnings();
    const e = S.earnings;
    if (!e) { el.innerHTML = '<p class="error">Couldn’t load earnings. Check your connection.</p>'; return; }
    const max = Math.max(1, ...e.days.map((d) => d.net));
    const today = e.days[e.days.length - 1].day;
    const dayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-UG', { weekday: 'short' }).slice(0, 3);
    el.innerHTML = `
      <div class="page-title">Earnings</div>
      <div class="seg-tabs"><button aria-pressed="false" data-r="today">Today</button><button aria-pressed="true" data-r="week">This week</button></div>
      <div id="range"></div>
      <div class="chart" aria-label="Earnings for the last 7 days">${e.days.map((d) => `<div class="b ${d.net ? '' : 'zero'} ${d.day === today ? 'today' : ''}" title="${dayName(d.day)}: ${K.ugx(d.net)}"><i style="height:${Math.max(2, (d.net / max) * 100)}%"></i><span>${dayName(d.day)}</span></div>`).join('')}</div>
      <div class="kv"><span>Completed trips</span><b>${e.week.trips}</b></div>
      <div class="kv"><span>Cash collected</span><b>${K.ugx(e.cashWeek)}</b></div>
      <div class="kv"><span>Kwata commission</span><b>−${K.ugx(e.commissionWeek)}</b></div>
      <div class="card" style="margin-top:16px"><span class="small muted">Balance you can cash out</span><div class="money">${K.ugx(e.balance)}</div>
        ${e.balance < 0 ? '<p class="small" style="margin:6px 0 0">Negative because commission on cash trips is taken here. It clears from your next Mobile Money or wallet trips.</p>' : ''}
        <label for="wamt">Cash out to ${K.esc(prettyPhone(e.momoNumber))}</label>
        <div class="row"><input id="wamt" class="fill" type="number" inputmode="numeric" min="${S.config.minWithdrawal}" value="${Math.max(0, e.balance)}"><button class="btn btn-primary" id="wd">Cash out</button></div>
        <p class="error" id="err"></p></div>
      ${e.withdrawals.length ? `<h3 style="margin-top:18px">Cash outs</h3>${e.withdrawals.map((w) => `<div class="tx"><span>${K.when(w.created_at)}</span><span>${K.ugx(w.amount)} <span class="badge ${w.status === 'paid' ? 'ok' : w.status === 'rejected' ? 'bad' : 'warn'}">${w.status}</span></span></div>`).join('')}` : ''}
      <h3 style="margin-top:18px">Activity</h3>
      ${e.transactions.length ? e.transactions.map((x) => `<div class="tx"><span>${K.esc(x.note || x.type)}<br><span class="tiny faint">${K.when(x.created_at)}</span></span><span class="${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${K.ugx(x.amount)}</span></div>`).join('') : '<p class="small muted">Complete your first trip to see earnings here.</p>'}`;
    const range = (r) => {
      el.querySelectorAll('[data-r]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === r));
      const v = r === 'today' ? e.today : e.week;
      K.$('#range', el).innerHTML = `<span class="small muted">${r === 'today' ? 'Today' : 'Last 7 days'}</span><div class="money">${K.ugx(v.net)}</div><span class="small muted">${v.trips} trip${v.trips === 1 ? '' : 's'}</span>`;
    };
    el.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => range(b.dataset.r));
    range('week');
    K.$('#wd', el).onclick = async () => {
      try { await K.api('/driver/withdraw', { amount: +K.$('#wamt', el).value }); K.toast('Cash out requested'); drawEarnings(el); }
      catch (err) { K.$('#err', el).textContent = err.message; }
    };
  }

  function drawProfile(el) {
    const d = S.driver;
    el.innerHTML = `
      <div class="page-title">Profile</div>
      <div class="profile-head">
        <label class="photo" style="cursor:pointer;position:relative" title="Change photo">${photoUrl() ? `<img src="${photoUrl()}" alt="">` : K.initials(S.user.name)}<input type="file" id="ph" accept="image/*" capture="user" hidden></label>
        <span class="grow"><b style="font-size:1.2rem;display:block">${K.esc(S.user.name)}</b><span class="small muted">${K.esc(prettyPhone(S.user.phone))}</span><br>
          <span class="verified">${K.ic('check', 'sm')} Verified driver</span></span></div>
      <div class="card row" style="margin-bottom:8px"><span style="width:84px;height:52px;flex:none">${K.artFor(null, d.vehicleType)}</span>
        <span class="grow"><b>${K.esc([d.vehicleColor, d.vehicleMake].filter(Boolean).join(' ') || (d.vehicleType === 'car' ? 'Car' : 'Boda boda'))}</b><br><span class="plate-chip">${K.esc(d.plate)}</span></span>
        <span class="rating"><span class="star-ic">★</span><b>${S.user.rating || 'New'}</b></span></div>
      <button class="menu-item" data-a="trips"><span class="ic">${K.ic('receipt')}</span><span class="grow">Trip history</span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="docs"><span class="ic">${K.ic('idcard')}</span><span class="grow">Documents<br><span class="small muted">ID, driving permit, vehicle, photo</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="manual"><span class="ic">${K.ic('pin')}</span><span class="grow">${S.manual ? 'Use phone GPS' : 'Set position on map'}<br><span class="small muted">For testing without GPS</span></span></button>
      <a class="menu-item" href="tel:${K.esc(S.config.supportPhone)}"><span class="ic">${K.ic('help')}</span><span class="grow">Driver support</span>${K.ic('chev', 'sm')}</a>
      <button class="menu-item" data-a="out" style="color:var(--stop)"><span class="ic" style="background:var(--stop-soft);color:var(--stop)">${K.ic('logout')}</span><span class="grow">Log out</span></button>`;
    K.$('#ph', el).onchange = async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try { await K.api('/driver/documents', { kind: 'photo', image: await K.compressImage(f, 800) }); S.hasPhoto = true; S.photoV = Date.now(); K.toast('Photo updated'); drawProfile(el); topbar(); }
      catch (e) { K.toast(e.message); }
    };
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => ({
      trips: openTrips,
      docs: () => {
        const host = document.createElement('div'); host.className = 'page'; host.style.zIndex = 870; host.style.padding = 0;
        root.querySelector('#app').appendChild(host);
        K.verifyDocs(host, { onDone: () => host.remove(), back: () => host.remove() });
      },
      manual: () => { if (S.manual) { S.manual = false; startGps(); } else { S.manual = true; navigator.geolocation && navigator.geolocation.clearWatch(watchId); K.toast('Tap the map to move your position.'); } openTab('home'); },
      out: () => { if (S.online) setOnline(false); K.session.clear(); location.reload(); },
    })[b.dataset.a]());
  }

  async function openTrips() {
    const m = K.modal('<p class="muted">Loading…</p>');
    const list = await K.api('/trips/history').catch(() => []);
    m.el.innerHTML = `<h2>Trip history</h2>
      ${list.length ? list.map((t) => `<div class="trip-card"><span class="ic">${K.artFor(t.service)}</span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(String(t.drop.address).split(',')[0])}</span><span class="s">${K.when(t.createdAt)} · ${K.PAY_LABEL[t.paymentMethod]}</span></span>
        <span class="p">${t.status === 'completed' ? K.ugx(t.earning) : `<span class="badge bad">${t.status.replace('_', ' ')}</span>`}</span></div>`).join('') : '<p class="muted">Go online to get your first trip.</p>'}`;
  }
})();
