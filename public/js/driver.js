// Kwata driver app
(function () {
  const root = document.getElementById('root');
  const S = { user: null, driver: null, online: false, offer: null, trip: null, loc: null, manual: false, earnings: null, rating: 0, config: null };
  let map, sock, sheet, meMarker, targetMarker, routeLine, watchId, offerTimer, wakeLock, lastSent = 0;

  if (!K.token()) K.authScreen(root, { role: 'driver', title: 'Drive with Kwata', onDone: start });
  else start();

  async function start() {
    root.innerHTML = `
      <div class="app">
        <div id="map" aria-label="Map"></div>
        <div class="topbar">
          <button class="btn icon-btn" id="menuBtn" aria-label="Open menu">☰</button>
          <span class="status-pill" id="pill"><i></i><span>Offline</span></span>
          <button class="btn icon-btn" id="locBtn" aria-label="Centre on me">◎</button>
        </div>
        <section class="sheet" id="sheet" aria-live="polite"></section>
      </div>`;
    sheet = K.$('#sheet');
    map = K.map('map');
    map.on('click', (e) => { if (S.manual) setLoc(e.latlng.lat, e.latlng.lng); });
    K.$('#menuBtn').onclick = openMenu;
    K.$('#locBtn').onclick = () => S.loc && map.setView([S.loc.lat, S.loc.lng], 16);

    const [me, config] = await Promise.all([K.api('/me'), K.api('/config')]);
    S.user = me.user; S.driver = me.driver; S.config = config;
    if (S.driver.status !== 'approved') { renderPending(); return; }

    sock = K.socket(K.token());
    sock.on('connect', async () => {
      if (S.online) sock.emit('driver:online', true, () => {});
      if (S.loc) sock.emit('driver:location', S.loc);
      const a = await K.api('/trips/active').catch(() => null);
      if (a) onTrip(a);
    });
    sock.on('trip:offer', onOffer);
    sock.on('trip:offer_expired', ({ id }) => { if (S.offer && S.offer.id === id) { S.offer = null; clearInterval(offerTimer); render(); } });
    sock.on('trip:update', onTrip);
    sock.on('toast', (m) => K.toast(m.text));
    sock.on('driver:forced_offline', () => { setOnline(false); K.toast('You have been taken offline by Kwata support.'); });
    sock.on('driver:status', () => location.reload());

    startGps();
    await loadEarnings();
    const active = await K.api('/trips/active');
    if (active) onTrip(active); else render();
  }

  function renderPending() {
    const msg = {
      pending: ['Your account is being reviewed', 'The Kwata team checks every driver’s permit and vehicle. Visit our office with your driving permit, logbook and National ID to finish verification. We’ll approve you within 24 hours after that.'],
      suspended: ['Your account is paused', 'Call Kwata support to find out why and how to get back on the road.'],
      rejected: ['We could not approve your account', 'Call Kwata support for details.'],
    }[S.driver.status] || ['Account not active', ''];
    root.innerHTML = `<div class="auth"><div class="auth-card"><div class="checker"></div><h1>${msg[0]}</h1><p>${msg[1]}</p>
      <p><span class="plate">${K.esc(S.driver.plate)}</span></p>
      <a class="btn btn-block" href="tel:${K.esc(S.config.supportPhone)}">Call support</a>
      <button class="btn btn-ghost btn-block" id="out">Sign out</button></div></div>`;
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
    K.toast('Location is off. Turn it on, or tap the map to set where you are.', 6000);
    if (!S.loc) setLoc(K.KAMPALA.lat, K.KAMPALA.lng);
  }
  function setLoc(lat, lng, heading) {
    const first = !S.loc;
    S.loc = { lat, lng, heading };
    const ll = [lat, lng];
    if (!meMarker) meMarker = L.marker(ll, { icon: K.icon(K.vehicleEmoji(S.driver.vehicleType)), zIndexOffset: 1000 }).addTo(map);
    else meMarker.setLatLng(ll);
    if (first) map.setView(ll, 16);
    const now = Date.now();
    if (sock && (now - lastSent > 2500 || S.manual)) { sock.emit('driver:location', S.loc); lastSent = now; }
  }

  // ---------- online ----------
  function setOnline(on) {
    if (!on) {
      S.online = false;
      sock.emit('driver:online', false, () => {});
      releaseWake(); render(); return;
    }
    if (!S.loc) { K.toast('Waiting for your location…'); return; }
    sock.emit('driver:online', true, (res) => {
      if (!res.ok) { K.toast(res.error); return; }
      S.online = true; keepAwake(); render();
    });
  }
  async function keepAwake() { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
  function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

  async function loadEarnings() { try { S.earnings = await K.api('/driver/earnings'); } catch {} }

  // ---------- views ----------
  function render() {
    const pill = K.$('#pill');
    pill.classList.toggle('on', S.online || !!S.trip);
    pill.lastChild.textContent = S.trip ? 'On a trip' : S.online ? 'Online' : 'Offline';
    if (S.offer) return vOffer();
    if (S.trip) return S.trip.status === 'completed' ? vDone() : vTrip();
    vHome();
  }

  function vHome() {
    clearTarget();
    const e = S.earnings || { today: { net: 0, trips: 0 }, balance: 0 };
    sheet.innerHTML = `
      <div class="checker"></div>
      <div class="stat-row">
        <div class="stat"><span class="small muted">Today</span><b>${K.ugx(e.today.net)}</b><span class="small muted">${e.today.trips} trip${e.today.trips === 1 ? '' : 's'}</span></div>
        <div class="stat"><span class="small muted">Balance</span><b>${K.ugx(e.balance)}</b><button class="btn btn-ghost btn-sm" id="earn" style="padding:0">Cash out</button></div>
      </div>
      ${S.online
        ? `<p style="text-align:center"><b>You're online.</b> <span class="muted">Ride requests near you will pop up here.</span></p>
           <button class="btn online-toggle" id="tog">Go offline</button>`
        : `<button class="btn btn-primary online-toggle" id="tog">Go online</button>
           <p class="small muted" style="text-align:center;margin-top:10px">You keep ${100 - S.config.commissionPct}% of every fare.</p>`}
      ${S.manual ? '<p class="small muted" style="text-align:center">Tap the map to set your position.</p>' : ''}`;
    K.$('#tog').onclick = () => setOnline(!S.online);
    K.$('#earn').onclick = openEarnings;
  }

  function onOffer(o) {
    if (S.trip && S.trip.status !== 'completed') return;
    S.offer = o; S.offer.left = o.expiresIn;
    try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {}
    beep();
    clearInterval(offerTimer);
    offerTimer = setInterval(() => {
      if (!S.offer) return clearInterval(offerTimer);
      S.offer.left -= 1;
      const bar = K.$('#cd'); if (bar) bar.style.width = Math.max(0, (S.offer.left / S.offer.expiresIn) * 100) + '%';
      const tx = K.$('#cdt'); if (tx) tx.textContent = Math.max(0, S.offer.left) + 's';
      if (S.offer.left <= 0) { S.offer = null; clearInterval(offerTimer); render(); }
    }, 1000);
    showTarget(o.pickup, '🙋');
    render();
  }

  function vOffer() {
    const o = S.offer;
    sheet.innerHTML = `
      <div class="checker"></div>
      <div class="row"><h2 style="margin:0">New ${K.esc(K.SERVICE_LABEL[o.service])} request</h2><span class="small muted" id="cdt" style="flex:none">${o.left}s</span></div>
      <div class="countdown"><i id="cd" style="width:${(o.left / o.expiresIn) * 100}%"></i></div>
      <div class="row" style="align-items:flex-end;margin-bottom:10px">
        <div><span class="small muted">You earn</span><div class="offer-fare">${K.ugx(o.earning || o.fare - Math.round(o.fare * S.config.commissionPct / 100))}</div></div>
        <div style="text-align:right"><span class="small muted">Fare</span><br><b>${K.ugx(o.fare)}</b><br><span class="small">${K.PAY_LABEL[o.paymentMethod]}</span></div>
      </div>
      <div class="route-line">
        <span class="dot dot-pick"></span><span><b>${K.esc(o.pickup.address)}</b><br><span class="small muted">${o.pickupKm} km away</span></span>
        <span class="bar"></span><span></span>
        <span class="dot dot-drop"></span><span><b>${K.esc(o.drop.address)}</b><br><span class="small muted">${o.distanceKm.toFixed(1)} km trip · ~${Math.round(o.durationMin)} min</span></span>
      </div>
      <p class="small">${K.esc(o.rider.name.split(' ')[0])} ${o.rider.rating ? '★ ' + o.rider.rating : '· new rider'}</p>
      <div class="actions"><button class="btn" id="no" style="flex:.6">Decline</button><button class="btn btn-primary" id="yes">Accept</button></div>`;
    K.$('#yes').onclick = () => respond(true);
    K.$('#no').onclick = () => respond(false);
  }

  function respond(accept) {
    const id = S.offer.id;
    clearInterval(offerTimer);
    sock.emit('trip:respond', { tripId: id, accept }, (res) => {
      S.offer = null;
      if (!res.ok) { K.toast(res.error); render(); return; }
      if (!accept) { clearTarget(); render(); }
      // on accept the server sends trip:update
    });
  }

  function onTrip(t) {
    if (t.status === 'cancelled' || t.status === 'requested') {
      if (S.trip && S.trip.id === t.id) {
        if (t.cancelledBy === 'rider') K.toast('The rider cancelled this trip.');
        S.trip = null; render();
      }
      return;
    }
    if (S.trip && t.id < S.trip.id) return;
    S.trip = t; S.offer = null;
    if (t.status === 'completed') loadEarnings();
    render();
  }

  function navLink(p) { return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=${S.driver.vehicleType === 'boda' ? 'two-wheeler' : 'driving'}`; }

  function vTrip() {
    const t = S.trip;
    const toPickup = t.status !== 'in_progress';
    const target = toPickup ? t.pickup : t.drop;
    showTarget(target, toPickup ? '🙋' : '📍');
    const parcel = t.parcel ? `<div style="background:var(--mist);border-radius:12px;padding:10px 12px;margin:10px 0" class="small">📦 <b>${K.esc(t.parcel.item)}</b><br>Deliver to ${K.esc(t.parcel.recipientName)} · <a href="tel:${K.esc(t.parcel.recipientPhone)}">${K.esc(t.parcel.recipientPhone)}</a></div>` : '';
    sheet.innerHTML = `
      <div class="checker"></div>
      <p class="status-line">${{ accepted: 'Pick up ' + K.esc(t.rider.name.split(' ')[0]), arrived: 'Waiting for ' + K.esc(t.rider.name.split(' ')[0]), in_progress: t.service === 'parcel' ? 'Deliver the parcel' : 'Drive to destination' }[t.status]}</p>
      <p class="small muted">${toPickup ? 'Pickup' : 'Drop-off'}: <b style="color:var(--ink)">${K.esc(target.address)}</b></p>
      ${parcel}
      <div class="actions">
        <a class="btn" href="${navLink(target)}" target="_blank" rel="noopener">🧭 Navigate</a>
        ${t.rider.phone ? `<a class="btn" href="tel:${K.esc(t.rider.phone)}">📞 Call</a>` : ''}
        <button class="btn btn-danger" id="sos" style="flex:.5" aria-label="Emergency SOS">SOS</button>
      </div>
      ${t.status === 'accepted' ? '<button class="btn btn-lake btn-block" id="arr" style="margin-top:12px">I have arrived</button>' : ''}
      ${t.status === 'arrived' || t.status === 'accepted' ? `
        <label for="pin" style="margin-top:14px">Rider's 4-digit PIN</label>
        <input id="pin" class="pin-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····">
        <p class="error" id="err"></p>
        <button class="btn btn-primary btn-block" id="start">Start trip</button>` : ''}
      ${t.status === 'in_progress' ? `<p class="small muted" style="margin-top:12px">${t.paymentMethod === 'cash' ? 'Collect <b>' + K.ugx(t.fare) + '</b> in cash at the end.' : 'Rider pays by ' + K.PAY_LABEL[t.paymentMethod] + '.'}</p>
        <p class="error" id="err"></p><button class="btn btn-primary btn-block" id="done">Complete trip</button>` : ''}
      ${toPickup ? '<button class="btn btn-ghost btn-block btn-sm" id="cancel" style="margin-top:6px">Cancel trip</button>' : ''}`;
    const go = (id, fn) => { const b = K.$('#' + id); if (b) b.onclick = fn; };
    go('arr', () => step('arrived'));
    go('start', () => step('start', { pin: K.$('#pin').value }));
    go('done', () => step('complete'));
    go('cancel', async () => { if (confirm('Cancel? The rider will be matched with another driver.')) { await K.api(`/trips/${t.id}/cancel`, {}).catch((e) => K.toast(e.message)); S.trip = null; render(); } });
    go('sos', async () => {
      if (!confirm('Send an emergency alert to the Kwata safety team?')) return;
      await K.api(`/trips/${t.id}/sos`, S.loc || {}).catch(() => {});
      K.modal(`<h2>Alert sent</h2><p>Our safety team has your location.</p><a class="btn btn-danger btn-block" href="tel:999">Call Police (999)</a><button class="btn btn-ghost btn-block" data-close>Close</button>`);
    });
  }

  async function step(action, body) {
    const btns = sheet.querySelectorAll('button'); btns.forEach((b) => b.disabled = true);
    try { await K.api(`/trips/${S.trip.id}/${action}`, body || {}); }
    catch (e) { const err = K.$('#err'); if (err) err.textContent = e.message; else K.toast(e.message); btns.forEach((b) => b.disabled = false); }
  }

  function vDone() {
    const t = S.trip;
    clearTarget();
    sheet.innerHTML = `
      <div class="checker"></div>
      <h2>Trip complete</h2>
      ${t.paymentMethod === 'cash' ? `<p>Collect cash</p><p class="money">${K.ugx(t.fare)}</p>` : `<p class="money">${K.ugx(t.earning)}</p><p class="small muted">${t.paymentStatus === 'paid' ? 'Added to your balance' : 'Will be added once the rider pays by ' + K.PAY_LABEL[t.paymentMethod]}</p>`}
      ${!t.driverRated ? `<h3 style="text-align:center;margin-top:12px">Rate ${K.esc(t.rider.name.split(' ')[0])}</h3>
        <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} stars" class="${n <= S.rating ? 'on' : ''}">★</button>`).join('')}</div>` : ''}
      <button class="btn btn-primary btn-block" id="next">${S.online ? 'Find next ride' : 'Back to map'}</button>`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { S.rating = +b.dataset.n; vDone(); });
    K.$('#next').onclick = async () => {
      if (S.rating && !t.driverRated) await K.api(`/trips/${t.id}/rate`, { stars: S.rating }).catch(() => {});
      S.rating = 0; S.trip = null; render();
    };
  }

  // ---------- map helpers ----------
  async function showTarget(p, emoji) {
    if (targetMarker && targetMarker._key === `${p.lat},${p.lng}`) return;
    clearTarget();
    targetMarker = L.marker([p.lat, p.lng], { icon: K.icon(emoji) }).addTo(map);
    targetMarker._key = `${p.lat},${p.lng}`;
    if (S.loc) {
      const r = await K.route(S.loc, p);
      if (!targetMarker || targetMarker._key !== `${p.lat},${p.lng}`) return;
      routeLine = L.polyline(r.coords, { color: '#0B3954', weight: 5, opacity: .85 }).addTo(map);
      const pad = window.innerWidth >= 760 ? { paddingTopLeft: [440, 80], paddingBottomRight: [40, 40] } : { paddingTopLeft: [30, 90], paddingBottomRight: [30, sheet.offsetHeight + 20] };
      map.fitBounds(routeLine.getBounds(), pad);
    }
  }
  function clearTarget() {
    [targetMarker, routeLine].forEach((l) => l && map.removeLayer(l));
    targetMarker = routeLine = null;
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, .35].forEach((d) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(.25, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + d + .3);
        o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .3);
      });
    } catch {}
  }

  // ---------- menu & earnings ----------
  function openMenu() {
    const m = K.modal(`
      <div class="checker"></div>
      <div class="driver-card" style="margin-bottom:10px"><div class="avatar">${K.initials(S.user.name)}</div>
        <div><b>${K.esc(S.user.name)}</b><br><span class="small muted">${K.esc(S.driver.vehicleMake || '')} <span class="plate" style="font-size:.8rem;padding:3px 6px">${K.esc(S.driver.plate)}</span></span>
        ${S.user.rating ? `<br><span class="small">★ ${S.user.rating}</span>` : ''}</div></div>
      <button class="menu-item" data-a="earn">💰 Earnings & cash out</button>
      <button class="menu-item" data-a="trips">🧾 Trip history</button>
      <button class="menu-item" data-a="manual">📍 ${S.manual ? 'Use phone GPS' : 'Set location on map (testing)'}</button>
      <a class="menu-item" href="tel:${K.esc(S.config.supportPhone)}" style="text-decoration:none">☎️ Driver support</a>
      <button class="menu-item" data-a="out">Sign out</button>`, { drawer: true });
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
      <div class="checker"></div><h2>Earnings</h2>
      <p class="small muted">Balance you can cash out</p>
      <p class="money">${K.ugx(e.balance)}</p>
      <div class="stat-row"><div class="stat"><span class="small muted">Today</span><b>${K.ugx(e.today.net)}</b></div><div class="stat"><span class="small muted">Last 7 days</span><b>${K.ugx(e.week.net)}</b><span class="small muted">${e.week.trips} trips</span></div></div>
      ${e.balance < 0 ? '<p class="small">Your balance is negative because Kwata’s commission on cash trips is deducted here. It clears automatically from your next Mobile Money or wallet trips.</p>' : ''}
      <label for="wamt">Cash out to ${K.esc(e.momoNumber)}</label>
      <div class="row"><input id="wamt" type="number" inputmode="numeric" min="${S.config.minWithdrawal}" value="${Math.max(0, e.balance)}"><button class="btn btn-primary" id="wd" style="flex:none">Cash out</button></div>
      <p class="error" id="err"></p>
      ${e.withdrawals.length ? `<h3>Cash outs</h3>${e.withdrawals.map((w) => `<div class="tx"><span>${K.when(w.created_at)}</span><span>${K.ugx(w.amount)} <span class="badge ${w.status === 'paid' ? 'ok' : w.status === 'rejected' ? 'bad' : 'warn'}">${w.status}</span></span></div>`).join('')}` : ''}
      <h3 style="margin-top:12px">Activity</h3>
      ${e.transactions.length ? e.transactions.map((x) => `<div class="tx"><span>${K.esc(x.note || x.type)}<br><span class="small muted">${K.when(x.created_at)}</span></span><span class="${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${K.ugx(x.amount)}</span></div>`).join('') : '<p class="small muted">Complete your first trip to see earnings here.</p>'}
      <button class="btn btn-ghost btn-block" data-close>Close</button>`;
    K.$('#wd', m.el).onclick = async () => {
      try { await K.api('/driver/withdraw', { amount: +K.$('#wamt', m.el).value }); K.toast('Cash out requested. Usually paid within a few hours.'); m.close(); await loadEarnings(); render(); }
      catch (err) { K.$('#err', m.el).textContent = err.message; }
    };
  }

  async function openTrips() {
    const m = K.modal('<p class="muted">Loading…</p>');
    const list = await K.api('/trips/history');
    m.el.innerHTML = `<div class="checker"></div><h2>Trip history</h2>
      ${list.length ? `<ul class="list">${list.map((t) => `<li><span class="grow"><b>${K.esc(t.pickup.address)} → ${K.esc(t.drop.address)}</b><br><span class="small muted">${K.when(t.createdAt)} · ${K.PAY_LABEL[t.paymentMethod]}</span></span><b>${t.status === 'completed' ? K.ugx(t.earning) : t.status}</b></li>`).join('')}</ul>` : '<p class="muted">Go online to get your first ride.</p>'}
      <button class="btn btn-ghost btn-block" data-close>Close</button>`;
  }
})();
