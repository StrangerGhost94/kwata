// Flytte customer app (mockup screens 5–13):
// Home → Search → Choose a ride → Finding your rider → Rider found → On trip → Trip completed
(function () {
  const root = document.getElementById('root');
  const S = {
    view: 'home', pickup: null, drop: null, route: null, quote: null, gps: null,
    // Only an everyday ride is remembered between visits. Parcel, errand and airport are one-off choices,
    // so the app never opens quietly in "send a parcel" mode.
    service: ['boda', 'car', 'comfort'].includes(localStorage.getItem('flytte_service')) ? localStorage.getItem('flytte_service') : 'boda',
    trip: null, user: null, config: null, recent: [], parcel: null, stops: [], rating: 0, unread: 0, chatOpen: false, messages: [],
  };
  let map, sock, sheet, routeLayer, labels = [], driverMarker, meMarker, nearby = new Map(), revTimer, phaseKm = null, routedPhase = null;

  const params = new URLSearchParams(location.search);
  // Invite links: /?ref=CODE fills the invite code on sign-up.
  if (params.get('ref')) { try { localStorage.setItem('flytte_ref', params.get('ref').toUpperCase().slice(0, 20)); } catch {} history.replaceState(null, '', location.pathname); }
  if (params.get('payment')) {
    history.replaceState(null, '', location.pathname);
    const pm = params.get('payment');
    setTimeout(() => K.toast(pm === 'success' ? 'Payment received ✅' : pm === 'pending' ? 'We’re still confirming your payment. It will update here automatically.' : 'Payment was not completed. Try again from your trip, or pay with cash.', 5000), 600);
  }

  K.boot(start, () => K.authScreen(root, { role: 'rider', onDone: start }));

  // ---------- payment preference ----------
  const PAY = {
    mtn: { name: 'Mobile Money', logo: `<span class="paylogo momo">${K.momoLogo()}</span>`, method: 'momo' },
    airtel: { name: 'Mobile Money', logo: `<span class="paylogo momo">${K.momoLogo()}</span>`, method: 'momo' },
    card: { name: 'Card', logo: `<span class="paylogo card">${K.ic('card', 'sm')}</span>`, method: 'card' },
    cash: { name: 'Cash', logo: `<span class="paylogo cash">${K.ic('cash', 'sm')}</span>`, method: 'cash' },
    wallet: { name: 'Flytte Wallet', logo: `<span class="paylogo wallet">${K.ic('wallet', 'sm')}</span>`, method: 'wallet' },
    business: { name: 'Company account', logo: `<span class="paylogo biz">${K.ic('work', 'sm')}</span>`, method: 'business' },
  };
  // Mobile Money and card only work once online payments are switched on.
  const payOK = (k) => k === 'business' ? bizCompanies('business').length > 0 : k === 'card' ? !!(S.config && S.config.paymentsAvailable && S.config.cardPayments !== false) : !['mtn', 'airtel'].includes(k) || !!(S.config && S.config.paymentsAvailable);
  // Mobile Money is one choice: MTN or Airtel follows the number the prompt goes to.
  const momoKey = () => K.momoNet(S.user && (S.user.payPhone || S.user.phone)) || (S.user && S.user.payPref === 'airtel' ? 'airtel' : 'mtn');
  const pref = () => { const p = S.user && S.user.payPref; if (!PAY[p] || !payOK(p)) return 'cash'; return ['mtn', 'airtel'].includes(p) ? momoKey() : p; };
  const payOfTrip = (t) => t.paymentMethod === 'momo' ? momoKey() : t.paymentMethod;

  const prettyPhone = (p) => K.prettyPhone(p);
  // What riders call the person who comes: "driver" (cars and bodas alike), "courier" for parcels.
  // ("Rider" would clash with riders, the passengers.)
  const who = (t) => (t && ['parcel', 'errand'].includes(t.service) ? 'courier' : 'driver');
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
    sheet.addEventListener('click', (e) => {
      if (!e.target.closest || !S.trip || !S.trip.driver) return;
      if (e.target.closest('[data-report]')) reportMismatch();
      else if (e.target.closest('[data-face]')) showDriver();
      else if (e.target.closest('[data-split]')) openSplit();
    });
    K.draggableSheet(sheet); K.smoothSheet(sheet);
    map = K.map('map');
    map.on('moveend', onPinMove);
    let tuckTimer;
    map.on('dragstart', () => {
      if (S.view !== 'home') return;
      S.mapTouched = true; clearTimeout(tuckTimer);
      if (sheet.snapTo && sheet.snap && sheet.snap() !== 'peek' && innerWidth < 760) { sheet._tucked = sheet.snap(); sheet.snapTo('peek'); }
    });
    map.on('moveend', () => {
      if (S.view !== 'home' || !sheet._tucked) return;
      clearTimeout(tuckTimer);
      tuckTimer = setTimeout(() => { if (S.view === 'home' && sheet._tucked && sheet.snapTo) { sheet.snapTo(sheet._tucked); sheet._tucked = null; } }, 1100);
    });
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => openTab(b.dataset.tab));

    // Fresh data from the server. If we have last-known data for this account, draw the
    // app with it straight away and let these update it in the background.
    const fresh = Promise.all([K.api('/me'), K.api('/config'), K.api('/trips/active'), K.api('/trips/history').catch(() => null)]);
    const cMe = K.cache.get('me'), cCfg = K.cache.get('config');
    // A trip in progress is saved too, so opening the app goes straight back into it.
    const LIVE = ['requested', 'accepted', 'arrived', 'in_progress'];
    const keep = (me, config, hist, active) => { K.cache.set('me', me); K.cache.set('config', config); if (hist) K.cache.set('hist', hist.slice(0, 30)); K.cache.set('active', active && LIVE.includes(active.status) ? active : null); };
    if (cMe && cCfg) {
      await null; // let the rest of this file finish loading before we draw
      const cAct = K.cache.get('active');
      boot(cMe, cCfg, cAct && LIVE.includes(cAct.status) ? cAct : null, K.cache.get('hist') || null);
      fresh.then(([me, config, active, hist]) => {
        keep(me, config, hist, active);
        S.user = me.user; S.config = config;
        if (hist) { S.history = hist; buildRecent(hist); patchHome('quick'); }
        if (active) onTrip(active);
        else if (S.trip && LIVE.includes(S.trip.status)) reset();   // the saved trip ended meanwhile
        else { patchHome('forYou'); }
      }).catch(() => {}); // offline: keep showing what we have; the banner explains
      return;
    }
    try {
      const [me, config, active, hist] = await fresh;
      keep(me, config, hist);
      boot(me, config, active, hist);
    } catch (e) { K.ready(); sheet.innerHTML = `<div class="state-box" role="alert"><b>Couldn’t open Flytte</b><span>${K.esc(e.message)}</span><button class="btn btn-primary btn-sm" onclick="location.reload()">Try again</button></div>`; }
  }

  function boot(me, config, active, hist) {
    S.user = me.user; S.config = config;
    applyPrefs();
    loadGrowth(); loadUpcoming(); loadBiz().then(() => { const c = bizCompanies('business')[0]; if (c) PAY.business.name = c.name; });
    S.history = hist; buildRecent(hist);   // null if unknown: Activity then loads it (with Retry on failure), never a false 'No trips'
    sock = K.socket(K.token());
    sock.on('trip:update', onTrip);
    sock.on('driver:location', (p) => { if (S.trip && p.tripId === S.trip.id) moveDriver(p); });
    sock.on('toast', (m) => { if (m.arrived && S.view === 'trip' && S.trip && S.trip.id === m.tripId) return; K.toast(m.text); });
    sock.on('chat:message', onChat);
    sock.on('connect', async () => { sock.emit('rider:visible', document.visibilityState === 'visible'); const a = await K.api('/trips/active').catch(() => null); if (a) onTrip(a); });
    // Trip alerts go to the lock screen only while Flytte isn't on screen.
    document.addEventListener('visibilitychange', () => sock.emit('rider:visible', document.visibilityState === 'visible'));
    if (active) onTrip(active); else {
      locate(false); render();
      const svc = params.get('service');
      if (svc && S.config.services.some((x) => x.id === svc)) { setService(svc); history.replaceState(null, '', location.pathname); openSearch(svc === 'airport' ? { preset: K.PLACES[0] } : {}); }
      if (params.get('open') === 'business' || params.get('open') === 'shop') { const k = params.get('open') === 'shop' ? 'merchant' : 'business'; history.replaceState(null, '', location.pathname); setTimeout(() => { openTab('account'); openBusiness(null, k); }, 300); }
      let q = null; try { q = sessionStorage.getItem('flytte_q'); sessionStorage.removeItem('flytte_q'); } catch {}
      if (q) openSearch({ query: q });
    }
    setInterval(loadNearby, 8000);
    K.ready();
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
  // If we can't get the rider's location we never guess one: we say why and ask
  // them to set the pickup themselves before they can request a ride.
  const LOC_MSG = {
    denied: 'Location access is off for Flytte. Set your pickup point, or allow location for this site in your browser or phone settings and try again.',
    unavailable: 'Your phone couldn’t find your position right now. Set your pickup point, or try again outside or near a window.',
    timeout: 'Finding your position took too long. Set your pickup point, or try again.',
    unsupported: 'This browser can’t share your location. Set your pickup point to continue.',
  };
  function locate(userAsked) {
    const failed = (why) => {
      S.loc = why;
      if (userAsked) K.toast(why === 'denied' ? 'Location is off. Set your pickup point instead.' : 'We couldn’t find your location. Set your pickup point instead.', 4500);
      if (!S.pickup && !S.gps) map.setView([K.KAMPALA.lat, K.KAMPALA.lng], 13); // just a map view, never a pickup
      patchHome('loc');
    };
    if (!navigator.geolocation) return failed('unsupported');
    if (!S.pickup) { S.loc = 'finding'; patchHome('loc'); }
    navigator.geolocation.getCurrentPosition((p) => {
      S.loc = 'ok';
      S.gps = { lat: p.coords.latitude, lng: p.coords.longitude };
      const ll = [S.gps.lat, S.gps.lng];
      if (!meMarker) meMarker = L.marker(ll, { icon: K.divIcon('<div class="me-dot"></div>', [18, 18]), interactive: false, zIndexOffset: 500 }).addTo(map);
      else meMarker.setLatLng(ll);
      if (userAsked) S.mapTouched = false;
      if (S.view === 'home') centerOn(S.gps, 16, !!userAsked);
      else if (userAsked) map.setView(ll, 16, { animate: true });
      if ((S.view === 'home' && (!S.pickup || !S.pickup.manual || userAsked)) || !S.pickup) setPickup(S.gps.lat, S.gps.lng, 'Current location');
      patchHome('loc');
    }, (err) => failed(err && err.code === 1 ? 'denied' : err && err.code === 3 ? 'timeout' : 'unavailable'),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  function setPickup(lat, lng, label, manual) {
    S.pickup = { lat, lng, address: label || 'Finding address…', short: label, manual: !!manual };
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      const addr = await K.reverse(lat, lng);
      if (S.pickup && S.pickup.lat === lat) {
        S.pickup.address = addr;
        if (S.pickup.short === 'Current location') S.pickup.short = null;   // the map label and the sheet then say the same place
        const el = K.$('#pickLabel'); if (el) el.textContent = addr;
      }
    }, 450);
    loadNearby();
  }

  function onPinMove() {
    if (S.view !== 'pickup' && S.view !== 'droppin') return;
    const c = map.getCenter();
    const el = K.$('#pinAddr'); if (el) el.textContent = 'Finding address…';
    if (S.view === 'pickup') S.pickup = { lat: c.lat, lng: c.lng, address: 'Finding address…', manual: true };
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
    } else if (v === 'trip' && S.trip.driver && ['accepted', 'arrived'].includes(S.trip.status)) {
      // Before pickup, the countdown and plate stay in view on the map, where riders look.
      const d = S.trip.driver, mins = tripMins(), here = S.trip.status === 'arrived';
      tb.innerHTML = `<div class="trip-banner"><span class="round tb-face">${d.photo ? `<img src="${K.esc(d.photo)}" alt="">` : K.initials(d.name)}</span>
        <span class="grow"><b>${K.esc(K.first(d.name))} · <span class="plate-mini">${K.esc(d.plate || '')}</span></b><small id="bnTxt">${S.trip.service === 'errand' ? (S.trip.errand && S.trip.errand.goodsTotal != null ? 'Items bought' : here ? 'Shopping for you' : mins ? `At the shop in ${mins} min` : 'Going to the shop') : here ? 'Here now · meet at the pickup' : mins ? `Here in ${mins} min` : 'On the way'}</small></span>
        <button class="round" id="bnSos" aria-label="Safety">${K.ic('shield')}</button></div>`;
      K.$('#bnSos').onclick = openSafetySheet;
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
    sheet.classList.toggle('choosing', v === 'choose');   // shorter, so the route stays in view
    K.underTabs(sheet, v === 'home');
    topbar();
    if (v !== S.lastView) { sheet.classList.remove('sheet-enter'); void sheet.offsetWidth; sheet.classList.add('sheet-enter'); }
    if (v !== 'home') leaveHomeSheet();
    S.lastView = v;
    ({ home: vHome, choose: vChoose, pickup: vPickup, droppin: vDropPin, searching: vSearching, trip: vTrip, done: vDone, none: vNone })[v]();
  }

  // Android Back on the map screens steps back like the on-screen back arrow.
  K.onRootBack = () => { if (['choose', 'pickup', 'droppin', 'none'].includes(S.view)) { goBack(); return true; } return false; };
  function goBack() {
    if (S.view === 'pickup') { // cancel: the pin was never confirmed
      S.pickup = S.prevPickup || null; S.prevPickup = undefined;
      if (S.route && S.quote && S.drop) { S.view = 'choose'; render(); showRoute(); }
      else { S.view = 'home'; render(); }
    }
    else if (S.view === 'droppin') { S.view = 'home'; render(); openSearch(); }
    else reset();
  }

  // Screen 5: home. One clear job up top ("Where to?"), quick picks, services, then offers you swipe through.
  // The sheet rests at the services row so the map stays visible; drag or flick it up for everything else.
  const shortName = (a) => String(a || '').split(',')[0].trim();
  function vHome() {
    clearRoute();
    const ids = S.config.services.map((s) => s.id);
    const main = ['boda', 'car', 'comfort', 'parcel', 'errand', 'airport'].filter((id) => ids.includes(id)).slice(0, 5);
    const first = !S.homeShown; S.homeShown = true;
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="home ${first && !K.reduced() ? 'home-in' : ''}">
        <div id="upHost"></div>
        <div id="locHost">${locHtml()}</div>
        <div class="where">
          <button class="where-go" id="whereBtn">${K.ic('search')}<span class="on-txt">Where to?</span><span class="off-txt">No connection</span></button>
          <button class="when-pill ${S.when ? 'on' : ''}" id="homeWhen" aria-label="Pickup time">${K.ic('clock', 'sm')}<span>${S.when ? K.esc(whenLabel(S.when)) : 'Now'}</span>${K.ic('chevDown', 'sm')}</button>
        </div>
        <div id="suggHost"></div>
        <div class="quick" id="quickHost">${quickHtml()}</div>
        <div class="svc-strip${main.length <= 5 ? ' fit' : ''}" id="svcStrip">${main.map((id) => `<button class="svc-t" data-svc="${id}"><span class="tile">${K.ART[id]}</span><b>${svcName(id)}</b><small data-eta="${id}">&nbsp;</small><small class="tile-price" data-price="${id}"></small></button>`).join('')}</div>
        <div id="foldMark"></div>
        <div id="forYou">${forYouHtml()}</div>
        <div id="installHost"></div>
      </div>`;
    upHtml(); bindLoc();
    K.installCard(K.$('#installHost'));
    K.$('#whereBtn').onclick = () => openSearch();
    K.$('#homeWhen').onclick = () => openWhen(() => openSearch());
    sheet.querySelectorAll('[data-svc]').forEach((b) => b.onclick = () => { if (b.dataset.svc === 'errand') { startErrand(); return; } setService(b.dataset.svc); openSearch(b.dataset.svc === 'airport' ? { preset: K.PLACES[0] } : {}); });
    bindQuick(); bindForYou(); paintEtas(); paintSuggestion();
    homeSheet();
  }

  function quickHtml() {
    const sp = S.user.savedPlaces || {};
    const chip = (attrs, ic, label, sub, cls = '') => `<button class="q-chip${cls}" ${attrs}><span class="ic">${K.ic(ic, 'sm')}</span><span class="t"><b>${K.esc(label)}</b>${sub ? `<small>${K.esc(sub)}</small>` : ''}</span></button>`;
    // Saved places first, then recent destinations; "Add home/work" goes last once there are recents.
    const set = (k) => !!sp[k];
    const saved = ['home', 'work'].filter(set).map((k) => chip(`data-place="${k}"`, k, k === 'home' ? 'Home' : 'Work', shortName(sp[k].address)));
    saved.push(...ownPlaces().map(([k, v]) => chip(`data-place="${k}"`, 'pin', shorten(v.label, 18), shortName(v.address))));
    const recent = S.recent.slice(0, 3).map((r, i) => chip(`data-recent="${i}"`, 'clock', shorten(shortName(r.name), 22), ''));
    const add = ['home', 'work'].filter((k) => !set(k)).map((k) => chip(`data-place="${k}"`, k, k === 'home' ? 'Home' : 'Work', 'Add', recent.length ? ' add' : ''));
    return [...saved, ...(recent.length ? [...recent, ...add] : [...add])].join('');
  }
  function bindQuick() {
    sheet.querySelectorAll('[data-place]').forEach((b) => b.onclick = () => {
      const key = b.dataset.place, p = (S.user.savedPlaces || {})[key];
      if (p) chooseDrop({ name: p.label || (key === 'home' ? 'Home' : 'Work'), address: p.address, lat: p.lat, lng: p.lng });
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
    const pc = S.config.pass;
    if (pc && pc.enabled && S.pass && !S.pass.active && passBuyable()) cards.push(`<button class="fy-card fy-pass" data-fy="pass"><span class="grow"><small>Flytte Pass</small><b>${pc.percent}% off every ride</b><span>No busy-time prices · free cancels · ${K.ugx(pc.price)} a month</span></span><span class="fy-art emoji">✨</span></button>`);
    if (ids.includes('errand')) cards.push(`<button class="fy-card fy-errand" data-errand><span class="grow"><small>Flytte Errand</small><b>Buy it for me</b><span>Market, pharmacy or shop: we buy it and bring it</span></span><span class="fy-art">${K.ART.errand}</span></button>`);
    if (ids.includes('parcel')) cards.push(`<button class="fy-card fy-parcel" data-svc2="parcel"><span class="grow"><small>Flytte Parcel</small><b>Send a package</b><span>Picked up and delivered across Kampala</span></span><span class="fy-art">${K.ART.parcel}</span></button>`);
    if (ids.includes('airport')) cards.push(`<button class="fy-card fy-air" data-svc2="airport"><span class="grow"><small>Airport transfer</small><b>Flying out of Entebbe?</b><span>Book now, or schedule ahead at the regular price</span></span><span class="fy-art">${K.ART.airport}</span></button>`);
    if (!cards.length) return '';
    return `<div class="section-label">For you</div><div class="fy-rail">${cards.join('')}</div>`;
  }
  function bindForYou() {
    const fe = sheet.querySelector('[data-errand]'); if (fe) fe.onclick = startErrand;
    sheet.querySelectorAll('[data-svc2]').forEach((b) => b.onclick = () => { setService(b.dataset.svc2); openSearch(b.dataset.svc2 === 'airport' ? { preset: K.PLACES[0] } : {}); });
    const ib = sheet.querySelector('[data-fy="invite"]'); if (ib) ib.onclick = () => openInvite();
    const pb = sheet.querySelector('[data-fy="pass"]'); if (pb) pb.onclick = () => openPass();
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
    if (part === 'loc') { K.$('#locHost').innerHTML = locHtml(); bindLoc(); paintSuggestion(); }
    sheet._keep = false;
  }

  // Pickup status on the home sheet: finding you, couldn't find you, or the pickup you set yourself.
  function locHtml() {
    if (S.pickup && S.pickup.manual) {
      return `<div class="pick-set"><span class="dot-pick" aria-hidden="true"></span><span class="grow"><small>Pickup</small><b class="ellipsis">${K.esc(S.pickup.short || S.pickup.address)}</b></span><button class="btn btn-sm btn-ghost" id="chgPick">Change</button></div>`;
    }
    if (S.pickup) return '';
    if (S.loc === 'finding' || S.loc === 'ok' || !S.loc) return `<p class="loc-finding" role="status"><span class="spin" aria-hidden="true"></span>Finding your location…</p>`;
    return `<div class="loc-card" role="alert">
      <span class="ic" aria-hidden="true">${K.ic('locate')}</span>
      <span class="grow"><b>We couldn’t find your location</b><span>${LOC_MSG[S.loc] || LOC_MSG.unavailable}</span></span>
      <span class="loc-actions"><button class="btn btn-primary btn-sm" id="setPick">Set pickup</button>${S.loc !== 'unsupported' ? '<button class="btn btn-sm" id="retryLoc">Try again</button>' : ''}</span>
    </div>`;
  }
  function bindLoc() {
    const sp = K.$('#setPick'), rl = K.$('#retryLoc'), cp = K.$('#chgPick');
    if (sp) sp.onclick = () => openSearch({ pickFirst: true });
    if (cp) cp.onclick = () => openSearch({ pickFirst: true });
    if (rl) rl.onclick = () => { S.loc = 'finding'; patchHome('loc'); locate(true); };
  }

  // A suggestion for right now: work on weekday mornings, home in the evening, otherwise the last place
  // you went. It shows the price and time before you tap, and the same prices appear on the ride tiles.
  function suggestion() {
    if (!S.pickup || !S.user) return null;
    const sp = S.user.savedPlaces || {}, k = new Date(Date.now() + 3 * 3600e3), h = k.getUTCHours(), wd = k.getUTCDay() >= 1 && k.getUTCDay() <= 5;
    const far = (p) => p && K.km(S.pickup, p) > 0.4;
    if (wd && h >= 5 && h < 11 && far(sp.work)) return { label: 'To work', icon: 'work', place: { name: 'Work', address: sp.work.address, lat: sp.work.lat, lng: sp.work.lng } };
    if ((h >= 16 || h < 2) && far(sp.home)) return { label: 'Head home', icon: 'home', place: { name: 'Home', address: sp.home.address, lat: sp.home.lat, lng: sp.home.lng } };
    const r = (S.recent || []).find(far);
    return r ? { label: 'Go again', icon: 'clock', place: { name: r.name, address: r.name, lat: r.lat, lng: r.lng } } : null;
  }
  const suggCache = {};
  async function paintSuggestion() {
    const host = K.$('#suggHost'); if (!host) return;
    const sg = suggestion();
    if (!sg) { host.innerHTML = ''; return; }
    const key = `${sg.place.lat.toFixed(4)},${sg.place.lng.toFixed(4)}|${S.pickup.lat.toFixed(3)},${S.pickup.lng.toFixed(3)}`;
    const draw = (q) => {
      const o = q && (q.options.find((x) => x.id === S.service) || q.options[0]);
      host.innerHTML = `<button class="sugg" id="sugg"><span class="sugg-ic">${K.ic(sg.icon, 'sm')}</span>
        <span class="grow"><small>${sg.label}</small><b class="ellipsis">${K.esc(shortName(sg.place.address || sg.place.name))}</b>
        <span class="sugg-meta">${o ? `${K.esc(svcName(o.id))} · ${K.ugx(o.payable ?? o.fare)} · about ${o.durationMin} min` : 'Checking prices…'}</span></span>
        <span class="sugg-go" aria-hidden="true">${K.ic('chev', 'sm')}</span></button>`;
      K.$('#sugg', host).onclick = () => chooseDrop(sg.place);
      sheet.querySelectorAll('[data-price]').forEach((el) => {
        const x = q && q.options.find((y) => y.id === el.dataset.price);
        el.textContent = x ? K.ugx(x.payable ?? x.fare).replace(/,000$/, 'k').replace(/,(\d)00$/, '.$1k') : '';
      });
    };
    const hit = suggCache[key];
    if (hit && Date.now() - hit.at < 120e3) { draw(hit.q); return; }
    draw(null);
    try {
      const r = await K.route(S.pickup, sg.place);
      const q = await K.api('/fare/estimate', { pickup: S.pickup, drop: { ...sg.place, address: sg.place.address || sg.place.name }, distanceKm: r.km, durationMin: r.freeMin, peek: true });
      suggCache[key] = { at: Date.now(), q };
      if (S.view === 'home' && K.$('#suggHost')) draw(q);
    } catch { host.innerHTML = ''; }
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
    if (typeof sheet.snap !== 'function') sheet.snap = () => 'full';
    if (typeof sheet.snapTo === 'function') { sheet._keep = true; sheet.snapTo('mid', false); sheet._keep = false; }
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
  function setService(id) {
    if (id === 'parcel' && S.stops && S.stops.length && S.view === 'choose') { S.stops = []; K.toast('Parcels go straight to one address, so your stops were removed.', 4000); setTimeout(prepareQuote, 0); }
    S.service = id; try { if (['boda', 'car', 'comfort'].includes(id)) localStorage.setItem('flytte_service', id); } catch {}
  }

  // ---------- full-screen search ----------
  let searchTimer;
  function openSearch(opts = {}) {
    if (opts.preset) { chooseDrop(opts.preset); return; }
    const saveAs = opts.saveAs, addStop = !!opts.addStop, shop = !!opts.shop, single = !!saveAs || addStop || shop;   // one search box
    const pickFirst = !single && !!opts.pickFirst;
    const page = document.createElement('div');
    page.className = 'page push-in';
    page.style.zIndex = 870;
    page.innerHTML = `<div class="page-inner">
      <div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Close">${K.ic('back')}</button>
        <h2>${saveAs ? 'Set ' + K.esc(opts.label || saveAs) + ' address' : shop ? 'Where should we buy?' : addStop ? 'Add a stop' : pickFirst ? 'Set your pickup point' : S.service === 'parcel' ? 'Where should it go?' : S.service === 'errand' ? 'Where should we bring it?' : 'Where are you going?'}</h2></div>
      ${single ? '' : `<div class="route-box" style="margin-bottom:6px">
        <div class="rb-line" style="grid-row:span 2"><span class="rb-dot"></span><span class="rb-bar"></span><span class="rb-sq"></span></div>
        <input id="qPick" placeholder="Set your pickup point" value="${K.esc(S.pickup && !opts.pickFirst ? (S.pickup.short || S.pickup.address) : '')}" autocomplete="off" aria-label="Pickup point">
        <input id="qDrop" placeholder="Where to?" autocomplete="off" aria-label="Destination">
      </div>`}
      ${single ? `<input id="qDrop" placeholder="${shop ? 'Shop, market or pharmacy' : addStop ? 'Search for your stop' : 'Search for an address'}" autocomplete="off" aria-label="Search">` : ''}
      <p class="error" id="sErr" role="alert"></p>
      <div id="res" style="margin-top:10px" aria-live="polite"></div></div>`;
    root.querySelector('#app').appendChild(page);
    let target = pickFirst ? 'pick' : 'drop', pendingDrop = null;
    const sErr = K.$('#sErr', page);
    const res = K.$('#res', page);
    const qDrop = K.$('#qDrop', page), qPick = K.$('#qPick', page);
    const close = () => K.pop(page);
    K.$('[data-x]', page).onclick = close;

    const rows = (items, iconFn) => items.map((p, i) => `<button class="lrow" data-i="${i}"><span class="ic">${K.ic(iconFn ? iconFn(p) : 'pin')}</span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(p.name)}</span><span class="s ellipsis" style="display:block">${K.esc(p.address || '')}</span></span>${S.pickup && p.lat && !p._act ? `<span class="tiny faint">${K.km(S.pickup, p).toFixed(1)} km</span>` : ''}</button>`).join('');
    let current = [];
    const bind = () => res.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => pick(current[+b.dataset.i]));
    const showDefault = () => {
      clearTimeout(searchTimer); // results for the other box must never land in this one
      const sp = S.user.savedPlaces || {};
      const saved = [];
      if (!saveAs && sp.home) saved.push({ name: 'Home', address: sp.home.address, lat: sp.home.lat, lng: sp.home.lng, _ic: 'home' });
      if (!saveAs && sp.work) saved.push({ name: 'Work', address: sp.work.address, lat: sp.work.lat, lng: sp.work.lng, _ic: 'work' });
      if (!saveAs) ownPlaces().forEach(([, v]) => saved.push({ name: v.label, address: v.address, lat: v.lat, lng: v.lng, _ic: 'pin' }));
      const recent = saveAs ? [] : S.recent.map((r) => ({ ...r, _ic: 'clock' }));
      const extra = saveAs ? [...(S.gps ? [{ name: 'Use my current location', address: 'Where your phone is now', lat: S.gps.lat, lng: S.gps.lng, _ic: 'locate', _act: 'gps' }] : []), { name: 'Pick on the map', address: 'Move the map to the spot', _ic: 'pin', _act: 'map' }]
        : target === 'pick' && S.gps ? [{ name: 'Current location', address: 'Use GPS', lat: S.gps.lat, lng: S.gps.lng, _ic: 'locate' }] : [];
      current = [...extra, ...saved, ...recent, ...K.PLACES.map((p) => ({ ...p, _ic: p.icon || 'pin' }))];
      const mapRow = !single ? `<button class="lrow" id="onMap"><span class="ic">${K.ic('pin')}</span><span class="t">${target === 'pick' ? 'Set pickup on map' : 'Set destination on map'}</span></button>` : '';
      res.innerHTML = (target === 'pick' ? mapRow : '') + rows(current, (p) => p._ic) + (target === 'drop' ? mapRow : '');
      bind();
      const om = K.$('#onMap', page);
      if (om) om.onclick = () => {
        close();
        const c = S.pickup || S.gps || map.getCenter();
        map.setView([c.lat, c.lng], 17);
        if (target === 'pick') { S.prevPickup = S.pickup; S.pickup = { lat: c.lat, lng: c.lng, address: 'Finding address…', manual: true }; S.view = 'pickup'; }
        else S.view = 'droppin';
        render();
      };
    };
    // Landmarks get a star, places popular with riders a trend arrow, everything else a pin.
    const kindIcon = (p) => p.icon || (p.kind === 'landmark' ? 'star' : p.kind === 'popular' ? 'trend' : 'pin');
    let searchSeq = 0;
    const onInput = (el) => {
      clearTimeout(searchTimer);
      const text = el.value.trim();
      const seq = ++searchSeq;   // only the latest search may fill the list
      if (text.length < 2) { showDefault(); return; }
      searchTimer = setTimeout(async () => {
        if (!res.querySelector('.lrow')) res.innerHTML = `<p class="small faint" style="padding:12px 2px">Searching…</p>`;
        try {
          const found = await K.search(text, S.pickup || S.gps);
          if (seq !== searchSeq) return;
          current = found;
          res.innerHTML = found.length ? rows(found, kindIcon) + (found.partial ? '<p class="small faint" style="padding:8px 2px">Some places may be missing. Keep typing or set the spot on the map.</p>' : '')
            : `<p class="small muted" style="padding:12px 2px">No places found. Try a landmark or the area name.</p>`;
          bind();
        } catch {
          if (seq !== searchSeq) return;
          K.failed(res, 'Search isn’t answering right now. Check your connection, or set the place on the map.', () => onInput(el),
            ['Use the map', () => { showDefault(); const om = K.$('#onMap', page); if (om) om.click(); }]);
        }
      }, 250);
    };
    qDrop.oninput = () => onInput(qDrop);
    qDrop.onfocus = () => { target = 'drop'; showDefault(); };
    if (qPick) { qPick.onfocus = () => { target = 'pick'; qPick.select(); showDefault(); }; qPick.oninput = () => onInput(qPick); }

    async function pick(p) {
      if (shop) { close(); errandShop({ lat: p.lat, lng: p.lng, address: p.name }); return; }
      if (addStop) {
        S.stops = [...(S.stops || []), { lat: p.lat, lng: p.lng, address: p.name }].slice(0, 2);
        close(); prepareQuote(); return;
      }
      if (saveAs && p._act === 'map') {
        close();
        const c = S.gps || S.pickup || map.getCenter();
        S.pinSave = { key: saveAs, label: opts.label, onSaved: opts.onSaved, back: S.view };
        map.setView([c.lat, c.lng], 17); S.view = 'droppin'; render(); return;
      }
      if (saveAs && p._act === 'gps') p = { ...p, name: await K.reverse(p.lat, p.lng).catch(() => 'My location') };
      if (saveAs) {
        try {
          const out = await K.api('/me', { savedPlaces: { [saveAs]: { lat: p.lat, lng: p.lng, address: p.name, label: opts.label } } }, 'PATCH');
          saveUser(out.user); K.toast(`${opts.label || (saveAs === 'home' ? 'Home' : 'Work')} saved`); close();
          if (opts.onSaved) opts.onSaved(); else if (S.view === 'home') render();
        } catch (e) { K.toast(e.message); }
        return;
      }
      sErr.textContent = '';
      if (target === 'pick') {
        S.pickup = { lat: p.lat, lng: p.lng, address: p.name, short: p.name, manual: !(S.gps && p.lat === S.gps.lat && p.lng === S.gps.lng) };
        qPick.value = p.name; loadNearby(); patchHome('loc');
        if (pendingDrop) { close(); chooseDrop(pendingDrop); return; }
        if (opts.thenQuote && S.drop) { close(); prepareQuote(); return; }
        target = 'drop'; qDrop.focus(); return;
      }
      if (!S.pickup) { // keep the destination and ask for the pickup next
        pendingDrop = p; qDrop.value = p.name;
        sErr.textContent = 'Now set your pickup point.';
        target = 'pick'; showDefault(); qPick && qPick.focus(); return;
      }
      close();
      chooseDrop(p);
    }
    showDefault();
    if (opts.query) { qDrop.value = opts.query; onInput(qDrop); }
    // Focus the box without the browser jumping to it. On Android the keyboard resizes the page, so
    // wait until the slide-in has finished; iOS only opens the keyboard close to the tap, so focus early.
    const focusBox = () => { if (page.isConnected) (target === 'pick' && qPick ? qPick : qDrop).focus({ preventScroll: true }); };
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) || matchMedia('(prefers-reduced-motion: reduce)').matches) setTimeout(focusBox, 60);
    else { let done = false; const go = () => { if (done) return; done = true; focusBox(); }; page.addEventListener('animationend', go, { once: true }); setTimeout(go, 650); }
  }

  function chooseDrop(p) {
    S.drop = { lat: p.lat, lng: p.lng, address: p.name };
    if (/airport/i.test(p.name) && S.config.services.some((s) => s.id === 'airport')) setService('airport');
    prepareQuote();
  }

  async function prepareQuote() {
    if (!S.pickup) { // never quote from a guessed location
      S.view = 'home'; render();
      openSearch({ pickFirst: true, thenQuote: true });
      K.toast('Set your pickup point first', 3000);
      return;
    }
    S.view = 'choose';
    K.$('#tabs').classList.add('hidden');
    sheet.classList.remove('home-card');
    K.underTabs(sheet, false);
    leaveHomeSheet(); S.lastView = 'choose';
    topbar();
    sheet.innerHTML = `<div class="grabber"></div><h2>Choose a ride</h2><div class="bar indet"><i></i></div>`;
    S.route = await K.route(S.pickup, S.drop, S.stops);
    try {
      S.quote = await K.api('/fare/estimate', { pickup: S.pickup, drop: S.drop, stops: S.stops, distanceKm: S.route.km, durationMin: S.route.freeMin, promoCode: S.promoCode || undefined });
      S.quote.at = Date.now();
      if (!S.quote.options.find((o) => o.id === S.service)) setService(S.quote.options[0].id);
      render();
      showRoute();
    } catch (e) { sheet.innerHTML = '<div class="grabber"></div><div id="qErr"></div>'; K.failed(K.$('#qErr'), e.message, prepareQuote, ['Back', reset]); }
  }

  // Prices are locked for 2 minutes. If the rider is still deciding, quietly get a fresh lock.
  let quoteTimer;
  async function refreshQuote() {
    if (S.view !== 'choose' || !S.route) return;
    try {
      const q = await K.api('/fare/estimate', { pickup: S.pickup, drop: S.drop, stops: S.stops, distanceKm: S.route.km, durationMin: S.route.freeMin, promoCode: S.promoCode || undefined });
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
    (S.stops || []).forEach((x, i) => labels.push(L.marker([x.lat, x.lng], { icon: K.divIcon(`<div class="pin-stop">${i + 1}</div>`, [20, 20]) }).addTo(map)));
    labels.push(L.marker(S.route.coords[0], { icon: K.label(`${etaPick ? `<b>${etaPick}<br>min</b>` : ''}<span>${K.esc(shorten(S.pickup.short || S.pickup.address))}</span>`), interactive: false }).addTo(map));
    labels.push(L.marker(S.route.coords[S.route.coords.length - 1], { icon: K.label(`<span>${K.esc(shorten(S.drop.address))}</span>`), interactive: false }).addTo(map));
    fit(routeLayer.bounds());
  }
  const shorten = (s, n = 26) => String(s || '').split(',')[0].slice(0, n);
  function fit(bounds) {
    const pad = window.innerWidth >= 760 ? { paddingTopLeft: [460, 90], paddingBottomRight: [60, 60] } : { paddingTopLeft: [40, 90], paddingBottomRight: [40, Math.min(sheet.offsetHeight + 30, window.innerHeight - 230)] };
    map.fitBounds(bounds, { ...pad, maxZoom: 16 });
  }
  function clearRoute() {
    if (routeLayer) routeLayer.remove(); routeLayer = null;
    labels.forEach((l) => map.removeLayer(l)); labels = [];
  }

  const surgeText = (o) => {
    const r = o.surgeReasons || [];
    const why = r.includes('rain') && r.includes('demand') ? 'Rain, busy' : r.includes('rain') ? 'Raining' : r.includes('demand') ? 'High demand' : 'Busy now';
    return `↑ ${why} · ×${o.surge}`;
  };

  // Scheduled rides are never surge-priced; discounts come off the price shown.
  const baseOf = (o) => (S.when ? o.regularFare : o.fare);
  const payOf = (o) => Math.max(0, baseOf(o) - (o.discount ? Math.min(o.discount, baseOf(o)) : 0));
  const priceHtml = (o) => {
    const base = baseOf(o), pay = payOf(o);
    const was = pay < base ? base : null;   // only a real discount is crossed out; busy-time pricing is explained on the card
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
    const m = K.modal(`<h2>Promo code</h2><p class="small muted">Got a code from Flytte or a friend? Add it here. One discount per trip: you always get the biggest one.</p>
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
        S.promoCode = code; q.at = Date.now(); q._shown = true; S.quote = q; m.close(); render(); K.toast('Promo applied');
      } catch (e) { K.$('#err', m.el).textContent = e.message; btn.disabled = false; }
    };
    const rm = K.$('#rm', m.el); if (rm) rm.onclick = () => { S.promoCode = null; m.close(); refreshQuote(); };
  }

  // Screen 6: choose a ride
  function vChoose() {
    const q = S.quote;
    const sel = q.options.find((o) => o.id === S.service);
    const p = pref(), P = PAY[p];
    // Arrival first: how soon the driver comes and when you'd get there. Seats sit next to the name.
    const seats = (o) => (o.id === 'errand' ? '' : o.seats ? `${o.seats} seat${o.seats > 1 ? 's' : ''}` : 'Up to 10 kg');
    const meta = (o) => o.etaMin == null ? 'No drivers nearby'
      : `<b>${o.etaMin} min</b> <span class="nowrap">· drop-off ${K.clock(new Date(Date.now() + (o.etaMin + o.durationMin) * 60e3))}</span>`;
    // One promo for every option (e.g. first ride 50% off) is said once, above the list.
    // An errand shows only the errand option; rides and parcels never list it (it needs its own form).
    const pool = q.options.filter((o) => (S.service === 'errand') === (o.id === 'errand'));
    const promos = [...new Set(pool.filter((o) => o.discount).map((o) => o.promoLabel))];
    const sharedPromo = promos.length === 1 && pool.every((o) => o.discount) ? promos[0] : null;
    // The 3 most useful options, plus the chosen one; the rest behind "More options".
    const ranked = [...pool].sort((a, b) => (a.etaMin == null) - (b.etaMin == null));
    const shown = S.allOpts || pool.length <= 3 ? pool : pool.filter((o) => o.id === S.service || ranked.slice(0, 3).includes(o)).slice(0, 4);
    const hidden = pool.length - shown.length;
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="row" style="margin-bottom:12px;align-items:baseline"><h2 style="margin:0" class="grow">${S.service === 'errand' ? 'Your errand' : 'Choose a ride'}</h2>
        <span class="tiny muted">${[q.raining ? '🌧 Raining' : '', { rush: 'Rush hour traffic', busy: 'Busy roads', clear: 'Clear roads' }[q.traffic] || ''].filter(Boolean).join(' · ')}</span></div>
      ${q.pass && S.service !== 'errand' ? `<p class="promo-band pass-band">✨<span>Flytte Pass · never busy-time prices${q.options.some((o) => o.passSaved > 0) ? ', you’re skipping a price rise now' : ''}</span></p>` : ''}
      ${sharedPromo ? `<p class="promo-band">${K.ic('tag', 'sm')}<span>${K.esc(sharedPromo)} · applied to every ride</span></p>` : ''}
      <div class="opts" role="radiogroup" aria-label="Ride type">
      ${shown.map((o) => `
        <button class="opt${o.etaMin == null ? ' none' : ''}" data-s="${o.id}" aria-pressed="${o.id === S.service}">
          <span class="art">${K.artFor(o.id, o.vehicle)}</span>
          <span class="grow"><span class="name" style="display:block">${K.esc(svcName(o.id))} <span class="opt-seats">${seats(o)}</span></span>
            <span class="meta">${meta(o)}</span>${o.surge > 1 && !S.when ? `<span class="surge" style="display:block">${surgeText(o)}</span>` : ''}${o.discount && !sharedPromo ? `<span class="deal" style="display:block">${K.ic('tag', 'sm')} ${K.esc(o.promoLabel)}</span>` : ''}</span>
          <span class="price">${priceHtml(o)}</span>
          <span class="tick">${K.ic('check', 'sm')}</span>
        </button>`).join('')}
      ${hidden > 0 ? `<button class="more-opts" id="moreOpts">More options (${hidden}) ${K.ic('chevDown', 'sm')}</button>` : ''}
      </div>
      <button class="payrow" id="pickRow" style="padding-bottom:4px"><span class="dot-pick" style="margin:0 12px 0 11px"></span><span class="grow"><span class="tiny muted" style="display:block;font-weight:500">${S.service === 'errand' ? 'Buy at' : 'Pickup'}</span><span class="ellipsis" id="pickLabel" style="display:block">${K.esc(S.pickup.address)}</span></span><span class="small muted">Change</span></button>
      ${(S.stops || []).map((x, i) => `<div class="payrow stop-row"><span class="stop-num" aria-hidden="true">${i + 1}</span><span class="grow"><span class="tiny muted" style="display:block;font-weight:500">Stop ${i + 1}</span><span class="ellipsis" style="display:block">${K.esc(x.address)}</span></span><button class="btn icon-btn btn-ghost" data-rmstop="${i}" aria-label="Remove stop ${i + 1}">${K.ic('x', 'sm')}</button></div>`).join('')}
      <button class="payrow" id="dropRow"><span class="dot-drop" style="margin:0 12px 0 11px"></span><span class="grow"><span class="tiny muted" style="display:block;font-weight:500">${['parcel', 'errand'].includes(S.service) ? 'Deliver to' : 'To'}</span><span class="ellipsis" style="display:block">${K.esc(S.drop.address)}</span></span><span class="small muted">Change</span></button>
      ${S.service === 'errand' ? `<button class="payrow" id="errandRow"><span class="paylogo wallet">${K.ic('receipt', 'sm')}</span><span class="grow">${S.errand ? `${S.errand.items.length} item${S.errand.items.length > 1 ? 's' : ''} · budget ${K.ugx(S.errand.budget)}<span class="tiny muted" style="display:block;font-weight:500">Plus the items, up to your budget, paid when they arrive</span>` : 'Add what to buy'}</span>${K.ic('chev', 'sm')}</button>` : ''}
      ${!['parcel', 'errand'].includes(S.service) && (S.stops || []).length < 2 ? `<button class="payrow add-stop" id="addStop"><span class="paylogo note-ic">${K.ic('plus', 'sm')}</span><span class="grow">Add a stop<span class="tiny muted" style="display:block;font-weight:500">${K.ugx((S.config && S.config.stopFee) || 0)} per stop, plus the extra distance</span></span></button>` : ''}
      <button class="payrow note-row" id="noteBtn"><span class="paylogo note-ic">${K.ic('msg', 'sm')}</span><span class="grow ellipsis">${S.note ? K.esc(S.note) : `<span class="muted">${S.service === 'errand' ? 'Add a note for the courier' : 'Add a pickup note'}</span>`}</span>${S.note ? '<span class="small muted">Edit</span>' : K.ic('chev', 'sm')}</button>
      ${S.service === 'parcel' ? `<button class="payrow" id="parcelRow"><span class="paylogo wallet">${K.ic('gift', 'sm')}</span><span class="grow">${S.parcel ? `Package for ${K.esc(S.parcel.recipientName)}` : 'Add delivery details'}</span>${K.ic('chev', 'sm')}</button>` : ''}
      <div class="chip-row">
        <button class="pill-opt ${S.when ? 'on' : ''}" id="whenBtn">${K.ic('clock', 'sm')}<span>${S.when ? K.esc(whenLabel(S.when)) : 'Now'}</span>${K.ic('chevDown', 'sm')}</button>
        ${S.service === 'errand' ? '' : `<button class="pill-opt ${S.passenger ? 'on' : ''}" id="whoBtn">${K.ic('person', 'sm')}<span>${S.passenger ? K.esc(K.first(S.passenger.name)) : 'For me'}</span>${K.ic('chevDown', 'sm')}</button>`}
        <button class="pill-opt ${S.promoCode ? 'on' : ''}" id="promoBtn">${K.ic('tag', 'sm')}<span>${S.promoCode ? K.esc(S.promoCode) : 'Promo'}</span></button>
      </div>
      <button class="payrow" id="womanBtn" role="switch" aria-checked="${!!S.womanDriver}"><span class="paylogo note-ic">${K.ic('shield', 'sm')}</span><span class="grow">Woman driver<span class="tiny muted" style="display:block;font-weight:500">${S.womanDriver ? 'Only women drivers get your request' : 'Ask only women drivers'}</span></span><span class="set-switch${S.womanDriver ? ' on' : ''}" aria-hidden="true"><i></i></span></button>
      <button class="payrow" id="payRow">${P.logo}<span class="grow">${P.name}${p === 'wallet' ? ` · ${K.ugx(S.user.walletBalance)}` : ''}${['mtn', 'airtel'].includes(p) ? '<span class="tiny muted" style="display:block;font-weight:500">MTN or Airtel, paid at the end</span>' : ''}</span>${K.ic('chev', 'sm')}</button>
      <div class="sheet-foot"><p class="tiny muted" style="margin:0;text-align:center">Upfront price · you pay what you see · <button class="link-btn tiny" id="whyPrice">How it’s priced</button></p><p class="error" id="err" style="margin:0 0 6px;min-height:0"></p>
      <button class="btn btn-primary btn-block btn-lg" id="request">${S.when ? 'Schedule' : 'Request'} ${K.esc(svcName(sel.id))} · ${K.ugx(payOf(sel))}</button></div>`;
    sheet.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
      if (b.dataset.s === S.service) return;
      setService(b.dataset.s); render(); showRoute();
    });
    K.$('#payRow').onclick = () => openPayments({ onPick: render });
    const mo = K.$('#moreOpts'); if (mo) mo.onclick = () => { S.allOpts = true; render(); };
    K.$('#dropRow').onclick = () => openSearch();
    const asb = K.$('#addStop'); if (asb) asb.onclick = () => openSearch({ addStop: true });
    sheet.querySelectorAll('[data-rmstop]').forEach((b) => b.onclick = () => { S.stops.splice(+b.dataset.rmstop, 1); prepareQuote(); });
    const er = K.$('#errandRow'); if (er) er.onclick = () => openErrandForm(render);
    if (S.service === 'errand') K.$('#pickRow').onclick = () => openSearch({ shop: true });
    else K.$('#pickRow').onclick = () => { S.prevPickup = S.pickup ? { ...S.pickup } : null; S.view = 'pickup'; clearRoute(); map.setView([S.pickup.lat, S.pickup.lng], 18); render(); };
    const pr = K.$('#parcelRow'); if (pr) pr.onclick = openParcel;
    K.$('#whenBtn').onclick = openWhen;
    const wb = K.$('#whoBtn'); if (wb) wb.onclick = openWho;
    K.$('#promoBtn').onclick = openPromo;
    K.$('#womanBtn').onclick = () => {
      S.womanDriver = !S.womanDriver; K.haptic && K.haptic();
      if (S.womanDriver) K.toast('We’ll only ask women drivers. It can take a little longer.', 4000);
      render();
    };
    K.$('#noteBtn').onclick = openNote;
    K.$('#whyPrice').onclick = () => whyPrice(q, sel);
    if (q.promoError && S.promoCode && !q._shown) { q._shown = true; K.toast(q.promoError, 4500); }
    K.$('#request').onclick = () => {
      if (S.service === 'parcel' && !S.parcel) { openParcel(); return; }
      if (S.service === 'errand' && !S.errand) { openErrandForm(render); return; }
      if (p === 'wallet' && S.user.walletBalance < payOf(sel)) { K.toast(S.config.paymentsAvailable ? 'Not enough in your wallet. Top up or pick another way to pay.' : 'Not enough in your wallet. Choose cash instead.', 4000); openPayments({ onPick: render }); return; }
      book();
    };
  }

  // A short note for the driver: where exactly to find you.
  function openNote() {
    const ideas = ['At the main gate', 'Call me when you arrive', 'Opposite the petrol station', 'At the stage'];
    const m = K.modal(`<h2>Pickup note</h2><p class="small muted">Help your ${who({ service: S.service })} find you. They see this when they accept.</p>
      <textarea id="nt" rows="3" maxlength="200" placeholder="e.g. Blue gate next to the pharmacy">${K.esc(S.note || '')}</textarea>
      <div class="chip-row" style="flex-wrap:wrap;margin-top:8px">${ideas.map((x) => `<button class="pill-opt" data-idea="${K.esc(x)}">${K.esc(x)}</button>`).join('')}</div>
      <div class="row" style="gap:8px;margin-top:14px">${S.note ? '<button class="btn fill" id="clr">Remove</button>' : ''}<button class="btn btn-primary fill" id="sv">Save note</button></div>`);
    const ta = K.$('#nt', m.el);
    setTimeout(() => ta.focus({ preventScroll: true }), 580);
    m.el.querySelectorAll('[data-idea]').forEach((b) => b.onclick = () => { ta.value = ta.value.trim() ? `${ta.value.trim()}. ${b.dataset.idea}` : b.dataset.idea; ta.focus(); });
    K.$('#sv', m.el).onclick = () => { S.note = ta.value.trim().slice(0, 200); m.close(); render(); };
    const c = K.$('#clr', m.el); if (c) c.onclick = () => { S.note = ''; m.close(); render(); };
  }

  // ---------- split the fare ----------
  // Friends pay their share by Mobile Money through a link; it lands in the rider's wallet.
  const canSplit = (t) => S.config.paymentsAvailable && !['parcel', 'errand'].includes(t.service) && t.paymentStatus !== 'paid' && ['accepted', 'arrived', 'in_progress', 'completed'].includes(t.status);
  const splitRow = (t) => !canSplit(t) ? '' : t.split
    ? `<button class="payrow" data-split><span class="paylogo note-ic">${K.ic('person', 'sm')}</span><span class="grow">Split ${t.split.people} ways · ${K.ugx(t.split.share)} each<span class="tiny muted" style="display:block;font-weight:500">${t.split.paid} of ${t.split.people - 1} friend${t.split.people > 2 ? 's' : ''} paid · goes to your Flytte Wallet</span></span>${K.ic('chev', 'sm')}</button>`
    : `<button class="payrow" data-split><span class="paylogo note-ic">${K.ic('person', 'sm')}</span><span class="grow">Split the fare<span class="tiny muted" style="display:block;font-weight:500">Friends pay their share by Mobile Money</span></span>${K.ic('chev', 'sm')}</button>`;
  function openSplit() {
    const t = S.trip; if (!t) return;
    const cur = t.split, min = cur ? Math.max(2, cur.paid + 1) : 2;
    const m = K.modal(`<h2>Split the fare</h2>
      <p class="small muted">Send friends a link. Each pays their share by Mobile Money, and it goes into your Flytte Wallet, so you can pay the trip from it.</p>
      <p class="small" style="margin:12px 0 6px;font-weight:600">How many people, including you?</p>
      <div class="row" style="gap:8px">${[2, 3, 4].map((n) => `<button class="btn fill ${cur && cur.people === n ? 'btn-primary' : ''}" data-people="${n}" ${n < min ? 'disabled' : ''}>${n}</button>`).join('')}</div>
      <p class="small muted" id="splitInfo" style="margin:10px 0 0">${cur ? `${K.ugx(cur.share)} each · ${cur.paid} of ${cur.people - 1} paid` : ''}</p>
      <button class="btn btn-primary btn-block btn-lg" id="splitSend" style="margin-top:12px" ${cur ? '' : 'disabled'}>Send the link on WhatsApp</button>
      <button class="btn btn-block" style="margin-top:8px" id="splitCopy" ${cur ? '' : 'disabled'}>Copy link</button>`);
    let link = cur ? `${location.origin}/split/${cur.token}` : null, share = cur ? cur.share : 0;
    const text = () => `Let’s split our Flytte ride. Your share is ${K.ugx(share)}. Pay it by Mobile Money here: ${link}`;
    m.el.querySelectorAll('[data-people]').forEach((b) => b.onclick = async () => {
      try {
        const out = await K.api(`/trips/${t.id}/split`, { people: +b.dataset.people });
        link = out.url; share = out.share;
        m.el.querySelectorAll('[data-people]').forEach((x) => x.classList.toggle('btn-primary', x === b));
        K.$('#splitInfo', m.el).textContent = `${K.ugx(out.share)} each · ${out.paid} of ${out.people - 1} paid`;
        K.$('#splitSend', m.el).disabled = false; K.$('#splitCopy', m.el).disabled = false;
      } catch (e) { K.toast(e.message); }
    });
    K.$('#splitSend', m.el).onclick = () => { if (!window.open('https://wa.me/?text=' + encodeURIComponent(text()), '_blank', 'noopener')) K.share(link, text()); };
    K.$('#splitCopy', m.el).onclick = async () => { try { await navigator.clipboard.writeText(text()); K.toast('Link copied'); } catch { prompt('Copy this link', link); } };
  }

  // Stops between pickup and destination on the trip screens; done ones are ticked.
  const stopRows = (t) => (t.stops || []).map((x, i) => `<div class="stop${x.doneAt ? ' done' : ''}"><span class="s-ic"><span class="dot-stop">${x.doneAt ? '✓' : i + 1}</span></span><span><small>Stop ${i + 1}${x.doneAt ? ' · done' : ''}</small><b class="ellipsis">${K.esc(x.address)}</b></span></div>`).join('');

  // "How it's priced": the parts behind the upfront price, and why it may be higher right now.
  function whyPrice(q, o) {
    const p = o.parts || {};
    const sum = (p.base || 0) + (p.distance || 0) + (p.time || 0);
    const minApplied = p.minFare && sum < p.minFare;
    const reasons = (o.surgeReasons || []).map((r) => ({ rain: 'It’s raining, so fewer drivers are out', demand: 'Many people are booking nearby', busy: 'Busy time on the roads', traffic: 'Heavy traffic on this route' }[r] || '')).filter(Boolean);
    K.modal(`<h2>How it’s priced</h2><p class="small muted">${svcName(o.id)} · ${p.km || q.distanceKm} km · about ${p.min || o.durationMin} min</p>
      <div class="kv"><span>Base fare</span><b>${K.ugx(p.base || 0)}</b></div>
      <div class="kv"><span>Distance (${p.km || q.distanceKm} km)</span><b>${K.ugx(p.distance || 0)}</b></div>
      <div class="kv"><span>Time (about ${p.min || o.durationMin} min)</span><b>${K.ugx(p.time || 0)}</b></div>
      ${minApplied ? `<div class="kv"><span>Minimum fare</span><b>${K.ugx(p.minFare)}</b></div>` : ''}
      ${p.stops ? `<div class="kv"><span>Stops (${(S.stops || []).length})</span><b>${K.ugx(p.stops)}</b></div>` : ''}
      ${o.surge > 1 ? `<div class="kv"><span>Busy-time pricing</span><b>×${o.surge}</b></div>` : ''}
      ${o.discount ? `<div class="kv"><span>${K.esc(o.promoLabel || 'Discount')}</span><b class="pos">−${K.ugx(o.discount)}</b></div>` : ''}
      <div class="big-total"><span class="bold">You pay</span><b>${K.ugx(payOf(o))}</b></div>
      ${reasons.length ? `<p class="small" style="margin:12px 0 0">${K.ic('info', 'sm')} Prices are higher right now: ${reasons.join('; ').toLowerCase()}. They drop again as things calm down.</p>` : ''}
      <p class="tiny faint" style="margin:12px 0 0">This is an upfront price. It only changes if you change the trip, such as a new destination or a long wait at pickup.</p>
      <button class="btn btn-block" style="margin-top:14px" data-close>Close</button>`);
  }

  // ---------- "Buy it for me" errands ----------
  // 1. What to buy and a budget  2. Where to buy it  3. Delivered to where you are (or where you choose).
  function startErrand() {
    if (!S.errandHome) S.errandHome = S.pickup && !S.pickup.isShop ? { ...S.pickup } : S.gps ? { lat: S.gps.lat, lng: S.gps.lng, address: 'Current location' } : null;
    openErrandForm(() => openSearch({ shop: true }));
  }
  function openErrandForm(next) {
    const e = S.errand || { items: [], budget: '', substitutes: true }, max = (S.config.errand || {}).maxBudget || 200000;
    const m = K.modal(`<h2>Buy it for me</h2><p class="small muted">Your courier buys these and brings them to you. You pay for the items when they arrive, plus the delivery.</p>
      <label for="er-items">What should we buy? One item per line</label><textarea id="er-items" rows="5" maxlength="1200" placeholder="2 kg sugar&#10;Panadol, 1 packet&#10;Airtime card, UGX 10,000">${K.esc(e.items.join('\n'))}</textarea>
      <label for="er-budget">Budget for the items (UGX)</label><input id="er-budget" type="number" inputmode="numeric" min="1000" max="${max}" step="500" placeholder="50000" value="${e.budget || ''}">
      <p class="tiny muted" style="margin:4px 0 10px">Your courier won’t spend more than this. You can raise it later.</p>
      <div class="set-card list" style="margin:0 0 12px"><button class="set-row" id="er-sub" role="switch" aria-checked="${e.substitutes !== false}"><span class="grow"><b>Substitutes are OK</b><small>If something isn’t there, the courier picks the closest match</small></span><span class="set-switch${e.substitutes !== false ? ' on' : ''}" aria-hidden="true"><i></i></span></button></div>
      <p class="error" id="err" role="alert"></p><button class="btn btn-primary btn-block btn-lg" id="er-next">${S.service === 'errand' && S.quote ? 'Save' : 'Next: choose the shop'}</button>`);
    let sub = e.substitutes !== false;
    K.$('#er-sub', m.el).onclick = (ev) => { sub = !sub; ev.currentTarget.setAttribute('aria-checked', sub); ev.currentTarget.querySelector('.set-switch').classList.toggle('on', sub); };
    K.$('#er-next', m.el).onclick = () => {
      const items = K.$('#er-items', m.el).value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
      const budget = Math.round(Number(K.$('#er-budget', m.el).value));
      const err = K.$('#err', m.el);
      if (!items.length) { err.textContent = 'Add at least one item.'; return; }
      if (!(budget >= 1000)) { err.textContent = 'Set a budget of at least UGX 1,000.'; return; }
      if (budget > max) { err.textContent = `The most for one errand is ${K.ugx(max)}.`; return; }
      S.errand = { items, budget, substitutes: sub };
      m.close(); setTimeout(() => (next || render)(), 280);
    };
  }
  // The shop is where the courier starts; your place is where it ends.
  function errandShop(place) {
    setService('errand'); S.stops = [];
    S.pickup = { ...place, short: shortName(place.address), manual: true, isShop: true };
    if (S.errandHome) {
      // The courier needs a real place name, not "Current location".
      const h = S.errandHome, generic = /^(Current location|Finding address…|Pinned location)$/;
      const name = h.short && !generic.test(h.short) ? h.short : h.address && !generic.test(h.address) ? h.address : null;
      const go = (addr) => { S.drop = { lat: h.lat, lng: h.lng, address: addr }; prepareQuote(); };
      if (name) go(name); else K.reverse(h.lat, h.lng).then((a) => go(a && !generic.test(a) ? a : 'Your location'));
    }
    else openSearch();   // no location yet: ask where to bring it
  }
  function raiseBudget(t) {
    const max = (S.config.errand || {}).maxBudget || 200000;
    const m = K.modal(`<h2>Raise the budget</h2><p class="small muted">Now ${K.ugx(t.errand.budget)}. Your courier gets a message straight away.</p>
      <input id="nb" type="number" inputmode="numeric" min="${t.errand.budget}" max="${max}" step="500" value="${t.errand.budget + 10000 <= max ? t.errand.budget + 10000 : max}" aria-label="New budget">
      <p class="error" id="err"></p><button class="btn btn-primary btn-block btn-lg" id="sv">Save budget</button>`);
    K.$('#sv', m.el).onclick = async () => {
      try { await K.api(`/trips/${t.id}/budget`, { budget: Math.round(Number(K.$('#nb', m.el).value)) }); m.close(); K.toast('Budget updated'); }
      catch (x) { K.$('#err', m.el).textContent = x.message; }
    };
  }
  // The receipt photo is private to the trip, so it's fetched with the sign-in, not as a public link.
  async function showReceiptPhoto(t) {
    const m = K.modal(`<h2>Receipt</h2><div id="rph" style="min-height:120px">${K.skeleton('list', 1)}</div><button class="btn btn-block" data-close style="margin-top:12px">Close</button>`);
    try {
      const r = await fetch(`/api/trips/${t.id}/receipt-photo`, { headers: { Authorization: 'Bearer ' + K.token() } });
      if (!r.ok) throw new Error();
      const url = URL.createObjectURL(await r.blob());
      K.$('#rph', m.el).innerHTML = `<img src="${url}" alt="Photo of the shop receipt" style="width:100%;border-radius:12px;display:block">`;
    } catch { K.$('#rph', m.el).innerHTML = '<p class="small muted">Couldn’t load the photo. Try again in a moment.</p>'; }
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
    if (S.pickup.address === 'Finding address…') onPinMove();
    K.$('#confirm').onclick = () => {
      if (S.pickup.address === 'Finding address…') S.pickup.address = 'Pinned location';
      S.pickup.short = null; S.pickup.manual = true; S.prevPickup = undefined;
      if (S.drop) prepareQuote();
      else { S.view = 'home'; render(); openSearch(); }
    };
  }

  function vDropPin() {
    const ps = S.pinSave, name = ps ? (ps.label || (ps.key === 'home' ? 'Home' : ps.key === 'work' ? 'Work' : 'this place')) : '';
    sheet.innerHTML = `
      <div class="grabber"></div>
      <h2 style="text-align:center">${ps ? `Set ${K.esc(name)} on the map` : 'Set your destination'}</h2>
      <div class="lrow" style="cursor:default"><span class="ic">${K.ic(ps ? 'pin' : 'flag')}</span><span class="grow"><span class="t ellipsis" id="pinAddr" style="display:block">${ps ? 'Move the map to the spot' : 'Move the map to your destination'}</span></span></div>
      <div class="sheet-foot"><button class="btn btn-primary btn-block btn-lg" id="confirm">${ps ? `Save as ${K.esc(name)}` : 'Confirm destination'}</button>${ps ? '<button class="btn btn-block" id="pinCancel">Cancel</button>' : ''}</div>`;
    onPinMove();
    const leave = () => { S.pinSave = null; S.view = 'home'; render(); };
    if (ps) K.$('#pinCancel').onclick = leave;
    K.$('#confirm').onclick = async () => {
      if (!S.pinDrop) return;
      if (!ps) { chooseDrop(S.pinDrop); return; }
      const d = S.pinDrop, address = d.address || (d.name !== 'Pinned location' ? d.name : await K.reverse(d.lat, d.lng).catch(() => 'Pinned location'));
      try {
        const out = await K.api('/me', { savedPlaces: { [ps.key]: { lat: d.lat, lng: d.lng, address, label: ps.label } } }, 'PATCH');
        saveUser(out.user); K.toast(`${name} saved`); const after = ps.onSaved; leave(); if (after) after();
      } catch (e) { K.toast(e.message); }
    };
  }

  async function book() {
    const btn = K.$('#request'), err = K.$('#err');
    if (!S.pickup) { err.textContent = 'Set your pickup point first.'; return; }
    btn.disabled = true; btn.textContent = 'Requesting…'; err.textContent = '';
    if (S.pickup.address === 'Finding address…') S.pickup.address = 'Pinned location';
    const opt = S.quote.options.find((o) => o.id === S.service);
    const body = { service: S.service, paymentMethod: PAY[pref()].method, companyId: pref() === 'business' ? (bizCompanies('business')[0] || {}).id : undefined, pickup: S.pickup, drop: S.drop, distanceKm: S.route.km, durationMin: S.route.freeMin, quoteId: S.quote.quoteId, expectedFare: opt && baseOf(opt), promoCode: S.promoCode || undefined, scheduledFor: S.when || undefined, passenger: S.passenger || undefined, notes: S.note || undefined, womanDriver: S.womanDriver || undefined, stops: S.stops.length ? S.stops : undefined };
    if (S.service === 'parcel') body.parcel = S.parcel;
    if (S.service === 'errand') body.errand = S.errand;
    // A locked wallet needs the rider's fingerprint, face or a code before paying from it.
    if (body.paymentMethod === 'wallet' && S.user.walletLock) {
      body.walletPass = await K.walletLock.unlock({ amount: opt ? payOf(opt) : undefined });
      if (!body.walletPass) { btn.disabled = false; btn.textContent = `Request ${svcName(S.service)}`; return; }
    }
    try { onTrip(await K.api('/trips', body, 'POST', { timeout: 45000 })); }
    catch (e) {
      if (/too long|reach Flytte/.test(e.message)) { // slow network: the request may have landed
        const a = await K.api('/trips/active').catch(() => null);
        if (a && ['requested', 'accepted', 'arrived', 'in_progress'].includes(a.status)) { onTrip(a); return; }
      }
      btn.disabled = false; btn.textContent = `Request ${svcName(S.service)}`;
      if (e.code === 'WALLET_LOCK') { S.user.walletLock = true; book(); return; }   // locked on another phone meanwhile
      if (/Prices have just changed/.test(e.message)) { K.toast(e.message, 5000); refreshQuote(); return; }
      err.textContent = e.message;
    }
  }

  // Asked once, right after the first booking: the moment the value is obvious.
  function offerAlerts() {
    let asked = false; try { asked = localStorage.getItem('flytte_alerts_asked') === '1'; } catch {}
    if (asked || !K.push.supported() || Notification.permission !== 'default') return;
    try { localStorage.setItem('flytte_alerts_asked', '1'); } catch {}
    setTimeout(() => {
      if (!S.trip || !['requested', 'accepted'].includes(S.trip.status)) return;
      const m = K.modal(`<div class="alert-ask"><div class="alert-ic">${K.ic('bell')}</div>
        <h2>Know when your driver arrives</h2>
        <p class="muted">Get a notification when your driver is close and when they’ve arrived, even with your phone locked.</p>
        <button class="btn btn-primary btn-block btn-lg" data-on>Turn on trip alerts</button>
        <button class="btn btn-ghost btn-block btn-lg" data-close>Not now</button></div>`);
      K.$('[data-on]', m.el).onclick = async () => {
        try { await K.push.enable(); m.close(); K.toast('Trip alerts are on'); }
        catch (e) { m.close(); K.toast(e.message, 6000); }
      };
    }, 1400);
  }

  // Screen 7: finding your rider
  function vSearching() {
    const t = S.trip;
    offerAlerts();
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
        <p class="small muted">${K.ugx(t.payable)} · ${PAY[payOfTrip(t)].name} · <span id="elapsed">0:00</span></p>
        <div class="slow-hint hidden" id="slow"></div>
      </div>
      <div class="sheet-foot"><button class="btn btn-outline btn-block btn-lg" id="cancel">Cancel</button></div>`;
    K.$('#cancel').onclick = cancelTrip;
    // Keep the wait honest: time spent, and after a while a faster option if there is one.
    clearInterval(S.searchTimer);
    const since = new Date(t.createdAt).getTime() || Date.now();
    const tick = () => {
      if (S.view !== 'searching' || !S.trip || S.trip.id !== t.id || !K.$('#elapsed')) { clearInterval(S.searchTimer); return; }
      const sec = Math.max(0, Math.floor((Date.now() - since) / 1000));
      K.$('#elapsed').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      const box = K.$('#slow');
      if (sec >= 45 && box.classList.contains('hidden')) {
        const alt = altService(t.service);
        box.innerHTML = `<b>Taking longer than usual</b><span>Drivers nearby are busy. We’re still asking.</span>${alt ? `<button class="btn btn-sm" id="tryAlt">Try ${K.esc(svcName(alt))} instead</button>` : ''}`;
        box.classList.remove('hidden');
        const b = K.$('#tryAlt'); if (b) b.onclick = () => switchService(alt);
      }
    };
    S.searchTimer = setInterval(tick, 1000); tick();
  }

  // The other everyday ride type, if it's on: boda <-> car.
  function altService(cur) {
    const on = (id) => S.config.services.some((x) => x.id === id);
    if (cur === 'boda' && on('car')) return 'car';
    if ((cur === 'car' || cur === 'comfort') && on('boda')) return 'boda';
    return null;
  }
  async function switchService(id) {
    const t = S.trip;
    try { if (t && t.status === 'requested') await K.api(`/trips/${t.id}/cancel`, { reason: 'switch' }); } catch {}
    S.trip = null; setService(id);
    if (t) { S.pickup = S.pickup || { ...t.pickup, manual: true }; S.drop = S.drop || { ...t.drop }; }
    prepareQuote();
  }

  function vNone() {
    clearRoute();
    sheet.innerHTML = `<div class="grabber"></div>
      <div class="finding"><div class="illu" style="width:110px;height:110px;margin:6px auto 16px"><span style="width:80px;height:54px;display:block">${K.artFor(S.trip ? S.trip.service : S.service)}</span></div>
      ${S.trip && S.trip.womanDriver ? `<h2>No women drivers free right now</h2>
      <p class="muted">The women drivers nearby are busy. Try again in a minute, or ask any driver.</p></div>
      <div class="sheet-foot"><button class="btn btn-outline btn-block btn-lg" id="anyDriver" style="margin-bottom:8px">Try any driver</button>`
      : `<h2>No ${S.trip ? who(S.trip) : 'driver'}s free right now</h2>
      <p class="muted">Everyone nearby is busy. Try again in a minute or choose another ride type.</p></div>
      <div class="sheet-foot">${(() => { const alt = altService(S.trip ? S.trip.service : S.service); return alt ? `<button class="btn btn-outline btn-block btn-lg" id="alt" style="margin-bottom:8px">Try ${K.esc(svcName(alt))}</button>` : ''; })()}`}
        <div class="row"><button class="btn fill" id="home">Back</button><button class="btn btn-primary fill" id="again">Try again</button></div></div>`;
    K.$('#home').onclick = reset;
    K.$('#again').onclick = () => prepareQuote();
    const alt = K.$('#alt'); if (alt) alt.onclick = () => switchService(altService(S.trip ? S.trip.service : S.service));
    const any = K.$('#anyDriver'); if (any) any.onclick = () => { S.womanDriver = false; prepareQuote(); };
  }

  function tripMins() {
    const t = S.trip; if (!t || !t.driver || !t.driver.location) return null;
    return K.etaMin(t.driver.location, t.status === 'in_progress' ? t.drop : t.pickup);
  }
  const photo = (d, cls = 'photo') => `<span class="${cls}">${d.photo ? `<img src="${K.esc(d.photo)}" alt="">` : K.initials(d.name)}</span>`;
  // What Flytte checked about the driver, shown before pickup (see driverChecks in src/realtime.js).
  const sinceText = (ym) => ym ? new Date(ym + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  const trustRow = (d) => {
    const c = d.checks || {};
    const label = c.id && c.permit ? 'ID & permit checked' : c.id ? 'ID checked' : c.permit ? 'Permit valid' : '';
    return label ? `<span class="trust-row"><span class="trust-b">${K.ic('check', 'sm')}<span>${label}</span></span></span>` : '';
  };
  const facePhoto = (d) => d.photo ? `<button class="photo-btn" data-face aria-label="See ${K.esc(K.first(d.name))}’s photo">${photo(d)}</button>` : photo(d);
  function showDriver() {
    const t = S.trip, d = t && t.driver; if (!d) return;
    const c = d.checks || {};
    const item = (ok, label) => `<div class="trust-li${ok ? '' : ' off'}">${K.ic(ok ? 'check' : 'info', 'sm')}<span>${label}</span></div>`;
    const m = K.modal(`<div class="face-card">
        ${d.photo ? `<img class="face-big" src="${K.esc(d.photo)}" alt="Photo of ${K.esc(d.name)}">` : `<span class="face-big face-none">${K.initials(d.name)}</span>`}
        <h2>${K.esc(d.name)}</h2>${stars(d.rating, d.trips)}
        <div class="face-plate"><span class="plate-chip">${K.esc(d.plate || '')}</span><span class="small muted">${K.esc(d.vehicle || svcName(t.service))}</span></div>
        <div class="trust-list">
          ${item(c.id, c.id ? 'National ID checked by Flytte' : 'ID not checked yet')}
          ${item(c.permit, c.permit ? 'Driving permit on file and valid' : 'Driving permit not confirmed')}
          ${c.since ? item(true, `Driving with Flytte since ${sinceText(c.since)}`) : ''}
        </div>
        <p class="small muted">Make sure the face and plate match before you get on.</p>
        <button class="btn" data-close>Looks right</button>
        <button class="link-report" data-mismatch>Driver or plate doesn’t match?</button>
      </div>`);
    K.$('[data-mismatch]', m.el).onclick = () => { m.close(); reportMismatch(); };
  }
  const stars = (r, n) => `<span class="rating"><span class="star-ic">★</span><b>${r || 'New'}</b>${n ? ` (${n} trip${n > 1 ? 's' : ''})` : ''}</span>`;
  const pinDigits = (pin) => `<span class="pin-code" aria-label="PIN ${pin}">${String(pin).split('').map((d) => `<span>${d}</span>`).join('')}</span>`;

  // ---------- trip extras: discount, passenger, parcel delivery code, tips ----------
  // The fare (crossed out when discounted); on an errand, the total with the items in it.
  const fareHtml = (t) => {
    const g = t.goodsTotal || 0, ride = t.payable - g;
    const base = t.discount ? `<span class="was" style="display:inline;margin-right:6px">${K.ugx(t.fare)}</span>${K.ugx(ride)}` : K.ugx(t.fare);
    return g ? `${K.ugx(t.payable)}<span class="fare-sub">incl. ${K.ugx(g)} of items</span>` : base;
  };
  function extrasHtml(t) {
    let h = '';
    if (t.passenger) h += `<div class="extra-box"><span class="grow"><b>Riding: ${K.esc(t.passenger.name)}</b><br><span class="small muted">The ${who(t)} will call ${K.esc(K.first(t.passenger.name))} at pickup</span></span><button class="btn btn-sm btn-primary" data-sendpass>Send details</button></div>`;
    if (t.service === 'errand' && t.errand) {
      const e = t.errand, list = e.items.slice(0, 4).map((x) => `<li>${K.esc(x)}</li>`).join('') + (e.items.length > 4 ? `<li class="muted">+${e.items.length - 4} more</li>` : '');
      h += `<div class="errand-box"><div class="row" style="justify-content:space-between;align-items:baseline"><b>Your shopping</b><span class="small muted">${e.substitutes ? 'Substitutes OK' : 'No substitutes'}</span></div>
        <ul class="errand-list">${list}</ul>
        ${e.goodsTotal != null ? `<div class="row" style="justify-content:space-between;align-items:center"><span><b>Spent ${K.ugx(e.goodsTotal)}</b><span class="small muted"> of ${K.ugx(e.budget)}</span></span>${e.receipt ? '<button class="btn btn-sm" data-receiptphoto>See receipt</button>' : ''}</div>`
          : `<div class="row" style="justify-content:space-between;align-items:center"><span class="small">Budget <b>${K.ugx(e.budget)}</b></span>${['requested', 'accepted', 'arrived'].includes(t.status) ? '<button class="btn btn-sm" data-budget>Raise budget</button>' : ''}</div>`}</div>`;
      if (t.dropCode && t.status !== 'completed') h += `<div class="extra-box"><span class="grow"><b>Delivery code ${pinDigits(t.dropCode)}</b><br><span class="small muted">Give it to ${K.esc(K.first((t.driver || {}).name || 'your courier'))} when your items arrive</span></span></div>`;
    }
    if (t.dropCode && t.service === 'parcel' && t.parcel) h += `<div class="extra-box"><span class="grow"><b>Delivery code ${pinDigits(t.dropCode)}</b><br><span class="small muted">${K.esc(K.first(t.parcel.recipientName))} gives this to the rider to receive the parcel</span></span><button class="btn btn-sm btn-primary" data-sendcode>Send</button></div>`;
    return h;
  }
  const sms = (phone, text) => { location.href = `sms:${phone}${/iphone|ipad/i.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`; };
  function bindExtras(t) {
    const link = location.origin + '/t/' + t.shareToken;
    const d = t.driver || {};
    const sp = sheet.querySelector('[data-sendpass]');
    if (sp) sp.onclick = () => sms(t.passenger.phone, `Hi ${K.first(t.passenger.name)}, I booked you a Flytte ${svcName(t.service).toLowerCase()}.${d.name ? ` ${K.first(d.name)} is coming in ${d.vehicle || ''} ${d.plate || ''}.` : ''} Your PIN is ${t.pin}: tell it to the ${who(t)} to start. Follow live: ${link}`);
    const bb = sheet.querySelector('[data-budget]'); if (bb) bb.onclick = () => raiseBudget(t);
    const rp = sheet.querySelector('[data-receiptphoto]'); if (rp) rp.onclick = () => showReceiptPhoto(t);
    const sc = sheet.querySelector('[data-sendcode]');
    if (sc) sc.onclick = () => sms(t.parcel.recipientPhone, `Hi ${K.first(t.parcel.recipientName)}, a Flytte parcel is on its way to you (${t.parcel.item}). Give the rider this delivery code when it arrives: ${t.dropCode}. Track it: ${link}`);
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
        ${canWallet ? `<button class="pay-item" data-m="wallet">${PAY.wallet.logo}<span class="grow"><b>From my Flytte Wallet</b><span>Sent to ${K.esc(K.first(t.driver.name))} instantly</span></span></button>` : ''}
        <button class="pay-item" data-m="cash">${PAY.cash.logo}<span class="grow"><b>In cash</b><span>Hand it to ${K.esc(K.first(t.driver.name))} now</span></span></button>
        <button class="btn btn-block" data-close style="margin-top:6px">Cancel</button>`);
      m.el.querySelectorAll('[data-m]').forEach((x) => x.onclick = async () => {
        try {
          let walletPass;
          if (x.dataset.m === 'wallet' && S.user.walletLock) { m.close(); walletPass = await K.walletLock.unlock({ amount }); if (!walletPass) return; }
          await K.api(`/trips/${t.id}/tip`, { amount, method: x.dataset.m, walletPass });
          if (x.dataset.m === 'wallet') S.user.walletBalance -= amount;
          S.trip.tip = amount; S.trip.tipMethod = x.dataset.m; m.close(); K.toast('Tip sent. Thank you.'); render();
        } catch (e) { K.toast(e.message); }
      });
    });
  }

  // Night-time sharing on the trip screen. Texted by SMS: a quiet line. Not texted (SMS not set up or it
  // failed): "Send your trip to <contact>" with a one-tap WhatsApp send of the same message and live link.
  const WA_IC = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z"/></svg>';
  function nightCard(t) {
    const n = t.nightShare;
    if (!n) return '';
    const who = n.contact ? prettyPhone(n.contact) : 'your emergency contact';
    if (n.status === 'sms') return `<p class="night-card ok" id="nightCard" role="status">${K.ic('check', 'sm')}<span><b>Night trip shared by SMS</b><small>${K.esc(who)} got your driver, plate and live link.</small></span></p>`;
    const why = n.reason === 'sms_error' ? 'The text didn’t go through.' : n.status === 'failed' ? 'We couldn’t share it automatically.' : 'Texts aren’t switched on yet.';
    return `<div class="night-card" id="nightCard" role="status">
      <span class="nc-ic">${K.ic('clock', 'sm')}</span>
      <span class="grow"><b>Send your trip to ${K.esc(who)}</b><small>${why} One tap sends your driver, plate and live link on WhatsApp.</small>
        ${n.opened ? '<small class="nc-done">Opened in WhatsApp</small>' : ''}</span>
      ${n.whatsapp ? `<button class="btn nc-wa" id="nsWa">${WA_IC}${n.opened ? 'Send again' : 'Send on WhatsApp'}</button>` : ''}</div>`;
  }
  function sendNightWhatsApp(t) {
    const n = t.nightShare;
    if (!n || !n.whatsapp) return;
    const w = window.open(n.whatsapp, '_blank', 'noopener');
    if (!w) location.href = n.whatsapp;
    if (!n.opened) K.api(`/trips/${t.id}/night-share/opened`, {}).catch(() => {});
  }
  // Told once per trip, as soon as the trip screen hears it wasn't texted.
  function nightToast(t) {
    const n = t.nightShare;
    if (!n || n.status === 'sms' || n.opened || !n.whatsapp) return;
    const key = 'flytte_ns_' + t.id;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch {}
    K.toast(`Send your trip to ${n.contact ? prettyPhone(n.contact) : 'your emergency contact'}`, 6000);
    vibrate();
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
        <div class="driver-card">${facePhoto(d)}
          <span class="grow"><b style="display:block">${K.esc(d.name)}</b>${stars(d.rating, d.trips)}<span class="small muted" style="display:block">${K.esc(d.vehicle || svcName(t.service))}</span><span class="plate-chip plate-inline">${K.esc(d.plate)}</span>${trustRow(d)}</span>
          ${callBtn('round go')}<button class="round brand" id="chatBtn" aria-label="Message">${K.ic('msg')}</button></div>
        <button class="link-report" data-report>Driver or plate doesn’t match?</button>
        ${nightCard(t)}
        <div class="bar" style="margin:14px 0 4px"><i id="etaBar" style="width:${pct}%"></i></div>
        <div class="stops">
          <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>From</small><b class="ellipsis">${K.esc(t.pickup.address)}</b></span></div>
          ${stopRows(t)}
          <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>To</small><b class="ellipsis">${K.esc(t.drop.address)}</b></span></div>
        </div>
        ${extrasHtml(t)}
        <div class="fare-row"><span class="muted">Total fare</span><b>${fareHtml(t)}</b></div>
        ${splitRow(t)}
        <div class="sheet-foot"><div class="row trip-acts-row"><button class="btn fill" id="share">${K.ic('send', 'sm')} Send arrival time</button><button class="btn btn-danger-soft sos-btn" id="sos" style="margin-top:0">${K.ic('sos', 'sm')} SOS</button></div></div>`;
      K.$('#share').onclick = shareEta;
      K.$('#sos').onclick = sos;
      const nw = K.$('#nsWa'); if (nw) nw.onclick = () => sendNightWhatsApp(t);
    } else {
      const arrived = t.status === 'arrived';
      sheet.innerHTML = `
        <div class="grabber"></div>
        ${t.service === 'errand' ? `<h2 style="font-size:1.15rem">${K.esc(K.first(d.name))} ${t.errand && t.errand.goodsTotal != null ? 'bought your items' : arrived ? 'is shopping for you' : 'is going to the shop'}</h2>`
          : arrived ? `<div class="arrive-hero" role="status"><small>${K.esc(K.first(d.name))} is here · look for</small><b class="arrive-plate">${K.esc(d.plate || '')}</b><span>${K.esc(d.vehicle || svcName(t.service))}</span></div>`
          : `<h2 style="font-size:1.15rem">${K.esc(K.first(d.name))} is on the way</h2>`}
        <div class="driver-card" style="margin-top:12px">${facePhoto(d)}
          <span class="grow"><b style="display:block">${K.esc(d.name)}</b>${stars(d.rating, d.trips)}<span class="small muted" style="display:block">${K.esc(d.vehicle || svcName(t.service))}</span>${trustRow(d)}</span>
          <span style="text-align:right"><span class="plate-chip">${K.esc(d.plate)}</span><span style="display:block;width:70px;height:44px;margin-top:4px">${K.artFor(t.service, d.vehicleType)}</span></span></div>
        ${t.service === 'errand' ? '' : '<button class="link-report" data-report>Driver or plate doesn’t match?</button>'}
        <div class="eta-line"><span id="etaTxt">${t.service === 'errand' ? (t.errand && t.errand.goodsTotal != null ? 'Items bought · on the way soon' : arrived ? 'Shopping now' : mins ? `At the shop in ${mins} min` : 'Going to the shop') : arrived ? `Meet ${K.esc(K.first(d.name))} now` : mins ? `Arriving in ${mins} min` : 'On the way'}</span><span class="small muted" style="font-weight:600">${t.service === 'parcel' ? 'Parcel pickup' : t.service === 'errand' ? 'Shop' : 'Pickup'}</span></div>
        <div class="bar"><i id="etaBar" style="width:${pct}%"></i></div>
        ${arrived && S.config.drivers && t.service !== 'errand' ? `<p class="wait-note">${K.ic('clock', 'sm')}<span>Your ${who(t)} waits up to ${S.config.drivers.freeWaitMin} min for free.${S.config.drivers.noShowFee ? ` After that they can leave, and a ${K.ugx(S.config.drivers.noShowFee)} no-show fee is taken from your wallet if it has enough.` : ' After that they can leave.'}</span></p>` : ''}
        <div class="act-row">${callBtn('act') || '<span></span>'}<button class="act" id="chatBtn">${K.ic('msg')} Message</button></div>
        ${t.service === 'errand' ? '' : `<div class="pin-box"><span><b>${t.passenger ? `${K.esc(K.first(t.passenger.name))}’s trip PIN` : 'Your trip PIN'}</b><br><span class="small muted">${t.passenger ? 'Send it to them below' : `Tell your ${who(t)} to start`}</span></span>${pinDigits(t.pin)}</div>`}
        ${extrasHtml(t)}
        ${t.notes ? `<p class="note-line">${K.ic('msg', 'sm')}<span><small>Your pickup note</small>${K.esc(t.notes)}</span></p>` : ''}
        <div class="stops">
          <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>${t.service === 'errand' ? 'Shop' : 'Pickup'}</small><b class="ellipsis">${K.esc(t.pickup.address)}</b></span></div>
          ${stopRows(t)}
          <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>${t.service === 'errand' ? 'Deliver to' : 'Drop-off'}</small><b class="ellipsis">${K.esc(t.drop.address)}</b></span></div>
        </div>
        <div class="fare-row"><span class="row" style="gap:8px">${PAY[payOfTrip(t)].logo}<span class="muted">${PAY[payOfTrip(t)].name}</span></span><b>${fareHtml(t)}</b></div>
        ${t.service === 'errand' && t.errand && t.errand.goodsTotal != null ? '' : `<div class="sheet-foot"><button class="btn btn-danger btn-block btn-lg" id="cancel">${t.service === 'errand' ? 'Cancel errand' : 'Cancel ride'}</button></div>`}`;
      const cx = K.$('#cancel'); if (cx) cx.onclick = cancelTrip;
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
  // The driver or vehicle isn't what the app shows: tell the safety team straight away.
  function reportMismatch() {
    const t = S.trip, d = t.driver || {};
    let kind = null;
    const m = K.modal(`<h2>Report a mismatch</h2>
      <p class="muted">Your report goes straight to the Flytte safety team. ${t.status === 'completed' ? '' : 'Don’t get on if the driver or vehicle isn’t the one shown in the app.'}</p>
      <button class="lrow" data-k="photo"><span class="ic">${K.ic('user')}</span><span class="grow"><span class="t">The driver isn’t the person in the photo</span></span><span class="tick" aria-hidden="true">${K.ic('check', 'sm')}</span></button>
      <button class="lrow" data-k="plate"><span class="ic">${K.ic('card')}</span><span class="grow"><span class="t">The number plate is different</span><span class="s">The app shows ${K.esc(d.plate || '')}</span></span><span class="tick" aria-hidden="true">${K.ic('check', 'sm')}</span></button>
      <label for="rnote">Anything else we should know? <span class="muted">(optional)</span></label>
      <textarea id="rnote" maxlength="300" rows="2" placeholder="e.g. the plate was UFB 999X"></textarea>
      <p class="error" id="rerr"></p>
      <button class="btn btn-danger btn-block btn-lg" id="rsend" disabled>Send report</button>
      <button class="btn btn-block" style="margin-top:8px" data-close>Cancel</button>`);
    m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
      kind = b.dataset.k;
      m.el.querySelectorAll('[data-k]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      K.$('#rsend', m.el).disabled = false;
    });
    K.$('#rsend', m.el).onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span>Sending…';
      try {
        await K.api(`/trips/${t.id}/report`, { kind, note: K.$('#rnote', m.el).value });
        const before = ['accepted', 'arrived'].includes(t.status), during = t.status === 'in_progress';
        m.el.innerHTML = `<div style="text-align:center;padding:6px 0 4px"><div class="check-big" style="margin:0 auto 10px">${K.ic('check')}</div>
          <h2>Report received</h2><p class="muted">The safety team will check this driver. ${before ? 'If it isn’t the right driver or vehicle, don’t get on. You can cancel this ride at no cost.' : during ? 'If you feel unsafe, use SOS or call the police on 999.' : ''}</p></div>
          ${before ? '<button class="btn btn-danger btn-block btn-lg" id="rcancel">Cancel this ride</button>' : ''}
          ${during ? `<button class="btn btn-danger btn-block btn-lg" id="rsos">${K.ic('sos', 'sm')} SOS</button>` : ''}
          <button class="btn btn-block" style="margin-top:8px" data-close>Close</button>`;
        const rc = K.$('#rcancel', m.el); if (rc) rc.onclick = () => { m.close(); cancelTrip(); };
        const rs = K.$('#rsos', m.el); if (rs) rs.onclick = () => { m.close(); sos(); };
      } catch (e) { b.disabled = false; b.textContent = 'Send report'; K.$('#rerr', m.el).textContent = e.message; }
    };
  }

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
        <h2>${t.school ? `${K.esc((t.passenger || {}).name || 'Your child')} ${t.school.leg === 'morning' ? 'is at school' : 'is home'}` : t.service === 'parcel' ? 'Parcel delivered' : t.service === 'errand' ? 'Your items are here' : 'You’ve arrived'}</h2>
        <p class="small muted">${t.service === 'parcel' ? 'Your package has been handed over' : t.service === 'errand' ? `${K.ugx(t.goodsTotal || 0)} of items, plus the delivery` : 'Thanks for riding with Flytte'}</p>
        <div class="fare-card">
          <span class="small muted">${t.paymentMethod === 'cash' ? 'Pay in cash' : needsPay ? 'Amount due' : 'Total paid'}</span>
          <div class="amt">${K.ugx(t.payable)}</div>
          ${t.discount ? `<span class="deal" style="display:block;margin-top:2px">${K.ic('tag', 'sm')} You saved ${K.ugx(t.discount)}${t.promoLabel ? ' · ' + K.esc(t.promoLabel) : ''}</span>` : ''}
          <span class="row" style="justify-content:center;gap:8px;margin-top:6px">${P.logo}<span class="small bold">${P.name}</span></span>
          ${t.pointsEarned ? `<span class="points-pill">★ +${t.pointsEarned} Flytte Rewards point${t.pointsEarned > 1 ? 's' : ''}</span>` : ''}
        </div>
        ${!t.riderRated ? `
          <h3 style="margin-top:6px">Rate your ${who(t)}</h3>
          <div class="row" style="justify-content:center;gap:8px">${photo(d, 'photo')}<span style="text-align:left"><b>${K.esc(d.name || '')}</b><br><span class="small muted">${K.esc(d.plate || '')}</span></span></div>
          <div class="stars" role="radiogroup" aria-label="Rate your ${who(t)}">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" role="radio" aria-checked="${n === S.rating}" aria-label="${n} star${n > 1 ? 's' : ''}" class="${n <= S.rating ? 'on' : ''}">${K.starSvg}</button>`).join('')}</div>` : ''}
        ${tipHtml(t)}
        <button class="btn btn-link btn-block" id="details" style="min-height:36px">View details</button>
        <button class="link-report" data-report style="margin:0 auto">Driver or vehicle didn’t match?</button>
      </div>
      ${needsPay ? splitRow(t) : ''}
      <div class="sheet-foot">
        ${needsPay ? `<p class="error" id="err" role="alert" style="margin:0 0 6px;min-height:0">${S.config.paymentsAvailable ? '' : `${P.name} isn’t available yet. Pay your ${who(t)} ${K.ugx(t.payable)} in cash.`}</p>
          ${S.user.walletBalance >= t.payable ? `<button class="btn btn-primary btn-block btn-lg" id="payWallet">Pay ${K.ugx(t.payable)} from Flytte Wallet</button>` : ''}
          ${S.config.paymentsAvailable ? `<button class="btn ${S.user.walletBalance >= t.payable ? 'btn-outline' : 'btn-primary'} btn-block btn-lg" id="pay">Pay ${K.ugx(t.payable)} with ${P.name}</button>` : ''}
          <button class="btn ${S.config.paymentsAvailable ? 'btn-outline' : 'btn-primary'} btn-block btn-lg" id="cashPaid">I paid in cash</button>` : ''}
        ${!t.riderRated ? `<button class="btn ${needsPay ? '' : 'btn-primary'} btn-block btn-lg" id="rate" ${S.rating || !needsPay ? '' : 'disabled'}>${S.rating || needsPay ? `Rate ${who(t)}` : 'Done'}</button>
          ${needsPay ? '' : `<p class="small muted" id="rateHint" style="text-align:center;margin:6px 0 0">${S.rating ? '' : 'Rating is optional'}</p>`}` : (!needsPay ? '<button class="btn btn-primary btn-block btn-lg" id="done">Done</button>' : '')}
      </div>`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => {
      S.rating = +b.dataset.n;
      sheet.querySelectorAll('[data-n]').forEach((x) => { x.classList.toggle('on', +x.dataset.n <= S.rating); x.setAttribute('aria-checked', String(+x.dataset.n === S.rating)); });
      const rb = K.$('#rate'); rb.disabled = false; rb.textContent = `Rate ${who(t)}`;
      const h = K.$('#rateHint'); if (h) h.textContent = '';
    });
    const pay = K.$('#pay');
    if (pay) pay.onclick = async () => {
      pay.disabled = true;
      try {
        const r = t.paymentMethod === 'momo'
          ? await K.payMomo({ amount: t.payable, title: 'Pay for your trip', saved: S.user.payPhone, send: (x) => K.api(`/trips/${t.id}/pay`, x) })
          : await K.awaitPayment(await K.api(`/trips/${t.id}/pay`, {}));
        if (r === 'success') { K.toast('Payment received ✅'); S.trip.paymentStatus = 'paid'; render(); }
        else if (r !== 'redirect') pay.disabled = false;
      } catch (e) { K.$('#err').textContent = e.message; pay.disabled = false; }
    };
    const pw = K.$('#payWallet');
    if (pw) pw.onclick = async () => {
      pw.disabled = true;
      try {
        let walletPass;
        if (S.user.walletLock) { walletPass = await K.walletLock.unlock({ amount: t.payable }); if (!walletPass) { pw.disabled = false; return; } }
        await K.api(`/trips/${t.id}/pay-wallet`, { walletPass });
        S.trip.paymentStatus = 'paid'; S.trip.paymentMethod = 'wallet'; S.user.walletBalance -= t.payable; K.toast('Paid from your Flytte Wallet'); render();
      } catch (e) { K.$('#err').textContent = e.message; pw.disabled = false; }
    };
    const cp = K.$('#cashPaid');
    if (cp) cp.onclick = async () => {
      cp.disabled = true;
      try { await K.api(`/trips/${t.id}/pay-cash`, {}); S.trip.paymentStatus = 'paid'; S.trip.paymentMethod = 'cash'; K.toast('Marked as paid in cash'); render(); }
      catch (e) { K.$('#err').textContent = e.message; cp.disabled = false; }
    };
    const rate = K.$('#rate');
    if (rate) rate.onclick = async () => {
      rate.disabled = true;
      // No stars chosen = "not now": the server records it so this screen doesn't come back.
      try { await K.api(`/trips/${t.id}/rate`, S.rating ? { stars: S.rating } : { skip: true }); }
      catch (e) { rate.disabled = false; K.toast(`Rating not saved: ${e.message}`, 4500); return; }
      S.trip.riderRated = true; S.rating = 0;
      if (needsPay) render(); else { K.toast('Thanks for riding with Flytte'); reset(); }
    };
    const dn = K.$('#done'); if (dn) dn.onclick = reset;
    K.$('#details').onclick = () => tripDetails(t);
    bindTip(t);
  }

  function tripDetails(t) {
    const d = t.driver || {};
    const P = PAY[payOfTrip(t)] || PAY.cash;
    // What happened when: requested → accepted → arrived → started → dropped off.
    const at = (x) => (x ? K.clock(new Date(x)) : null);
    const steps = [['Requested', t.createdAt], [`${d.name ? K.first(d.name) : 'Driver'} accepted`, t.acceptedAt], ['Arrived at pickup', t.arrivedAt], ['Trip started', t.startedAt],
      [['parcel', 'errand'].includes(t.service) ? 'Delivered' : 'Dropped off', t.completedAt]].filter(([, x]) => x);
    if (['cancelled', 'no_drivers'].includes(t.status)) steps.push([t.status === 'no_drivers' ? 'No driver found' : `Cancelled${t.cancelledBy === 'driver' ? ' by the driver' : ''}`, null]);
    const dm = K.modal(`<div class="td-map" id="tdMap" aria-label="Map of the route"></div>
      <h2>${K.esc(shorten(t.drop.address, 40))}</h2>
      <p class="small muted">${K.when(t.completedAt || t.createdAt)} · ${K.esc(svcName(t.service))}${t.distanceKm ? ` · ${Number(t.distanceKm).toFixed(1)} km` : ''}</p>
      ${steps.length > 1 ? `<ol class="timeline">${steps.map(([l, x], i) => `<li class="${i === steps.length - 1 ? 'last' : ''}"><b>${K.esc(l)}</b>${at(x) ? `<span>${at(x)}</span>` : ''}</li>`).join('')}</ol>` : ''}
      <div class="stops">
        <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>From</small><b>${K.esc(t.pickup.address)}</b></span></div>
        ${stopRows(t)}
        <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>To</small><b>${K.esc(t.drop.address)}</b></span></div>
      </div>
      <div class="kv"><span>Service</span><b>${svcName(t.service)}</b></div>
      ${t.errand ? `<div class="kv"><span>Items bought (${t.errand.items.length})</span><b>${t.errand.goodsTotal != null ? K.ugx(t.errand.goodsTotal) : 'Not yet'}</b></div>` : ''}
      ${d.name ? `<div class="kv"><span>${['parcel', 'errand'].includes(t.service) ? 'Courier' : 'Driver'}</span><b>${K.esc(d.name)} · ${K.esc(d.plate || '')}</b></div>` : ''}
      ${t.distanceKm ? `<div class="kv"><span>Distance</span><b>${Number(t.distanceKm).toFixed(1)} km</b></div>` : ''}
      <div class="kv"><span>Payment</span><b>${P.name}${t.paymentStatus === 'paid' ? ' · Paid' : t.paymentStatus === 'pending' && t.paymentMethod !== 'cash' ? ' · Not paid' : ''}</b></div>
      ${t.scheduledFor ? `<div class="kv"><span>Scheduled for</span><b>${whenLabel(t.scheduledFor)}</b></div>` : ''}
      ${t.passenger ? `<div class="kv"><span>Passenger</span><b>${K.esc(t.passenger.name)}</b></div>` : ''}
      <div class="kv"><span>Fare</span><b>${K.ugx(t.fare)}</b></div>
      ${t.discount ? `<div class="kv"><span>${K.esc(t.promoLabel || 'Discount')}</span><b class="pos">−${K.ugx(t.discount)}</b></div>` : ''}
      ${t.tip ? `<div class="kv"><span>Tip (${t.tipMethod === 'wallet' ? 'wallet' : 'cash'})</span><b>${K.ugx(t.tip)}</b></div>` : ''}
      <div class="big-total"><span class="bold">You paid</span><b>${K.ugx(t.payable + (t.tip || 0))}</b></div>
      <div class="trip-acts">
        ${!['parcel', 'errand'].includes(t.service) && ['completed', 'cancelled', 'no_drivers'].includes(t.status) ? `<button class="trip-act" data-again>${K.ic('refresh')}<span>Book again</span></button>` : ''}
        ${!['parcel', 'errand'].includes(t.service) && t.status === 'completed' ? `<button class="trip-act" data-return>${K.ic('back')}<span>Book the return</span></button>` : ''}
        ${t.status === 'completed' ? `<button class="trip-act" data-receipt>${K.ic('receipt')}<span>Receipt</span></button>` : ''}
        ${t.driver ? `<button class="trip-act" data-help>${K.ic('help')}<span>Get help</span></button>` : ''}
      </div>
      <div data-issues></div>
      <button class="btn btn-block" style="margin-top:14px" data-close>Close</button>`);
    const box = dm.el, close = dm.close;
    const again = box.querySelector('[data-again]'); if (again) again.onclick = () => { close(); bookAgain(t); };
    const ret = box.querySelector('[data-return]'); if (ret) ret.onclick = () => { close(); bookAgain(t, true); };
    // The route on a real map (still, no dragging), in the app's light or dark style.
    setTimeout(async () => {
      if (!box.isConnected || !K.$('#tdMap', box)) return;
      try {
        const mm = K.map('tdMap', t.pickup, 14);
        ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard'].forEach((h) => mm[h] && mm[h].disable());
        const r = await K.route(t.pickup, t.drop, t.stops || []);
        if (!box.isConnected) return;
        const line = K.drawRoute(mm, r.coords, { animate: !K.reduced() });
        L.marker(r.coords[0], { icon: K.divIcon('<div class="pin-ci"></div>', [18, 18]) }).addTo(mm);
        L.marker(r.coords[r.coords.length - 1], { icon: K.divIcon('<div class="pin-sq"></div>', [18, 18]) }).addTo(mm);
        (t.stops || []).forEach((x, i) => L.marker([x.lat, x.lng], { icon: K.divIcon(`<div class="pin-stop">${i + 1}</div>`, [20, 20]) }).addTo(mm));
        mm.fitBounds(line.bounds(), { padding: [26, 26], maxZoom: 16 });
      } catch {}
    }, 60);
    const rc = box.querySelector('[data-receipt]'); if (rc) rc.onclick = () => receipt(t);
    const hp = box.querySelector('[data-help]'); if (hp) hp.onclick = () => { close(); tripHelp(t); };
    // Earlier reports on this trip, with the Flytte team's reply.
    const ib = box.querySelector('[data-issues]');
    if (ib && t.driver) K.api(`/trips/${t.id}/help`).then((r) => { ib.innerHTML = issueList(r.issues); }).catch(() => {});
  }

  const issueList = (list) => (list && list.length ? `<h3 class="set-h" style="margin-top:16px">Your reports</h3>${list.map((i) => `<div class="issue ${i.status}">
      <div class="row" style="justify-content:space-between;gap:8px"><b>${K.esc(i.label)}</b><span class="badge ${i.status === 'open' ? 'warn' : 'ok'}">${i.status === 'open' ? 'In review' : 'Resolved'}</span></div>
      <p class="small muted" style="margin:4px 0 0">${K.esc(i.details || '')}</p>
      ${i.reply ? `<div class="issue-reply"><small>Flytte support</small>${K.esc(i.reply)}</div>` : '<p class="tiny faint" style="margin:6px 0 0">We usually reply within a few hours.</p>'}</div>`).join('')}` : '');

  // Same route, same service, ready to confirm.
  // A soft two-note chime when the driver arrives (only if the page may play sound).
  function chime() {
    try {
      const c = new (window.AudioContext || window.webkitAudioContext)();
      [[0, 784], [0.18, 1046]].forEach(([d, f]) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(c.destination);
        g.gain.setValueAtTime(0.0001, c.currentTime + d); g.gain.exponentialRampToValueAtTime(0.18, c.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d + 0.5);
        o.start(c.currentTime + d); o.stop(c.currentTime + d + 0.55); });
    } catch {}
  }

  // Book again, or the return trip (destination becomes the pickup), with the same ride type.
  function bookAgain(t, back = false) {
    if (S.trip && ['requested', 'accepted', 'arrived', 'in_progress'].includes(S.trip.status)) { K.toast('Finish your current trip first'); return; }
    openTab('home');
    const from = back ? t.drop : t.pickup, to = back ? t.pickup : t.drop;
    S.pickup = { lat: from.lat, lng: from.lng, address: from.address, short: shortName(from.address), manual: true };
    if (S.config.services.some((x) => x.id === t.service)) setService(t.service);
    S.stops = back ? [] : (t.stops || []).map((x) => ({ lat: x.lat, lng: x.lng, address: x.address }));
    chooseDrop({ lat: to.lat, lng: to.lng, name: to.address });
  }

  // A clean receipt: share it, or save it as a PDF from the print dialog.
  function receipt(t) {
    const d = t.driver || {}, P = PAY[payOfTrip(t)] || PAY.cash;
    const when = new Date(t.completedAt || t.createdAt);
    const date = when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    const no = `FLY-${String(t.id).padStart(6, '0')}`;
    const rows = [['Trip fare', K.ugx(t.fare)], ...(t.discount ? [[t.promoLabel || 'Discount', '−' + K.ugx(t.discount)]] : []), ...(t.tip ? [['Tip', K.ugx(t.tip)]] : [])];
    const total = K.ugx(t.payable + (t.tip || 0));
    const text = [`Flytte receipt ${no}`, date, `${svcName(t.service)}: ${t.pickup.address} → ${t.drop.address}`, ...rows.map(([a, b]) => `${a}: ${b}`), `Total: ${total} (${P.name})`, d.name ? `Driver: ${d.name}${d.plate ? ' · ' + d.plate : ''}` : ''].filter(Boolean).join('\n');
    const mm = K.modal(`<div class="receipt">
      <div class="rc-head"><b>Flytte</b><span>Receipt</span></div>
      <p class="rc-no">${no} · ${K.esc(date)}</p>
      <div class="rc-total"><small>Total</small><b>${total}</b><span>${K.esc(P.name)}${t.paymentStatus === 'paid' || t.paymentMethod === 'cash' ? ' · Paid' : ''}</span></div>
      <div class="stops"><div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>From</small><b>${K.esc(t.pickup.address)}</b></span></div>
        ${stopRows(t)}
        <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>To</small><b>${K.esc(t.drop.address)}</b></span></div></div>
      ${rows.map(([a, b]) => `<div class="kv"><span>${K.esc(a)}</span><b>${b}</b></div>`).join('')}
      <div class="kv"><span>Service</span><b>${svcName(t.service)}${t.distanceKm ? ` · ${Number(t.distanceKm).toFixed(1)} km` : ''}</b></div>
      ${d.name ? `<div class="kv"><span>Driver</span><b>${K.esc(d.name)}${d.plate ? ' · ' + K.esc(d.plate) : ''}</b></div>` : ''}
      <div class="row" style="gap:8px;margin-top:16px"><button class="btn fill" data-share>${K.ic('share', 'sm')} Share</button><button class="btn fill" data-pdf>Save as PDF</button></div>
      <button class="btn btn-ghost btn-block" style="margin-top:6px" data-close>Done</button></div>`);
    K.$('[data-share]', mm.el).onclick = async () => {
      if (navigator.share) { try { await navigator.share({ title: `Flytte receipt ${no}`, text }); return; } catch { return; } }
      try { await navigator.clipboard.writeText(text); K.toast('Receipt copied'); } catch { K.toast('Couldn’t copy the receipt'); }
    };
    K.$('[data-pdf]', mm.el).onclick = () => {
      const w = window.open('', '_blank');
      if (!w) { K.toast('Allow pop-ups to save the receipt'); return; }
      const esc = (x) => K.esc(String(x));
      w.document.write(`<!doctype html><meta charset="utf-8"><title>Flytte receipt ${no}</title><style>body{font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:40px auto;padding:0 20px;color:#111}h1{font-size:22px;margin:0}small{color:#666}.t{font-size:34px;font-weight:800;margin:18px 0 2px}.r{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:9px 0}.r span{color:#555}footer{margin-top:28px;color:#888;font-size:12px}</style>
        <h1>Flytte</h1><small>Receipt ${no} · ${esc(date)}</small><div class="t">${total}</div><small>${esc(P.name)}</small>
        <div style="margin-top:22px">${[['From', t.pickup.address], ['To', t.drop.address], ['Service', svcName(t.service) + (t.distanceKm ? ' · ' + Number(t.distanceKm).toFixed(1) + ' km' : '')], ...rows, ...(d.name ? [['Driver', d.name + (d.plate ? ' · ' + d.plate : '')]] : [])].map(([a, b]) => `<div class="r"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div>
        <footer>Thank you for riding with Flytte.</footer><script>setTimeout(()=>print(),300)<\/script>`);
      w.document.close();
    };
  }

  // Help with a past trip. Lost items, fares and safety go to the Flytte team with the trip attached.
  async function tripHelp(t) {
    let kinds = { lost_item: 'I lost an item', fare: 'I was charged the wrong amount', route: 'The route was longer than it should be', driver: 'Driver behaviour', safety: 'Safety concern', other: 'Something else' };
    let issues = [];
    try { const r = await K.api(`/trips/${t.id}/help`); kinds = r.kinds || kinds; issues = r.issues || []; } catch {}
    const call = S.config.supportPhone ? `<a class="btn btn-ghost btn-block" href="tel:${K.esc(S.config.supportPhone.replace(/\s/g, ''))}">${K.ic('phone', 'sm')} Call support</a>` : '';
    const mm = K.modal(`<div class="help-sheet"><h2>Get help</h2>
      <p class="small muted">${svcName(t.service)} · ${K.when(t.createdAt)} · ${K.esc(shorten(t.drop.address, 30))}</p>
      <div data-step>
        <div class="set-card list">${Object.entries(kinds).map(([k, l]) => `<button class="set-row" data-kind="${k}"><span class="grow"><b>${K.esc(l)}</b></span>${K.ic('chev', 'sm')}</button>`).join('')}</div>
        ${issueList(issues)}
        ${call}
      </div></div>`);
    const step = K.$('[data-step]', mm.el);
    step.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => {
      const kind = b.dataset.kind, lost = kind === 'lost_item', safety = kind === 'safety';
      step.innerHTML = `<h3 style="margin:6px 0 4px">${K.esc(kinds[kind])}</h3>
        ${safety ? '<p class="small" style="margin:0 0 8px"><b>In danger right now? Call 999.</b></p>' : ''}
        <label for="hd">${lost ? 'What did you leave, and where in the vehicle?' : 'What happened?'}</label>
        <textarea id="hd" rows="4" maxlength="1000" placeholder="${lost ? 'e.g. Black Samsung phone, back seat' : 'Add any details that will help us'}"></textarea>
        <p class="tiny faint" style="margin:6px 0 0">${lost ? 'We’ll contact your driver and arrange a way to get it back to you.' : 'The Flytte team reviews every report and replies here.'}</p>
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" data-send style="margin-top:10px">Send to Flytte</button>`;
      const ta = K.$('#hd', step), err = K.$('.error', step), send = K.$('[data-send]', step);
      setTimeout(() => ta.focus({ preventScroll: true }), 580);
      send.onclick = async () => {
        err.textContent = ''; send.disabled = true;
        try {
          await K.api(`/trips/${t.id}/help`, { kind, details: ta.value.trim() });
          step.innerHTML = `<div class="help-done">${K.ic('check')}<h3>Report sent</h3><p class="small muted">${lost ? 'We’ll contact your driver and update you here and by notification.' : 'The Flytte team will review it and reply here, usually within a few hours.'}</p>
            <button class="btn btn-block" data-close>Done</button></div>`;
          K.$('[data-close]', step).onclick = () => mm.close();
        } catch (e) { err.textContent = e.message; send.disabled = false; }
      };
    });
  }

  // ---------- trip events ----------
  function onTrip(t) {
    try { K.cache.set('active', t && ['requested', 'accepted', 'arrived', 'in_progress'].includes(t.status) ? t : null); } catch {}
    if (!t) return;
    if (S.trip && t.id < S.trip.id) return;
    const prev = S.trip && S.trip.status;
    S.trip = t;
    if (t.status === 'scheduled') {
      K.toast(`${svcName(t.service)} scheduled for ${whenLabel(t.scheduledFor)}`, 4500);
      S.trip = null; reset(); loadUpcoming(); return;
    }
    if (t.status === 'requested') S.view = 'searching';
    else if (['accepted', 'arrived', 'in_progress'].includes(t.status)) S.view = 'trip';
    else if (t.status === 'completed') S.view = 'done';
    else if (t.status === 'no_drivers') S.view = 'none';
    else if (t.status === 'cancelled') { if (t.cancelledBy === 'rider') { reset(); return; } S.view = 'none'; K.toast(`Your ${who(t)} cancelled. Try again.`); }
    nightToast(t);
    if (prev !== t.status) {
      if (t.status === 'accepted') { vibrate(); loadMessages(); }   // the banner and headline already say who's coming
      if (t.status === 'arrived') { vibrate(); chime(); }
      if (t.status === 'completed') S.note = '';
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
    const bn = K.$('#bnTxt'); if (bn) bn.textContent = t.status === 'in_progress' ? `Arriving in ${mins} min` : t.status === 'accepted' ? (t.service === 'errand' ? `At the shop in ${mins} min` : `Here in ${mins} min`) : bn.textContent;
    const bar = K.$('#etaBar'); if (bar && phaseKm && t.status !== 'arrived') bar.style.width = Math.max(5, Math.min(100, 100 - (K.km(p, target) / phaseKm) * 100)) + '%';
  }

  // Mirrors cancelFeeDue in src/routes.js: free during the grace period, and when the driver is very late.
  function cancelFeeNow(t) {
    const d = S.config.drivers || {};
    if (!d.cancelFee || !t.driver || !t.acceptedAt || !['accepted', 'arrived'].includes(t.status)) return { fee: 0, freeFor: 0 };
    const mins = (Date.now() - new Date(t.acceptedAt).getTime()) / 60000;
    if (mins < d.cancelGraceMin) return { fee: 0, freeFor: Math.ceil(d.cancelGraceMin - mins) };
    if (t.status === 'accepted' && mins >= 15) return { fee: 0, freeFor: 0 };
    if (S.pass && S.pass.active) return { fee: 0, freeFor: 0, pass: true };
    return { fee: d.cancelFee, freeFor: 0 };
  }
  async function cancelTrip() {
    const t = S.trip;
    const { fee, freeFor, pass } = cancelFeeNow(t);
    const name = t.driver ? K.esc(K.first(t.driver.name)) : '';
    const feeNote = fee ? `<p class="card small" style="margin:10px 0">A ${K.ugx(fee)} cancellation fee goes to ${name} for their time, from your Flytte Wallet if it has enough.</p>`
      : pass ? '<p class="small muted" style="margin:6px 0 10px">✨ Free to cancel with your Flytte Pass.</p>'
      : freeFor ? `<p class="small muted" style="margin:6px 0 10px">Free to cancel for ${freeFor} more minute${freeFor === 1 ? '' : 's'}.</p>` : '';
    const m = K.modal(`<h2>Cancel your ride?</h2><p class="muted">${t.driver ? `${name} is already on the way.` : `We’re still finding you a ${who(t)}.`}</p>${feeNote}
      <button class="btn btn-danger btn-block btn-lg" id="yes">Yes, cancel</button><button class="btn btn-block" style="margin-top:8px" data-close>Keep my ride</button>`);
    K.$('#yes', m.el).onclick = async () => {
      try {
        const out = await K.api(`/trips/${t.id}/cancel`, { reason: 'rider' });
        m.close(); reset();
        if (out.fee) K.toast(`Ride cancelled. ${K.ugx(out.fee)} cancellation fee paid to ${name}.`, 5000);
      } catch (e) { K.toast(e.message); }
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
  const shareTrip = () => K.share(location.origin + '/t/' + S.trip.shareToken, `Follow my Flytte trip live: ${S.trip.driver.name}, ${S.trip.driver.plate}`);
  // One tap: a WhatsApp message with the arrival time and the live link (the share sheet where WhatsApp isn't there).
  function etaMessage(t, mins, now = new Date()) {
    const link = location.origin + '/t/' + t.shareToken;
    const ride = t.service === 'errand' ? 'My Flytte errand is' : t.service === 'parcel' ? 'My Flytte parcel is' : `I’m on my way to ${t.drop.address} in a Flytte ${t.driver && t.driver.vehicleType === 'car' ? 'car' : 'boda'}.`;
    if (['parcel', 'errand'].includes(t.service)) {
      return mins ? `${ride} on its way to ${t.drop.address}. It should arrive at about ${K.clock(new Date(now.getTime() + mins * 60e3))} (${mins} min). Follow it live: ${link}` : `${ride} on its way to ${t.drop.address}. Follow it live: ${link}`;
    }
    return mins ? `${ride} I’ll arrive at about ${K.clock(new Date(now.getTime() + mins * 60e3))} (${mins} min). Follow my trip live: ${link}` : `${ride} Follow my trip live: ${link}`;
  }
  function shareEta() {
    const text = etaMessage(S.trip, S.trip.status === 'in_progress' ? tripMins() : null);
    const w = window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    if (!w) K.share(location.origin + '/t/' + S.trip.shareToken, text);
  }
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
        const m = K.modal(`<h2>Alert sent to Flytte</h2>
          <p>The Flytte team has been alerted with ${lat ? 'your location and ' : ''}your trip details. If you are in danger, call the police now.</p>
          <a class="btn btn-danger btn-block btn-lg" href="tel:999">Call Police (999)</a>
          ${out.emergencyContact ? `<a class="btn btn-block" style="margin-top:8px" href="sms:${out.emergencyContact}?body=${encodeURIComponent('I need help. Follow my Flytte trip: ' + link)}">Text my emergency contact</a>` : ''}
          <button class="btn btn-block" style="margin-top:8px" id="sh">Share my live location</button>
          <button class="btn btn-ghost btn-block" data-close>Close</button>`);
        K.$('#sh', m.el).onclick = () => K.share(link, 'I need help. Follow my Flytte trip live');
      } catch (e) {
        // The alert didn't reach us: never pretend it did. Calling the police still works offline.
        const link = location.origin + '/t/' + S.trip.shareToken;
        const m = K.modal(`<h2>We couldn’t send the alert</h2>
          <p role="alert">${K.esc(e.message)} Call the police directly if you are in danger.</p>
          <a class="btn btn-danger btn-block btn-lg" href="tel:999">Call Police (999)</a>
          <button class="btn btn-block" style="margin-top:8px" id="again">Try sending the alert again</button>
          <button class="btn btn-block" style="margin-top:8px" id="sh">Share my live trip</button>
          <button class="btn btn-ghost btn-block" data-close>Close</button>`);
        K.$('#again', m.el).onclick = () => { m.close(); send(lat, lng); };
        K.$('#sh', m.el).onclick = () => K.share(link, 'I need help. Follow my Flytte trip live');
      }
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => send(p.coords.latitude, p.coords.longitude), () => send(), { timeout: 5000 });
    else send();
  }

  function reset() {
    const hadTrip = !!S.trip;
    S.view = 'home'; S.drop = null; S.quote = null; S.route = null; S.trip = null; S.rating = 0; S.parcel = null; S.allOpts = false;
    S.when = null; S.passenger = null; S.promoCode = null; S.tipped = false; S.womanDriver = false; S.stops = [];
    if (S.errandHome) { S.pickup = S.errandHome; S.errandHome = null; }
    S.errand = null;
    // After an errand or parcel, Home is back to the rider's usual ride.
    if (['errand', 'parcel'].includes(S.service)) S.service = (S.user && S.user.ridePrefs && S.user.ridePrefs.service) || 'boda';
    S.summary = null; applyPrefs();
    loadGrowth();
    S.messages = []; S.unread = 0; routedPhase = null; phaseKm = null;
    if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
    clearRoute();
    K.api('/me').then((m) => { S.user = m.user; K.cache.set('me', m); }).catch(() => {});
    K.api('/trips/history').then((h) => { S.history = h; buildRecent(h); if (S.view === 'home') render(); }).catch(() => {});
    if (hadTrip || !S.pickup) { S.pickup = null; locate(false); }       // after a trip: find where they are now
    else if (S.pickup.manual || !S.gps) map.setView([S.pickup.lat, S.pickup.lng], 16); // just backed out: keep the pickup they set
    else setPickup(S.gps.lat, S.gps.lng, 'Current location');
    render();
  }

  // ---------- growth: offers, upcoming rides, invite friends, rewards ----------
  async function loadGrowth() {
    try { S.growth = await K.api('/me/growth'); patchHome('forYou'); } catch {}
    try { S.pass = await K.api('/me/pass'); patchHome('forYou'); } catch {}
  }
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
          <p class="muted">Share your code. When a friend signs up with it and takes their first trip, you both get Flytte Wallet credit.</p></div>
        <div class="code-box"><span class="tiny muted">Your invite code</span><b>${K.esc(g.code)}</b></div>
        <button class="btn btn-primary btn-block btn-lg" id="share">${K.ic('share', 'sm')} Share my invite</button>
        <div class="stats3" style="margin-top:18px"><div><b>${g.friends.joined}</b><span>Friends joined</span></div><div><b>${g.friends.rode}</b><span>Took a trip</span></div><div><b>${K.ugx(g.earned).replace('UGX ', '')}</b><span>Earned (UGX)</span></div></div>
        <p class="tiny faint">Credit arrives in your wallet automatically and pays for your next trips. One reward per new friend.</p>`;
      K.$('#share', sp.page).onclick = () => K.share(g.link, `Ride with me on Flytte! Use my code ${g.code} when you sign up and get ${K.ugx(rf.friend)} after your first trip.`);
    };
    sp.body.innerHTML = K.skeleton('list', 2);
    if (S.growth) draw(S.growth);
    try { S.growth = await K.api('/me/growth'); draw(S.growth); } catch (e) { if (!S.growth) K.failed(sp.body, e.message, async () => { try { S.growth = await K.api('/me/growth'); draw(S.growth); } catch (x) { K.toast(x.message); } }); }
  }

  async function openRewards(onBack) {
    const sp = subPage('Flytte Rewards', onBack);
    const draw = (g) => {
      const rw = g.rewards, t = g.tier, tiers = g.tiers || [{ name: 'Bronze', at: 0 }, { name: 'Silver', at: 100 }, { name: 'Gold', at: 300 }];
      const ready = g.points >= rw.redeemPoints;
      const pct = Math.min(1, g.points / rw.redeemPoints);
      const C = 2 * Math.PI * 34;
      const top = tiers[tiers.length - 1].at;
      const lifePct = Math.min(100, (g.lifetimePoints / top) * 100);
      const toNext = t.next ? Math.max(0, t.at - g.lifetimePoints) : 0;
      const when = (d) => new Date(d).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' });
      sp.body.innerHTML = `
        ${rw.enabled === false ? '<div class="rw-paused">Rewards are paused right now. Your points are safe.</div>' : ''}
        <div class="rw-hero tier-${t.name.toLowerCase()}">
          <div class="rw-top"><span class="rw-pill">${t.name} member</span><span class="rw-brand">Flytte Rewards</span></div>
          <div class="rw-main">
            <div><b class="rw-pts">${g.points.toLocaleString()}</b><span class="rw-unit">points</span>
              <p class="rw-sub">${ready ? `Ready to swap for ${K.ugx(rw.redeemValue)}` : `${(rw.redeemPoints - g.points).toLocaleString()} more points for ${K.ugx(rw.redeemValue)}`}</p></div>
            <svg class="rw-ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="bg"/><circle cx="40" cy="40" r="34" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
              <text x="40" y="38" text-anchor="middle" class="v">${Math.round(pct * 100)}%</text><text x="40" y="52" text-anchor="middle" class="l">to reward</text></svg>
          </div>
        </div>
        <button class="btn btn-primary btn-block btn-lg" id="redeem" ${ready && rw.enabled !== false ? '' : 'disabled'}>${ready ? `Swap ${rw.redeemPoints} points for ${K.ugx(rw.redeemValue)}` : `Swap at ${rw.redeemPoints} points`}</button>

        <h3 class="set-h">Your level</h3>
        <div class="set-card rw-level">
          <div class="rw-track"><i style="width:${lifePct}%"></i>
            ${tiers.map((x) => `<span class="rw-node ${g.lifetimePoints >= x.at ? 'on' : ''} ${x.name === t.name ? 'cur' : ''}" style="left:${(x.at / top) * 100}%"><em></em><b>${x.name}</b><small>${x.at}</small></span>`).join('')}</div>
          <p class="rw-note">${t.next ? `<b>${toNext.toLocaleString()} lifetime points</b> to reach ${t.next}.` : '<b>You’ve reached Gold</b>, our top level.'} Lifetime points count every point you’ve earned, so your level never drops when you swap points.</p>
        </div>

        <h3 class="set-h">How you earn</h3>
        <div class="set-card list rw-how">
          <div class="set-row"><span class="rw-ic">${K.ic('nav')}</span><span class="grow"><b>Ride or send a parcel</b><small>${rw.pointsPer1000} point${rw.pointsPer1000 === 1 ? '' : 's'} for every UGX 1,000 you pay</small></span></div>
          <div class="set-row"><span class="rw-ic">${K.ic('check')}</span><span class="grow"><b>Points arrive when the trip ends</b><small>On every completed trip, any payment method</small></span></div>
          <div class="set-row"><span class="rw-ic">${K.ic('wallet')}</span><span class="grow"><b>Swap for wallet credit</b><small>${rw.redeemPoints} points = ${K.ugx(rw.redeemValue)}, spent on your next trips</small></span></div>
        </div>

        <h3 class="set-h">Recent points</h3>
        <div class="set-card list">${(g.history || []).length ? g.history.map((h) => h.kind === 'earn'
          ? `<div class="set-row"><span class="grow"><b>${K.esc(svcName(h.service) || 'Trip')}${h.to ? ` to ${K.esc(String(h.to).split(',')[0])}` : ''}</b><small>${when(h.at)}</small></span><span class="rw-delta plus">+${h.points}</span></div>`
          : `<div class="set-row"><span class="grow"><b>Swapped for ${K.ugx(h.value)}</b><small>${when(h.at)}</small></span><span class="rw-delta">${h.points}</span></div>`).join('')
          : '<p class="rw-empty">Points from your trips will appear here.</p>'}</div>`;
      K.$('#redeem', sp.page).onclick = async () => {
        const btn = K.$('#redeem', sp.page); btn.disabled = true;
        try { const out = await K.api('/rewards/redeem', {}); S.user.walletBalance = out.walletBalance; K.toast(`${K.ugx(rw.redeemValue)} added to your wallet`); S.growth = await K.api('/me/growth'); draw(S.growth); }
        catch (e) { K.toast(e.message); btn.disabled = false; }
      };
    };
    sp.body.innerHTML = K.skeleton('list', 2);
    if (S.growth) draw(S.growth);
    try { S.growth = await K.api('/me/growth'); draw(S.growth); } catch (e) { if (!S.growth) K.failed(sp.body, e.message, async () => { try { S.growth = await K.api('/me/growth'); draw(S.growth); } catch (x) { K.toast(x.message); } }); }
  }

  // ---------- tabs: activity & account (screens 11–13) ----------
  function openTab(tab) {
    if (tab !== 'home' && S.view !== 'home') return;
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    const old = [...document.querySelectorAll('.page[data-tabpage]')];
    if (tab === 'home') { old.forEach((p) => p.remove()); return; }
    if (old.some((p) => p.dataset.tabpage === tab)) { old.filter((p) => p.dataset.tabpage !== tab).forEach((p) => p.remove()); return; }
    const page = document.createElement('div');
    page.className = 'page tab-swap grouped'; page.dataset.tabpage = tab;
    page.innerHTML = `<div class="page-inner">${tab === 'activity' && !S.history ? tripSkeleton() : K.skeleton('title-list')}</div>`;
    root.querySelector('#app').insertBefore(page, K.$('#tabs'));
    (tab === 'activity' ? drawActivity : drawAccount)(page.firstElementChild);
    old.forEach((p) => p.remove());                 // only after the new page is in place: no gap to see through
  }

  function subPage(title, onBack) {
    const page = document.createElement('div');
    page.className = 'page push-in grouped nav-large'; page.style.zIndex = 860;
    page.innerHTML = `<div class="page-inner"><div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Back">${K.ic('back')}</button><h2 aria-hidden="true">${title}</h2></div><h1 class="page-title">${title}</h1><div data-body></div></div>`;
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
    try { S.history = await K.api('/trips/history'); }
    catch (e) {
      el.innerHTML = `<div class="page-title">Activity</div><div class="state-box" role="alert"><b>Couldn’t load your trips</b><span>${K.esc(e.message)}</span><button class="btn btn-sm" id="again">Try again</button></div>`;
      K.$('#again', el).onclick = () => { el.innerHTML = tripSkeleton(); drawActivity(el, filter, true); };
      return;
    }
    paintActivity(el, filter, S.history);
  }
  // Activity: trips grouped as Upcoming, This week, then by month (with the month's total), each card
  // with a drawing of its route, the driver and the stars you gave.
  const tripSkeleton = (n = 4) => `<div class="page-title">Activity</div><i class="sk" style="width:70%;height:34px;border-radius:12px;margin:2px 0 14px"></i>${Array.from({ length: n }, () => `<div class="tc sk-tc"><i class="sk tc-map"></i><span class="grow"><i class="sk" style="width:64%;height:14px"></i><i class="sk" style="width:42%;height:11px;margin-top:8px"></i><i class="sk" style="width:30%;height:11px;margin-top:8px"></i></span></div>`).join('')}`;
  const monthKey = (d) => { const k = new Date(new Date(d).getTime() + 3 * 3600e3); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`; };
  function paintActivity(el, filter, list) {
    el.dataset.filter = filter;
    const live = ['requested', 'accepted', 'arrived', 'in_progress'];
    const keep = (t) => filter === 'all' ? !['cancelled', 'no_drivers'].includes(t.status) || t.cancelFee || t.noShowFee
      : filter === 'cancelled' ? ['cancelled', 'no_drivers'].includes(t.status)
      : (filter === 'parcel' ? ['parcel', 'errand'].includes(t.service) : !['parcel', 'errand'].includes(t.service)) && !['cancelled', 'no_drivers'].includes(t.status);
    const shown = list.filter(keep);
    const st = (t) => (t.status === 'scheduled' ? [`Scheduled · ${whenLabel(t.scheduledFor)}`, 'warn'] : live.includes(t.status) ? ['Now', 'warn'] : { cancelled: ['Cancelled', 'bad'], no_drivers: ['No driver found', 'bad'] }[t.status] || null);
    const groups = [], weekAgo = Date.now() - 7 * 86400e3;
    const push = (key, title, t) => { let g = groups.find((x) => x.key === key); if (!g) { g = { key, title, trips: [] }; groups.push(g); } g.trips.push(t); };
    for (const t of shown) {
      if (t.status === 'scheduled' || live.includes(t.status)) push('up', 'Upcoming', t);
      else if (new Date(t.completedAt || t.createdAt).getTime() > weekAgo) push('week', 'This week', t);
      else { const mk = monthKey(t.completedAt || t.createdAt); push(mk, new Date(mk + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), t); }
    }
    const total = (g) => g.trips.filter((t) => t.status === 'completed').reduce((a, t) => a + (t.payable ?? t.fare) + (t.tip || 0), 0);
    const card = (t, i) => {
      const d = t.driver || {}, s = st(t);
      return `<button class="tc" data-t="${i}" style="--i:${Math.min(i, 8)}">
        <span class="tc-map">${K.routeThumb([t.pickup, ...(t.stops || []), t.drop])}</span>
        <span class="grow"><b class="ellipsis">${K.esc(shorten(t.drop.address, 34))}</b>
          <small class="ellipsis">From ${K.esc(shorten(t.pickup.address, 28))}</small>
          <small class="ellipsis">${K.when(t.completedAt || t.createdAt)} · ${K.esc(svcName(t.service))}${d.name ? ` · ${K.esc(K.first(d.name))}` : ''}</small>
          ${s ? `<span class="badge ${s[1]}">${s[0]}</span>` : ''}</span>
        <span class="tc-p">${t.status === 'completed' ? K.ugx((t.payable ?? t.fare) + (t.tip || 0)) : t.cancelFee || t.noShowFee ? K.ugx(t.cancelFee || t.noShowFee) : ''}${t.myStars ? `<span class="tc-stars" aria-label="You gave ${t.myStars} stars">★ ${t.myStars}</span>` : ''}${d.photo ? `<img class="tc-face" src="${K.esc(d.photo)}" alt="">` : ''}</span></button>`;
    };
    let idx = 0; const flat = [];
    el.innerHTML = `<div class="page-title">Activity</div>
      <div class="seg-tabs">${[['all', 'All'], ['ride', 'Rides'], ['parcel', 'Deliveries'], ['cancelled', 'Cancelled']].map(([k, l]) => `<button data-f="${k}" aria-pressed="${k === filter}">${l}</button>`).join('')}</div>
      ${shown.length ? groups.map((g) => {
        const sum = total(g), n = g.trips.filter((t) => t.status === 'completed').length;
        return `<div class="act-h"><b>${K.esc(g.title)}</b>${n && g.key !== 'up' ? `<button class="link-btn small" data-month="${/^\d{4}-\d{2}$/.test(g.key) ? g.key : ''}">${n} trip${n > 1 ? 's' : ''} · ${K.ugx(sum)}</button>` : ''}</div>`
          + g.trips.map((t) => { flat.push(t); return card(t, idx++); }).join('');
      }).join('')
      : `<div class="empty"><div class="illu">${K.ART[filter === 'parcel' ? 'parcel' : 'boda']}</div><h3>${filter === 'cancelled' ? 'No cancelled trips' : `No ${filter === 'parcel' ? 'deliveries' : 'trips'} yet`}</h3><p class="small">${filter === 'cancelled' ? 'Trips you or a driver cancel show here.' : `Your ${filter === 'parcel' ? 'deliveries' : 'rides and deliveries'} will show here.`}</p>${filter === 'cancelled' ? '' : `<button class="btn btn-primary" id="first">${filter === 'parcel' ? 'Send a parcel' : 'Book a ride'}</button>`}</div>`}`;
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => paintActivity(el, b.dataset.f, S.history || []));
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => tripDetails(flat[+b.dataset.t]));
    el.querySelectorAll('[data-month]').forEach((b) => b.onclick = () => openSummary(null, b.dataset.month || undefined));
    const f = K.$('#first', el); if (f) f.onclick = () => { openTab('home'); if (filter === 'parcel') setService('parcel'); openSearch(); };
  }

  // ---------- Flytte for Business and Flytte for Shops ----------
  // A company account pays for work rides (billed monthly, with a budget per person). A shop account
  // sends deliveries to customers and gets requests through its own order link.
  async function loadBiz() { try { S.biz = await K.api('/business/me'); } catch {} }
  const bizCompanies = (kind) => ((S.biz && S.biz.companies) || []).filter((c) => !kind || c.kind === kind);
  const budgetText = (c) => c.budget ? `${K.ugx(Math.max(0, c.budget - c.spent))} left of ${K.ugx(c.budget)} this month` : `${K.ugx(c.spent)} this month · no budget limit`;
  function waLink(phone, text) { return `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`; }

  async function openBusiness(onBack, kind) {
    const sp = subPage(kind === 'merchant' ? 'Flytte for Shops' : 'Flytte for Business', onBack);
    const draw = () => {
      const mine = bizCompanies(kind === 'merchant' ? 'merchant' : 'business');
      const intro = kind === 'merchant'
        ? `<div class="biz-hero shop"><small>Flytte for Shops</small><h2>Deliveries for your customers</h2><p>Send an order across Kampala in a minute, or share your order link on WhatsApp so customers ask for delivery themselves. Pay one bill at the end of the month.</p></div>
           <div class="set-card">${perkRow('send', 'Book a delivery in seconds', 'Customer, address, done. They get a live link and a delivery code.')}${perkRow('share', 'Your own order link', 'Put it in your WhatsApp status or bio. Requests come straight to this page.')}${perkRow('receipt', 'One monthly bill', 'Every delivery on one statement, paid by Mobile Money.')}</div>`
        : `<div class="biz-hero"><small>Flytte for Business</small><h2>Work rides, one monthly bill</h2><p>Your team rides on the company account. You set a budget for each person and pay one statement a month.</p></div>
           <div class="set-card">${perkRow('user', 'Add staff by phone', 'They choose the company account when they book. No cash, no refunds to chase.')}${perkRow('chart', 'Budgets per person', 'A monthly limit for each person, or none.')}${perkRow('receipt', 'Statements', 'Every trip with who, where and how much. Download it for your accounts.')}</div>`;
      sp.body.innerHTML = `${mine.length ? `<h3 class="set-h">Your accounts</h3><div class="set-card list">${mine.map((c) => `<button class="set-row" data-co="${c.id}"><span class="row-ic">${K.ic(c.kind === 'merchant' ? 'send' : 'work', 'sm')}</span><span class="grow"><b>${K.esc(c.name)}</b><small>${c.role === 'admin' ? 'Admin' : 'Staff'} · ${c.kind === 'merchant' ? 'Shop deliveries' : budgetText(c)}</small></span>${K.ic('chev', 'sm')}</button>`).join('')}</div>` : intro}
        ${S.biz && S.biz.enabled === false ? '' : `<button class="btn ${mine.length ? '' : 'btn-primary'} btn-block btn-lg" id="new" style="margin-top:16px">${mine.length ? K.ic('plus', 'sm') + ' ' : ''}${kind === 'merchant' ? 'Open a shop account' : 'Create a company account'}</button>`}
        ${mine.length ? '' : '<p class="tiny faint" style="text-align:center;margin-top:10px">Free to open. You only pay for the trips your team takes.</p>'}`;
      sp.body.querySelectorAll('[data-co]').forEach((b) => b.onclick = () => openCompany(+b.dataset.co, () => loadBiz().then(draw)));
      const nb = K.$('#new', sp.page); if (nb) nb.onclick = () => createCompany(kind === 'merchant' ? 'merchant' : 'business', (id) => { draw(); openCompany(id, () => loadBiz().then(draw)); });
    };
    sp.body.innerHTML = K.skeleton('list', 3);
    await loadBiz(); draw();
  }
  const perkRow = (ic, t, s) => `<div class="pass-perk"><span class="row-ic">${K.ic(ic, 'sm')}</span><span><b>${t}</b><small>${s}</small></span></div>`;

  function createCompany(kind, done) {
    const shop = kind === 'merchant';
    let spot = shop && S.pickup ? { address: S.pickup.address, lat: S.pickup.lat, lng: S.pickup.lng } : null;
    const m = K.modal(`<h2>${shop ? 'Open a shop account' : 'Create a company account'}</h2>
      <form id="f" novalidate>
        <label for="cn">${shop ? 'Shop or restaurant name' : 'Company name'}</label><input id="cn" autocomplete="organization" required>
        ${shop ? `<label>Where riders collect from</label><div class="biz-spot" id="spot">${spot ? K.esc(spot.address) : 'Set your shop’s location'}</div><button class="btn btn-sm" type="button" id="here" style="margin-top:6px">${K.ic('locate', 'sm')} Use where I am now</button>
          <div id="spotSearch"></div>` : ''}
        <label for="em">Email for statements (optional)</label><input id="em" type="email" autocomplete="email" inputmode="email">
        <p class="error" id="err" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">${shop ? 'Open shop account' : 'Create account'}</button>
        <p class="tiny faint" style="margin-top:8px">You’ll be the admin. Flytte gives new accounts a credit limit of ${K.ugx(300000)} to start with.</p>
      </form>`);
    if (shop) {
      placePicker(K.$('#spotSearch', m.el), 'Search for your shop', (p) => { spot = p; K.$('#spot', m.el).textContent = p.address; });
      K.$('#here', m.el).onclick = () => { if (S.gps || S.pickup) { const g = S.gps || S.pickup; spot = { lat: g.lat, lng: g.lng, address: (S.pickup && S.pickup.address) || 'My shop' }; K.$('#spot', m.el).textContent = spot.address; } else K.toast('Turn on location, or search for your shop.'); };
    }
    K.$('#f', m.el).onsubmit = async (e) => {
      e.preventDefault();
      const btn = K.$('button[type=submit]', m.el); btn.disabled = true;
      try {
        const out = await K.api('/business', { kind, name: K.$('#cn', m.el).value, email: K.$('#em', m.el).value || undefined, shop: spot || undefined });
        S.biz = { ...(S.biz || {}), companies: out.companies };
        m.close(); K.toast(shop ? 'Shop account ready' : 'Company account ready'); done(out.id);
      } catch (x) { K.$('#err', m.el).textContent = x.message; btn.disabled = false; }
    };
  }

  // A small search box that lists places and calls back with the one picked.
  function placePicker(host, placeholder, onPick, near) {
    host.innerHTML = `<input type="search" placeholder="${K.esc(placeholder)}" aria-label="${K.esc(placeholder)}" autocomplete="off" style="margin-top:8px"><div class="biz-results" role="listbox"></div>`;
    const inp = host.querySelector('input'), list = host.querySelector('.biz-results');
    let timer, seq = 0;
    inp.oninput = () => {
      clearTimeout(timer);
      const q = inp.value.trim();
      if (q.length < 2) { list.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        const my = ++seq;
        const at = near || S.pickup || { lat: 0.3136, lng: 32.5811 };
        try {
          const r = await K.api('/places/search?' + new URLSearchParams({ q, lat: at.lat, lng: at.lng }));
          if (my !== seq) return;
          list.innerHTML = r.results.map((p, i) => `<button type="button" class="biz-res" data-i="${i}" role="option"><b>${K.esc(p.name)}</b><small>${K.esc(p.address || '')}</small></button>`).join('') || '<p class="tiny muted" style="padding:8px 2px">No places found. Try another name.</p>';
          list.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => {
            const p = r.results[+b.dataset.i];
            inp.value = p.name; list.innerHTML = '';
            onPick({ lat: p.lat, lng: p.lng, address: [p.name, p.address].filter(Boolean).join(', ') });
          });
        } catch (e) { if (my === seq) list.innerHTML = `<p class="tiny muted" style="padding:8px 2px">${K.esc(e.message)}</p>`; }
      }, 250);
    };
  }

  async function openCompany(id, onBack) {
    const c0 = bizCompanies().find((c) => c.id === id) || { id, name: 'Account', role: 'staff' };
    const sp = subPage(K.esc(c0.name), onBack);
    let timer = null;
    const stop = () => clearInterval(timer);
    const back = sp.page.querySelector('[data-x]'); const ob = back.onclick; back.onclick = () => { stop(); ob(); };
    const load = async () => {
      if (!sp.page.isConnected) return stop();
      try {
        const [d, live] = await Promise.all([c0.role === 'admin' ? K.api(`/business/${id}`) : null, c0.kind === 'merchant' ? K.api(`/business/${id}/deliveries`) : null]);
        draw(d, live || []);
      } catch (e) { if (!sp.body.firstElementChild || sp.body.querySelector('.sk')) K.failed(sp.body, e.message, load); }
    };
    const draw = (d, live) => {
      const merchant = c0.kind === 'merchant';
      const shopBits = merchant ? `
        <button class="btn btn-primary btn-block btn-lg" id="send">${K.ic('send', 'sm')} Send a delivery</button>
        ${d && d.requests.length ? `<h3 class="set-h">Requests from customers <span class="badge warn">${d.requests.length}</span></h3><div class="set-card list">${d.requests.map((q) => `<div class="set-row" style="cursor:default;align-items:flex-start"><span class="row-ic">${K.ic('bell', 'sm')}</span>
            <span class="grow"><b>${K.esc(q.name)}</b><small class="blk">${K.esc(q.note)}</small><small class="blk">${K.ic('pin', 'sm')} ${K.esc(q.address)} · ${K.esc(K.prettyPhone(q.phone))}</small>
            <span class="row" style="gap:8px;margin-top:8px"><button class="btn btn-sm btn-primary" data-rq="${q.id}">Send rider</button><button class="btn btn-sm" data-dq="${q.id}">Decline</button></span></span></div>`).join('')}</div>` : ''}
        <h3 class="set-h">Deliveries today</h3>
        ${live.length ? `<div class="set-card list">${live.map((t) => deliveryRow(t)).join('')}</div>` : '<div class="set-card"><p class="small muted" style="margin:0">No deliveries yet today. Book one above, or share your order link with customers.</p></div>'}
        ${d && d.link ? `<h3 class="set-h">Your order link</h3><div class="set-card"><p class="small" style="margin:0 0 4px"><b>${K.esc(d.link.replace(/^https?:\/\//, ''))}</b></p><p class="tiny muted" style="margin:0 0 10px">Customers open it, say what they ordered and where to bring it. You get the request here.</p>
            <div class="row" style="gap:8px"><a class="btn btn-sm fill" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Order from ${d.name} and get it delivered by Flytte: ${d.link}`)}">${K.ic('msg', 'sm')} WhatsApp</a><button class="btn btn-sm fill" id="copy">Copy link</button></div></div>` : ''}` : '';
      if (!d) {
        sp.body.innerHTML = `${merchant ? shopBits : ''}<div class="set-card" style="margin-top:14px"><p style="margin:0"><b>${K.esc(c0.name)}</b></p><p class="small muted" style="margin:4px 0 0">${merchant ? 'You can send deliveries for this shop.' : budgetText(c0)}</p></div>
          ${merchant ? '' : '<p class="small muted" style="margin:14px 2px">To ride on this account, choose it as your payment method when you book.</p><button class="btn btn-primary btn-block" id="usePay">Use for my next ride</button>'}`;
      } else {
        const pct = d.creditLimit ? Math.min(100, Math.round((d.balanceDue / d.creditLimit) * 100)) : 0;
        sp.body.innerHTML = `
          <div class="biz-bill"><div class="row" style="justify-content:space-between;align-items:flex-start"><span><small>Owed to Flytte</small><b>${K.ugx(d.balanceDue)}</b></span>
            ${d.balanceDue >= 1000 && d.payments ? '<button class="btn btn-sm btn-primary" id="pay">Pay now</button>' : ''}</div>
            <span class="acct-meter" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="tiny">Account limit ${K.ugx(d.creditLimit)} · ${d.month.label}: ${d.month.trips} ${merchant ? 'deliveries' : 'trips'}, ${K.ugx(d.month.spent)}</span></div>
          ${shopBits}
          <h3 class="set-h">${merchant ? 'Staff who can send deliveries' : 'Staff'}</h3><div class="set-card list">
            ${d.staff.map((x) => `<button class="set-row${x.active ? '' : ' off'}" data-uid="${x.userId}"><span class="row-ic">${K.ic('user', 'sm')}</span><span class="grow"><b>${K.esc(x.name)}${x.me ? ' (you)' : ''}</b><small>${x.active ? `${x.role === 'admin' ? 'Admin · ' : ''}${merchant ? K.esc(K.prettyPhone(x.phone)) : x.budget ? `${K.ugx(x.spent)} of ${K.ugx(x.budget)}` : `${K.ugx(x.spent)} · no limit`}` : 'Removed'}</small></span>${K.ic('chev', 'sm')}</button>`).join('')}
            <button class="set-row" id="add"><span class="row-ic">${K.ic('plus', 'sm')}</span><span class="grow"><b>Add someone</b><small>By the phone number they use on Flytte</small></span>${K.ic('chev', 'sm')}</button></div>
          ${!merchant ? `<h3 class="set-h">Recent trips</h3>${d.trips.length ? `<div class="set-card list">${d.trips.slice(0, 8).map((t) => `<div class="set-row" style="cursor:default"><span class="row-ic">${K.ic('pin', 'sm')}</span><span class="grow"><b>${K.esc(t.by)}</b><small>${K.esc(String(t.to).split(',')[0])} · ${K.when(t.at)}</small></span><b class="small">${t.status === 'completed' ? K.ugx(t.amount) : K.esc(t.status.replace('_', ' '))}</b></div>`).join('')}</div>` : '<div class="set-card"><p class="small muted" style="margin:0">No trips yet. Add your staff, and they choose the company account when they book.</p></div>'}` : ''}
          <div class="set-card list" style="margin-top:14px">
            <button class="set-row" id="stmt"><span class="row-ic">${K.ic('receipt', 'sm')}</span><span class="grow"><b>Monthly statements</b><small>Every ${merchant ? 'delivery' : 'trip'}, download for your accounts</small></span>${K.ic('chev', 'sm')}</button>
            <button class="set-row" id="edit"><span class="row-ic">${K.ic('edit', 'sm')}</span><span class="grow"><b>Account details</b><small>${K.esc(d.name)}${d.email ? ' · ' + K.esc(d.email) : ''}</small></span>${K.ic('chev', 'sm')}</button></div>`;
      }
      const $ = (s) => K.$(s, sp.page);
      if ($('#send')) $('#send').onclick = () => sendDelivery(c0, d && d.shop, null, load);
      if ($('#copy')) $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(d.link); K.toast('Link copied'); } catch { K.toast(d.link, 6000); } };
      if ($('#usePay')) $('#usePay').onclick = async () => { try { S.user = (await K.api('/me', { payPref: 'business' }, 'PATCH')).user; K.toast(`${c0.name} is now your payment method`); } catch (e) { K.toast(e.message); } };
      if ($('#pay')) $('#pay').onclick = () => payStatement(d, load);
      if ($('#add')) $('#add').onclick = () => addStaff(d, load);
      if ($('#stmt')) $('#stmt').onclick = () => openStatement(d);
      if ($('#edit')) $('#edit').onclick = () => editCompany(d, load);
      sp.body.querySelectorAll('[data-uid]').forEach((b) => b.onclick = () => editStaff(d, d.staff.find((x) => x.userId === +b.dataset.uid), load));
      sp.body.querySelectorAll('[data-rq]').forEach((b) => b.onclick = () => { const q = d.requests.find((x) => x.id === +b.dataset.rq); sendDelivery(c0, d.shop, q, load); });
      sp.body.querySelectorAll('[data-dq]').forEach((b) => b.onclick = async () => { try { await K.api(`/business/${id}/requests/${b.dataset.dq}`, { status: 'declined' }); load(); } catch (e) { K.toast(e.message); } });
      sp.body.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => notifyCustomer(id, +b.dataset.wa));
    };
    sp.body.innerHTML = K.skeleton('list', 4);
    await load();
    if (c0.kind === 'merchant') timer = setInterval(load, 15000);
  }

  const DSTATUS = { requested: 'Finding a rider', accepted: 'Rider on the way to you', arrived: 'Rider is at the shop', in_progress: 'On the way to the customer', completed: 'Delivered', cancelled: 'Cancelled', no_drivers: 'No rider found' };
  function deliveryRow(t) {
    const pc = t.parcel || {}, live = ['requested', 'accepted', 'arrived', 'in_progress'].includes(t.status);
    return `<div class="set-row" style="cursor:default;align-items:flex-start"><span class="row-ic">${K.ic(t.status === 'completed' ? 'check' : 'send', 'sm')}</span>
      <span class="grow"><b>${K.esc(pc.recipientName || 'Customer')} · ${K.esc(pc.item || '')}</b><small class="blk">${K.esc(DSTATUS[t.status] || t.status)}${t.driver ? ` · ${K.esc(K.first(t.driver.name))} ${K.esc(t.driver.plate || '')}` : ''}</small>
        ${live && ['accepted', 'arrived'].includes(t.status) ? `<small class="blk">Pickup code for the rider: <b class="biz-pin">${K.esc(t.pin)}</b></small>` : ''}
        ${live ? `<span class="row" style="gap:8px;margin-top:8px"><button class="btn btn-sm" data-wa="${t.id}">${K.ic('msg', 'sm')} Send customer the link</button><a class="btn btn-sm" href="/t/${K.esc(t.shareToken)}" target="_blank" rel="noopener">Track</a></span>` : ''}</span>
      <b class="small">${K.ugx(t.payable)}</b></div>`;
  }
  async function notifyCustomer(companyId, tripId) {
    try {
      const out = await K.api(`/business/${companyId}/deliveries/${tripId}/notify`, {});
      if (out.texted) K.toast('Texted to the customer');
      else window.open(waLink(out.phone, out.text), '_blank', 'noopener');
    } catch (e) { K.toast(e.message); }
  }

  // Book a shop delivery: the customer, what it is and where. Billed to the shop account.
  function sendDelivery(c, shop, req, after) {
    const from = shop || c.shop;
    if (!from) { K.toast('Set your shop’s location in Account details first.'); return; }
    let drop = req && req.lat ? { lat: req.lat, lng: req.lng, address: req.address } : null, q = null;
    const m = K.modal(`<h2>Send a delivery</h2><p class="small muted" style="margin-top:-4px">From ${K.esc(String(from.address).split(',')[0])}, billed to ${K.esc(c.name)}</p>
      <form id="f" novalidate>
        <label for="nm">Customer’s name</label><input id="nm" autocomplete="off" value="${K.esc(req ? req.name : '')}">
        <label for="ph">Customer’s phone</label><input id="ph" type="tel" inputmode="tel" placeholder="0772 123456" value="${K.esc(req ? K.prettyPhone(req.phone) : '')}">
        <label for="it">What you’re sending</label><input id="it" placeholder="e.g. 2 pizzas, order #114" value="${K.esc(req ? req.note.slice(0, 120) : '')}">
        <label>Deliver to</label><div class="biz-spot" id="to">${drop ? K.esc(drop.address) : 'Search for the address below'}</div><div id="toSearch"></div>
        <div class="biz-price" id="price" aria-live="polite"></div>
        <p class="error" id="err" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit" id="go">Book delivery</button>
      </form>`);
    const price = async () => {
      if (!drop) return;
      K.$('#price', m.el).innerHTML = '<span class="tiny muted">Pricing…</span>';
      try {
        q = await K.api('/fare/estimate', { pickup: from, drop, peek: true });
        const o = q.options.find((x) => x.id === 'parcel');
        K.$('#price', m.el).innerHTML = o ? `<span>Delivery</span><b>${K.ugx(o.fare)}</b><span class="tiny muted">${o.etaMin != null ? `rider in ~${o.etaMin} min` : 'no riders close right now'}</span>` : '';
      } catch (e) { K.$('#price', m.el).textContent = e.message; }
    };
    placePicker(K.$('#toSearch', m.el), 'Search: area, street, building', (p) => { drop = p; K.$('#to', m.el).textContent = p.address; price(); }, from);
    price();
    K.$('#f', m.el).onsubmit = async (e) => {
      e.preventDefault();
      const err = K.$('#err', m.el), btn = K.$('#go', m.el);
      if (!drop) { err.textContent = 'Choose where to deliver.'; return; }
      btn.disabled = true; btn.textContent = 'Booking…'; err.textContent = '';
      try {
        const o = q && q.options.find((x) => x.id === 'parcel');
        const t = await K.api('/trips', { service: 'parcel', paymentMethod: 'business', companyId: c.id, merchant: true, pickup: from, drop, quoteId: q && q.quoteId, expectedFare: o && o.fare,
          parcel: { recipientName: K.$('#nm', m.el).value, recipientPhone: K.$('#ph', m.el).value, item: K.$('#it', m.el).value } });
        if (req) await K.api(`/business/${c.id}/requests/${req.id}`, { status: 'sent', tripId: t.id }).catch(() => {});
        m.close();
        const ok = K.modal(`<div style="text-align:center"><div style="font-size:2.4rem" aria-hidden="true">📦</div><h2>Delivery booked</h2><p class="muted">We’re finding a rider. Give them this pickup code when they collect:</p><p class="biz-pin big">${K.esc(t.pin)}</p></div>
          <button class="btn btn-primary btn-block btn-lg" id="wa">${K.ic('msg', 'sm')} Send the customer their live link</button><button class="btn btn-block" style="margin-top:8px" data-close>Done</button>`);
        K.$('#wa', ok.el).onclick = () => { notifyCustomer(c.id, t.id); ok.close(); };
        after && after();
      } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Book delivery'; }
    };
  }

  function addStaff(d, after) {
    const shop = d.kind === 'merchant';
    const m = K.modal(`<h2>Add someone</h2><p class="small muted">They need the Flytte app, signed up with this number.</p>
      <label for="ph">Phone number</label><input id="ph" type="tel" inputmode="tel" placeholder="0772 123456">
      ${shop ? '' : '<label for="bd">Monthly budget (UGX, 0 = no limit)</label><input id="bd" type="number" inputmode="numeric" min="0" step="1000" value="100000">'}
      <label class="check-row"><input type="checkbox" id="ad"> Make them an admin too</label>
      <p class="error" id="err" role="alert"></p><button class="btn btn-primary btn-block btn-lg" id="sv">Add</button>`);
    K.$('#sv', m.el).onclick = async () => {
      try {
        const out = await K.api(`/business/${d.id}/members`, { phone: K.$('#ph', m.el).value, budget: shop ? 0 : +K.$('#bd', m.el).value, role: K.$('#ad', m.el).checked ? 'admin' : 'staff' });
        m.close(); K.toast(`${K.first(out.name)} added`); after();
      } catch (e) { K.$('#err', m.el).textContent = e.message; }
    };
  }
  function editStaff(d, x, after) {
    if (!x) return;
    const shop = d.kind === 'merchant';
    const m = K.modal(`<h2>${K.esc(x.name)}</h2><p class="small muted">${K.esc(K.prettyPhone(x.phone))}${shop ? '' : ` · ${K.ugx(x.spent)} used this month`}</p>
      ${shop ? '' : `<label for="bd">Monthly budget (UGX, 0 = no limit)</label><input id="bd" type="number" inputmode="numeric" min="0" step="1000" value="${x.budget}">`}
      <label class="check-row"><input type="checkbox" id="ad" ${x.role === 'admin' ? 'checked' : ''}> Admin (manages staff and pays statements)</label>
      <p class="error" id="err" role="alert"></p>
      <button class="btn btn-primary btn-block btn-lg" id="sv">Save</button>
      <button class="btn btn-block ${x.active ? 'btn-danger-soft' : ''}" id="rm" style="margin-top:8px">${x.active ? 'Remove from account' : 'Add back'}</button>`);
    const save = async (body) => { try { await K.api(`/business/${d.id}/members/${x.userId}`, body, 'PATCH'); m.close(); after(); } catch (e) { K.$('#err', m.el).textContent = e.message; } };
    K.$('#sv', m.el).onclick = () => save({ budget: shop ? 0 : +K.$('#bd', m.el).value, role: K.$('#ad', m.el).checked ? 'admin' : 'staff' });
    K.$('#rm', m.el).onclick = () => save({ active: !x.active });
  }
  function editCompany(d, after) {
    let spot = null;
    const m = K.modal(`<h2>Account details</h2>
      <label for="cn">Name</label><input id="cn" value="${K.esc(d.name)}">
      <label for="em">Email for statements</label><input id="em" type="email" value="${K.esc(d.email || '')}">
      ${d.kind === 'merchant' ? `<label>Shop location</label><div class="biz-spot" id="spot">${K.esc(d.shop ? d.shop.address : 'Not set')}</div><div id="spotSearch"></div>` : ''}
      <p class="error" id="err" role="alert"></p><button class="btn btn-primary btn-block btn-lg" id="sv">Save</button>`);
    if (d.kind === 'merchant') placePicker(K.$('#spotSearch', m.el), 'Search to move your shop', (p) => { spot = p; K.$('#spot', m.el).textContent = p.address; }, d.shop);
    K.$('#sv', m.el).onclick = async () => {
      try { await K.api(`/business/${d.id}`, { name: K.$('#cn', m.el).value, email: K.$('#em', m.el).value, ...(spot ? { shop: spot } : {}) }, 'PATCH'); m.close(); loadBiz(); after(); } catch (e) { K.$('#err', m.el).textContent = e.message; }
    };
  }
  function payStatement(d, after) {
    const m = K.modal(`<h2>Pay ${K.esc(d.name)}’s bill</h2><p class="money">${K.ugx(d.balanceDue)}</p><p class="small muted">Paid by MTN or Airtel Mobile Money. The account limit frees up as soon as it’s confirmed.</p>
      <p class="error" id="err" role="alert"></p><button class="btn btn-primary btn-block btn-lg" id="go">Pay with Mobile Money</button>`);
    K.$('#go', m.el).onclick = async () => {
      try { m.close(); const r = await K.payMomo({ amount: d.balanceDue, title: `Pay ${d.name}’s bill`, saved: S.user.payPhone, send: (x) => K.api(`/business/${d.id}/pay`, x) }); if (r === 'success') { K.toast('Payment received ✅'); after(); } }
      catch (e) { K.$('#err', m.el).textContent = e.message; }
    };
  }
  async function openStatement(d) {
    const sp = subPage('Statements');
    let month = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);
    const shift = (n) => { const [y, mo] = month.split('-').map(Number); const x = new Date(Date.UTC(y, mo - 1 + n, 1)); month = x.toISOString().slice(0, 7); load(); };
    const csv = (s) => {
      const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = [['Date', 'Booked by', 'From', 'To', d.kind === 'merchant' ? 'Customer' : 'Type', 'Amount (UGX)'].map(q).join(',')];
      for (const t of s.trips) lines.push([t.when, t.by, t.from, t.to, t.customer ? t.customer.recipientName : t.service, t.amount].map(q).join(','));
      lines.push(['', '', '', '', 'Total', s.total].map(q).join(','));
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `Flytte ${s.company} ${s.month}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    const load = async () => {
      sp.body.innerHTML = K.skeleton('list', 4);
      let s; try { s = await K.api(`/business/${d.id}/statement?month=${month}`); } catch (e) { K.failed(sp.body, e.message, load); return; }
      const now = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);
      sp.body.innerHTML = `<div class="row biz-month"><button class="btn icon-btn btn-ghost" id="prev" aria-label="Previous month">${K.ic('back')}</button><b class="grow" style="text-align:center">${K.esc(s.label)}</b><button class="btn icon-btn btn-ghost" id="next" aria-label="Next month" ${month >= now ? 'disabled' : ''} style="transform:scaleX(-1)">${K.ic('back')}</button></div>
        <div class="stats3"><div><b>${s.trips.length}</b><span>${d.kind === 'merchant' ? 'Deliveries' : 'Trips'}</span></div><div><b>${K.ugx(s.total).replace('UGX ', '')}</b><span>Total (UGX)</span></div><div><b>${K.ugx(s.balanceDue).replace('UGX ', '')}</b><span>Owed now</span></div></div>
        ${s.people.length > 1 ? `<h3 class="set-h">By person</h3><div class="set-card list">${s.people.map((p) => `<div class="set-row" style="cursor:default"><span class="grow"><b>${K.esc(p.name)}</b><small>${p.trips} trip${p.trips === 1 ? '' : 's'}</small></span><b class="small">${K.ugx(p.spent)}</b></div>`).join('')}</div>` : ''}
        <h3 class="set-h">${d.kind === 'merchant' ? 'Deliveries' : 'Trips'}</h3>
        ${s.trips.length ? `<div class="set-card list">${s.trips.map((t) => `<div class="set-row" style="cursor:default"><span class="grow"><b>${K.esc(String(t.to).split(',')[0])}</b><small>${K.esc(t.when)} · ${K.esc(t.customer ? t.customer.recipientName : t.by)}</small></span><b class="small">${K.ugx(t.amount)}</b></div>`).join('')}</div>` : '<div class="set-card"><p class="small muted" style="margin:0">Nothing this month.</p></div>'}
        ${s.payments.length ? `<h3 class="set-h">Payments</h3><div class="set-card list">${s.payments.map((p) => `<div class="set-row" style="cursor:default"><span class="grow"><b>${K.esc(p.note)}</b><small>${K.esc(p.when)}</small></span><b class="small pos">${K.ugx(p.amount)}</b></div>`).join('')}</div>` : ''}
        ${s.trips.length ? '<button class="btn btn-block btn-lg" id="dl" style="margin-top:16px">Download for Excel (CSV)</button>' : ''}`;
      K.$('#prev', sp.page).onclick = () => shift(-1);
      K.$('#next', sp.page).onclick = () => shift(1);
      const dl = K.$('#dl', sp.page); if (dl) dl.onclick = () => csv(s);
    };
    load();
  }

  // ---------- School runs ----------
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const daysText = (d) => d.join(',') === '1,2,3,4,5' ? 'Mon to Fri' : d.map((x) => DAYS[x - 1]).join(', ');
  const schoolMsg = (p) => `Hello${p.contact ? ' ' + p.contact.name : ''}, ${p.child} now goes to and from school with Flytte. The driver will ask you for the handover code ${p.handoverCode}. Please only give it to the Flytte driver collecting or dropping ${p.child}.`;
  async function openSchool(onBack) {
    const sp = subPage('School runs', onBack);
    const draw = () => {
      const plans = S.plans || [];
      sp.body.innerHTML = `${plans.length ? '' : `<div class="biz-hero school"><small>School runs</small><h2>Safe rides to school, every day</h2><p>Set it up once. Flytte books the rides, with a driver checked for children, and the same driver every day.</p></div>
          <div class="set-card">${perkRow('shield', 'Vetted drivers only', 'Police check, references and a meeting with our team before they carry children.')}${perkRow('lock', 'A handover code at the gate', 'The school gives the driver a code you set up, so your child only goes with the right person.')}${perkRow('locate', 'Follow every ride live', 'See the car on the map, the driver and plate. You get a notice when your child is dropped off.')}${perkRow('user', 'The same driver every day', 'After the first ride, that driver is offered your child’s runs first.')}</div>`}
        ${plans.map((p) => `<div class="school-card${p.active ? '' : ' off'}" data-plan="${p.id}">
            <div class="row" style="justify-content:space-between;align-items:baseline"><b>${K.esc(p.child)}</b><span class="badge ${p.active ? 'ok' : ''}">${p.active ? daysText(p.days) : 'Paused'}</span></div>
            <p class="small muted" style="margin:4px 0 0">${K.esc(String(p.school.address).split(',')[0])} · ${[p.morning ? `to school ${p.morning}` : '', p.afternoon ? `home ${p.afternoon}` : ''].filter(Boolean).join(' · ')}</p>
            <div class="school-driver">${p.driver ? `${p.driver.photo ? `<img src="${K.esc(p.driver.photo)}" alt="">` : `<span class="acct-photo">${K.initials(p.driver.name)}</span>`}<span><b>${K.esc(p.driver.name)}</b><small>${K.esc(p.driver.vehicle)} · ${K.esc(p.driver.plate || '')} · usual driver</small></span>` : `<span class="row-ic">${K.ic('user', 'sm')}</span><span><b>Driver chosen on the first ride</b><small>Then the same driver every day</small></span>`}</div>
            ${p.next.length && p.active ? `<p class="tiny muted" style="margin:8px 0 0">Next: ${p.next.slice(0, 2).map((t) => `${t.leg === 'morning' ? 'to school' : 'home'} ${K.when(t.at)}`).join(' · ')}</p>` : ''}
            <div class="school-code"><span class="tiny muted">Handover code for the school</span><b>${K.esc(p.handoverCode)}</b></div>
            <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
              <a class="btn btn-sm" target="_blank" rel="noopener" href="${p.contact && p.contact.phone ? waLink(p.contact.phone, schoolMsg(p)) : 'https://wa.me/?text=' + encodeURIComponent(schoolMsg(p))}">${K.ic('msg', 'sm')} Send code to school</a>
              <button class="btn btn-sm" data-pa="${p.active ? 'pause' : 'resume'}">${p.active ? 'Pause' : 'Resume'}</button>
              ${p.driver ? '<button class="btn btn-sm" data-pa="driver">Change driver</button>' : ''}
              <button class="btn btn-sm" data-pa="code">New code</button>
            </div></div>`).join('')}
        <button class="btn ${plans.length ? '' : 'btn-primary'} btn-block btn-lg" id="new" style="margin-top:16px">${K.ic('plus', 'sm')} Set up a school run</button>
        <p class="tiny faint" style="text-align:center;margin-top:10px">Rides are booked about a day ahead at the normal price (never busy-time prices) and paid like any trip.</p>`;
      K.$('#new', sp.page).onclick = () => newPlan((p) => { S.plans = [...(S.plans || []), p]; draw(); });
      sp.body.querySelectorAll('[data-plan]').forEach((card) => card.querySelectorAll('[data-pa]').forEach((b) => b.onclick = async () => {
        const id = +card.dataset.plan, a = b.dataset.pa;
        const body = { pause: { active: false }, resume: { active: true }, driver: { newDriver: true }, code: { newCode: true } }[a];
        if (a === 'driver' && !confirm('Find a different usual driver from the next ride?')) return;
        if (a === 'code' && !confirm('Make a new handover code? Send the new one to the school.')) return;
        try { const p = await K.api(`/school/plans/${id}`, body, 'PATCH'); S.plans = S.plans.map((x) => (x.id === id ? p : x)); draw(); K.toast({ pause: 'School run paused', resume: 'School run back on', driver: 'We’ll match a new driver on the next ride', code: 'New code made. Send it to the school.' }[a]); }
        catch (e) { K.toast(e.message); }
      }));
    };
    sp.body.innerHTML = K.skeleton('list', 3);
    try { S.plans = await K.api('/school/plans'); draw(); } catch (e) { K.failed(sp.body, e.message, () => { sp.close(); openSchool(onBack); }); }
  }
  function newPlan(done) {
    const saved = (S.user.savedPlaces || {}).home;
    let home = saved ? { address: saved.address, lat: saved.lat, lng: saved.lng } : S.pickup ? { address: S.pickup.address, lat: S.pickup.lat, lng: S.pickup.lng } : null;
    let sch = null; const days = new Set([1, 2, 3, 4, 5]);
    const m = K.modal(`<h2>Set up a school run</h2>
      <label for="ch">Child’s name</label><input id="ch" autocomplete="off" placeholder="e.g. Amani">
      <label>Picked up from</label><div class="biz-spot" id="hm">${home ? K.esc(home.address) : 'Search for home below'}</div><div id="hmS"></div>
      <label>School</label><div class="biz-spot" id="sc">Search for the school below</div><div id="scS"></div>
      <label>School days</label><div class="chips wrap" id="days">${DAYS.map((d, i) => `<button type="button" class="chip${days.has(i + 1) ? ' on' : ''}" data-d="${i + 1}" aria-pressed="${days.has(i + 1)}">${d}</button>`).join('')}</div>
      <div class="row" style="gap:10px"><span class="fill"><label for="mo">Pickup for school</label><input id="mo" type="time" value="06:45"></span><span class="fill"><label for="af">Pickup from school</label><input id="af" type="time" value="16:30"></span></div>
      <label for="cn">Who receives your child at school</label><input id="cn" placeholder="e.g. Teacher Grace, or the gate">
      <label for="cp">Their phone (to get the handover code)</label><input id="cp" type="tel" inputmode="tel" placeholder="0772 123456">
      <label>Pay with</label><div class="chips" id="pay"><button type="button" class="chip on" data-p="cash" aria-pressed="true">Cash</button><button type="button" class="chip" data-p="wallet" aria-pressed="false">Flytte Wallet</button></div>
      <p class="error" id="err" role="alert"></p>
      <button class="btn btn-primary btn-block btn-lg" id="sv">Set up school run</button>`);
    let pay = 'cash';
    placePicker(K.$('#hmS', m.el), 'Search for home', (p) => { home = p; K.$('#hm', m.el).textContent = p.address; });
    placePicker(K.$('#scS', m.el), 'Search for the school', (p) => { sch = p; K.$('#sc', m.el).textContent = p.address; });
    m.el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { const d = +b.dataset.d; days.has(d) ? days.delete(d) : days.add(d); b.classList.toggle('on', days.has(d)); b.setAttribute('aria-pressed', days.has(d)); });
    m.el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { pay = b.dataset.p; m.el.querySelectorAll('[data-p]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); });
    K.$('#sv', m.el).onclick = async () => {
      const btn = K.$('#sv', m.el); btn.disabled = true;
      try {
        const p = await K.api('/school/plans', { child: K.$('#ch', m.el).value, home, school: sch, days: [...days], morning: K.$('#mo', m.el).value || null, afternoon: K.$('#af', m.el).value || null, contactName: K.$('#cn', m.el).value, contactPhone: K.$('#cp', m.el).value || undefined, payment: pay });
        m.close(); done(p);
        const ok = K.modal(`<div style="text-align:center"><div style="font-size:2.4rem" aria-hidden="true">🎒</div><h2>${K.esc(p.child)}’s school run is set</h2><p class="muted">Give the school this handover code. The driver must get it from them at the gate.</p><p class="biz-pin big">${K.esc(p.handoverCode)}</p></div>
          <a class="btn btn-primary btn-block btn-lg" target="_blank" rel="noopener" href="${p.contact && p.contact.phone ? waLink(p.contact.phone, schoolMsg(p)) : 'https://wa.me/?text=' + encodeURIComponent(schoolMsg(p))}">${K.ic('msg', 'sm')} Send it to the school on WhatsApp</a><button class="btn btn-block" style="margin-top:8px" data-close>Done</button>`);
        ok.el.querySelector('a').addEventListener('click', () => setTimeout(ok.close, 300));
      } catch (e) { K.$('#err', m.el).textContent = e.message; btn.disabled = false; }
    };
  }

  // ---------- Flytte Pass ----------
  const dayMonth = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  // The Pass can be bought now if Mobile Money is on, or the wallet already covers it.
  const passBuyable = () => !!(S.config.pass && (S.config.paymentsAvailable || S.user.walletBalance >= S.config.pass.price));
  function passCard() {
    const pc = S.config.pass, p = S.pass;
    if (!pc || (!pc.enabled && !(p && p.active))) return '';
    if (p && p.active) return `<button class="pass-card on" data-a="pass"><span class="pass-glow" aria-hidden="true"></span><span class="grow"><small>Flytte Pass</small><b>Active until ${dayMonth(p.endsAt)}</b>
      <span>${p.saved ? `You’ve saved ${K.ugx(p.saved)} so far` : `${pc.percent}% off every ride · free cancels`}</span></span><span class="pass-tick">${K.ic('check', 'sm')}</span></button>`;
    return `<button class="pass-card" data-a="pass"><span class="pass-glow" aria-hidden="true"></span><span class="grow"><small>Flytte Pass</small><b>${pc.percent}% off every ride</b>
      <span>No busy-time prices, free cancels · ${K.ugx(pc.price)} a month</span></span><span class="acct-pill${passBuyable() ? '' : ' soon'}">${passBuyable() ? 'Get it' : 'Soon'}</span></button>`;
  }
  async function openPass(onBack) {
    const sp = subPage('Flytte Pass', onBack);
    const pc = S.config.pass;
    const perk = (ic, t, s) => `<div class="pass-perk"><span class="row-ic">${K.ic(ic, 'sm')}</span><span><b>${t}</b><small>${s}</small></span></div>`;
    const draw = (p) => {
      const perks = `<div class="set-card">${perk('tag', `${pc.percent}% off every ride`, `Up to ${K.ugx(pc.maxDiscount)} a trip, on boda, car and deliveries`)}${perk('chart', 'Never busy-time prices', 'Rain, rush hour, Friday night: you pay the normal price')}${perk('clock', 'Free cancellations', 'Change of plan? No cancellation fee. Flytte still pays your driver')}</div>`;
      if (p.active) {
        sp.body.innerHTML = `<div class="pass-hero on"><small>Flytte Pass</small><h2>You’re a member ✨</h2><p>Active until <b>${new Date(p.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</b></p>
            <div class="stats3"><div><b>${K.ugx(p.saved).replace('UGX ', '')}</b><span>Saved (UGX)</span></div><div><b>${p.trips}</b><span>Trips with a saving</span></div><div><b>${Math.max(0, Math.ceil((new Date(p.endsAt) - Date.now()) / 864e5))}</b><span>Days left</span></div></div></div>
          ${perks}
          <div class="set-card list" style="margin-top:14px"><button class="set-row" id="ar" role="switch" aria-checked="${p.autoRenew}"><span class="row-ic">${K.ic('wallet', 'sm')}</span><span class="grow"><b>Renew from my wallet</b><small>${p.autoRenew ? `${K.ugx(pc.price)} on ${dayMonth(p.endsAt)}, if your wallet has it` : 'Off · your pass ends on ' + dayMonth(p.endsAt)}</small></span><span class="set-switch${p.autoRenew ? ' on' : ''}" aria-hidden="true"><i></i></span></button></div>
          ${passBuyable() ? `<button class="btn btn-block" id="more" style="margin-top:12px">Add another ${pc.days} days</button>` : ''}`;
        K.$('#ar', sp.page).onclick = async () => { try { S.pass = await K.api('/me/pass/renew', { on: !p.autoRenew }); draw(S.pass); } catch (e) { K.toast(e.message); } };
        const mb = K.$('#more', sp.page); if (mb) mb.onclick = () => buyPass(draw);
        return;
      }
      sp.body.innerHTML = `<div class="pass-hero"><small>Flytte Pass</small><h2>Ride more, pay less</h2><p><b class="pass-price">${K.ugx(pc.price)}</b> for ${pc.days} days</p></div>
        ${perks}
        <p class="small muted" style="margin:14px 2px">At ${pc.percent}% off, it pays for itself after about ${Math.ceil(pc.price / Math.max(100, Math.min(pc.maxDiscount, (10000 * pc.percent) / 100)))} rides of ${K.ugx(10000)}, before any busy-time savings. Switch off renewal any time.</p>
        ${passBuyable() ? '<button class="btn btn-primary btn-block btn-lg" id="buy">Get Flytte Pass</button>' : `<div class="pass-soon" role="status"><b>Paying by Mobile Money is coming soon</b>
          <span>You can already get Flytte Pass from your Flytte Wallet once it has ${K.ugx(pc.price)}. You have ${K.ugx(S.user.walletBalance)}. Invite friends to earn wallet credit, and we’ll tell you as soon as Mobile Money is on.</span></div>
          <button class="btn btn-block btn-lg" id="inv" style="margin-top:12px">${K.ic('gift', 'sm')} Invite friends for credit</button>`}
        ${p.endedAt ? `<p class="tiny faint" style="text-align:center;margin-top:10px">Your last pass ended on ${dayMonth(p.endedAt)}.</p>` : ''}`;
      const bb = K.$('#buy', sp.page); if (bb) bb.onclick = () => buyPass(draw);
      const ib = K.$('#inv', sp.page); if (ib) ib.onclick = () => openInvite();
    };
    sp.body.innerHTML = K.skeleton('list', 3);
    if (S.pass) draw(S.pass);
    try { S.pass = await K.api('/me/pass'); draw(S.pass); } catch (e) { if (!S.pass) K.failed(sp.body, e.message, () => { sp.close(); openPass(onBack); }); }
  }
  function buyPass(after) {
    const pc = S.config.pass, enough = S.user.walletBalance >= pc.price;
    const m = K.modal(`<h2>Pay for Flytte Pass</h2><p class="money">${K.ugx(pc.price)}</p><p class="small muted">${pc.days} days of ${pc.percent}% off, normal prices at busy times and free cancellations.</p>
      <button class="btn btn-primary btn-block btn-lg" id="w" ${enough ? '' : 'disabled'}>${K.ic('wallet', 'sm')} Flytte Wallet · ${K.ugx(S.user.walletBalance)}</button>
      ${enough ? '' : '<p class="tiny muted" style="margin:6px 2px 0">Your wallet doesn’t have enough.</p>'}
      ${S.config.paymentsAvailable ? '<button class="btn btn-block btn-lg" id="mm" style="margin-top:8px">MTN / Airtel Mobile Money</button>' : ''}
      <p class="error" id="err" role="alert"></p>`);
    const go = async (method, b) => {
      b.disabled = true;
      try {
        let walletPass;
        if (method === 'wallet' && S.user.walletLock) { walletPass = await K.walletLock.unlock({ amount: pc.price }); if (!walletPass) { b.disabled = false; return; } }
        if (method === 'momo') {
          m.close();
          const r = await K.payMomo({ amount: pc.price, title: 'Pay for Flytte Pass', saved: S.user.payPhone, send: (x) => K.api('/me/pass/buy', { method: 'momo', ...x }) });
          if (r !== 'success') return;
          S.pass = await K.api('/me/pass'); K.toast('Flytte Pass is on ✨ Enjoy your rides.', 4000); after && after(S.pass); patchHome('forYou');
          return;
        }
        const out = await K.api('/me/pass/buy', { method, walletPass });
        if (method === 'wallet') S.user.walletBalance -= pc.price;
        S.pass = out.pass || await K.api('/me/pass');
        m.close(); K.toast('Flytte Pass is on ✨ Enjoy your rides.', 4000); K.haptic && K.haptic('success');
        after && after(S.pass); patchHome('forYou');
      } catch (e) { K.$('#err', m.el).textContent = e.message; b.disabled = false; }
    };
    const w = K.$('#w', m.el); if (w) w.onclick = () => go('wallet', w);
    const mm = K.$('#mm', m.el); if (mm) mm.onclick = () => go('momo', mm);
  }

  // ---------- Account ----------
  // Header (tap to edit) with stats, Wallet and Rewards up top, then short sections.
  const monthYear = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '');
  const avatar = (u, cls = 'acct-photo') => `<span class="${cls}">${u.photo ? `<img src="${K.esc(u.photo)}" alt="">` : K.initials(u.name)}</span>`;
  const row = (a, ic, title, sub, extra = '') => `<button class="set-row" data-a="${a}"><span class="row-ic">${K.ic(ic, 'sm')}</span><span class="grow"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span>${extra || K.ic('chev', 'sm')}</button>`;
  function drawAccount(el) {
    const u = S.user, P = PAY[pref()], g = S.growth, sm = S.summary;
    const places = Object.keys(u.savedPlaces || {}).length;
    const ns = u.nightShare || {};
    const tier = g && g.tier, pts = g ? g.lifetimePoints || 0 : 0;
    const pct = tier && tier.next ? Math.min(100, Math.round((pts / tier.at) * 100)) : 100;
    el.innerHTML = `
      <div class="page-title">Account</div>
      <button class="acct-head" data-a="profile" aria-label="Edit your profile">${avatar(u)}
        <span class="grow"><b>${K.esc(u.name)}</b><span class="small muted">${K.esc(prettyPhone(u.phone))}</span>
          <span class="acct-badges"><span>${K.ic('check', 'sm')}Phone</span>${u.email && u.emailVerified ? `<span>${K.ic('check', 'sm')}Email</span>` : ''}</span></span>
        <span class="small muted">Edit</span></button>
      <div class="acct-stats">
        <div><b>${sm ? sm.allTime.trips : '–'}</b><span>trips</span></div>
        <div><b>★ ${u.rating || 'New'}</b><span>rating</span></div>
        <div><b>${monthYear(u.memberSince) || '–'}</b><span>rider since</span></div>
        <div><b>${tier ? K.esc(tier.name) : '–'}</b><span>Rewards</span></div>
      </div>
      <div class="acct-cards">
        <button class="acct-card" data-a="wallet"><small>Flytte Wallet</small><b>${K.ugx(u.walletBalance)}</b><span class="acct-pill">${S.config.paymentsAvailable ? 'Top up' : 'View'}</span></button>
        <button class="acct-card rewards" data-a="rewards"><small>Flytte Rewards</small><b>${g ? `${g.points} points` : 'Rewards'}</b>
          <span class="acct-meter" aria-hidden="true"><i style="width:${pct}%"></i></span><span class="tiny muted">${tier && tier.next ? `${Math.max(0, tier.at - pts)} to ${K.esc(tier.next)}` : tier ? 'Top level' : ''}</span></button>
      </div>
      ${passCard()}
      <h3 class="set-h">Payments</h3><div class="set-card list">
        ${row('pay', 'card', 'Payment methods', K.esc(P.name))}
        ${row('summary', 'chart', 'Monthly summary', sm ? `${sm.totals.trips} trip${sm.totals.trips === 1 ? '' : 's'} · ${K.ugx(sm.totals.spent)} this month` : 'Trips, spending and statements')}
      </div>
      <h3 class="set-h">Places & safety</h3><div class="set-card list">
        ${row('places', 'pin', 'Saved places', places ? `${places} saved` : 'Home, work and your own places')}
        ${row('prefs', 'settings', 'Ride preferences', [u.ridePrefs && u.ridePrefs.service ? svcName(u.ridePrefs.service) : '', u.ridePrefs && u.ridePrefs.womanDriver ? 'Woman driver' : ''].filter(Boolean).join(' · ') || 'Default ride, driver and pickup note')}
        ${row('safety', 'shield', 'Emergency contact', u.emergencyContact ? K.esc(prettyPhone(u.emergencyContact)) : 'Add someone we can alert')}
        ${row('night', 'clock', 'Share night trips', ns.on ? `On from ${K.esc(ns.from)} · ${S.config.nightShareSms ? 'texted automatically' : 'one tap on WhatsApp'}` : 'Off', `<span class="set-switch${ns.on ? ' on' : ''}" aria-hidden="true"><i></i></span>`)}
      </div>
      <h3 class="set-h">Work, shops and school</h3><div class="set-card list">
        ${row('biz', 'work', 'Flytte for Business', bizCompanies('business').length ? K.esc(bizCompanies('business').map((c) => c.name).join(', ')) : 'Company rides, billed monthly')}
        ${row('shop', 'send', 'Flytte for Shops', bizCompanies('merchant').length ? K.esc(bizCompanies('merchant').map((c) => c.name).join(', ')) : 'Deliveries for your customers')}
        ${row('school', 'flag', 'School runs', S.plans && S.plans.length ? `${S.plans.length} child${S.plans.length === 1 ? '' : 'ren'} · same driver every day` : 'Vetted drivers, a PIN at the school gate')}
      </div>
      <h3 class="set-h">You</h3><div class="set-card list">
        ${row('profile', 'user', 'Profile and sign-in', ['Name, photo, phone', S.config.emailReceipts || u.email ? 'email' : '', !S.config.smsLogin ? 'password' : ''].filter(Boolean).join(', '))}
        ${row('devices', 'lock', 'Signed-in devices', 'See where you’re signed in')}
        ${row('invite', 'gift', 'Invite friends', `Share your link · get ${K.ugx((S.config.growth || { referral: {} }).referral.referrer || 0)} for each friend`)}
        ${row('settings', 'settings', 'Settings', 'Appearance, language, privacy')}
      </div>
      <h3 class="set-h">Help</h3><div class="set-card list">
        ${row('help', 'help', 'Help centre', 'Answers, your reports, contact us')}
        ${row('rate', 'star', 'Rate Flytte', 'Tell us how we’re doing')}
      </div>
      <div class="set-card list" style="margin-top:22px">${row('out', 'logout', 'Log out', '', '')}</div>
      <p class="tiny faint" style="text-align:center;margin-top:18px">Flytte ${K.esc(S.config.version || '')}</p>`;
    const redraw = () => drawAccount(el);
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'pay') openPayments({ onBack: redraw });
      else if (a === 'invite') openInvite(redraw);
      else if (a === 'rewards') openRewards(redraw);
      else if (a === 'places') openPlaces(redraw);
      else if (a === 'wallet') openWallet(redraw);
      else if (a === 'pass') openPass(redraw);
      else if (a === 'biz') openBusiness(redraw, 'business');
      else if (a === 'shop') openBusiness(redraw, 'merchant');
      else if (a === 'school') openSchool(redraw);
      else if (a === 'safety') openEmergency(redraw);
      else if (a === 'email') openEmail(redraw);
      else if (a === 'settings') K.openSettings({ role: 'rider', onBack: redraw });
      else if (a === 'profile') openProfile(redraw);
      else if (a === 'prefs') openPrefs(redraw);
      else if (a === 'night') toggleNight(redraw);
      else if (a === 'summary') openSummary(redraw);
      else if (a === 'devices') openDevices(redraw);
      else if (a === 'help') openHelp(redraw);
      else if (a === 'rate') openRate();
      else if (a === 'share') shareFlytte();
      else if (a === 'out') K.logout();
    });
    el.querySelector('[data-a="out"]').classList.add('danger');
    // Stats and this month's numbers load quietly; the page redraws once when they arrive.
    if (!S.summary) K.api('/me/summary').then((x) => { S.summary = x; if (el.isConnected) redraw(); }).catch(() => {});
    if (!S.growth) K.api('/me/growth').then((x) => { S.growth = x; if (el.isConnected) redraw(); }).catch(() => {});
    if (!S.pass) K.api('/me/pass').then((x) => { S.pass = x; if (el.isConnected) redraw(); }).catch(() => {});
    if (!S.plans) K.api('/school/plans').then((x) => { S.plans = x; if (el.isConnected && x.length) redraw(); }).catch(() => {});
    if (!S.biz) loadBiz().then(() => { if (el.isConnected && bizCompanies().length) redraw(); });
  }
  const saveUser = (u) => { S.user = u; const sess = K.session.get(); if (sess) { sess.user = { ...sess.user, ...u }; K.session.set(sess); } };

  // Profile and sign-in: photo, name, phone number (confirmed by a code), email, password.
  function openProfile(onBack) {
    const sp = subPage('Profile', onBack);
    const draw = () => {
      const u = S.user;
      sp.body.innerHTML = `
        <div class="prof-photo"><button class="prof-pic" id="pic" aria-label="Change photo">${avatar(u, 'acct-photo big')}<span class="prof-cam">${K.ic('camera', 'sm')}</span></button>
          <input type="file" id="picIn" accept="image/*" hidden>
          ${u.photo ? '<button class="link-btn small" id="picDel">Remove photo</button>' : '<p class="tiny muted">Only you see your photo.</p>'}</div>
        <h3 class="set-h">Name</h3><div class="set-card"><form id="nf" class="row" style="gap:8px"><input id="nm" class="fill" value="${K.esc(u.name)}" autocomplete="name" aria-label="Full name" style="margin:0"><button class="btn btn-primary" type="submit">Save</button></form></div>
        <h3 class="set-h">Sign-in</h3><div class="set-card list">
          ${row('phone', 'phone', 'Phone number', `${K.esc(prettyPhone(u.phone))} · confirmed`, '<span class="small muted">Change</span>')}
          ${S.config.emailReceipts || u.email ? row('email', 'mail', 'Email and receipts', u.email ? `${K.esc(u.email)}${u.emailVerified ? ' · confirmed' : ' · not confirmed'}` : 'Add your email to get trip receipts') : ''}
          ${!S.config.smsLogin ? row('pw', 'lock', 'Password', 'Change your password') : ''}
        </div>`;
      const inp = K.$('#picIn', sp.body);
      K.$('#pic', sp.body).onclick = () => inp.click();
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        try { const photo = await shrinkPhoto(f); saveUser((await K.api('/me', { photo }, 'PATCH')).user); K.toast('Photo updated'); draw(); }
        catch (e) { K.toast(e.message || 'Couldn’t use that photo. Try another.'); }
      };
      const del = K.$('#picDel', sp.body); if (del) del.onclick = async () => { try { saveUser((await K.api('/me', { photo: null }, 'PATCH')).user); draw(); } catch (e) { K.toast(e.message); } };
      K.$('#nf', sp.body).onsubmit = async (e) => {
        e.preventDefault();
        try { saveUser((await K.api('/me', { name: K.$('#nm', sp.body).value }, 'PATCH')).user); K.toast('Name saved'); } catch (x) { K.toast(x.message); }
      };
      sp.body.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => {
        if (b.dataset.a === 'phone') changePhone(draw);
        else if (b.dataset.a === 'email') openEmail(draw);
        else if (b.dataset.a === 'pw') changePassword();
      });
    };
    draw();
  }
  // A square, small JPEG (320 px) so the photo stays light on data.
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const n = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 320;
        c.getContext('2d').drawImage(img, (img.width - n) / 2, (img.height - n) / 2, n, n, 0, 0, 320, 320);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t read that photo. Try another.')); };
      img.src = url;
    });
  }
  // New phone number: a code goes to the new number, then the change is confirmed with it.
  function changePhone(after) {
    const m = K.modal(`<h2>Change phone number</h2><p class="small muted">We’ll send a code to your new number. Your trips, wallet and rewards stay with you.</p>
      <form id="pf"><label for="np">New mobile number</label><input id="np" type="tel" inputmode="tel" placeholder="0772 123456" autocomplete="tel">
        <div id="codeBox" hidden><label for="cd">6-digit code</label><input id="cd" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <p class="error" id="err" role="alert"></p><button class="btn btn-primary btn-block btn-lg" type="submit" id="go">Send code</button></form>`);
    let sentTo = null;
    K.$('#pf', m.el).onsubmit = async (e) => {
      e.preventDefault();
      const err = K.$('#err', m.el), go = K.$('#go', m.el), phone = K.$('#np', m.el).value;
      err.textContent = ''; go.disabled = true;
      try {
        if (!sentTo || sentTo !== phone) {
          const ch = (S.config.codeChannels || [])[0] || 'sms';
          const out = await K.api('/auth/otp/send', { phone, channel: ch });
          sentTo = phone; K.$('#codeBox', m.el).hidden = false; go.textContent = 'Confirm new number'; K.$('#cd', m.el).focus();
          if (out.demoCode) K.toast(`Test mode: your code is ${out.demoCode}`, 6000);
        } else {
          saveUser((await K.api('/me/phone', { phone, code: K.$('#cd', m.el).value })).user);
          m.close(); K.toast('Phone number changed'); after && after();
        }
      } catch (x) { err.textContent = x.message; }
      go.disabled = false;
    };
  }
  function changePassword() {
    const m = K.modal(`<h2>Change password</h2><form id="wf"><label for="cur">Current password</label><input id="cur" type="password" autocomplete="current-password">
      <label for="nw">New password</label><input id="nw" type="password" autocomplete="new-password" minlength="6" placeholder="At least 6 characters">
      <p class="error" id="err" role="alert"></p><button class="btn btn-primary btn-block btn-lg" type="submit">Change password</button></form>`);
    K.$('#wf', m.el).onsubmit = async (e) => {
      e.preventDefault();
      try { await K.api('/me/password', { current: K.$('#cur', m.el).value, next: K.$('#nw', m.el).value }); m.close(); K.toast('Password changed'); }
      catch (x) { K.$('#err', m.el).textContent = x.message; }
    };
  }

  // Ride preferences: used for every booking until changed on the ride options.
  function applyPrefs() {
    const p = (S.user && S.user.ridePrefs) || {};
    if (p.service && S.config && S.config.services.some((s) => s.id === p.service)) S.service = p.service;
    S.womanDriver = !!p.womanDriver;
    if (!S.note && p.note) S.note = p.note;
  }
  function openPrefs(onBack) {
    const sp = subPage('Ride preferences', onBack);
    const p = { ...(S.user.ridePrefs || {}) };
    const draw = () => {
      sp.body.innerHTML = `<p class="small muted" style="margin:0 4px 6px">Used for every booking. You can still change them on the ride options.</p>
        <h3 class="set-h">Usual ride</h3><div class="set-card list" role="radiogroup" aria-label="Usual ride">${S.config.services.filter((s) => ['boda', 'car', 'comfort'].includes(s.id)).map((s) => { const on = (p.service || 'boda') === s.id; return `<button class="set-row" data-svc="${s.id}" role="radio" aria-checked="${on}"><span class="grow"><b>${K.esc(svcName(s.id))}</b>${!p.service && on ? '<small>Default</small>' : ''}</span>${on ? K.ic('check') : ''}</button>`; }).join('')}</div>
        <h3 class="set-h">Driver</h3><div class="set-card list"><button class="set-row" id="wd" role="switch" aria-checked="${!!p.womanDriver}"><span class="grow"><b>Always ask for a woman driver</b><small>It can take a little longer to find one</small></span><span class="set-switch${p.womanDriver ? ' on' : ''}" aria-hidden="true"><i></i></span></button></div>
        <h3 class="set-h">Pickup note</h3><div class="set-card"><input id="pn" maxlength="120" placeholder="e.g. Call me when you arrive" value="${K.esc(p.note || '')}" aria-label="Default pickup note" style="margin:0"></div>
        <button class="btn btn-primary btn-block btn-lg" id="sv" style="margin-top:18px">Save preferences</button>`;
      sp.body.querySelectorAll('[data-svc]').forEach((b) => b.onclick = () => { p.service = b.dataset.svc; p.note = K.$('#pn', sp.body).value; draw(); });
      K.$('#wd', sp.body).onclick = () => { p.womanDriver = !p.womanDriver; p.note = K.$('#pn', sp.body).value; draw(); };
      K.$('#sv', sp.body).onclick = async () => {
        p.note = K.$('#pn', sp.body).value;
        try { saveUser((await K.api('/me', { ridePrefs: p }, 'PATCH')).user); S.note = ''; applyPrefs(); K.toast('Preferences saved'); sp.close(); onBack && onBack(); } catch (e) { K.toast(e.message); }
      };
    };
    draw();
  }

  // Night trips: the emergency contact gets the live link by SMS for trips that start late.
  function toggleNight(after) {
    const u = S.user, ns = u.nightShare || { on: false, from: '21:00' };
    if (!u.emergencyContact) { K.toast('Add an emergency contact first.'); openEmergency(after); return; }
    const auto = !!S.config.nightShareSms;
    const m = K.modal(`<h2>Share night trips</h2><p class="small muted">When a trip starts late, ${K.esc(prettyPhone(u.emergencyContact))} gets your driver, plate and live link. Only you can turn it off.</p>
      <p class="night-how ${auto ? 'ok' : ''}" id="nightHow">${K.ic(auto ? 'check' : 'msg', 'sm')}<span>${auto ? 'Texts go automatically by SMS.' : 'Texts aren’t switched on yet. When a night trip starts, Flytte tells you straight away and you send it on WhatsApp with one tap.'}</span></p>
      <div class="set-card list" style="margin:12px 0"><button class="set-row" id="on" role="switch" aria-checked="${ns.on}"><span class="grow"><b>Share automatically</b></span><span class="set-switch${ns.on ? ' on' : ''}" aria-hidden="true"><i></i></span></button></div>
      <label for="fr">From</label><select id="fr">${['19:00', '20:00', '21:00', '22:00', '23:00'].map((t) => `<option ${t === ns.from ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <p class="tiny muted">Until 5 am, Kampala time. Once per trip.</p><button class="btn btn-primary btn-block btn-lg" id="sv">Save</button>`);
    let on = ns.on;
    K.$('#on', m.el).onclick = (e) => { on = !on; const b = e.currentTarget; b.setAttribute('aria-checked', on); b.querySelector('.set-switch').classList.toggle('on', on); };
    K.$('#sv', m.el).onclick = async () => {
      try { saveUser((await K.api('/me', { nightShare: { on, from: K.$('#fr', m.el).value } }, 'PATCH')).user); m.close(); K.toast(on ? 'Night trips will be shared' : 'Night sharing is off'); after && after(); }
      catch (e) { K.toast(e.message); }
    };
  }

  // Monthly summary with a statement to download.
  async function openSummary(onBack, startMonth) {
    const sp = subPage('Monthly summary', onBack);
    let month = startMonth || (S.summary && S.summary.month) || null;
    const shift = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
    const label = (ym) => new Date(ym + '-01T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const load = async () => {
      sp.body.innerHTML = K.skeleton('list', 3);
      let s; try { s = await K.api('/me/summary' + (month ? `?month=${month}` : '')); } catch (e) { K.failed(sp.body, e.message, load); return; }
      month = s.month; if (!S.summary || S.summary.month === s.month) S.summary = s;
      const cur = shift(new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7), 0);
      sp.body.innerHTML = `
        <div class="month-nav"><button class="btn icon-btn btn-ghost" id="prev" aria-label="Previous month">${K.ic('back')}</button><b>${label(month)}</b><button class="btn icon-btn btn-ghost" id="next" aria-label="Next month" ${month >= cur ? 'disabled' : ''} style="transform:scaleX(-1)">${K.ic('back')}</button></div>
        <div class="sum-grid"><div><span>Trips</span><b>${s.totals.trips}</b></div><div><span>Spent</span><b>${K.ugx(s.totals.spent)}</b></div><div><span>Saved</span><b class="pos">${K.ugx(s.totals.saved)}</b></div><div><span>Distance</span><b>${s.totals.km} km</b></div></div>
        ${Object.keys(s.byService).length ? `<h3 class="set-h">By ride type</h3><div class="set-card list">${Object.entries(s.byService).map(([k, n]) => `<div class="set-row" style="cursor:default"><span class="grow"><b>${K.esc(svcName(k))}</b></span><span class="small muted">${n} trip${n > 1 ? 's' : ''}</span></div>`).join('')}</div>` : ''}
        <h3 class="set-h">Trips</h3><div class="set-card list">${s.trips.length ? s.trips.map((t) => `<div class="set-row" style="cursor:default"><span class="grow"><b>${K.esc(String(t.from).split(',')[0])} → ${K.esc(String(t.to).split(',')[0])}</b><small>${K.when(t.at)} · ${K.esc(svcName(t.service))}</small></span><b>${K.ugx(t.paid + t.tip)}</b></div>`).join('') : '<p class="small muted" style="padding:14px 0;margin:0">No trips this month.</p>'}</div>
        ${s.trips.length ? '<button class="btn btn-block btn-lg" id="csv" style="margin-top:16px">Download statement (CSV)</button>' : ''}
        <p class="tiny muted" style="text-align:center;margin-top:12px">All time: ${s.allTime.trips} trips · ${s.allTime.km} km</p>`;
      K.$('#prev', sp.body).onclick = () => { month = shift(month, -1); load(); };
      K.$('#next', sp.body).onclick = () => { month = shift(month, 1); load(); };
      const c = K.$('#csv', sp.body);
      if (c) c.onclick = () => {
        const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const lines = [['Date', 'Trip', 'Ride', 'From', 'To', 'Km', 'Fare (UGX)', 'Discount', 'Tip', 'Paid', 'Method'].join(',')]
          .concat(s.trips.map((t) => [new Date(t.at).toISOString().slice(0, 16).replace('T', ' '), t.id, svcName(t.service), t.from, t.to, t.km, t.fare, t.discount, t.tip, t.paid + t.tip, t.method].map(q).join(',')));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        a.download = `flytte-statement-${month}.csv`; document.body.appendChild(a); a.click(); a.remove();
      };
    };
    load();
  }

  // Signed-in devices.
  async function openDevices(onBack) {
    const sp = subPage('Signed-in devices', onBack);
    const load = async () => {
      sp.body.innerHTML = K.skeleton('list', 2);
      let d; try { d = await K.api('/me/sessions'); } catch (e) { K.failed(sp.body, e.message, load); return; }
      const others = d.sessions.filter((x) => !x.current);
      sp.body.innerHTML = `<div class="set-card list">${d.sessions.map((x) => `<div class="set-row" style="cursor:default"><span class="row-ic">${K.ic(/iPhone|Android|iPad/.test(x.device) ? 'phone' : 'user', 'sm')}</span>
          <span class="grow"><b>${K.esc(x.device || 'Device')}${x.current ? ' <span class="this-dev">This phone</span>' : ''}</b><small>Signed in ${K.when(x.since)}${x.current ? '' : ` · last used ${K.when(x.lastSeen)}`}</small></span>
          ${x.current ? '' : `<button class="btn btn-sm" data-out="${K.esc(x.id)}">Sign out</button>`}</div>`).join('') || '<p class="small muted" style="padding:14px 0;margin:0">Only this phone.</p>'}</div>
        ${d.legacy ? '<p class="tiny muted" style="margin:10px 4px 0">Phones that signed in before this list existed don’t show here. “Sign out other devices” signs them out too.</p>' : ''}
        <button class="btn btn-block btn-lg" id="all" style="margin-top:16px;color:var(--stop)">Sign out other devices</button>`;
      sp.body.querySelectorAll('[data-out]').forEach((b) => b.onclick = async () => { try { await K.api(`/me/sessions/${b.dataset.out}/revoke`, {}); K.toast('Signed out'); load(); } catch (e) { K.toast(e.message); } });
      K.$('#all', sp.body).onclick = async () => {
        try {
          const out = await K.api('/me/sessions/revoke-others', {});
          if (out.token) { const s = K.session.get(); if (s) { s.token = out.token; K.session.set(s); } }
          K.toast(others.length || d.legacy ? 'Other devices are signed out' : 'No other devices'); load();
        } catch (e) { K.toast(e.message); }
      };
    };
    load();
  }

  // Help centre: answers, reports from all trips, and how to reach Flytte.
  async function openHelp(onBack) {
    const sp = subPage('Help centre', onBack);
    const faq = [
      ['How are prices worked out?', 'Every price is upfront: you pay what you see when you book. It covers the distance, the expected time in traffic, any stops, and busier times. Tap “How it’s priced” on the ride options to see the parts.'],
      ['Do I pay to cancel?', `Cancelling is free while we look for a driver and for ${(S.config.drivers || {}).cancelGraceMin ?? 2} minutes after one accepts. After that, ${K.ugx((S.config.drivers || {}).cancelFee || 0)} goes to the driver for their time, taken from your Flytte Wallet only if it has enough. It’s free if the driver is very late.`],
      ['I left something behind', 'Open the trip in Activity, tap Get help, and choose “I lost an item”. We’ll contact the driver and reply in the app.'],
      ['Paying by Mobile Money or card', 'Choose it before you book and pay at the end of the trip. If the payment doesn’t go through, you can pay the driver in cash instead. Your wallet can also pay at the end.'],
      ['Staying safe', 'Check the driver’s face and plate before you get on, and give your PIN only to them. The shield on the map has SOS, trip sharing and your emergency contact. You can also share night trips automatically in Account.'],
      ['Changing my number or details', 'Go to Account → Profile and sign-in. A new phone number is confirmed with a code sent to it.'],
    ];
    sp.body.innerHTML = `<div class="set-card list faq">${faq.map(([q, a]) => `<details class="faq-item"><summary><b>${K.esc(q)}</b>${K.ic('chevDown', 'sm')}</summary><p>${K.esc(a)}</p></details>`).join('')}</div>
      <h3 class="set-h">Your reports</h3><div id="reps">${K.skeleton('list', 1)}</div>
      <h3 class="set-h">Contact us</h3><div class="set-card list">
        ${row('trip', 'receipt', 'Problem with a trip', 'Open the trip in Activity and tap Get help')}
        ${row('msg', 'msg', 'Write to us', 'Anything else: your account, payments, an idea')}
        ${S.config.supportPhone ? `<a class="set-row" href="https://wa.me/${K.esc(S.config.supportPhone.replace(/\D/g, ''))}" target="_blank" rel="noopener"><span class="row-ic">${K.ic('msg', 'sm')}</span><span class="grow"><b>WhatsApp us</b><small>${K.esc(S.config.supportPhone)}</small></span>${K.ic('chev', 'sm')}</a>
        <a class="set-row" href="tel:${K.esc(S.config.supportPhone.replace(/\s/g, ''))}"><span class="row-ic">${K.ic('phone', 'sm')}</span><span class="grow"><b>Call support</b><small>${K.esc(S.config.supportPhone)}</small></span>${K.ic('chev', 'sm')}</a>` : ''}
      </div>`;
    K.$('[data-a="trip"]', sp.body).onclick = () => { sp.close(); openTab('activity'); };
    K.$('[data-a="msg"]', sp.body).onclick = () => {
      const m = K.modal(`<h2>Write to us</h2><p class="small muted">The Flytte team reads every message and replies by phone or in the app.</p>
        <textarea id="hm" rows="5" maxlength="1000" placeholder="How can we help?"></textarea><p class="error" id="err"></p>
        <button class="btn btn-primary btn-block btn-lg" id="sv">Send</button>`);
      K.$('#sv', m.el).onclick = async () => {
        try { await K.api('/support/message', { message: K.$('#hm', m.el).value }); m.close(); K.toast('Sent. We’ll get back to you soon.', 4000); }
        catch (e) { K.$('#err', m.el).textContent = e.message; }
      };
    };
    const label = { lost_item: 'Lost item', wrong_charge: 'Charged the wrong amount', long_route: 'Longer route', driver_behaviour: 'Driver behaviour', safety: 'Safety concern', other: 'Something else' };
    try {
      const list = await K.api('/me/reports');
      K.$('#reps', sp.body).innerHTML = list.length ? `<div class="set-card list">${list.map((i) => `<div class="set-row" style="cursor:default;align-items:flex-start"><span class="grow"><b>${K.esc(label[i.kind] || 'Report')} · trip #${i.tripId}</b><small>${K.when(i.at)} · ${i.status === 'open' ? 'In review' : 'Resolved'}</small>${i.reply ? `<span class="rep-reply">${K.esc(i.reply)}</span>` : ''}</span></div>`).join('')}</div>`
        : '<p class="small muted" style="margin:0 4px">No reports yet.</p>';
    } catch { K.$('#reps', sp.body).innerHTML = '<p class="small muted" style="margin:0 4px">Couldn’t load your reports.</p>'; }
  }

  // Rate Flytte: stars and a note for the team. 5 stars also suggests sharing Flytte.
  function openRate() {
    let stars = 0;
    const m = K.modal(`<h2>Rate Flytte</h2><p class="small muted">How is Flytte working for you?</p>
      <div class="stars" role="radiogroup" aria-label="Rate Flytte">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <textarea id="nt" rows="3" maxlength="500" placeholder="What should we do better? (optional)"></textarea>
      <button class="btn btn-primary btn-block btn-lg" id="send" disabled>Send</button>`);
    m.el.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => {
      stars = +b.dataset.n; K.$('#send', m.el).disabled = false;
      m.el.querySelectorAll('[data-n]').forEach((x) => { x.classList.toggle('on', +x.dataset.n <= stars); x.setAttribute('aria-checked', String(+x.dataset.n === stars)); });
    });
    K.$('#send', m.el).onclick = async () => {
      try {
        await K.api('/feedback', { stars, note: K.$('#nt', m.el).value });
        m.close(); K.toast(stars >= 4 ? 'Thank you! Tell a friend about Flytte too.' : 'Thank you. The team reads every message.', 4000);
        if (stars === 5) setTimeout(shareFlytte, 900);
      } catch (e) { K.toast(e.message); }
    };
  }
  async function shareFlytte() {
    try { if (!S.growth) S.growth = await K.api('/me/growth'); } catch {}
    const link = (S.growth && S.growth.link) || location.origin;
    K.share(link, `I ride with Flytte in Kampala: bodas, cars and deliveries.${S.growth && S.growth.code ? ` Use my code ${S.growth.code} when you sign up.` : ''}`);
  }

  // Email for receipts: add/confirm, switch receipts on or off, or remove it.
  function openEmail(after) {
    const u = S.user;
    const apply = (nu) => { if (nu) { Object.assign(S.user, nu); const sess = K.session.get(); if (sess) { sess.user = { ...sess.user, ...nu }; K.session.set(sess); } } };
    if (!(u.email && u.emailVerified)) {
      const m = K.modal('<div class="email-modal" data-host></div>');
      K.emailFlow(K.$('[data-host]', m.el), { current: u.email || '', onDone: (nu) => { apply(nu); m.close(); after && after(); } });
      return;
    }
    const m = K.modal(`<div class="email-modal"><h2>Email</h2>
      <p class="small muted" style="margin:0 0 12px">${K.esc(u.email)} · Confirmed</p>
      <div class="set-card list"><button class="set-row" id="rcpt" role="switch" aria-checked="${u.emailReceipts}"><span class="grow"><b>Trip receipts</b><small>Emailed a few minutes after each paid trip</small></span><span class="set-switch${u.emailReceipts ? ' on' : ''}" aria-hidden="true"><i></i></span></button></div>
      <button class="btn btn-block" id="chg" style="margin-top:14px">Change email</button>
      <button class="btn btn-ghost btn-block" id="rm" style="color:var(--stop)">Remove email</button></div>`);
    K.$('#rcpt', m.el).onclick = async () => {
      try { const out = await K.api('/me/email/settings', { receipts: !S.user.emailReceipts }); apply(out.user); m.close(); setTimeout(() => openEmail(after), 280); after && after(); }
      catch (e) { K.toast(e.message); }
    };
    K.$('#chg', m.el).onclick = () => { const host = m.el.querySelector('.email-modal'); K.emailFlow(host, { onDone: (nu) => { apply(nu); m.close(); after && after(); } }); };
    K.$('#rm', m.el).onclick = async () => {
      try { const out = await K.api('/me/email/settings', { remove: true }); apply(out.user); m.close(); K.toast('Email removed'); after && after(); }
      catch (e) { K.toast(e.message); }
    };
  }

  // Screen 13: payment methods
  function openPayments({ onPick, onBack } = {}) {
    const sp = subPage('Payment methods', onBack);
    const draw = () => {
      const cur = pref();
      const sub = { mtn: 'MTN or Airtel · you choose when you pay', airtel: 'MTN or Airtel · you choose when you pay', card: 'Visa or Mastercard, paid at the end', cash: 'Pay your rider or driver directly', wallet: 'Balance ' + K.ugx(S.user.walletBalance), business: (bizCompanies('business')[0] ? budgetText(bizCompanies('business')[0]) : '') };
      const live = S.config.paymentsAvailable;
      sp.body.innerHTML = `<p class="small muted" style="margin:0 0 12px">Your default is used for every trip. Change it any time.</p>
        <div role="radiogroup" aria-label="Default payment method">
        ${Object.keys(PAY).filter((k) => (k !== 'business' || payOK(k)) && (!['mtn', 'airtel'].includes(k) || k === momoKey())).map((k) => payOK(k)
          ? `<button class="pay-item ${k === cur ? 'on' : ''}" data-p="${k}" role="radio" aria-checked="${k === cur}">${PAY[k].logo}<span class="grow"><b>${PAY[k].name}</b><span>${sub[k]}</span></span>${k === cur ? '<span class="default-badge">Default</span>' : ''}</button>`
          : `<div class="pay-item off" role="radio" aria-checked="false" aria-disabled="true">${PAY[k].logo}<span class="grow"><b>${PAY[k].name}</b><span>Not available yet</span></span><span class="soon-badge">Coming soon</span></div>`).join('')}
        </div>
        ${live ? `<button class="btn btn-outline btn-block" id="top" style="margin-top:8px">${K.ic('plus', 'sm')} Add money to wallet</button>` : '<p class="small muted" style="margin-top:10px">Mobile Money and card payments are coming soon. For now, pay with cash or with wallet credit from rewards and invites.</p>'}
        ${S.config.paymentsDemo ? '<p class="tiny faint" style="margin-top:10px">Test mode: Mobile Money and card payments complete instantly without charging you.</p>' : ''}`;
      sp.body.querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => {
        try { S.user = (await K.api('/me', { payPref: b.dataset.p }, 'PATCH')).user; } catch (e) { K.toast(e.message); return; }
        if (onPick) { sp.close(); onPick(); } else draw();
      });
      if (live) K.$('#top', sp.page).onclick = () => openWallet(draw);
    };
    draw();
  }

  // Saved places: Home, Work, and up to 10 of the rider's own ("Mum's place", "Gym").
  const ownPlaces = () => Object.entries(S.user.savedPlaces || {}).filter(([k]) => k.startsWith('c'));
  function openPlaces(onBack) {
    const sp = subPage('Saved places', onBack);
    const draw = () => {
      const p = S.user.savedPlaces || {};
      const line = (k, ic, label, place) => `<div class="set-row" style="cursor:default"><span class="row-ic">${K.ic(ic, 'sm')}</span>
        <span class="grow"><b>${K.esc(label)}</b><small>${place ? K.esc(place.address) : 'Not set'}</small></span>
        <button class="btn btn-sm" data-set="${k}" data-label="${K.esc(label)}">${place ? 'Change' : 'Add'}</button>${place ? `<button class="btn btn-sm btn-ghost" data-del="${k}" aria-label="Remove ${K.esc(label)}">${K.ic('x', 'sm')}</button>` : ''}</div>`;
      const own = ownPlaces();
      sp.body.innerHTML = `<div class="set-card list">${line('home', 'home', 'Home', p.home)}${line('work', 'work', 'Work', p.work)}</div>
        <h3 class="set-h">Your places</h3><div class="set-card list">${own.map(([k, v]) => line(k, 'pin', v.label || 'Place', v)).join('')}
          ${own.length < 10 ? `<button class="set-row" id="addPl"><span class="row-ic">${K.ic('plus', 'sm')}</span><span class="grow"><b>Add a place</b><small>Mum’s place, the gym, church…</small></span>${K.ic('chev', 'sm')}</button>` : ''}</div>
        <p class="tiny muted" style="margin:10px 4px 0">Your places show on Home and at the top of search.</p>`;
      sp.body.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => openSearch({ saveAs: b.dataset.set, label: b.dataset.label, onSaved: draw }));
      sp.body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
        try { saveUser((await K.api('/me', { savedPlaces: { [b.dataset.del]: null } }, 'PATCH')).user); draw(); } catch (e) { K.toast(e.message); }
      });
      const add = K.$('#addPl', sp.body);
      if (add) add.onclick = () => {
        const m = K.modal(`<h2>Name this place</h2><form id="lf"><input id="lb" maxlength="30" placeholder="e.g. Mum’s place" aria-label="Place name"><p class="error" id="err"></p><button class="btn btn-primary btn-block btn-lg" type="submit">Next: find it</button></form>`);
        K.$('#lb', m.el).focus();
        K.$('#lf', m.el).onsubmit = (e) => {
          e.preventDefault();
          const label = K.$('#lb', m.el).value.trim();
          if (label.length < 2) { K.$('#err', m.el).textContent = 'Give it a name, e.g. Mum’s place.'; return; }
          m.close(); openSearch({ saveAs: 'c' + Date.now().toString(36).slice(-6), label, onSaved: draw });
        };
      };
    };
    draw();
  }

  // Wallet lock switch. Turning it on registers this phone's fingerprint/face; turning it off needs proof.
  async function bindWalletLock(m, after) {
    const row = K.$('#lockRow', m.el), sub = K.$('#lockSub', m.el), err = K.$('#err', m.el);
    const can = await K.walletLock.supported();
    if (!S.user.walletLock && !can) { row.disabled = true; sub.textContent = 'This phone has no fingerprint or face unlock set up, or this browser can’t use it.'; return; }
    if (!S.user.walletLock) K.walletLock.prepare().catch(() => {});   // ready before the tap (iPhone needs the tap to start Face ID)
    row.onclick = async () => {
      err.textContent = ''; row.disabled = true;
      try {
        if (!S.user.walletLock) {
          await K.walletLock.create();
          S.user.walletLock = true; K.toast('Wallet lock is on');
        } else {
          const pass = await K.walletLock.unlock({ title: 'Turn off wallet lock?' });
          if (!pass) { row.disabled = false; return; }
          await K.api('/wallet/lock/off', { pass });
          S.user.walletLock = false; K.toast('Wallet lock is off');
        }
        m.close(); setTimeout(() => openWallet(after), 280);
      } catch (e) {
        row.disabled = false;
        err.textContent = e.name === 'NotAllowedError' ? 'Not set up. Try again when you’re ready.' : e.name === 'InvalidStateError' ? 'This phone is already set up.' : e.message;
        if (!S.user.walletLock) K.walletLock.prepare().catch(() => {});
      }
    };
  }

  async function openWallet(after) {
    const m = K.modal(`<h2>Flytte Wallet</h2><p class="money">${K.ugx(S.user.walletBalance)}</p>${K.skeleton('list', 3)}`);
    let w; try { w = await K.api('/wallet'); } catch (e) {
      if (!m.el.isConnected) return;
      m.el.innerHTML = `<h2>Flytte Wallet</h2><div class="state-box" role="alert"><b>Couldn’t load your wallet</b><span>${K.esc(e.message)}</span><button class="btn btn-sm" id="again">Try again</button></div>`;
      K.$('#again', m.el).onclick = () => { m.close(); setTimeout(() => openWallet(after), 280); };
      return;
    }
    if (!m.el.isConnected) return;
    const live = S.config.paymentsAvailable;
    m.el.innerHTML = `
      <h2>Flytte Wallet</h2>
      <p class="money">${K.ugx(w.balance)}</p>
      ${live ? `<p class="small muted">Top up once with Mobile Money and pay for trips in one tap.</p>
      <div class="chips">${[10000, 20000, 50000, 100000].map((a) => `<button class="chip" data-amt="${a}">${K.ugx(a)}</button>`).join('')}</div>
      <label for="amt">Amount (UGX)</label><input id="amt" type="number" inputmode="numeric" min="1000" max="2000000" step="500" value="20000">
      <button class="btn btn-primary btn-block btn-lg momo-btn" data-m="momo" style="margin-top:12px"><span class="paylogo momo">${K.momoLogo()}</span><span>Top up with Mobile Money</span></button>
      <p class="tiny muted" style="text-align:center;margin:6px 0 0">MTN MoMo or Airtel Money · you choose next</p>
      ${S.config.cardPayments === false ? '' : `<button class="btn btn-block" data-m="card" style="margin-top:8px">${K.ic('card', 'sm')} Top up with a card</button>`}
      ${S.config.paymentsDemo ? '<p class="tiny faint" style="margin-top:8px">Test mode: top-ups are added instantly without charging you.</p>' : ''}` : '<p class="small muted">Wallet top-ups by Mobile Money and card are coming soon. Credit from Flytte Rewards and invites lands here, and you can use it to pay for trips.</p>'}
      <p class="error" id="err" role="alert"></p>
      <div class="set-card list" style="margin:14px 0 4px"><button class="set-row" id="lockRow" role="switch" aria-checked="${!!S.user.walletLock}"><span class="ic-lock">${K.ic('lock')}</span>
        <span class="grow"><b>Wallet lock</b><small id="lockSub">${S.user.walletLock ? `On · ${K.esc(K.walletLock.bioName())} or a code to pay from your wallet` : `Ask for ${K.esc(K.walletLock.bioName())} before paying from your wallet`}</small></span>
        <span class="set-switch${S.user.walletLock ? ' on' : ''}" aria-hidden="true"><i></i></span></button></div>
      ${w.transactions.length ? `<h3>History</h3>${w.transactions.map((x) => `<div class="tx"><span>${K.esc(x.note || x.type)}<br><span class="tiny faint">${K.when(x.created_at)}</span></span><span class="${x.amount > 0 ? 'pos' : 'neg'}">${x.amount > 0 ? '+' : ''}${K.ugx(x.amount)}</span></div>`).join('')}` : ''}`;
    m.el.querySelectorAll('[data-amt]').forEach((b) => b.onclick = () => { K.$('#amt', m.el).value = b.dataset.amt; });
    bindWalletLock(m, after);
    m.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => {
      const amount = Math.round(+K.$('#amt', m.el).value);
      if (!(amount >= 1000 && amount <= 2000000)) { K.$('#err', m.el).textContent = 'Enter an amount between UGX 1,000 and 2,000,000.'; return; }
      if (b.dataset.m === 'momo') {
        m.close();
        const r = await K.payMomo({ amount, title: 'Top up with Mobile Money', saved: S.user.payPhone, send: (x) => K.api('/wallet/topup', { amount, method: 'momo', ...x }) });
        if (r === 'success') { S.user.walletBalance = (await K.api('/wallet')).balance; K.toast('Wallet topped up'); after && after(); if (S.view === 'choose') render(); }
        K.api('/me').then((x) => { S.user = x.user; }).catch(() => {});
        return;
      }
      b.disabled = true;
      try {
        const out = await K.api('/wallet/topup', { amount, method: b.dataset.m });
        if (out.link || out.pending) {
          m.close();
          if ((await K.awaitPayment(out)) !== 'success') return;
          out.balance = (await K.api('/wallet')).balance;
        }
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
