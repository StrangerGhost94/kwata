// Kwata rider app
(function () {
  const root = document.getElementById('root');
  const S = {
    view: 'home', pickup: null, drop: null, route: null, quote: null,
    service: 'boda', payment: 'cash', trip: null, user: null, config: null,
    rating: 0, editing: 'drop',
  };
  let map, sock, pickupMarker, dropMarker, driverMarker, routeLine, nearbyLayer, meMarker;
  let sheet, revTimer, searchTimer, nearbyTimer;

  const params = new URLSearchParams(location.search);
  if (params.get('payment')) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => K.toast(params.get('payment') === 'success' ? 'Payment received ✅' : 'Payment was not completed. Try again from the trip screen.'), 600);
  }

  if (!K.token()) K.authScreen(root, { role: 'rider', title: 'Ride with Kwata', onDone: start });
  else start();

  async function start() {
    root.innerHTML = `
      <div class="app">
        <div id="map" aria-label="Map"></div>
        <div class="center-pin" id="cpin" aria-hidden="true"></div>
        <div class="topbar">
          <button class="btn icon-btn" id="menuBtn" aria-label="Open menu">☰</button>
          <span class="brand"><span class="brand-dot"></span>Kwata</span>
          <button class="btn icon-btn" id="locBtn" aria-label="Go to my location">◎</button>
        </div>
        <section class="sheet" id="sheet" aria-live="polite"></section>
      </div>`;
    sheet = K.$('#sheet');
    map = K.map('map');
    nearbyLayer = L.layerGroup().addTo(map);
    map.on('moveend', onMapMove);
    K.$('#menuBtn').onclick = openMenu;
    K.$('#locBtn').onclick = locate;

    try {
      const [me, config, active] = await Promise.all([K.api('/me'), K.api('/config'), K.api('/trips/active')]);
      S.user = me.user; S.config = config;
      sock = K.socket(K.token());
      sock.on('trip:update', onTrip);
      sock.on('driver:location', (p) => { if (S.trip && p.tripId === S.trip.id) moveDriver(p); });
      sock.on('toast', (m) => K.toast(m.text));
      sock.on('connect', async () => { // resync after reconnect
        const a = await K.api('/trips/active').catch(() => null);
        if (a) onTrip(a);
      });
      if (active) { onTrip(active); } else { locate(true); render(); }
      nearbyTimer = setInterval(loadNearby, 10000);
    } catch (e) { sheet.innerHTML = `<p class="error">${K.esc(e.message)}</p><button class="btn btn-block" onclick="location.reload()">Try again</button>`; }
  }

  // ---------- location ----------
  function locate(silent) {
    if (!navigator.geolocation) { setPickupFromCenter(); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      const ll = [p.coords.latitude, p.coords.longitude];
      if (!meMarker) meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="mk-me"></div>', iconSize: [18, 18] }), interactive: false }).addTo(map);
      else meMarker.setLatLng(ll);
      if (S.view === 'home') map.setView(ll, 16); else if (!silent) map.panTo(ll);
    }, () => { if (!silent) K.toast('Turn on location so drivers can find you. Or drag the map to your spot.'); setPickupFromCenter(); },
    { enableHighAccuracy: true, timeout: 10000 });
  }

  function onMapMove() { if (S.view === 'home') setPickupFromCenter(); }
  function setPickupFromCenter() {
    const c = map.getCenter();
    S.pickup = { lat: c.lat, lng: c.lng, address: 'Finding address…' };
    updatePickupLabel();
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      const addr = await K.reverse(c.lat, c.lng);
      if (S.pickup && S.pickup.lat === c.lat) { S.pickup.address = addr; updatePickupLabel(); }
    }, 500);
    loadNearby();
  }
  function updatePickupLabel() { const el = K.$('#pickLabel'); if (el) el.textContent = S.pickup.address; }

  async function loadNearby() {
    if (!['home', 'choose'].includes(S.view) || !S.pickup) return;
    try {
      const list = await K.api(`/drivers/nearby?lat=${S.pickup.lat}&lng=${S.pickup.lng}`);
      nearbyLayer.clearLayers();
      list.forEach((d) => L.marker([d.lat, d.lng], { icon: K.icon(K.vehicleEmoji(d.vehicle)), interactive: false }).addTo(nearbyLayer));
      const n = K.$('#nearby');
      if (n) n.textContent = list.length ? `${list.length} driver${list.length > 1 ? 's' : ''} nearby` : 'Drivers are joining Kwata every day';
    } catch {}
  }

  // ---------- views ----------
  function render() {
    K.$('#cpin').classList.toggle('hidden', S.view !== 'home');
    const v = { home: vHome, search: vSearch, choose: vChoose, searching: vSearching, trip: vTrip, done: vDone, none: vNone }[S.view];
    v();
  }

  function vHome() {
    clearRoute();
    sheet.innerHTML = `
      <div class="checker"></div>
      <h2>Hi ${K.esc(S.user.name.split(' ')[0])}, where to?</h2>
      <div class="route-line"><span class="dot dot-pick"></span><span class="small"><span class="muted">Pickup · drag the map to adjust</span><br><b id="pickLabel">${K.esc(S.pickup ? S.pickup.address : 'Finding you…')}</b></span></div>
      <button class="where btn-block" id="whereBtn" style="border:0;cursor:text;text-align:left;font:inherit;color:var(--ink-2)"><span class="dot dot-drop"></span><span style="padding:14px 0">Search destination</span></button>
      <div class="chips" style="margin-top:10px">${K.PLACES.slice(0, 6).map((p, i) => `<button class="chip" data-p="${i}">${K.esc(p.name)}</button>`).join('')}</div>
      <p class="small muted" id="nearby" style="margin:4px 0 0"></p>`;
    K.$('#whereBtn').onclick = () => { S.view = 'search'; S.editing = 'drop'; render(); };
    sheet.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => chooseDrop(K.PLACES[+b.dataset.p]));
    loadNearby();
  }

  function vSearch() {
    const editingPick = S.editing === 'pick';
    sheet.innerHTML = `
      <div class="row" style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" id="back" style="flex:none">← Back</button><h3 style="margin:0">${editingPick ? 'Change pickup' : 'Where are you going?'}</h3></div>
      <div class="where"><span class="dot ${editingPick ? 'dot-pick' : 'dot-drop'}"></span>
        <input id="q" placeholder="${editingPick ? 'Pickup place' : 'Destination, e.g. Kisementi'}" autocomplete="off" aria-label="Search places"></div>
      <ul class="results" id="res"></ul>`;
    K.$('#back').onclick = () => { S.view = S.drop && S.quote ? 'choose' : 'home'; render(); };
    const q = K.$('#q');
    const res = K.$('#res');
    const show = (items, heading) => {
      res.innerHTML = (heading ? `<li class="small muted" style="padding:10px 6px 4px">${heading}</li>` : '') + (items.length ? items.map((p, i) => `<li><button data-i="${i}"><b>${K.esc(p.name)}</b><span class="sub">${K.esc(p.address)}</span></button></li>`).join('') : '<li class="small muted" style="padding:12px 6px">No places found. Try a nearby landmark or the area name.</li>');
      res.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => (editingPick ? choosePick : chooseDrop)(items[+b.dataset.i]));
    };
    show(K.PLACES, 'Popular in Kampala');
    q.oninput = () => {
      clearTimeout(searchTimer);
      const text = q.value.trim();
      if (text.length < 3) { show(K.PLACES, 'Popular in Kampala'); return; }
      searchTimer = setTimeout(async () => {
        res.innerHTML = '<li class="small muted" style="padding:12px 6px">Searching…</li>';
        try { show(await K.search(text)); } catch { res.innerHTML = '<li class="error">Search is not responding. Check your connection.</li>'; }
      }, 450);
    };
    q.focus();
  }

  function choosePick(p) { S.pickup = { lat: p.lat, lng: p.lng, address: p.name }; map.setView([p.lat, p.lng], 16, { animate: false }); prepareQuote(); }
  function chooseDrop(p) { S.drop = { lat: p.lat, lng: p.lng, address: p.name + (p.address && !p.address.startsWith(p.name) ? ', ' + p.address.split(',')[0] : '') }; if (p.name === 'Entebbe Airport') S.service = 'airport'; prepareQuote(); }

  async function prepareQuote() {
    if (!S.pickup) setPickupFromCenter();
    S.view = 'choose';
    sheet.innerHTML = '<div class="checker"></div><p class="muted">Working out your fare…</p>';
    K.$('#cpin').classList.add('hidden');
    S.route = await K.route(S.pickup, S.drop);
    drawRoute(S.route.coords);
    try {
      S.quote = await K.api('/fare/estimate', { pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.min });
      if (!S.quote.options.find((o) => o.id === S.service)) S.service = S.quote.options[0].id;
      render();
    } catch (e) { sheet.innerHTML = `<p class="error">${K.esc(e.message)}</p><button class="btn btn-block" id="b">Back</button>`; K.$('#b').onclick = reset; }
  }

  function vChoose() {
    const q = S.quote;
    const sel = q.options.find((o) => o.id === S.service);
    const pays = ['cash', 'momo', 'wallet', 'card'];
    sheet.innerHTML = `
      <div class="row" style="margin-bottom:6px"><button class="btn btn-ghost btn-sm" id="back" style="flex:none">← Back</button>
        <span class="small muted" style="text-align:right">${q.distanceKm.toFixed(1)} km · about ${Math.round(q.durationMin)} min</span></div>
      <div class="route-line">
        <span class="dot dot-pick"></span><button class="btn-ghost small" id="editPick" style="border:0;background:none;text-align:left;padding:0;font:inherit;color:inherit;cursor:pointer"><b>${K.esc(S.pickup.address)}</b></button>
        <span class="bar"></span><span></span>
        <span class="dot dot-drop"></span><button class="small" id="editDrop" style="border:0;background:none;text-align:left;padding:0;font:inherit;color:inherit;cursor:pointer"><b>${K.esc(S.drop.address)}</b></button>
      </div>
      <div role="radiogroup" aria-label="Ride type">
      ${q.options.map((o) => `
        <button class="opt" data-s="${o.id}" aria-pressed="${o.id === S.service}">
          <span class="opt-icon" aria-hidden="true">${o.icon}</span>
          <span class="grow"><span class="opt-name">${K.esc(o.name)}</span> ${o.seats ? `<span class="small muted">· ${o.seats} seat${o.seats > 1 ? 's' : ''}</span>` : ''}<br>
          <span class="small muted">${K.esc(o.blurb)}</span>${o.surge > 1 ? ` <span class="surge">Busy ×${o.surge}</span>` : ''}</span>
          <span class="opt-fare">${K.ugx(o.fare)}</span>
        </button>`).join('')}
      </div>
      ${S.service === 'parcel' ? `
        <div id="parcel"><label for="pr-name">Who receives it?</label>
        <div class="row"><input id="pr-name" placeholder="Recipient name"><input id="pr-phone" type="tel" placeholder="Their phone"></div>
        <label for="pr-item">What are you sending?</label><input id="pr-item" placeholder="e.g. Documents in an envelope"></div>` : ''}
      <label>Pay with</label>
      <div class="chips" role="radiogroup" aria-label="Payment method">
        ${pays.map((p) => `<button class="chip" data-pay="${p}" aria-pressed="${p === S.payment}">${K.PAY_LABEL[p]}${p === 'wallet' ? ` (${K.ugx(S.user.walletBalance)})` : ''}</button>`).join('')}
      </div>
      <div class="sticky-cta"><p class="error" id="err" style="margin-top:0"></p>
      <button class="btn btn-primary btn-block" id="book">Book ${K.esc(sel.name)} · ${K.ugx(sel.fare)}</button></div>`;
    K.$('#back').onclick = reset;
    K.$('#editPick').onclick = () => { S.view = 'search'; S.editing = 'pick'; render(); };
    K.$('#editDrop').onclick = () => { S.view = 'search'; S.editing = 'drop'; render(); };
    sheet.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { S.service = b.dataset.s; render(); });
    sheet.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => { S.payment = b.dataset.pay; render(); });
    K.$('#book').onclick = book;
    loadNearby();
  }

  async function book() {
    const btn = K.$('#book'), err = K.$('#err');
    btn.disabled = true; err.textContent = '';
    const body = { service: S.service, paymentMethod: S.payment, pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.min };
    if (S.service === 'parcel') body.parcel = { recipientName: K.$('#pr-name').value, recipientPhone: K.$('#pr-phone').value, item: K.$('#pr-item').value };
    try { onTrip(await K.api('/trips', body)); }
    catch (e) { err.textContent = e.message; btn.disabled = false; if (/wallet/i.test(e.message)) openWallet(); }
  }

  function vSearching() {
    const t = S.trip;
    sheet.innerHTML = `
      <div class="checker"></div>
      <div class="pulse" aria-hidden="true">${S.config.services.find((s) => s.id === t.service)?.icon || '🏍️'}</div>
      <h2 style="text-align:center">Finding your driver</h2>
      <p class="muted" style="text-align:center">We're asking the closest ${K.esc(K.SERVICE_LABEL[t.service] || '')} drivers. This usually takes under a minute.</p>
      <p style="text-align:center"><b>${K.ugx(t.fare)}</b> · ${K.PAY_LABEL[t.paymentMethod]}</p>
      <button class="btn btn-block" id="cancel">Cancel request</button>`;
    K.$('#cancel').onclick = cancelTrip;
  }

  function vNone() {
    sheet.innerHTML = `<div class="checker"></div><h2>No drivers free right now</h2>
      <p class="muted">All nearby drivers are busy. Try again in a few minutes, or pick a different ride type.</p>
      <div class="actions"><button class="btn" id="home">Back</button><button class="btn btn-primary" id="again">Try again</button></div>`;
    K.$('#home').onclick = reset;
    K.$('#again').onclick = () => { S.view = 'choose'; render(); };
  }

  function vTrip() {
    const t = S.trip, d = t.driver;
    const statusText = {
      accepted: d.location ? `${d.name.split(' ')[0]} is on the way · about ${etaMin(d.location, t.pickup)} min` : `${d.name.split(' ')[0]} is on the way`,
      arrived: 'Your driver is here',
      in_progress: t.service === 'parcel' ? 'Your parcel is on its way' : 'On the way to your destination',
    }[t.status];
    sheet.innerHTML = `
      <div class="checker"></div>
      <p class="status-line">${K.esc(statusText)}</p>
      <p class="small muted" style="margin-bottom:14px">${t.status === 'in_progress' ? 'To ' + K.esc(t.drop.address) : 'Pickup at ' + K.esc(t.pickup.address)}</p>
      <div class="driver-card">
        <div class="avatar" aria-hidden="true">${K.initials(d.name)}</div>
        <div class="grow"><b>${K.esc(d.name)}</b> ${d.rating ? `<span class="small">★ ${d.rating}</span>` : '<span class="small muted">New driver</span>'}<br>
          <span class="small muted">${K.esc(d.vehicle || K.SERVICE_LABEL[t.service])}</span></div>
        <span class="plate">${K.esc(d.plate)}</span>
      </div>
      ${t.status !== 'in_progress' ? `<div style="margin-top:16px;padding:14px;background:var(--mist);border-radius:14px;display:flex;align-items:center;justify-content:space-between">
        <span class="small"><b>Your PIN</b><br><span class="muted">Tell your driver to start the trip</span></span><span class="pin">${t.pin}</span></div>` : ''}
      <div class="actions">
        ${d.phone ? `<a class="btn" href="tel:${K.esc(d.phone)}">📞 Call</a>` : ''}
        <button class="btn" id="share">Share trip</button>
        <button class="btn btn-danger" id="sos" aria-label="Emergency SOS">SOS</button>
      </div>
      <p class="small muted" style="margin:12px 0 0">${K.ugx(t.fare)} · ${K.PAY_LABEL[t.paymentMethod]}</p>
      ${t.status !== 'in_progress' ? '<button class="btn btn-ghost btn-block btn-sm" id="cancel" style="margin-top:6px">Cancel ride</button>' : ''}`;
    K.$('#share').onclick = () => K.share(location.origin + '/t/' + t.shareToken, `Follow my Kwata ride live: ${d.name}, ${d.plate}`);
    K.$('#sos').onclick = sos;
    const c = K.$('#cancel'); if (c) c.onclick = cancelTrip;
  }

  function vDone() {
    const t = S.trip;
    const needsPay = t.paymentStatus === 'pending' && ['momo', 'card'].includes(t.paymentMethod);
    sheet.innerHTML = `
      <div class="checker"></div>
      <h2>${t.service === 'parcel' ? 'Parcel delivered' : 'You have arrived'}</h2>
      <p class="muted">${K.esc(t.drop.address)}</p>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:10px 0 4px"><span>Total</span><span class="money">${K.ugx(t.fare)}</span></div>
      <p class="small muted">${t.paymentMethod === 'cash' ? 'Pay your driver in cash.' : needsPay ? `Pay with ${K.PAY_LABEL[t.paymentMethod]} to finish.` : `Paid with ${K.PAY_LABEL[t.paymentMethod]} ✅`}</p>
      ${needsPay ? `<button class="btn btn-primary btn-block" id="pay">Pay ${K.ugx(t.fare)} with ${K.PAY_LABEL[t.paymentMethod]}</button><p class="error" id="err"></p>` : ''}
      ${!t.riderRated ? `<h3 style="text-align:center;margin-top:16px">How was ${K.esc(t.driver.name.split(' ')[0])}?</h3>
        <div class="stars" role="radiogroup" aria-label="Rate your driver">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} star${n > 1 ? 's' : ''}" class="${n <= S.rating ? 'on' : ''}">★</button>`).join('')}</div>
        <button class="btn btn-lake btn-block" id="rate" ${S.rating ? '' : 'disabled'}>Submit rating</button>` : ''}
      ${(t.riderRated && !needsPay) ? '<button class="btn btn-block" id="done">Done</button>' : ''}
      ${!t.riderRated && !needsPay ? '<button class="btn btn-ghost btn-block btn-sm" id="skip">Skip</button>' : ''}`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { S.rating = +b.dataset.n; render(); });
    const pay = K.$('#pay');
    if (pay) pay.onclick = async () => {
      pay.disabled = true;
      try {
        const out = await K.api(`/trips/${t.id}/pay`, {});
        if (out.link) location.href = out.link; else { K.toast('Payment received ✅'); onTrip(await K.api('/trips/active') || { ...t, paymentStatus: 'paid' }); }
      } catch (e) { K.$('#err').textContent = e.message; pay.disabled = false; }
    };
    const rate = K.$('#rate');
    if (rate) rate.onclick = async () => {
      rate.disabled = true;
      await K.api(`/trips/${t.id}/rate`, { stars: S.rating }).catch(() => {});
      S.trip.riderRated = true; S.rating = 0;
      if (t.paymentStatus === 'pending' && ['momo', 'card'].includes(t.paymentMethod)) render(); else { K.toast('Thanks for riding with Kwata'); reset(); }
    };
    ['done', 'skip'].forEach((id) => { const b = K.$('#' + id); if (b) b.onclick = reset; });
  }

  // ---------- trip events ----------
  function onTrip(t) {
    if (!t) return;
    if (S.trip && t.id < S.trip.id) return; // stale update from an older trip
    S.trip = t;
    if (t.status === 'requested') S.view = 'searching';
    else if (['accepted', 'arrived', 'in_progress'].includes(t.status)) S.view = 'trip';
    else if (t.status === 'completed') S.view = 'done';
    else if (t.status === 'no_drivers') S.view = 'none';
    else if (t.status === 'cancelled') { if (t.cancelledBy === 'rider') { reset(); return; } S.view = 'none'; }
    S.pickup = t.pickup; S.drop = t.drop;
    if (S.view !== 'home') {
      if (!routeLine) { K.route(t.pickup, t.drop).then((r) => drawRoute(r.coords)); }
      if (t.driver && t.driver.location) moveDriver(t.driver.location);
    }
    if (S.view === 'done' && driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    render();
  }

  function moveDriver(p) {
    if (!S.trip || !S.trip.driver) return;
    const ll = [p.lat, p.lng];
    if (!driverMarker) driverMarker = L.marker(ll, { icon: K.icon(K.vehicleEmoji(S.trip.driver.vehicleType)), zIndexOffset: 1000 }).addTo(map);
    else driverMarker.setLatLng(ll);
    S.trip.driver.location = p;
    if (S.trip.status === 'accepted') {
      const sl = K.$('.status-line');
      if (sl) sl.textContent = `${S.trip.driver.name.split(' ')[0]} is on the way · about ${etaMin(p, S.trip.pickup)} min`;
    }
  }

  function etaMin(a, b) {
    const R = 6371, toR = (x) => x * Math.PI / 180;
    const h = Math.sin(toR(b.lat - a.lat) / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(toR(b.lng - a.lng) / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(h)) * 1.3;
    return Math.max(1, Math.round((km / 20) * 60));
  }

  async function cancelTrip() {
    if (!confirm('Cancel this ride?')) return;
    try { await K.api(`/trips/${S.trip.id}/cancel`, { reason: 'rider' }); reset(); } catch (e) { K.toast(e.message); }
  }

  async function sos() {
    if (!confirm('Send an emergency alert to the Kwata safety team? Call 999 or 112 if you are in immediate danger.')) return;
    const send = async (lat, lng) => {
      try {
        const out = await K.api(`/trips/${S.trip.id}/sos`, { lat, lng });
        const link = location.origin + '/t/' + out.shareToken;
        const m = K.modal(`<div class="checker"></div><h2>Help is being alerted</h2>
          <p>The Kwata safety team has your live location.</p>
          <a class="btn btn-danger btn-block" href="tel:999">Call Police (999)</a>
          ${out.emergencyContact ? `<a class="btn btn-block" style="margin-top:10px" href="sms:${out.emergencyContact}?body=${encodeURIComponent('I need help. Follow my Kwata ride: ' + link)}">Text my emergency contact</a>` : ''}
          <button class="btn btn-block" style="margin-top:10px" id="sh">Share my live trip link</button>
          <button class="btn btn-ghost btn-block" data-close>Close</button>`);
        K.$('#sh', m.el).onclick = () => K.share(link, 'I need help. Follow my Kwata ride live');
      } catch (e) { K.toast(e.message); }
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => send(p.coords.latitude, p.coords.longitude), () => send(), { timeout: 5000 });
    else send();
  }

  // ---------- map drawing ----------
  function drawRoute(coords) {
    clearRoute();
    routeLine = L.polyline(coords, { color: getComputedStyle(document.documentElement).getPropertyValue('--lake').trim() || '#0B3954', weight: 5, opacity: .9 }).addTo(map);
    pickupMarker = L.marker(coords[0], { icon: L.divIcon({ className: '', html: '<div class="mk-me"></div>', iconSize: [18, 18] }) }).addTo(map);
    dropMarker = L.marker(coords[coords.length - 1], { icon: K.icon('📍') }).addTo(map);
    const pad = window.innerWidth >= 760 ? { paddingTopLeft: [440, 80], paddingBottomRight: [40, 40] } : { paddingTopLeft: [30, 90], paddingBottomRight: [30, sheet.offsetHeight + 20] };
    map.fitBounds(routeLine.getBounds(), pad);
  }
  function clearRoute() {
    [routeLine, pickupMarker, dropMarker].forEach((l) => l && map.removeLayer(l));
    routeLine = pickupMarker = dropMarker = null;
  }

  function reset() {
    S.view = 'home'; S.drop = null; S.quote = null; S.route = null; S.trip = null; S.rating = 0;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    clearRoute();
    K.api('/me').then((m) => { S.user = m.user; }).catch(() => {});
    if (S.pickup) map.setView([S.pickup.lat, S.pickup.lng], 16);
    render();
  }

  // ---------- menu ----------
  function openMenu() {
    const m = K.modal(`
      <div class="checker"></div>
      <div class="driver-card" style="margin-bottom:10px"><div class="avatar">${K.initials(S.user.name)}</div>
        <div><b>${K.esc(S.user.name)}</b><br><span class="small muted">${K.esc(S.user.phone)}${S.user.rating ? ' · ★ ' + S.user.rating : ''}</span></div></div>
      <button class="menu-item" data-a="wallet">💳 Wallet <span class="grow"></span><b>${K.ugx(S.user.walletBalance)}</b></button>
      <button class="menu-item" data-a="trips">🧾 Your trips</button>
      <button class="menu-item" data-a="safety">🛡️ Safety & emergency contact</button>
      <a class="menu-item" href="tel:${K.esc(S.config.supportPhone)}" style="text-decoration:none">☎️ Call support</a>
      <a class="menu-item" href="/driver" style="text-decoration:none">🏍️ Drive with Kwata</a>
      <button class="menu-item" data-a="out">Sign out</button>`, { drawer: true });
    m.el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      m.close();
      ({ wallet: openWallet, trips: openTrips, safety: openSafety, out: () => { K.session.clear(); location.reload(); } })[b.dataset.a]();
    });
  }

  async function openWallet() {
    const m = K.modal('<p class="muted">Loading wallet…</p>');
    const w = await K.api('/wallet');
    m.el.innerHTML = `
      <div class="checker"></div><h2>Kwata Wallet</h2>
      <p class="money">${K.ugx(w.balance)}</p>
      <p class="small muted">Top up once with Mobile Money and every ride pays itself.</p>
      <div class="chips">${[10000, 20000, 50000].map((a) => `<button class="chip" data-amt="${a}">${K.ugx(a)}</button>`).join('')}</div>
      <label for="amt">Amount</label><input id="amt" type="number" inputmode="numeric" min="1000" step="500" value="20000">
      <div class="row" style="margin-top:12px"><button class="btn btn-primary" data-m="momo">MTN / Airtel</button><button class="btn" data-m="card">Card</button></div>
      ${S.config.paymentsLive ? '' : '<p class="small muted" style="margin-top:8px">Test mode: top-ups are added instantly without charging you.</p>'}
      <p class="error" id="err"></p>
      <h3 style="margin-top:12px">History</h3>
      ${w.transactions.length ? w.transactions.map((x) => `<div class="tx"><span>${K.esc(x.note || x.type)}<br><span class="small muted">${K.when(x.created_at)}</span></span><span class="${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${K.ugx(x.amount)}</span></div>`).join('') : '<p class="muted small">No wallet activity yet.</p>'}
      <button class="btn btn-ghost btn-block" data-close>Close</button>`;
    m.el.querySelectorAll('[data-amt]').forEach((b) => b.onclick = () => { K.$('#amt', m.el).value = b.dataset.amt; });
    m.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const out = await K.api('/wallet/topup', { amount: +K.$('#amt', m.el).value, method: b.dataset.m });
        if (out.link) { location.href = out.link; return; }
        S.user.walletBalance = out.balance; K.toast('Wallet topped up ✅'); m.close();
        if (S.view === 'choose') render();
      } catch (e) { K.$('#err', m.el).textContent = e.message; b.disabled = false; }
    });
  }

  async function openTrips() {
    const m = K.modal('<p class="muted">Loading trips…</p>');
    const list = await K.api('/trips/history');
    const badge = (s) => ({ completed: 'ok', cancelled: 'bad', no_drivers: 'bad' }[s] || 'warn');
    m.el.innerHTML = `<div class="checker"></div><h2>Your trips</h2>
      ${list.length ? `<ul class="list">${list.map((t) => `<li><span class="grow"><b>${K.esc(t.drop.address)}</b><br><span class="small muted">${K.when(t.createdAt)} · ${K.SERVICE_LABEL[t.service]}</span></span>
        <span style="text-align:right"><b>${K.ugx(t.fare)}</b><br><span class="badge ${badge(t.status)}">${t.status.replace('_', ' ')}</span></span></li>`).join('')}</ul>` : '<p class="muted">Your trips will show here. Where are you off to first?</p>'}
      <button class="btn btn-ghost btn-block" data-close>Close</button>`;
  }

  function openSafety() {
    const m = K.modal(`<div class="checker"></div><h2>Safety</h2>
      <p>Every ride starts only after you share your 4-digit PIN with the driver, so you always get into the right vehicle.</p>
      <p>During a ride you can share a live tracking link and press SOS to alert our team.</p>
      <label for="ec">Emergency contact</label><input id="ec" type="tel" placeholder="0772 123456" value="${K.esc(S.user.emergencyContact || '')}">
      <p class="error" id="err"></p>
      <button class="btn btn-primary btn-block" id="save">Save emergency contact</button>
      <button class="btn btn-ghost btn-block" data-close>Close</button>`);
    K.$('#save', m.el).onclick = async () => {
      try { const out = await K.api('/me', { emergencyContact: K.$('#ec', m.el).value }, 'PATCH'); S.user = out.user; K.toast('Emergency contact saved'); m.close(); }
      catch (e) { K.$('#err', m.el).textContent = e.message; }
    };
  }
})();
