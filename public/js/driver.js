// Flytte Driver app (mockup screens 14–20):
// Welcome → Become a driver → Verify documents → Home (Go Online) → Ride request → Active trip → Earnings / Profile
(function () {
  const root = document.getElementById('root');
  const S = { user: null, driver: null, online: false, offer: null, trip: null, next: null, ov: null, loc: null, manual: false, earnings: null, rating: 0, config: null, messages: [], unread: 0, chatOpen: false, tab: 'home', hasPhoto: false };
  let map, sock, sheet, me, targetMarker, routeLayer, watchId, offerTimer, waitTimer, wakeLock, lastSent = 0, routedFor = null;

  K.boot(start, () => K.authScreen(root, { role: 'driver', onDone: start }));

  const prettyPhone = (p) => K.prettyPhone(p);
  const photoUrl = () => (S.hasPhoto && S.photoData) || null;   // own photo, loaded privately (works while pending approval)
  const photo = (cls = 'photo') => `<span class="${cls}">${photoUrl() ? `<img src="${photoUrl()}" alt="">` : K.initials(S.user.name)}</span>`;
  const fmtKm = (km) => (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1) + ' km');
  const customer = (t) => (t.service === 'parcel' ? 'sender' : 'customer');
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const DOC_LABEL = { license: 'Driving permit', insurance: 'Insurance sticker' };
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  // ---------- ride alerts (Web Push) ----------
  // With alerts on, a request still rings when the phone is locked or Flytte Driver is in the background.
  // The driver's own choice is remembered on this phone and is never overridden: we only re-link
  // quietly when they chose "on" and the phone lost its link (e.g. after an app update).
  const pushSupported = () => K.push.supported();
  const PREF = 'flytte_driver_alerts';
  const alertPref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };   // 'on' | 'off' | null
  const setAlertPref = (v) => { try { localStorage.setItem(PREF, v); } catch {} };
  let pushBusy = false;
  // Real state of this phone: permission granted and a live subscription.
  async function alertsOnHere() { S.alertsHere = !!(await K.push.current()); return S.alertsHere; }
  const alertsShown = () => (S.alertsHere != null ? S.alertsHere : !!(S.ov && S.ov.push));
  async function enablePush(silent) {
    if (pushBusy) return false;
    pushBusy = true;
    try {
      if (silent && (!pushSupported() || Notification.permission !== 'granted')) return false;
      await K.push.enable();
      setAlertPref('on');
      S.alertsHere = true;
      if (S.ov) S.ov.push = true;
      if (!silent) K.toast('Ride alerts are on. Requests will ring even when your phone is locked.', 5000);
      return true;
    } catch (e) {
      if (!silent) K.toast(e.message, 6000);
      return false;
    } finally { pushBusy = false; }
  }
  async function disablePush() {
    if (pushBusy) return false;
    pushBusy = true;
    try {
      setAlertPref('off');
      const sub = await K.push.current();
      if (sub) { try { await sub.unsubscribe(); } catch {} }
      S.alertsHere = false;
      await K.api('/push/unsubscribe', { all: true });
      if (S.ov) S.ov.push = false;
      K.toast('Ride alerts are off. Keep the app open to get requests.', 4500);
      return true;
    } catch (e) { K.toast(e.message); return false; }
    finally { pushBusy = false; }
  }
  // Keeps the server in step with this phone, without ever undoing the driver's choice.
  async function syncPush() {
    if (!S.ov || pushBusy) return;
    const here = await alertsOnHere();
    if (alertPref() === 'off') { if (S.ov.push) { S.ov.push = false; K.api('/push/unsubscribe', { all: true }).catch(() => {}); } return; }
    if (here && !S.ov.push) { enablePush(true); return; }                 // phone linked, server forgot: re-send
    if (!here && alertPref() === 'on' && pushSupported() && Notification.permission === 'granted') enablePush(true);
    if (!here && S.ov.push && Notification.permission !== 'granted') S.ov.push = false;   // blocked in phone settings
  }

  // ---------- overview: alerts, money owed, documents, heading home, bonuses ----------
  async function loadOverview() {
    try { S.ov = await K.api('/driver/overview'); } catch { return; }
    syncPush();
    const el = K.$('#tools');
    if (el && S.tab === 'home' && !S.trip) { el.innerHTML = toolsHtml(); bindTools(el); }
  }
  setInterval(() => { if (!S.trip && S.tab === 'home' && document.visibilityState === 'visible') loadOverview(); }, 90e3);

  function toolsHtml() {
    const o = S.ov; if (!o) return '';
    const cards = [];
    if (!alertsShown() && S.online && alertPref() !== 'off') {   // not shown once they've chosen "off" in Profile
      const can = pushSupported();
      cards.push(`<div class="tool-card info"><span class="ic">${K.ic('bell')}</span><span class="grow"><b>Get requests when your phone is locked</b>
        <span>${can ? 'Turn on ride alerts so you don’t miss trips when the screen is off.' : isIOS && !K.standalone() ? 'Add Flytte Driver to your Home Screen (Share → Add to Home Screen), then open it from there to turn on ride alerts.' : 'This browser can’t show ride alerts. Keep the app open while online.'}</span></span>
        ${can ? '<button class="btn btn-sm btn-dark" data-t="push">Turn on</button>' : ''}</div>`);
    }
    if (o.owed > 0) {
      cards.push(`<div class="tool-card ${o.cashPaused ? 'bad' : 'warn'}"><span class="ic">${K.ic('wallet')}</span><span class="grow"><b>You owe ${K.ugx(o.owed)} in commission</b>
        <span>${o.cashPaused ? 'Cash trips are paused until you pay. Mobile Money and wallet trips still come to you.' : `From cash trips. Cash trips pause if it reaches ${K.ugx(o.debtLimit)}.`}${S.config.paymentsAvailable ? '' : ' It also clears from your next Mobile Money or wallet trips.'}</span></span>
        ${S.config.paymentsAvailable ? '<button class="btn btn-sm btn-dark" data-t="pay">Pay now</button>' : ''}</div>`);
    }
    for (const d of o.docs || []) {
      const what = DOC_LABEL[d.kind] || d.kind;
      cards.push(`<div class="tool-card ${d.expired ? 'bad' : 'warn'}"><span class="ic">${K.ic('idcard')}</span><span class="grow"><b>${what} ${d.expired ? 'has expired' : d.days === 0 ? 'expires today' : `expires in ${d.days} day${d.days === 1 ? '' : 's'}`}</b>
        <span>${d.expired ? 'Renew it and upload the new one to keep driving.' : 'Renew it and upload the new one before it runs out.'}</span></span><button class="btn btn-sm btn-dark" data-t="docs">Update</button></div>`);
    }
    if (S.online && o.homePerDay > 0) {
      cards.push(o.home
        ? `<div class="tool-card home on"><span class="ic">${K.ic('home')}</span><span class="grow"><b>Heading home</b><span>Only trips towards ${K.esc(String(o.home.address).split(',')[0])}</span></span><button class="btn btn-sm" data-t="homeoff">Turn off</button></div>`
        : `<div class="tool-card home"><span class="ic">${K.ic('home')}</span><span class="grow"><b>Heading home</b><span>${o.homeUsesLeft ? `Only get trips going your way · ${o.homeUsesLeft} left today` : 'Used up for today. It resets at midnight.'}</span></span>${o.homeUsesLeft ? '<button class="btn btn-sm" data-t="home">Set</button>' : ''}</div>`);
    }
    const bonus = (o.bonuses || []).map((b) => `<div class="bonus ${b.paid ? 'paid' : ''}">
        <div class="bonus-top"><b>${K.esc(b.title)}</b><span>${b.paid ? 'Earned ✓' : `+${K.ugx(b.reward)}`}</span></div>
        <div class="bonus-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${b.trips}" aria-valuenow="${b.done}" aria-label="${b.done} of ${b.trips} trips"><i style="width:${Math.round((b.done / b.trips) * 100)}%"></i></div>
        <span class="tiny muted">${b.done} of ${b.trips} trips ${b.period === 'day' ? 'today' : 'this week'}${b.paid ? ' · added to your balance' : ''}</span></div>`).join('');
    return cards.join('') + (bonus ? `<div class="section-label">Bonuses</div>${bonus}` : '');
  }
  function bindTools(el) {
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => ({
      push: async () => { if (await enablePush(false)) loadOverview(); },
      pay: payDebt,
      docs: openDocs,
      home: chooseHome,
      homeoff: async () => { try { await K.api('/driver/home', { on: false }); S.ov.home = null; K.toast('Heading home is off.'); vHome(); } catch (e) { K.toast(e.message); } },
    })[b.dataset.t]());
  }

  async function payDebt() {
    const o = S.ov;
    const m = K.modal(`<h2>Pay commission</h2><p class="muted">You owe ${K.ugx(o.owed)} in commission from cash trips. Pay it by Mobile Money and cash trips ${o.cashPaused ? 'start again straight away' : 'keep coming'}.</p>
      <button class="btn btn-primary btn-block btn-lg" id="paynow">Pay ${K.ugx(o.owed)}</button><button class="btn btn-block" style="margin-top:8px" data-close>Not now</button><p class="error" id="perr"></p>`);
    K.$('#paynow', m.el).onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span>Starting payment…';
      try {
        const r = await K.api('/driver/pay-debt', {});
        if (r.link) { location.href = r.link; return; }
        m.close(); K.toast('Payment received'); await loadEarnings(); loadOverview();
      } catch (e) { b.disabled = false; b.textContent = 'Try again'; K.$('#perr', m.el).textContent = e.message; }
    };
  }

  // Heading home: choose a place; only trips towards it are offered until you arrive or turn it off.
  function chooseHome() {
    const o = S.ov, saved = o.savedHome;
    const m = K.modal(`<h2>Where are you heading?</h2><p class="muted">You’ll only get trips that take you closer. It switches off when you arrive. ${o.homeUsesLeft} left today.</p>
      ${saved ? `<button class="lrow" data-h="saved"><span class="ic">${K.ic('home')}</span><span class="grow"><span class="t">Last place</span><span class="s ellipsis" style="display:block">${K.esc(saved.address)}</span></span></button>` : ''}
      ${K.PLACES.map((p, i) => [p, i]).filter(([p]) => p.icon !== 'plane').slice(0, 6).map(([p, i]) => `<button class="lrow" data-h="${i}"><span class="ic">${K.ic('pin')}</span><span class="grow"><span class="t">${K.esc(p.name)}</span><span class="s">${K.esc(p.address || '')}</span></span></button>`).join('')}
      <button class="lrow" data-h="map"><span class="ic">${K.ic('locate')}</span><span class="grow"><span class="t">Pick on the map</span><span class="s">Tap where you’re heading</span></span></button>`);
    m.el.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => {
      const h = b.dataset.h;
      m.close();
      if (h === 'map') { S.pickHome = true; K.toast('Tap the map where you’re heading.', 5000); return; }
      const p = h === 'saved' ? saved : K.PLACES[+h];
      setHome({ lat: p.lat, lng: p.lng, address: h === 'saved' ? p.address : [p.name, p.address].filter(Boolean).join(', ') });
    });
  }
  async function setHome(place) {
    try {
      const r = await K.api('/driver/home', { on: true, place });
      S.ov.home = r.home; S.ov.homeUsesLeft = r.usesLeft;
      K.toast(`Heading home to ${String(r.home.address).split(',')[0]}. You’ll only get trips going your way.`, 4500);
      vHome();
    } catch (e) { K.toast(e.message, 5000); }
  }

  async function start() {
    root.innerHTML = '<div class="onb"></div>'; // the opening animation covers this moment
    let me0, config, docs;
    const fresh = Promise.all([K.api('/me'), K.api('/config'), K.api('/driver/documents').catch(() => ({ uploaded: {} }))]);
    const cached = K.cache.get('boot');
    if (cached && cached[0].driver && cached[0].driver.status === 'approved') {
      // Open straight away with last-known data; if anything important changed, reload once.
      [me0, config, docs] = cached;
      await null; // let the rest of this file finish loading before we draw
      fresh.then((r) => {
        K.cache.set('boot', r);
        if (!r[0].driver || r[0].driver.status !== 'approved') { location.reload(); return; }
        S.user = r[0].user; S.driver = r[0].driver; S.config = r[1];
      }).catch(() => {});
    } else {
      try { [me0, config, docs] = await fresh; K.cache.set('boot', [me0, config, docs]); }
      catch (e) { K.ready(); root.innerHTML = `<div class="onb" style="text-align:center"><div class="state-box" role="alert" style="margin-top:30vh"><b>Couldn’t open Flytte Driver</b><span>${K.esc(e.message)}</span><button class="btn btn-primary btn-sm" onclick="location.reload()">Try again</button></div></div>`; return; }
    }
    S.user = me0.user; S.driver = me0.driver; S.config = config; S.docs = docs; S.hasPhoto = !!(docs.uploaded || {}).photo;
    if (S.hasPhoto) K.api('/driver/photo').then((r) => { S.photoData = r.url; if (S.tab === 'home') topbar(); }).catch(() => {});
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
    K.draggableSheet(sheet); K.smoothSheet(sheet);
    map = K.map('map');
    map.on('click', (e) => {
      if (S.pickHome) { S.pickHome = false; setHome({ lat: e.latlng.lat, lng: e.latlng.lng, address: 'Pinned place' }); return; }
      if (S.manual) { const had = !!S.loc; setLoc(e.latlng.lat, e.latlng.lng); if (!had && S.tab === 'home' && !S.trip) render(); }
    });
    root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => openTab(b.dataset.tab));

    sock = K.socket(K.token());
    sock.on('connect', async () => {
      if (S.loc) sock.emit('driver:location', S.loc);   // position first: the server needs it to go online
      if (S.online) sock.emit('driver:online', true, (r) => { if (r && !r.ok) { S.online = false; K.toast(r.error); render(); } });
      const a = await K.api('/trips/active').catch(() => null);
      if (a) onTrip(a);
    });
    sock.on('trip:offer', onOffer);
    sock.on('trip:offer_expired', ({ id }) => { if (S.offer && S.offer.id === id) closeOffer(); });
    sock.on('trip:update', onTrip);
    sock.on('toast', (m) => K.toast(m.text));
    sock.on('chat:message', onChat);
    sock.on('driver:forced_offline', () => { S.online = false; render(); K.toast('You were taken offline by Flytte support.'); });
    sock.on('driver:status', () => location.reload());
    sock.on('driver:change', async (c) => {
      await loadChanges();
      if (c.kind === 'photo' && c.status === 'approved') { const r = await K.api('/driver/photo').catch(() => null); if (r) { S.photoData = r.url; S.hasPhoto = !!r.url; topbar(); } }
      if (c.kind === 'vehicle' && c.status === 'approved') { const m0 = await K.api('/me').catch(() => null); if (m0) S.driver = m0.driver; }
      if (S.tab === 'profile') openTab('profile');
    });
    sock.on('driver:home', (h) => { if (S.ov) S.ov.home = null; if (h && h.arrived) K.toast('You’re nearly home. Heading home is off.', 5000); if (!S.trip && S.tab === 'home') vHome(); });
    // Tell the server when the app is on screen, so requests also ring as alerts when it isn't.
    document.addEventListener('visibilitychange', () => { sock.emit('driver:visible', document.visibilityState === 'visible'); if (document.visibilityState === 'visible' && !S.trip) loadOverview(); });
    const pay = new URLSearchParams(location.search).get('payment');
    if (pay) {
      history.replaceState(null, '', location.pathname);
      setTimeout(() => K.toast(pay === 'success' ? 'Commission paid' : pay === 'pending' ? 'Payment is being confirmed. It shows here shortly.' : 'The payment didn’t go through. Try again.', 5000), 800);
    }

    startGps();
    await Promise.all([loadEarnings(), loadOverview(), loadChanges()]);
    const active = await K.api('/trips/active').catch(() => null);
    if (active) onTrip(active); else render();
  }

  // ---------- application status (screen 16 + review) ----------
  async function renderPending() {
    const st = S.driver ? S.driver.status : 'pending';
    let docsKnown = true, info = null;
    if (st === 'pending') {
      try { info = await K.api('/driver/documents'); } catch { docsKnown = false; }
      const missing = info ? Object.keys(info.kinds).filter((k) => !info.uploaded[k]) : [];
      if (missing.length) { K.verifyDocs(root, { onDone: renderPending }); return; }
    }
    const ask = S.config.supportPhone ? 'Call driver support' : 'Contact the Flytte team';
    const msg = {
      pending: ['Application under review', 'Thanks! We’re checking your documents. We’ll show it here as soon as you’re approved, and we may call you to confirm a few details.'],
      suspended: ['Your account is paused', `${ask} to find out why and how to get back on the road.`],
      rejected: ['We couldn’t approve your account', `${ask} for details.`],
    }[st] || ['Account not active', ''];
    root.innerHTML = `<div class="onb onb-enter" style="text-align:center">
      <div class="illu" style="margin-top:30px">${st === 'pending' ? `<span style="width:110px;height:70px;display:block">${K.artFor(null, S.driver.vehicleType)}</span>` : K.ic('shield').replace('class="i "', 'class="i" style="width:60px;height:60px;stroke-width:1.6"')}</div>
      <h1>${msg[0]}</h1><p class="lead" style="max-width:32ch;margin:0 auto 18px">${msg[1]}</p>
      <div style="text-align:left">
        <div class="kv"><span>Vehicle</span><b>${K.esc([S.driver.vehicleColor, S.driver.vehicleMake].filter(Boolean).join(' ') || (S.driver.vehicleType === 'car' ? 'Car' : 'Boda boda'))}</b></div>
        <div class="kv"><span>Number plate</span><b>${K.esc(S.driver.plate)}</b></div>
        ${st === 'pending' ? `<div class="kv"><span>Documents</span>${docsKnown ? '<b style="color:var(--go)">All uploaded ✓</b>' : '<b class="muted">Couldn’t check right now</b>'}</div>` : ''}
        <div class="kv"><span>Status</span><b><span class="badge ${st === 'pending' ? 'warn' : 'bad'}">${st === 'pending' ? 'In review' : st}</span></b></div>
      </div>
      <div class="spacer"></div>
      ${st === 'pending' ? '<button class="btn btn-primary btn-block btn-lg" id="check">Check again</button>' : ''}
      ${S.config.supportPhone ? `<a class="btn btn-outline btn-block btn-lg" style="margin-top:8px" href="tel:${K.esc(S.config.supportPhone.replace(/\s/g, ''))}">Call driver support</a>` : ''}
      <button class="btn btn-link btn-block" id="docs">Update my documents</button>
      <button class="btn btn-link btn-block" id="out" style="color:var(--stop)">Log out</button></div>`;
    const c = K.$('#check'); if (c) c.onclick = () => location.reload();
    K.$('#docs').onclick = () => K.verifyDocs(root, { onDone: renderPending, back: renderPending });
    K.$('#out').onclick = () => K.logout();
  }

  // ---------- GPS ----------
  // Riders are matched to drivers by position, so a driver can only go online from a
  // real GPS fix or a position they set themselves on the map. We never guess one.
  function startGps() {
    if (!navigator.geolocation) return gpsFailed('unsupported');
    S.gpsState = S.loc ? S.gpsState : 'finding';
    watchId = navigator.geolocation.watchPosition(
      (p) => { const had = !!S.loc && !S.manual; S.manual = false; S.gpsState = 'ok'; setLoc(p.coords.latitude, p.coords.longitude, p.coords.heading); if (!had && S.tab === 'home' && !S.trip && !S.offer) render(); },
      (err) => gpsFailed(err && err.code === 1 ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }
  function gpsFailed(why) {
    if (S.loc) return;                        // keep the last real position through a brief GPS hiccup
    const changed = S.gpsState !== why;
    S.gpsState = why; S.manual = true;
    if (changed && S.tab === 'home' && !S.trip && !S.offer) render();
  }
  function locHtml() {
    if (S.loc) return S.manual ? '<p class="tiny faint" style="text-align:center;margin:0 0 8px">Using the position you set on the map. Tap the map to move it.</p>' : '';
    if (!S.gpsState || S.gpsState === 'finding') return '<p class="loc-finding" role="status"><span class="spin" aria-hidden="true"></span>Finding your location…</p>';
    const why = { denied: 'Location access is off for Flytte Driver. Allow location in your browser or phone settings, or tap the map to set where you are.',
      unsupported: 'This browser can’t share your location. Tap the map to set where you are.',
      unavailable: 'Your phone couldn’t find your position. Try again outside, or tap the map to set where you are.' }[S.gpsState];
    return `<div class="loc-card" role="alert"><span class="ic" aria-hidden="true">${K.ic('locate')}</span>
      <span class="grow"><b>Location needed to go online</b><span>${why}</span></span>
      ${S.gpsState !== 'unsupported' ? '<span class="loc-actions"><button class="btn btn-sm" id="retryGps">Try again</button></span>' : ''}</div>`;
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
    if (K.Nav.active()) K.Nav.update(S.loc);
    else if (first && S.trip) syncNav();   // a trip was accepted before the first GPS fix
  }

  // ---------- online ----------
  function setOnline(on) {
    if (!on) { S.online = false; sock.emit('driver:online', false, () => {}); releaseWake(); render(); return; }
    if (!S.loc) { K.toast(S.gpsState === 'finding' ? 'Still finding your location…' : 'Set your position first: turn on location or tap the map.', 4000); return; }
    sock.emit('driver:online', true, (res) => {
      if (!res.ok) { K.toast(res.error); return; }
      S.online = true; keepAwake(); render(); loadOverview();
    });
  }
  async function keepAwake() { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
  function releaseWake() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }
  async function loadChanges() { try { S.changes = await K.api('/driver/changes'); } catch { S.changes = S.changes || {}; } }
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
    K.underTabs(sheet, !inTrip);
    topbar();
    sheet.classList.remove('sheet-enter'); void sheet.offsetWidth; sheet.classList.add('sheet-enter');
    clearInterval(waitTimer);
    if (S.trip) (S.trip.status === 'completed' ? vDone : vTrip)();
    else vHome();
    if (S.offer) vOffer(); else { const r = K.$('#req'); if (r) r.remove(); }
    syncNav();
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
      ${S.online ? '' : locHtml()}
      ${S.online ? `<div class="online-banner"><span class="pulse"></span><span class="grow">You’re online<br><span class="tiny" style="opacity:.7;font-weight:500">Ride requests near you will pop up here</span></span></div>` : ''}
      <div id="demand">${demandHtml()}</div>
      <div id="tools">${toolsHtml()}</div>
      <button class="earn-card" id="earn"><span><small>Today’s earnings</small><b>${K.ugx(e.today.net)}</b></span>${K.ic('chev')}</button>
      <div class="stats3">
        <div><b>${e.today.trips}</b><span>Trips today</span></div>
        <div><b>★ ${S.user.rating || '–'}</b><span>Rating</span></div>
        <div><b>${K.ugx(e.balance).replace('UGX ', '')}</b><span>Balance (UGX)</span></div>
      </div>
      <div class="sheet-foot">${S.online
        ? `<button class="btn btn-go btn-block btn-lg" id="off">${K.ic('power')} Go Offline</button>`
        : `<button class="btn btn-primary btn-block btn-lg" id="on" ${S.loc ? '' : 'aria-disabled="true"'}>${K.ic('power')} Go Online</button>
           <p class="tiny muted" style="text-align:center;margin:6px 0 0">You keep ${100 - S.config.commissionPct}% of every fare.</p>`}</div>`;
    const rg = K.$('#retryGps'); if (rg) rg.onclick = () => { navigator.geolocation && navigator.geolocation.clearWatch(watchId); S.manual = false; S.gpsState = 'finding'; render(); startGps(); };
    K.$('#earn').onclick = () => openTab('earnings');
    const on = K.$('#on'); if (on) on.onclick = () => setOnline(true);
    const off = K.$('#off'); if (off) off.onclick = () => setOnline(false);
    K.installCard(K.$('#installHost'), 'Flytte Driver', '/icons/flytte-driver-192.png');
    bindTools(K.$('#tools'));
  }

  // Screen 18: new ride request
  function onOffer(o) {
    const lineUp = o.queued && S.trip && S.trip.status === 'in_progress' && !S.next;
    if (S.trip && S.trip.status !== 'completed' && !lineUp) return;
    if (S.trip && S.trip.status === 'completed' && !lineUp) S.trip = null;
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
    if (!o.queued) showTarget(o.pickup, 'pickup');
    render();
  }
  function closeOffer() { S.offer = null; clearInterval(offerTimer); clearTarget(); render(); }

  // A small sketch of the trip: you → pickup (dashed) → destination (gold).
  function routeSketch(o) {
    const pts = [S.loc, o.pickup, o.drop && o.drop.lat != null ? o.drop : null].filter(Boolean);
    const W = 300, H = 92, pad = 14;
    const kx = Math.cos((o.pickup.lat * Math.PI) / 180);
    const xs = pts.map((p) => p.lng * kx), ys = pts.map((p) => -p.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1e-4), (H - 2 * pad) / Math.max(maxY - minY, 1e-4));
    const ox = (W - (maxX - minX) * sc) / 2, oy = (H - (maxY - minY) * sc) / 2;
    const P = (p) => [ox + (p.lng * kx - minX) * sc, oy + (-p.lat - minY) * sc].map((v) => v.toFixed(1));
    const [px, py] = P(o.pickup), [dx, dy] = o.drop && o.drop.lat != null ? P(o.drop) : P(o.pickup);
    const you = S.loc ? P(S.loc) : null;
    return `<svg class="route-sketch" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      ${you ? `<line x1="${you[0]}" y1="${you[1]}" x2="${px}" y2="${py}" stroke="#8E8E93" stroke-width="2.5" stroke-dasharray="4 5" stroke-linecap="round"/>` : ''}
      ${o.drop && o.drop.hidden ? '' : `<line x1="${px}" y1="${py}" x2="${dx}" y2="${dy}" stroke="#F2B705" stroke-width="4" stroke-linecap="round"/>`}
      ${you ? `<circle cx="${you[0]}" cy="${you[1]}" r="6" fill="#0A84FF" stroke="#fff" stroke-width="2.5"/>` : ''}
      <circle cx="${px}" cy="${py}" r="6.5" fill="#fff" stroke="#141414" stroke-width="3"/>
      ${o.drop && o.drop.hidden ? '' : `<rect x="${(dx - 6).toFixed(1)}" y="${(dy - 6).toFixed(1)}" width="12" height="12" rx="2" fill="#141414"/>`}</svg>`;
  }

  function vOffer() {
    const o = S.offer;
    const pickMin = Math.max(1, Math.round((o.pickupKm * 1.3 / 20) * 60));
    const totalMin = pickMin + Math.round(o.durationMin);
    const perKm = Math.round(o.earning / Math.max(0.5, o.pickupKm + o.distanceKm) / 10) * 10;
    let el = K.$('#req');
    if (!el) { el = document.createElement('div'); el.id = 'req'; el.className = 'req'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-label', 'New ride request'); root.querySelector('#app').appendChild(el); }
    el.innerHTML = `
      <svg class="timer" viewBox="0 0 54 54" aria-label="Seconds left"><circle class="bg" cx="27" cy="27" r="24"/><circle class="fg" id="ringFg" cx="27" cy="27" r="24" stroke-dasharray="151" style="stroke-dashoffset:${151 * (1 - o.left / o.expiresIn)}"/>
        <text id="ringTx" x="27" y="33" text-anchor="middle" font-weight="800" font-size="17" fill="#fff">${o.left}</text></svg>
      <h2>New ${o.service === 'parcel' ? 'delivery' : o.service === 'errand' ? 'errand' : 'ride'} request</h2>
      <div class="req-card">
        ${o.queued ? `<div class="next-note">${K.ic('clock', 'sm')} Next trip · starts after you drop off your current ${customer(S.trip || o)}</div>` : ''}
        ${routeSketch(o)}
        <div class="away">${K.ic('nav')}<span class="grow">${pickMin} min to ${o.service === 'errand' ? 'the shop' : 'pickup'}</span><span class="small muted" style="font-weight:600">${o.pickupKm} km</span></div>
        <div class="row" style="margin:6px 0 2px"><span class="avatar" style="width:38px;height:38px;font-size:.8rem">${K.initials(o.rider.name)}</span>
          <span class="grow"><b>${K.esc(K.first(o.rider.name))}</b><br><span class="rating"><span class="star-ic">★</span><b>${o.rider.rating || 'New'}</b></span></span>
          <span class="badge" style="background:var(--ink);color:#fff">${K.esc(K.SERVICE_LABEL[o.service])}</span></div>
        <div class="stops">
          <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>${o.service === 'errand' ? 'Buy at' : 'Pickup'}</small><b class="ellipsis">${K.esc(o.pickup.address)}</b></span></div>
          <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>Destination${(o.stops || []).length ? ` · ${o.stops.length} stop${o.stops.length > 1 ? 's' : ''} on the way` : ''} · ${o.distanceKm.toFixed(1)} km, ${Math.round(o.durationMin)} min</small><b class="ellipsis">${o.drop.hidden ? 'Shown after you accept' : K.esc(o.drop.address)}</b></span></div>
        </div>
        ${o.notes ? `<p class="note-line">${K.ic('msg', 'sm')}<span><small>Pickup note</small>${K.esc(o.notes)}</span></p>` : ''}
        ${o.errand ? `<div class="errand-offer">${K.ic('receipt', 'sm')}<span><b>Buy ${o.errand.items.length} item${o.errand.items.length > 1 ? 's' : ''} · budget ${K.ugx(o.errand.budget)}</b><small>You pay at the shop and get it back in full on delivery</small></span></div>` : ''}
        <div class="est"><div class="est-row"><span><small>You earn</small><b>${K.ugx(o.earning)}</b></span>
          <span class="est-side"><b>${totalMin} min</b><small>in total</small><b>${K.ugx(perKm)}</b><small>per km</small></span></div>
          <span class="small muted" style="display:block">${o.paymentMethod === 'cash' && o.discount ? `Collect ${K.ugx(o.payable)}${o.errand ? ' + the items' : ''} cash · Flytte pays the ${K.ugx(o.discount)} discount` : `Fare ${K.ugx(o.fare)} · ${o.paymentMethod === 'cash' ? 'Cash' : K.PAY_LABEL[o.paymentMethod]}`}</span>
          ${o.bookedBy ? `<span class="small muted" style="display:block">Booked by ${K.esc(K.first(o.bookedBy))} for ${K.esc(o.rider.name)}</span>` : ''}</div>
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
    if (t.next) { S.next = t.next; delete t.next; }
    // The lined-up next trip lives beside the current one until the current trip is finished.
    const isNext = S.next && t.id === S.next.id;
    if (isNext && (t.status === 'cancelled' || t.status === 'requested')) { S.next = null; K.toast(`Your next ${customer(t)} cancelled.`); render(); return; }
    if (isNext || (S.trip && S.trip.status === 'in_progress' && t.id !== S.trip.id && t.status === 'accepted')) {
      const fresh = !S.next || S.next.id !== t.id;
      S.next = t; if (fresh) { if (S.offer && S.offer.id === t.id) { S.offer = null; clearInterval(offerTimer); } K.toast('Next trip lined up. Finish this one first.', 4000); }
      render(); return;
    }
    if (t.status === 'cancelled' || t.status === 'requested') {
      if (S.trip && S.trip.id === t.id) {
        if (t.cancelReason === 'no_show') K.toast(t.noShowFee ? `Marked as a no-show. ${K.ugx(t.noShowFee)} was added to your balance.` : 'Marked as a no-show. You’re free for the next trip.', 5000);
        else if (t.cancelledBy === 'rider') K.toast(t.cancelFee ? `The ${customer(t)} cancelled. ${K.ugx(t.cancelFee)} cancellation fee was added to your balance.` : `The ${customer(t)} cancelled this trip.`, t.cancelFee ? 5000 : undefined);
        S.trip = S.next || null; S.next = null; routedFor = null; clearTarget(); render();
        if (!S.trip) loadOverview();
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

  // Where the driver is heading now: the pickup, then each stop not yet done, then the destination.
  const nextStop = (t) => (t.stops || []).findIndex((x) => !x.doneAt);
  function legTarget(t) {
    if (t.status !== 'in_progress') return t.pickup;
    const i = nextStop(t);
    return i >= 0 ? { ...t.stops[i], stopNo: i + 1 } : t.drop;
  }
  const stopRowsD = (t) => (t.stops || []).map((x, i) => `<div class="stop${x.doneAt ? ' done' : ''}"><span class="s-ic"><span class="dot-stop">${x.doneAt ? '✓' : i + 1}</span></span><span><small>Stop ${i + 1}${x.doneAt ? ' · done' : ''}</small><b class="ellipsis">${K.esc(x.address)}</b></span></div>`).join('');

  // The shopping list, ticked off on this phone as items go into the bag.
  const ticked = new Set();
  function errandCard(t) {
    const e = t.errand;
    setTimeout(() => document.querySelectorAll('[data-tick]').forEach((b) => b.onclick = () => {
      const k = t.id + ':' + b.dataset.tick; ticked.has(k) ? ticked.delete(k) : ticked.add(k);
      b.classList.toggle('on', ticked.has(k)); b.setAttribute('aria-checked', ticked.has(k));
    }));
    return `<div class="errand-card"><div class="row" style="justify-content:space-between;align-items:baseline"><b>Shopping list</b><span class="small muted">${e.substitutes ? 'Substitutes OK' : 'No substitutes'}</span></div>
      <div class="errand-items">${e.items.map((x, i) => `<button class="errand-item${ticked.has(t.id + ':' + i) ? ' on' : ''}" data-tick="${i}" role="checkbox" aria-checked="${ticked.has(t.id + ':' + i)}"><span class="tickbox">${K.ic('check', 'sm')}</span><span>${K.esc(x)}</span></button>`).join('')}</div>
      <p class="small" style="margin:8px 0 0">${e.goodsTotal != null ? `Spent <b>${K.ugx(e.goodsTotal)}</b> of ${K.ugx(e.budget)}` : `Budget <b>${K.ugx(e.budget)}</b> · don’t go over it; message the customer if prices are higher`}</p></div>`;
  }
  // Receipt photos are shrunk on the phone so they upload quickly on mobile data.
  function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  function navLink(p) { return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=${S.driver.vehicleType === 'boda' ? 'two-wheeler' : 'driving'}`; }

  function updateBanner() {
    const nb = K.$('#banner'), t = S.trip;
    if (!nb || !t || t.status === 'completed') return;
    const target = legTarget(t);
    const km = S.loc ? K.km(S.loc, target) : null;
    const errand = t.service === 'errand';
    const head = target.stopNo ? `Stop ${target.stopNo}` : t.status === 'in_progress' ? (['parcel', 'errand'].includes(t.service) ? 'Delivering' : 'On trip') : t.status === 'arrived' ? (errand ? 'At the shop' : 'Waiting at pickup') : (errand ? 'Head to the shop' : 'Head to pickup');
    nb.innerHTML = `<span class="round" aria-hidden="true">${K.ic('nav')}</span>
      <span class="grow"><b>${head}${km != null && t.status !== 'arrived' ? ` · ${fmtKm(km)}` : ''}</b><small class="ellipsis" style="display:block">${K.esc(String(target.address).split(',')[0])}${km != null && t.status !== 'arrived' ? ` · ${K.etaMin(S.loc, target)} min` : ''}</small></span>
      <button class="btn btn-primary btn-sm" data-nav>Navigate</button>`;
    nb.querySelector('[data-nav]').onclick = startNav;
  }

  // In-app turn-by-turn (nav.js). S.navOn stays set across pickup so directions to the drop-off
  // start by themselves once the trip begins; Exit turns it off.
  function startNav() {
    const t = S.trip;
    if (!t || t.status === 'completed') return;
    if (!S.loc) { K.toast('Waiting for your location…'); return; }
    const toDrop = t.status === 'in_progress';
    if (t.status === 'arrived') return;
    const target = legTarget(t);
    S.navOn = true;
    if (routeLayer) { routeLayer.remove(); routeLayer = null; }
    K.Nav.start({
      map, loc: S.loc, target, externalUrl: navLink(target),
      arriveLabel: target.stopNo ? `You’ve reached stop ${target.stopNo}` : toDrop ? (t.service === 'parcel' ? 'You’ve reached the drop-off' : 'You’ve reached the destination') : 'You’ve reached the pickup',
      onArrive: () => { S.navSkip = legKey(t); K.Nav.stop(true); routedFor = null; render(); },
      onExit: () => { S.navOn = false; S.navSkip = legKey(t); routedFor = null; render(); },
    });
  }
  function syncNav() {
    const t = S.trip;
    if (!t || t.status === 'completed' || t.status === 'arrived') { if (K.Nav.active()) { K.Nav.stop(true); routedFor = null; } if (!t || t.status === 'completed') S.navOn = false; return; }
    const target = legTarget(t);
    const cur = K.Nav.target();
    if (cur && (cur.lat !== target.lat || cur.lng !== target.lng)) { K.Nav.stop(true); routedFor = null; }
    if (K.Nav.active() || !S.loc || S.offer) return;
    // Directions open by themselves on accepting and when the trip starts (unless the driver
    // switched that off, or closed navigation for this leg).
    const leg = legKey(t);
    if ((S.navOn && t.status === 'in_progress') || (autoNav() && S.navSkip !== leg && ['accepted', 'in_progress'].includes(t.status))) startNav();
  }
  const legKey = (t) => `${t.id}:${t.status}:${nextStop(t)}`;   // each stop is its own leg
  const autoNav = () => { try { return localStorage.getItem('flytte_auto_nav') !== 'off'; } catch { return true; } };

  // Screen 19: active trip
  function vTrip() {
    clearInterval(waitTimer);
    const t = S.trip, r = t.rider;
    const nx = S.next;
    const nextChip = nx ? `<div class="next-chip">${K.ic('clock', 'sm')}<span class="grow">Next: pickup at <b>${K.esc(String(nx.pickup.address).split(',')[0])}</b> after this trip</span></div>` : '';
    const toPickup = t.status !== 'in_progress';
    const lt = legTarget(t);
    showTarget(lt, toPickup ? 'pickup' : 'drop');
    const parcel = t.parcel ? `<div class="card small" style="margin:10px 0">${K.ic('gift', 'sm')} <b>${K.esc(t.parcel.item)}</b><br>Deliver to ${K.esc(t.parcel.recipientName)} · <a href="tel:${K.esc(t.parcel.recipientPhone)}"><b>${K.esc(prettyPhone(t.parcel.recipientPhone))}</b></a></div>` : '';
    sheet.innerHTML = `
      <div class="grabber"></div>
      <div class="driver-card"><span class="photo">${K.initials(r.name)}</span>
        <span class="grow"><b style="display:block">${K.esc(r.name)}</b><span class="rating"><span class="star-ic">★</span><b>${r.rating || 'New'}</b>${r.trips ? ` (${r.trips} trips)` : ''}</span>
          <span class="small muted" style="display:block">${K.esc(K.SERVICE_LABEL[t.service])} · ${t.paymentMethod === 'cash' ? 'Cash' : K.PAY_LABEL[t.paymentMethod]}${t.bookedBy ? ` · booked by ${K.esc(K.first(t.bookedBy))}` : ''}</span></span>
        ${r.phone ? `<a class="round go" href="tel:${K.esc(r.phone)}" aria-label="Call ${customer(t)}">${K.ic('phone')}</a>` : ''}
        <button class="round brand" id="chatBtn" aria-label="Message ${customer(t)}">${K.ic('msg')}${S.unread ? '<span class="dot"></span>' : ''}</button></div>
      ${nextChip}
      ${parcel}
      ${t.errand ? errandCard(t) : ''}
      ${t.notes && t.status !== 'in_progress' ? `<p class="note-line">${K.ic('msg', 'sm')}<span><small>Pickup note from ${K.esc(K.first(r.name))}</small>${K.esc(t.notes)}</span></p>` : ''}
      ${t.status === 'arrived' && t.service !== 'errand' ? '<div class="wait-box" id="wait" role="timer" aria-live="off"></div>' : ''}
      <div class="stops">
        <div class="stop"><span class="s-ic"><span class="dot-pick"></span></span><span><small>${t.service === 'errand' ? 'Shop' : 'Pickup'}</small><b class="ellipsis">${K.esc(t.pickup.address)}</b></span></div>
        ${stopRowsD(t)}
        <div class="stop"><span class="s-ic"><span class="dot-drop"></span></span><span><small>Destination</small><b class="ellipsis">${K.esc(t.drop.address)}</b></span></div>
      </div>
      <div class="fare-row"><span class="muted">${t.paymentMethod === 'cash' ? 'Collect in cash' : 'Fare'}</span><b>${K.ugx(t.paymentMethod === 'cash' ? t.payable : t.fare)}</b></div>
      ${t.discount ? `<p class="tiny muted" style="margin:6px 0 0">${t.paymentMethod === 'cash' ? `The ${customer(t)} has a ${K.ugx(t.discount)} discount. Flytte adds it to your balance, so you still earn on the full ${K.ugx(t.fare)}.` : `Promo applied for the ${customer(t)}. You still earn on the full ${K.ugx(t.fare)}.`}</p>` : ''}
      ${t.goodsTotal ? `<p class="tiny muted" style="margin:6px 0 0">Delivery ${K.ugx(t.payable - t.goodsTotal)} + items ${K.ugx(t.goodsTotal)}${t.paymentMethod === 'cash' ? '' : '. The items come back to your balance in full when the customer pays.'}</p>` : ''}
      ${t.status === 'in_progress' && t.needsDropCode ? `<label for="dcode" style="text-align:center">Ask the ${t.service === 'errand' ? 'customer' : 'recipient'} for the delivery code</label>
        <input id="dcode" class="pin-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····" aria-label="Delivery code">` : ''}
      ${t.status === 'arrived' && t.service === 'errand' && t.errand.goodsTotal == null ? `
        <label for="gtotal">What did you spend on the items? (UGX)</label>
        <input id="gtotal" type="number" inputmode="numeric" min="1" max="${t.errand.budget}" placeholder="Up to ${t.errand.budget.toLocaleString()}">
        <input type="file" id="gphoto" accept="image/*" capture="environment" hidden>
        <button class="btn btn-block" id="gphotoBtn" style="margin-top:8px">${K.ic('camera', 'sm')} Add a photo of the receipt</button>` : ''}
      ${t.status === 'arrived' && t.service !== 'errand' ? `
        <label for="pin" style="text-align:center">Ask the ${customer(t)} for their 4-digit PIN</label>
        <input id="pin" class="pin-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····" aria-label="Trip PIN">` : ''}
      <div class="sheet-foot"><p class="error" id="err" style="margin:0 0 6px;min-height:0"></p>
      <div id="action"></div>
      <div class="row" style="margin-top:6px">
        <button class="btn btn-ghost btn-sm fill" id="sos">${K.ic('shield', 'sm')} Safety</button>
        ${toPickup ? '<button class="btn btn-ghost btn-sm fill" id="cancel" style="color:var(--stop)">Cancel trip</button>' : ''}
      </div></div>`;
    const action = K.$('#action');
    if (t.status === 'accepted') K.slider(action, { label: t.service === 'errand' ? 'Slide when you reach the shop' : 'Slide when you arrive', onDone: () => step('arrived') });
    else if (t.status === 'arrived' && t.service === 'errand') {
      // At the shop: record what was spent (and the receipt), then head to the customer. No PIN: nobody waits here.
      let photo = null;
      action.innerHTML = `<button class="btn btn-primary btn-block btn-lg" id="start">${t.errand.goodsTotal == null ? 'Done shopping · deliver' : 'Start delivery'}</button>`;
      const pf = K.$('#gphoto'), pb = K.$('#gphotoBtn');
      if (pb) pb.onclick = () => pf.click();
      if (pf) pf.onchange = async () => { const f = pf.files && pf.files[0]; if (!f) return; try { photo = await shrinkImage(f, 1280); pb.innerHTML = `${K.ic('check', 'sm')} Receipt photo added`; } catch { K.toast('Couldn’t use that photo. Try again.'); } };
      K.$('#start').onclick = async (e) => {
        const btn = e.currentTarget; K.$('#err').textContent = '';
        if (t.errand.goodsTotal == null) {
          const total = Math.round(Number(K.$('#gtotal').value));
          if (!(total > 0)) { K.$('#err').textContent = 'Enter what you spent on the items.'; K.$('#gtotal').focus(); return; }
          btn.disabled = true;
          try { await K.api(`/trips/${t.id}/goods`, { total, photo: photo || undefined }); }
          catch (x) { K.$('#err').textContent = x.message; btn.disabled = false; return; }
        }
        btn.disabled = true; await step('start'); btn.disabled = false;
      };
    }
    else if (t.status === 'arrived') {
      action.innerHTML = '<button class="btn btn-primary btn-block btn-lg" id="start">Start trip</button>';
      K.$('#start').onclick = () => step('start', { pin: K.$('#pin').value });
      const pin = K.$('#pin'); pin.oninput = () => { pin.value = pin.value.replace(/\D/g, ''); if (pin.value.length === 4) K.$('#start').focus(); };
    } else if (t.status === 'in_progress' && lt.stopNo) {
      action.innerHTML = `<button class="btn btn-primary btn-block btn-lg" id="stopDone">Done at stop ${lt.stopNo} · continue</button>`;
      K.$('#stopDone').onclick = async (e) => { e.target.disabled = true; await step('stop'); e.target.disabled = false; };
    } else if (t.status === 'in_progress') K.slider(action, { label: t.service === 'parcel' ? 'Slide to complete delivery' : 'Slide to complete trip', cls: 'dark', onDone: () => {
      const dc = K.$('#dcode');
      if (dc && dc.value.trim().length !== 4) { K.$('#err').textContent = 'Enter the 4-digit delivery code from the recipient.'; const a = K.$('#action'); a.reset && a.reset(); dc.focus(); return; }
      step('complete', dc ? { code: dc.value.trim() } : {});
    } });
    K.$('#chatBtn').onclick = openChat;
    K.$('#sos').onclick = safety;
    if (t.status === 'arrived' && t.service !== 'errand') {
      // Free waiting time, then the driver may leave and mark a no-show.
      const free = ((S.config.drivers && S.config.drivers.freeWaitMin) ?? 5) * 60;
      const fee = (S.config.drivers && S.config.drivers.noShowFee) || 0;
      const since = t.arrivedAt ? Date.parse(t.arrivedAt) : Date.now();
      const tick = () => {
        const box = K.$('#wait'); if (!box) return clearInterval(waitTimer);
        const sec = Math.max(0, (Date.now() - since) / 1000);
        const over = sec >= free;
        const was = box.dataset.over === '1';
        if (was && over) { const tt = K.$('#waitT', box); if (tt) tt.textContent = mmss(sec); return; }
        box.dataset.over = over ? '1' : '0';
        box.classList.toggle('over', over);
        box.innerHTML = over
          ? `<span class="grow"><b>Waited <span id="waitT">${mmss(sec)}</span></b><span>The free waiting time is over.${fee ? ` If the ${customer(t)} doesn’t come, you get ${K.ugx(fee)} when their wallet covers it.` : ''}</span></span><button class="btn btn-sm btn-danger-soft" id="noshow">${customer(t) === 'sender' ? 'Sender' : 'Customer'} didn’t come</button>`
          : `<span class="grow"><b>Waiting <span id="waitT">${mmss(sec)}</span></b><span>Free waiting ends at ${mmss(free)}</span></span><span class="wait-ring" style="--p:${Math.min(1, sec / Math.max(1, free))}"></span>`;
        if (!over) { const ring = box.querySelector('.wait-ring'); if (ring) ring.style.setProperty('--p', Math.min(1, sec / Math.max(1, free))); }
        const ns = K.$('#noshow', box); if (ns) ns.onclick = noShow;
      };
      tick(); waitTimer = setInterval(() => { const box = K.$('#wait'); if (!box) return clearInterval(waitTimer); if (box.dataset.over !== '1') { box.dataset.over = ''; } tick(); }, 1000);
    }
    const c = K.$('#cancel'); if (c) c.onclick = cancelTrip;
  }

  function noShow() {
    const t = S.trip, fee = (S.config.drivers && S.config.drivers.noShowFee) || 0;
    const m = K.modal(`<h2>Leave as a no-show?</h2><p class="muted">Only do this if you’ve tried calling or messaging the ${customer(t)}. The trip is cancelled${fee ? ` and you get ${K.ugx(fee)} if their wallet covers it` : ''}. It doesn’t count against your cancellation rate.</p>
      <button class="btn btn-danger btn-block btn-lg" id="ns">Cancel as no-show</button><button class="btn btn-block" style="margin-top:8px" data-close>Keep waiting</button><p class="error" id="nerr"></p>`);
    K.$('#ns', m.el).onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      try { await K.api(`/trips/${t.id}/noshow`, {}); m.close(); }
      catch (e) { ev.currentTarget.disabled = false; K.$('#nerr', m.el).textContent = e.message; }
    };
  }

  async function step(action, body) {
    K.$('#err').textContent = '';
    try { await K.api(`/trips/${S.trip.id}/${action}`, body || {}); }
    catch (e) { K.$('#err').textContent = e.message; const s = K.$('#action'); if (s && s.reset) s.reset(); }
  }

  function cancelTrip() {
    const m = K.modal(`<h2>Cancel this trip?</h2><p class="muted">The ${customer(S.trip)} will be matched with someone else. Cancellations count towards your cancellation rate, shown on your profile.</p>
      <button class="btn btn-danger btn-block btn-lg" id="yes">Cancel trip</button><button class="btn btn-block" style="margin-top:8px" data-close>Keep trip</button>`);
    K.$('#yes', m.el).onclick = async () => {
      try { await K.api(`/trips/${S.trip.id}/cancel`, {}); m.close(); S.trip = S.next || null; S.next = null; routedFor = null; clearTarget(); render(); } catch (e) { K.toast(e.message); }
    };
  }

  function safety() {
    const m = K.modal(`<h2>Safety</h2><p class="muted">An emergency alert sends your location and this trip to the Flytte team. If you are in danger, call the police.</p>
      <button class="btn btn-danger btn-block btn-lg" id="sos">${K.ic('sos')} Send emergency alert</button>
      <a class="btn btn-block" href="tel:999" style="margin-top:8px">Call Police (999)</a>
      ${S.trip.shareToken ? `<button class="btn btn-block" id="shareTrip" style="margin-top:8px">${K.ic('share', 'sm')} Share trip with family</button>` : ''}
      ${S.config.supportPhone ? `<a class="btn btn-block" href="tel:${K.esc(S.config.supportPhone.replace(/\s/g, ''))}" style="margin-top:8px">Call driver support</a>` : ''}`);
    const sh = K.$('#shareTrip', m.el);
    if (sh) sh.onclick = async () => {
      const url = `${location.origin}/t/${S.trip.shareToken}`;
      const text = `I’m driving a Flytte trip. Follow it live: ${url}`;
      try { if (navigator.share) await navigator.share({ title: 'My Flytte trip', text, url }); else { await navigator.clipboard.writeText(url); K.toast('Trip link copied. Send it to someone you trust.'); } }
      catch {}
    };
    K.$('#sos', m.el).onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Sending alert…';
      try {
        await K.api(`/trips/${S.trip.id}/sos`, S.loc || {});
        m.close(); K.toast('Alert sent to the Flytte team with your location.', 6000);
      } catch (e) {
        b.disabled = false; b.textContent = 'Try sending the alert again';
        const p = m.el.querySelector('.muted'); p.setAttribute('role', 'alert'); p.textContent = `The alert didn’t send: ${e.message} Call the police directly if you are in danger.`;
      }
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
            ? `<span class="small muted">Collect cash</span><div class="amt">${K.ugx(t.payable)}</div><span class="small muted">You earned ${K.ugx(t.earning)}${t.discount ? ` (includes ${K.ugx(t.discount)} discount paid by Flytte)` : ''}</span>`
            : `<span class="small muted">You earned</span><div class="amt">${K.ugx(t.earning)}</div><span class="small muted">${t.paymentStatus === 'paid' ? 'Added to your balance' : 'Added once the ' + customer(t) + ' pays by ' + K.PAY_LABEL[t.paymentMethod]}</span>`}
          ${t.tip ? `<span class="points-pill">💛 Tip ${K.ugx(t.tip)}${t.tipMethod === 'cash' ? ' in cash' : ''}</span>` : ''}
        </div>
        ${!t.driverRated ? `<h3>Rate ${K.esc(K.first(t.rider.name))}</h3>
          <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-n="${n}" aria-label="${n} stars" class="${n <= S.rating ? 'on' : ''}">${K.starSvg}</button>`).join('')}</div>` : ''}
      </div>
      <div class="sheet-foot"><button class="btn btn-primary btn-block btn-lg" id="next">${S.next ? 'Go to next pickup' : S.online ? 'Find next trip' : 'Done'}</button></div>`;
    sheet.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => {
      S.rating = +b.dataset.n;
      sheet.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', +x.dataset.n <= S.rating));
    });
    K.$('#next').onclick = async () => {
      if (S.rating && !t.driverRated) await K.api(`/trips/${t.id}/rate`, { stars: S.rating }).catch((e) => K.toast(`Rating not saved: ${e.message}`, 4000));
      S.rating = 0; routedFor = null;
      if (S.next) { S.trip = S.next; S.next = null; S.messages = []; S.unread = 0; K.api(`/trips/${S.trip.id}/messages`).then((m) => { S.messages = m; }).catch(() => {}); }
      else S.trip = null;
      render(); if (!S.trip) loadOverview();
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
    if (routedFor !== key || K.Nav.active()) return;   // navigation draws its own line and follows the driver
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
    page.className = 'page push-in'; page.style.zIndex = 870;
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
    K.$('[data-x]', page).onclick = () => { S.chatOpen = false; K.pop(page, () => { if (S.trip && S.trip.status !== 'completed') vTrip(); }); };
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
    const old = [...document.querySelectorAll('.page[data-tabpage]')];
    if (tab === 'home') { old.forEach((p) => p.remove()); if (!S.trip && sheet) vHome(); return; }
    if (old.some((p) => p.dataset.tabpage === tab)) { old.filter((p) => p.dataset.tabpage !== tab).forEach((p) => p.remove()); return; }
    const page = document.createElement('div');
    page.className = 'page tab-swap grouped'; page.dataset.tabpage = tab;
    page.innerHTML = `<div class="page-inner">${K.skeleton(tab === 'earnings' ? 'earnings' : 'title-list')}</div>`;
    root.querySelector('#app').insertBefore(page, K.$('#tabs'));
    (tab === 'earnings' ? drawEarnings : drawProfile)(page.firstElementChild);
    old.forEach((p) => p.remove());                 // only after the new page is in place: no gap to see through
  }

  // Earnings were loaded when the app opened: show them instantly, refresh in the background.
  async function drawEarnings(el, fresh = false) {
    if (!S.earnings || fresh) await loadEarnings();
    else loadEarnings().then(() => { if (el.isConnected && !el._refreshed) { el._refreshed = true; drawEarnings(el, false); } });
    const e = S.earnings;
    if (!e) { K.failed(el, 'Couldn’t load your earnings. Check your connection.', () => drawEarnings(el, true)); return; }
    const max = Math.max(1, ...e.days.map((d) => d.net));
    const today = e.days[e.days.length - 1].day;
    const dayName = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-UG', { weekday: 'short' }).slice(0, 3);
    el.innerHTML = `
      <div class="page-title">Earnings</div>
      <div class="seg-tabs"><button aria-pressed="false" data-r="today">Today</button><button aria-pressed="true" data-r="week">This week</button></div>
      <div id="range"></div>
      <div class="chart" aria-label="Earnings for the last 7 days">${e.days.map((d) => `<div class="b ${d.net ? '' : 'zero'} ${d.day === today ? 'today' : ''}" title="${dayName(d.day)}: ${K.ugx(d.net)}"><i style="height:${Math.max(2, (d.net / max) * 100)}%"></i><span>${dayName(d.day)}</span></div>`).join('')}</div>
      ${weekSummary(e)}
      <div class="kv"><span>Completed trips</span><b>${e.week.trips}</b></div>
      <div class="kv"><span>Cash collected</span><b>${K.ugx(e.cashWeek)}</b></div>
      <div class="kv"><span>Flytte commission</span><b>−${K.ugx(e.commissionWeek)}</b></div>
      <div class="card" style="margin-top:16px"><span class="small muted">Balance you can cash out</span><div class="money">${K.ugx(e.balance)}</div>
        ${e.balance < 0 ? `<p class="small" style="margin:6px 0 0">Negative because commission on cash trips is taken here. It clears from your next Mobile Money or wallet trips${S.config.paymentsAvailable ? ', or pay it now' : ''}.</p>${S.config.paymentsAvailable ? '<button class="btn btn-dark btn-sm" id="payd" style="margin-top:8px">Pay commission by Mobile Money</button>' : ''}` : ''}
        <label for="wamt">Cash out to ${K.esc(prettyPhone(e.momoNumber))}</label>
        <div class="row"><input id="wamt" class="fill" type="number" inputmode="numeric" min="${S.config.minWithdrawal}" value="${Math.max(0, e.balance)}"><button class="btn btn-primary" id="wd">Cash out</button></div>
        <p class="error" id="err"></p></div>
      ${e.withdrawals.length ? `<h3 style="margin-top:18px">Cash outs</h3>${e.withdrawals.map((w) => `<div class="tx"><span>${K.when(w.created_at)}</span><span>${K.ugx(w.amount)} <span class="badge ${w.status === 'paid' ? 'ok' : w.status === 'rejected' ? 'bad' : 'warn'}">${w.status}</span></span></div>`).join('')}` : ''}
      <h3 style="margin-top:18px">Trips</h3>
      <div class="seg-tabs" id="tr"><button aria-pressed="true" data-d="1">Today</button><button aria-pressed="false" data-d="7">7 days</button><button aria-pressed="false" data-d="30">30 days</button></div>
      <div id="tlist">${K.skeleton('list', 2)}</div>
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
    const pd = K.$('#payd', el); if (pd) pd.onclick = async () => { if (!S.ov) await loadOverview(); if (S.ov) payDebt(); };
    el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { el.querySelectorAll('[data-d]').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawTrips(K.$('#tlist', el), +b.dataset.d); });
    drawTrips(K.$('#tlist', el), 1);
  }

  // This week against last week, average per trip, and when riders book most.
  function weekSummary(e) {
    const sm = e.summary; if (!sm) return '';
    const now = e.week.net, before = sm.prevWeek.net;
    const diff = before ? Math.round(((now - before) / before) * 100) : null;
    const trend = diff == null ? (now ? 'Your first week of earnings' : 'No trips yet this week')
      : diff === 0 ? 'Same as last week' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}% vs last week (${K.ugx(before)})`;
    const hr = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
    return `<div class="week-sum">
      <div class="ws-row"><span><small>Compared with last week</small><em class="${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${trend}</em></span>
        <span class="ws-side"><small>Average per trip</small><b>${sm.avgTrip ? K.ugx(sm.avgTrip) : '—'}</b></span></div>
      ${sm.busyHours.length ? `<p class="ws-tip">${K.ic('clock', 'sm')}<span>Riders book most around <b>${sm.busyHours.map((x) => hr(x.hour)).join(', ')}</b>. Being online then usually means shorter waits between trips.</span></p>` : ''}
    </div>`;
  }

  // Trip-by-trip breakdown, plus a statement the driver can save or print.
  const PERIOD = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days' };
  async function drawTrips(host, days) {
    host.innerHTML = K.skeleton('list', 2);
    let d;
    try { d = await K.api(`/driver/trips?days=${days}`); }
    catch (e) { host.innerHTML = `<div class="state-box" role="alert"><b>Couldn’t load trips</b><span>${K.esc(e.message)}</span></div>`; return; }
    if (!host.isConnected) return;
    const tt = d.totals;
    host.innerHTML = `
      <div class="sum-grid">
        <div><span>Trips</span><b>${tt.trips}</b></div><div><span>Fares</span><b>${K.ugx(tt.fare)}</b></div>
        <div><span>Commission</span><b>−${K.ugx(tt.commission)}</b></div><div><span>Tips, fees & bonuses</span><b>${K.ugx(tt.tips + tt.noShowFees + (tt.cancelFees || 0) + tt.bonuses)}</b></div>
        <div class="wide"><span>You earned</span><b>${K.ugx(tt.earning)}</b></div></div>
      ${d.trips.length ? d.trips.map((t) => `<div class="trip-line">
          <div class="tl-top"><b class="ellipsis">${t.noShow ? (t.feeKind === 'cancel' ? 'Cancellation fee' : 'No-show fee') : `${K.esc(String(t.from).split(',')[0])} → ${K.esc(String(t.to).split(',')[0])}`}</b><b>${K.ugx(t.earning)}</b></div>
          <div class="tl-sub"><span>${K.when(t.at)} · ${K.SERVICE_LABEL[t.service] || ''}${t.noShow ? '' : ` · ${K.PAY_LABEL[t.method] || t.method}`}</span>
            ${t.noShow ? '' : `<span>Fare ${K.ugx(t.fare)} · commission −${K.ugx(t.commission)}${t.discount ? ` · discount covered ${K.ugx(t.discount)}` : ''}${t.tip ? ` · tip ${K.ugx(t.tip)}${t.tipMethod === 'cash' ? ' cash' : ''}` : ''}</span>`}</div></div>`).join('')
        : '<p class="small muted">No trips in this period yet.</p>'}
      ${d.bonuses.map((b) => `<div class="trip-line"><div class="tl-top"><b>${K.esc(b.note)}</b><b>${K.ugx(b.amount)}</b></div><div class="tl-sub"><span>${K.when(b.created_at)}</span></div></div>`).join('')}
      <div class="row" style="margin-top:12px;gap:8px">
        <button class="btn btn-outline btn-sm fill" id="stmt">${K.ic('receipt', 'sm')} Statement</button>
        <button class="btn btn-outline btn-sm fill" id="csv">${K.ic('list', 'sm')} Download CSV</button></div>`;
    K.$('#csv', host).onclick = () => downloadCsv(d);
    K.$('#stmt', host).onclick = () => statement(d);
  }
  function downloadCsv(d) {
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Trip', 'Service', 'Payment', 'From', 'To', 'Fare (UGX)', 'Commission (UGX)', 'Discount covered (UGX)', 'Tip (UGX)', 'No-show fee (UGX)', 'You earned (UGX)']];
    for (const t of d.trips) rows.push([new Date(t.at).toISOString().slice(0, 16).replace('T', ' '), t.id, t.service, t.noShow ? (t.feeKind === 'cancel' ? 'cancellation' : 'no-show') : t.method, t.from, t.to, t.fare, t.commission, t.discount, t.tip, t.noShowFee + (t.cancelFee || 0), t.earning]);
    for (const b of d.bonuses) rows.push([new Date(b.created_at).toISOString().slice(0, 16).replace('T', ' '), '', 'bonus', '', b.note, '', '', '', '', '', '', b.amount]);
    const csv = rows.map((r) => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = `flytte-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function statement(d) {
    const tt = d.totals, from = new Date(d.since), to = new Date();
    const fmt = (x) => x.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' });
    const page = document.createElement('div');
    page.className = 'page push-in statement'; page.style.zIndex = 870;
    page.innerHTML = `<div class="page-inner">
      <div class="page-head no-print"><button class="btn icon-btn btn-ghost" data-x aria-label="Back">${K.ic('back')}</button><h2>Statement</h2></div>
      <div class="st-head"><div><b class="st-brand">Flytte Driver</b><span>Earnings statement</span></div><div class="st-right"><b>${K.esc(S.user.name)}</b><span>${K.esc(prettyPhone(S.user.phone))} · ${K.esc(S.driver.plate)}</span><span>${fmt(from)} – ${fmt(to)}</span></div></div>
      <table class="st-table"><thead><tr><th>Date</th><th>Trip</th><th class="n">Fare</th><th class="n">Commission</th><th class="n">Earned</th></tr></thead><tbody>
        ${d.trips.map((t) => `<tr><td>${new Date(t.at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })}</td><td>${t.noShow ? 'No-show fee' : `${K.esc(String(t.from).split(',')[0])} → ${K.esc(String(t.to).split(',')[0])}<br><small>${K.SERVICE_LABEL[t.service] || ''} · ${K.PAY_LABEL[t.method] || t.method}${t.tip ? ` · tip ${K.ugx(t.tip)}` : ''}</small>`}</td><td class="n">${t.noShow ? '' : K.ugx(t.fare)}</td><td class="n">${t.noShow ? '' : '−' + K.ugx(t.commission)}</td><td class="n">${K.ugx(t.earning)}</td></tr>`).join('')}
        ${d.bonuses.map((b) => `<tr><td>${new Date(b.created_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })}</td><td>${K.esc(b.note)}</td><td></td><td></td><td class="n">${K.ugx(b.amount)}</td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="2">${tt.trips} trip${tt.trips === 1 ? "" : "s"}</td><td class="n">${K.ugx(tt.fare)}</td><td class="n">−${K.ugx(tt.commission)}</td><td class="n">${K.ugx(tt.earning)}</td></tr></tfoot></table>
      <p class="tiny muted">Cash fares were collected by you; commission on them is taken from your Flytte balance. Discounts are paid by Flytte and added to your balance.</p>
      <button class="btn btn-primary btn-block no-print" id="print">${K.ic('receipt', 'sm')} Save as PDF or print</button></div>`;
    root.querySelector('#app').appendChild(page);
    K.$('[data-x]', page).onclick = () => K.pop(page);
    K.$('#print', page).onclick = () => window.print();
  }

  function drawProfile(el) {
    const d = S.driver;
    el.innerHTML = `
      <div class="page-title">Profile</div>
      <div class="profile-head">
        <span class="photo">${photoUrl() ? `<img src="${photoUrl()}" alt="Your profile photo">` : K.initials(S.user.name)}</span>
        <span class="grow"><b style="font-size:1.2rem;display:block">${K.esc(S.user.name)}</b><span class="small muted">${K.esc(prettyPhone(S.user.phone))}</span><br>
          <span class="verified">${K.ic('check', 'sm')} Verified driver</span></span></div>
      <div class="card row" style="margin-bottom:8px"><span style="width:84px;height:52px;flex:none">${K.artFor(null, d.vehicleType)}</span>
        <span class="grow"><b>${K.esc([d.vehicleColor, d.vehicleMake].filter(Boolean).join(' ') || (d.vehicleType === 'car' ? 'Car' : 'Boda boda'))}</b><br><span class="plate-chip">${K.esc(d.plate)}</span></span>
        <span class="rating"><span class="star-ic">★</span><b>${S.user.rating || 'New'}</b></span></div>

      ${statsHtml()}
      <button class="menu-item" data-a="identity"><span class="ic">${K.ic('user')}</span><span class="grow">Photo & vehicle<br><span class="small muted">${identitySub()}</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="trips"><span class="ic">${K.ic('receipt')}</span><span class="grow">Trip history</span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="docs"><span class="ic">${K.ic('idcard')}</span><span class="grow">Documents<br><span class="small muted">${S.ov && S.ov.docs && S.ov.docs.length ? `<span style="color:var(--stop)">${S.ov.docs.length} need${S.ov.docs.length === 1 ? 's' : ''} attention</span>` : 'ID, driving permit, insurance, vehicle, photo'}</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="alerts" role="switch" aria-checked="${alertsShown()}" ${pushSupported() ? '' : 'disabled'}><span class="ic">${K.ic('bell')}</span><span class="grow">Ride alerts<br><span class="small muted">${alertsShown() ? 'On · requests ring when your phone is locked' : pushSupported() ? (Notification.permission === 'denied' ? 'Blocked · allow notifications for Flytte Driver in your phone settings' : 'Off · turn on to get requests when your phone is locked') : isIOS && !K.standalone() ? 'Add the app to your Home Screen to use them' : 'Not available in this browser'}</span></span>${pushSupported() ? `<span class="set-switch${alertsShown() ? ' on' : ''}" aria-hidden="true"><i></i></span>` : ''}</button>
      <button class="menu-item" data-a="autonav" role="switch" aria-checked="${autoNav()}"><span class="ic">${K.ic('nav')}</span><span class="grow">Start navigation automatically<br><span class="small muted">${autoNav() ? 'Flytte directions open when you accept a trip' : 'Off · tap Navigate on a trip to open directions'}</span></span><span class="set-switch${autoNav() ? ' on' : ''}" aria-hidden="true"><i></i></span></button>
      <button class="menu-item" data-a="manual"><span class="ic">${K.ic('pin')}</span><span class="grow">${S.manual ? 'Use phone GPS' : 'Set position on map'}<br><span class="small muted">For testing without GPS</span></span></button>
      ${S.config.supportPhone ? `<a class="menu-item" href="tel:${K.esc(S.config.supportPhone.replace(/\s/g, ''))}"><span class="ic">${K.ic('help')}</span><span class="grow">Driver support<br><span class="small muted">Call ${K.esc(S.config.supportPhone)}</span></span>${K.ic('chev', 'sm')}</a>` : ''}
      <button class="menu-item" data-a="settings"><span class="ic">${K.ic('settings')}</span><span class="grow">Settings<br><span class="small muted">Appearance, language, privacy</span></span>${K.ic('chev', 'sm')}</button>
      <button class="menu-item" data-a="out" style="color:var(--stop)"><span class="ic" style="background:var(--stop-soft);color:var(--stop)">${K.ic('logout')}</span><span class="grow">Log out</span></button>
      <p class="tiny faint" style="text-align:center;margin-top:18px">Flytte Driver 1.0</p>`;

    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => ({
      trips: openTrips,
      docs: openDocs,
      identity: () => openIdentity(() => drawProfile(el)),
      alerts: async () => {
        if (pushBusy) return;
        // Decide from the state we already know: no waiting before the permission prompt (iOS needs it in the tap).
        const on = alertsShown();
        const btn = el.querySelector('[data-a="alerts"]'), sw = btn && btn.querySelector('.set-switch');
        if (sw) sw.classList.toggle('on', !on);
        if (btn) btn.disabled = true;
        if (on) await disablePush(); else await enablePush(false);
        await alertsOnHere();
        await loadOverview(); drawProfile(el);
      },
      autonav: () => { try { localStorage.setItem('flytte_auto_nav', autoNav() ? 'off' : 'on'); } catch {} K.haptic && K.haptic(); drawProfile(el); },
      manual: () => { if (S.manual) { S.manual = false; startGps(); } else { S.manual = true; navigator.geolocation && navigator.geolocation.clearWatch(watchId); K.toast('Tap the map to move your position.'); } openTab('home'); },
      settings: () => K.openSettings({ role: 'driver', onBack: () => drawProfile(el) }),
      out: () => { if (S.online) setOnline(false); K.logout(); },
    })[b.dataset.a]());
  }

  function identitySub() {
    const c = S.changes || {};
    const p = [c.photo, c.vehicle].filter(Boolean);
    if (p.some((x) => x.status === 'rejected')) return '<span style="color:var(--stop)">A change wasn’t approved</span>';
    if (p.some((x) => x.status === 'pending')) return '<span style="color:#8A5200">A change is being checked</span>';
    return 'Profile photo, vehicle and number plate';
  }

  // Photo & vehicle: what riders see, and the only place to ask for changes (checked by the team).
  function openIdentity(onBack) {
    const page = document.createElement('div');
    page.className = 'page push-in grouped nav-large'; page.style.zIndex = 870;
    page.innerHTML = `<div class="page-inner"><div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Back">${K.ic('back')}</button><h2 aria-hidden="true">Photo & vehicle</h2></div><h1 class="page-title">Photo & vehicle</h1><div data-body></div></div>`;
    root.querySelector('#app').appendChild(page);
    K.$('[data-x]', page).onclick = () => K.pop(page, onBack);
    const body = K.$('[data-body]', page);
    const draw = async () => {
      await loadChanges();
      if (!body.isConnected) return;
      const d = S.driver;
      body.innerHTML = `
        <p class="small muted" style="margin:0 4px 14px">This is what riders see when you pick them up. Changes are checked by the Flytte team first, so riders always see details that match you and your vehicle.</p>
        <div class="id-card">
          <span class="id-photo">${photoUrl() ? `<img src="${photoUrl()}" alt="Your profile photo">` : K.initials(S.user.name)}</span>
          <b>Profile photo</b>
          ${changeNote('photo')}
          <button class="btn btn-outline btn-sm" data-i="photo">${K.ic('camera', 'sm')} Change photo</button>
        </div>
        <div class="id-card">
          <span class="id-veh">${K.artFor(null, d.vehicleType)}</span>
          <b>${K.esc([d.vehicleColor, d.vehicleMake].filter(Boolean).join(' ') || (d.vehicleType === 'car' ? 'Car' : 'Boda boda'))}</b>
          <span class="plate-chip big">${K.esc(d.plate)}</span>
          ${changeNote('vehicle')}
          <button class="btn btn-outline btn-sm" data-i="vehicle">${K.ic('edit', 'sm')} Change vehicle or number plate</button>
        </div>`;
      K.$('[data-i="photo"]', body).onclick = () => newPhoto(draw);
      K.$('[data-i="vehicle"]', body).onclick = () => changeVehicle(draw);
    };
    body.innerHTML = K.skeleton('list', 2);
    draw();
  }

  // A new profile photo is checked by the team; riders keep seeing the approved one until then.
  async function newPhoto(after) {
    const img = await K.camera({ guide: 'face', title: 'New profile photo', hint: 'Riders use this to recognise you. Face the light, look at the camera, no sunglasses, helmet or cap.' });
    if (!img) return;
    try {
      const r = await K.api('/driver/documents', { kind: 'photo', image: img, live: true }, 'POST', { timeout: 90000 });
      if (r.pending) K.toast('Photo sent for review. Riders see your current photo until it’s approved.', 5000);
      else { S.hasPhoto = true; S.photoData = img; topbar(); K.toast('Photo saved'); }
      await loadChanges(); after && after();
    } catch (e) { K.toast(e.message, 5000); }
  }
  function changeNote(kind) {
    const c = S.changes && S.changes[kind];
    if (!c) return '';
    const what = kind === 'photo' ? 'New photo' : `Change to ${K.esc(c.plate)}${c.vehicleColor || c.vehicleMake ? ` (${K.esc([c.vehicleColor, c.vehicleMake].filter(Boolean).join(' '))})` : ''}`;
    if (c.status === 'pending') return `<div class="review-note pending">${kind === 'photo' && c.url ? `<img src="${c.url}" alt="">` : K.ic('clock', 'sm')}<span><b>${what} is being checked</b>Riders see your current ${kind === 'photo' ? 'photo' : 'vehicle details'} until it’s approved.</span></div>`;
    if (c.status === 'rejected') return `<div class="review-note rejected">${K.ic('x', 'sm')}<span><b>${what} wasn’t approved</b>${K.esc(c.note || '')}</span></div>`;
    return `<div class="review-note ok">${K.ic('check', 'sm')}<span><b>${what} was approved</b></span></div>`;
  }
  function changeVehicle(after) {
    const d = S.driver, pend = S.changes && S.changes.vehicle && S.changes.vehicle.status === 'pending' ? S.changes.vehicle : null;
    let photo = null;
    const m = K.modal(`<h2>Change vehicle or number plate</h2>
      <p class="muted">The Flytte team checks the photo before riders see the new details. Until then, riders see ${K.esc(d.plate)}.${pend ? ' This replaces the change you already sent.' : ''}</p>
      <label for="vp">Number plate</label><input id="vp" autocapitalize="characters" autocomplete="off" maxlength="12" value="${K.esc(pend ? pend.plate : d.plate)}" style="text-transform:uppercase">
      <div class="row" style="gap:10px"><span class="fill"><label for="vm">Make and model</label><input id="vm" maxlength="40" value="${K.esc((pend && pend.vehicleMake) || d.vehicleMake || '')}" placeholder="e.g. Bajaj Boxer"></span>
        <span class="fill"><label for="vc">Colour</label><input id="vc" maxlength="20" value="${K.esc((pend && pend.vehicleColor) || d.vehicleColor || '')}" placeholder="e.g. Red"></span></div>
      <label>Photo of the vehicle</label>
      <button class="veh-shot" id="vshot" type="button"><span>${K.ic('camera')}<b>Take a photo</b><small>The whole vehicle with the number plate clearly readable</small></span></button>
      <p class="error" id="verr"></p>
      <button class="btn btn-primary btn-block btn-lg" id="vsend">Send for approval</button><button class="btn btn-block" style="margin-top:8px" data-close>Cancel</button>`);
    const shotBtn = K.$('#vshot', m.el);
    shotBtn.onclick = async () => {
      const img = await K.camera({ guide: 'plate', title: 'Vehicle photo', hint: 'Stand back so the whole vehicle fits, with the number plate clear and readable.' });
      if (!img) return;
      photo = img; shotBtn.classList.add('has'); shotBtn.innerHTML = `<img src="${img}" alt="Vehicle photo"><small>Tap to retake</small>`;
    };
    K.$('#vsend', m.el).onclick = async (ev) => {
      const b = ev.currentTarget, err = K.$('#verr', m.el); err.textContent = '';
      if (!photo) { err.textContent = 'Take a photo of the vehicle with the number plate showing.'; return; }
      b.disabled = true; b.innerHTML = '<span class="spin"></span>Sending…';
      try {
        await K.api('/driver/vehicle-change', { plate: K.$('#vp', m.el).value, vehicleMake: K.$('#vm', m.el).value, vehicleColor: K.$('#vc', m.el).value, photo }, 'POST', { timeout: 90000 });
        m.close(); K.toast('Sent. We’ll let you know once it’s approved.', 4500); await loadChanges(); after && after();
      } catch (e) { b.disabled = false; b.textContent = 'Send for approval'; err.textContent = e.message; }
    };
  }

  function statsHtml() {
    const st = S.ov && S.ov.stats;
    if (!st) return '';
    const pct = (v) => (v == null ? '–' : v + '%');
    return `<div class="card stats-card"><div class="stats3">
        <div><b>${pct(st.acceptanceRate)}</b><span>Acceptance</span></div>
        <div><b>${pct(st.cancellationRate)}</b><span>Cancellation</span></div>
        <div><b>${st.offers}</b><span>Requests</span></div></div>
      <p class="tiny muted" style="margin:8px 0 0">Last ${st.days} days. Missed requests count as not accepted. No-shows don’t count as cancellations.</p></div>`;
  }

  // Documents: replace a photo or set the expiry date on the ones that run out.
  async function openDocs() {
    const page = document.createElement('div');
    page.className = 'page push-in grouped nav-large'; page.style.zIndex = 870;
    page.innerHTML = `<div class="page-inner"><div class="page-head"><button class="btn icon-btn btn-ghost" data-x aria-label="Back">${K.ic('back')}</button><h2 aria-hidden="true">Documents</h2></div><h1 class="page-title">Documents</h1><div data-body>${K.skeleton('list', 4)}</div></div>`;
    root.querySelector('#app').appendChild(page);
    K.$('[data-x]', page).onclick = () => K.pop(page, () => { loadOverview(); if (S.tab === 'profile') openTab('profile'); });
    const body = K.$('[data-body]', page);
    const draw = async () => {
      let info;
      try { [info] = await Promise.all([K.api('/driver/documents'), loadChanges()]); }
      catch (e) { body.innerHTML = `<div class="state-box" role="alert"><b>Couldn’t load your documents</b><span>${K.esc(e.message)}</span></div>`; return; }
      const all = { ...info.kinds, ...info.optional };
      const alerts = Object.fromEntries(((S.ov && S.ov.docs) || []).map((d) => [d.kind, d]));
      body.innerHTML = `${Object.entries(all).map(([k, label]) => {
          const up = info.uploaded[k], exp = info.expires && info.expires[k], al = alerts[k];
          const expiring = info.expiring.includes(k);
          return `<div class="doc-row ${al ? (al.expired ? 'bad' : 'warn') : ''}">
            <div class="dr-top"><span class="grow"><b>${K.esc(label)}${info.optional[k] ? ' <span class="tiny muted">optional</span>' : ''}</b>
              <span class="small muted">${up ? `Uploaded ${K.when(up)}` : 'Not uploaded'}${al ? ` · <b style="color:${al.expired ? 'var(--stop)' : '#8A5200'}">${al.expired ? 'Expired' : `Expires in ${al.days} day${al.days === 1 ? '' : 's'}`}</b>` : ''}</span></span>
              ${k === 'photo' || (k === 'vehicle' && up) ? '<button class="btn btn-sm btn-outline" data-idp>Manage</button>'
                : `<label class="btn btn-sm btn-outline">${up ? 'Replace' : 'Upload'}<input type="file" accept="image/*" data-k="${k}" hidden capture="environment"></label>`}</div>
            ${expiring ? `<div class="dr-exp"><label for="e-${k}">Expiry date</label><div class="row"><input type="date" id="e-${k}" value="${exp || ''}" class="fill"><button class="btn btn-sm" data-save="${k}" ${up ? '' : 'disabled'}>Save</button></div></div>` : ''}
          </div>`;
        }).join('')}
        <p class="error" id="derr"></p>
        <p class="small muted" style="padding:0 16px">We remind you on your home screen before your driving permit or insurance runs out. Keep them current to stay on the road.</p>`;
      body.querySelectorAll('input[type=file]').forEach((inp) => inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const lbl = inp.parentElement; lbl.firstChild.textContent = 'Uploading…';
        const k = inp.dataset.k, e = K.$(`#e-${k}`, body);
        try {
          await K.api('/driver/documents', { kind: k, image: await K.compressImage(f, 1400), expiresOn: e && e.value ? e.value : undefined }, 'POST', { timeout: 90000 });
          K.toast('Uploaded'); await loadOverview(); draw();
        } catch (ex) { K.$('#derr', body).textContent = ex.message; lbl.firstChild.textContent = 'Try again'; }
      });
      body.querySelectorAll('[data-idp]').forEach((b) => b.onclick = () => openIdentity(draw));
      body.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
        const k = b.dataset.save, v = K.$(`#e-${k}`, body).value;
        try { await K.api('/driver/documents/expiry', { kind: k, expiresOn: v }); K.toast('Expiry date saved'); await loadOverview(); draw(); }
        catch (ex) { K.$('#derr', body).textContent = ex.message; }
      });
    };
    draw();
  }

  async function openTrips() {
    const m = K.modal(`<h2>Trip history</h2>${K.skeleton('list', 4)}`);
    const list = await K.api('/trips/history').catch(() => []);
    if (!m.el.isConnected) return;
    m.el.innerHTML = `<h2>Trip history</h2>
      ${list.length ? list.map((t, i) => `<button class="trip-card" data-i="${i}" style="width:100%;text-align:left;cursor:pointer"><span class="ic">${K.artFor(t.service)}</span><span class="grow"><span class="t ellipsis" style="display:block">${K.esc(String(t.drop.address).split(',')[0])}</span><span class="s">${K.when(t.createdAt)} · ${K.PAY_LABEL[t.paymentMethod]}</span></span>
        <span class="p">${t.status === 'completed' ? K.ugx(t.earning) : `<span class="badge bad">${t.status.replace('_', ' ')}</span>`}</span></button>`).join('') : '<p class="muted">Go online to get your first trip.</p>'}`;
    m.el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { m.close(); tripHelp(list[+b.dataset.i]); });
  }

  // Help with a past trip: items left behind, unpaid trips, behaviour and safety.
  async function tripHelp(t) {
    let kinds = {}, issues = [];
    try { const r = await K.api(`/trips/${t.id}/help`); kinds = r.kinds; issues = r.issues || []; } catch (e) { K.toast(e.message); return; }
    const list = issues.length ? `<h3 class="set-h" style="margin-top:16px">Your reports</h3>${issues.map((i) => `<div class="issue ${i.status}"><div class="row" style="justify-content:space-between;gap:8px"><b>${K.esc(i.label)}</b><span class="badge ${i.status === 'open' ? 'warn' : 'ok'}">${i.status === 'open' ? 'In review' : 'Resolved'}</span></div>
      <p class="small muted" style="margin:4px 0 0">${K.esc(i.details || '')}</p>${i.reply ? `<div class="issue-reply"><small>Flytte support</small>${K.esc(i.reply)}</div>` : ''}</div>`).join('')}` : '';
    const mm = K.modal(`<div class="help-sheet"><h2>Trip help</h2>
      <p class="small muted">${K.when(t.createdAt)} · ${K.esc(String(t.pickup.address).split(',')[0])} → ${K.esc(String(t.drop.address).split(',')[0])}</p>
      ${t.status === 'completed' ? `<div class="kv"><span>You earned</span><b>${K.ugx(t.earning)}</b></div>` : ''}
      <div data-step><div class="set-card list" style="margin-top:12px">${Object.entries(kinds).map(([k, l]) => `<button class="set-row" data-kind="${k}"><span class="grow"><b>${K.esc(l)}</b></span>${K.ic('chev', 'sm')}</button>`).join('')}</div>${list}</div>
      <button class="btn btn-ghost btn-block" style="margin-top:10px" data-close>Close</button></div>`);
    const step = K.$('[data-step]', mm.el);
    step.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => {
      const kind = b.dataset.kind, lost = kind === 'lost_item';
      step.innerHTML = `<h3 style="margin:10px 0 4px">${K.esc(kinds[kind])}</h3>
        <label for="hd">${lost ? 'What was left, and where is it now?' : 'What happened?'}</label>
        <textarea id="hd" rows="4" maxlength="1000" placeholder="${lost ? 'e.g. Phone on the back seat. I have it with me.' : 'Add any details that will help us'}"></textarea>
        <p class="error" role="alert"></p>
        <button class="btn btn-primary btn-block btn-lg" data-send style="margin-top:10px">Send to Flytte</button>`;
      const ta = K.$('#hd', step), err = K.$('.error', step), send = K.$('[data-send]', step);
      send.onclick = async () => {
        err.textContent = ''; send.disabled = true;
        try { await K.api(`/trips/${t.id}/help`, { kind, details: ta.value.trim() }); mm.close(); K.toast('Report sent. Flytte will reply in Trip history.', 4500); }
        catch (e) { err.textContent = e.message; send.disabled = false; }
      };
    });
  }
})();
