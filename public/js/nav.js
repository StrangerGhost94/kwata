/* Flytte in-app navigation for drivers: turn-by-turn directions on the Flytte map.
   Routes and steps come from OSRM (the same router the apps already use for route lines).
   The map follows the driver, the next turn shows in a banner, spoken prompts are optional,
   and the route is recalculated when the driver leaves it. */
(function () {
  const K = window.K;
  const ROUTER = 'https://router.project-osrm.org/route/v1/driving/';
  const TRAFFIC = 1.8;           // OSRM assumes empty roads; same factor the app uses for ETAs
  const OFF_ROUTE_M = 45;        // GPS on a boda wanders; beyond this for a few fixes we reroute
  const ARRIVE_M = 35;
  let N = null;                  // the active session

  const sw = () => K.lang && K.lang() === 'sw';
  const muted = () => { try { return localStorage.getItem('flytte_nav_mute') === '1'; } catch { return false; } };
  const setMuted = (v) => { try { localStorage.setItem('flytte_nav_mute', v ? '1' : '0'); } catch {} };

  // ---------- geometry ----------
  const R = 6371000, rad = (d) => d * Math.PI / 180;
  function dist(a, b) {
    const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Projects p onto segment a-b on a local flat plane. Returns {d: metres away, f: 0..1 along}.
  function project(p, a, b) {
    const kx = Math.cos(rad(p[0])) * R * Math.PI / 180, ky = R * Math.PI / 180;
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const f = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const x = ax + f * dx, y = ay + f * dy;
    return { d: Math.sqrt(x * x + y * y), f };
  }

  // ---------- words ----------
  const ORD_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  const ORD_SW = ['ya kwanza', 'ya pili', 'ya tatu', 'ya nne', 'ya tano', 'ya sita', 'ya saba', 'ya nane'];
  const MOD_EN = { left: 'left', right: 'right', 'slight left': 'slightly left', 'slight right': 'slightly right', 'sharp left': 'sharp left', 'sharp right': 'sharp right', straight: 'straight', uturn: 'around' };
  const MOD_SW = { left: 'kushoto', right: 'kulia', 'slight left': 'kidogo kushoto', 'slight right': 'kidogo kulia', 'sharp left': 'kwa nguvu kushoto', 'sharp right': 'kwa nguvu kulia', straight: 'moja kwa moja', uturn: 'nyuma' };
  const CARD_EN = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const CARD_SW = ['kaskazini', 'kaskazini-mashariki', 'mashariki', 'kusini-mashariki', 'kusini', 'kusini-magharibi', 'magharibi', 'kaskazini-magharibi'];

  function road(s) { return s.name || s.ref || ''; }
  function instruction(s, last, arriveLabel) {
    const m = s.maneuver || {}, type = m.type, mod = m.modifier || 'straight', name = road(s), S = sw();
    const onto = name ? (S ? ` kuingia ${name}` : ` onto ${name}`) : '';
    const dir = (S ? MOD_SW : MOD_EN)[mod] || mod;
    if (type === 'arrive' || last) return arriveLabel || (S ? 'Umefika' : 'You have arrived');
    if (type === 'depart') {
      const c = (S ? CARD_SW : CARD_EN)[Math.round(((m.bearing_after || 0) % 360) / 45) % 8];
      return S ? `Elekea ${c}${onto}` : `Head ${c}${onto}`;
    }
    if (type === 'roundabout' || type === 'rotary' || type === 'exit roundabout' || type === 'exit rotary') {
      if (m.exit) return S ? `Kwenye mzunguko, toka njia ${ORD_SW[m.exit - 1] || m.exit}${onto}` : `At the roundabout, take the ${ORD_EN[m.exit - 1] || m.exit + 'th'} exit${onto}`;
      return S ? `Ingia kwenye mzunguko${onto}` : `Enter the roundabout${onto}`;
    }
    if (type === 'roundabout turn') return S ? `Kwenye mzunguko, pinda ${dir}${onto}` : `At the roundabout, turn ${dir}${onto}`;
    if (mod === 'uturn') return S ? `Geuka urudi${onto}` : `Make a U-turn${onto}`;
    if (type === 'fork') return S ? `Kaa ${dir}${onto}` : `Keep ${dir}${onto}`;
    if (type === 'merge') return S ? `Ungana ${dir}${onto}` : `Merge ${dir}${onto}`;
    if (type === 'on ramp') return S ? `Panda barabara ${dir}${onto}` : `Take the ramp ${dir}${onto}`;
    if (type === 'off ramp') return S ? `Toka ${dir}${onto}` : `Take the exit ${dir}${onto}`;
    if (type === 'end of road') return S ? `Mwisho wa barabara, pinda ${dir}${onto}` : `At the end of the road, turn ${dir}${onto}`;
    if (type === 'continue' || type === 'new name' || mod === 'straight') return S ? `Endelea ${name ? 'kwenye ' + name : 'moja kwa moja'}` : `Continue ${name ? 'on ' + name : 'straight'}`;
    return S ? `Pinda ${dir}${onto}` : `Turn ${dir}${onto}`;
  }
  function distLabel(m) {
    if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
    if (m >= 100) return `${Math.round(m / 50) * 50} m`;
    return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  }
  function spokenDist(m) {
    const d = distLabel(m).replace(' km', sw() ? ' kilomita' : ' kilometres').replace(' m', sw() ? ' mita' : ' metres');
    if (sw()) return `Baada ya ${d.replace(/^(\S+) (\S+)$/, '$2 $1')}`;
    return `In ${d}`;
  }

  // ---------- arrows ----------
  const ARROW = {
    straight: '<path d="M12 20V5"/><path d="m6 11 6-6 6 6"/>',
    right: '<path d="M7 20v-6a5 5 0 0 1 5-5h7"/><path d="m15 5 4 4-4 4"/>',
    'slight right': '<path d="M9 20v-6.5l7.5-7.5"/><path d="M11 6h5.5v5.5"/>',
    'sharp right': '<path d="M8 4v9l8.5 6"/><path d="M11 19.5h6v-5.5"/>',
    uturn: '<path d="M16 20V10a4 4 0 0 0-8 0v4"/><path d="m4 11 4 4 4-4"/>',
    roundabout: '<circle cx="12" cy="9" r="3.6"/><path d="M12 20v-7.4"/><path d="M15 6.3 18 4"/>',
    arrive: '<path d="M6 21V4h11l-2.5 4.2L17 12.5H6"/>',
  };
  function arrowFor(s, last) {
    const m = s.maneuver || {}, type = m.type, mod = m.modifier || 'straight';
    let key = 'straight', flip = false;
    if (type === 'arrive' || last) key = 'arrive';
    else if (/roundabout|rotary/.test(type) && type !== 'roundabout turn') key = 'roundabout';
    else if (mod === 'uturn') key = 'uturn';
    else if (/left/.test(mod)) { key = mod.replace('left', 'right'); flip = true; }
    else if (/right/.test(mod)) key = mod;
    if (type === 'depart' || type === 'continue' || type === 'new name') { if (!/left|right/.test(mod)) key = 'straight'; }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" ${flip ? 'style="transform:scaleX(-1)"' : ''}>${ARROW[key] || ARROW.straight}</svg>`;
  }

  // ---------- voice ----------
  function say(text) {
    if (muted() || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = sw() ? 'sw-KE' : 'en-GB'; u.rate = 1;
      const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(sw() ? 'sw' : 'en'));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch {}
  }

  // ---------- routing ----------
  async function fetchRoute(from, to) {
    const url = `${ROUTER}${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
    const r = await fetch(url);
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt || !rt.legs || !rt.legs[0]) throw new Error('No route');
    const coords = rt.geometry.coordinates.map(([x, y]) => [y, x]);
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + dist(coords[i - 1], coords[i]);
    // Place each maneuver along the line (searching forward so loops don't confuse it).
    let from_ = 0;
    const steps = rt.legs[0].steps.map((s) => {
      const p = [s.maneuver.location[1], s.maneuver.location[0]];
      let best = from_, bd = Infinity;
      for (let i = from_; i < coords.length; i++) { const d = dist(p, coords[i]); if (d < bd) { bd = d; best = i; } if (bd < 3 && i > best + 20) break; }
      from_ = best;
      return { ...s, at: cum[best] };
    });
    return { coords, cum, steps, total: cum[cum.length - 1], dur: rt.duration * TRAFFIC };
  }

  // ---------- UI ----------
  function build(o) {
    const el = document.createElement('div');
    el.className = 'nav-ui';
    el.innerHTML = `
      <div class="nav-top" role="status" aria-live="polite">
        <div class="nav-man"><span class="nav-arrow" id="navArrow"></span>
          <span class="grow"><b class="nav-dist" id="navDist"></b><span class="nav-instr" id="navInstr">${sw() ? 'Inatafuta njia…' : 'Finding the route…'}</span></span></div>
        <div class="nav-then" id="navThen" hidden></div>
      </div>
      <button class="nav-recenter" id="navRecenter" hidden>${K.ic('nav', 'sm')}<span>${sw() ? 'Rudisha katikati' : 'Re-centre'}</span></button>
      <div class="nav-bot">
        <button class="nav-btn" id="navMute" aria-pressed="${muted()}"></button>
        <span class="grow nav-eta"><b id="navEta">–</b><small id="navMeta"></small></span>
        ${o.externalUrl ? `<a class="nav-btn" href="${o.externalUrl}" target="_blank" rel="noopener" aria-label="Open in Google Maps"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>` : ''}
        <button class="nav-exit" id="navExit">${sw() ? 'Funga' : 'Exit'}</button>
      </div>`;
    document.body.appendChild(el);
    return el;
  }
  const SPK_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const SPK_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>';
  function paintMute() {
    const b = N && N.el.querySelector('#navMute'); if (!b) return;
    b.innerHTML = muted() ? SPK_OFF : SPK_ON;
    b.setAttribute('aria-pressed', String(muted()));
    b.setAttribute('aria-label', muted() ? (sw() ? 'Washa sauti' : 'Turn voice on') : (sw() ? 'Zima sauti' : 'Mute voice'));
  }

  function drawLine() {
    const dark = K.dark && K.dark();
    if (N.casing) { N.map.removeLayer(N.casing); N.map.removeLayer(N.line); }
    N.casing = L.polyline(N.r.coords, { color: dark ? '#000' : '#fff', weight: 11, opacity: .9, interactive: false }).addTo(N.map);
    N.line = L.polyline(N.r.coords, { color: '#1A73E8', weight: 7, interactive: false }).addTo(N.map);
  }

  async function reroute(first) {
    if (!N || N.busy || !N.loc) return;
    N.busy = true; N.lastRoute = Date.now();
    try {
      const r = await fetchRoute(N.loc, N.target);
      if (!N) return;
      N.r = r; N.idx = 0; N.off = 0; N.spoken = {};
      drawLine();
      tick(true);   // announces the first instruction of the new route
    } catch {
      if (N && first) {
        N.el.querySelector('#navInstr').textContent = sw() ? 'Njia haikupatikana. Jaribu tena au tumia Google Maps.' : 'Couldn’t get directions. Try again, or use Google Maps.';
        N.el.querySelector('#navArrow').innerHTML = '';
      }
    } finally { if (N) N.busy = false; }
  }

  function follow(force) {
    if (!N || !N.loc || (!N.follow && !force)) return;
    const m = N.map, z = Math.max(m.getZoom(), 17);
    // Keep the vehicle in the lower third so more of the road ahead is visible.
    const h = m.getSize().y, p = m.project([N.loc.lat, N.loc.lng], z).subtract([0, h * 0.18]);
    m.setView(m.unproject(p, z), z, { animate: true, duration: 0.6 });
  }

  function tick(fresh) {
    if (!N || !N.r || !N.loc) return;
    const { coords, cum, steps, total, dur } = N.r, p = [N.loc.lat, N.loc.lng];
    // Snap to the route: search a window ahead of the last position.
    let best = { d: Infinity, i: N.idx, f: 0 };
    const end = Math.min(coords.length - 1, N.idx + 60);
    for (let i = Math.max(0, N.idx - 3); i < end; i++) { const q = project(p, coords[i], coords[i + 1]); if (q.d < best.d) best = { d: q.d, i, f: q.f }; }
    if (best.d > 150) for (let i = 0; i < coords.length - 1; i++) { const q = project(p, coords[i], coords[i + 1]); if (q.d < best.d) best = { d: q.d, i, f: q.f }; }
    const along = best.d === Infinity ? 0 : cum[best.i] + best.f * (cum[best.i + 1] - cum[best.i]);
    if (best.d !== Infinity) N.idx = best.i;
    const left = Math.max(0, total - along);

    // Off the route for a few fixes (or far off once): get a new route.
    N.off = best.d > OFF_ROUTE_M ? N.off + 1 : 0;
    if ((N.off >= 3 || best.d > 120) && Date.now() - N.lastRoute > 8000) { reroute(false); }

    // Trim the line behind the vehicle.
    if (best.d !== Infinity && N.line) {
      const a = coords[best.i], b = coords[best.i + 1];
      const snap = [a[0] + (b[0] - a[0]) * best.f, a[1] + (b[1] - a[1]) * best.f];
      const rest = [snap, ...coords.slice(best.i + 1)];
      N.line.setLatLngs(rest); N.casing.setLatLngs(rest);
    }

    // The next maneuver is the first one still ahead of us (skipping the departure).
    let k = steps.findIndex((s, i) => i > 0 && s.at > along + 8);
    if (k < 0) k = steps.length - 1;
    const s = steps[k], last = k === steps.length - 1, toTurn = Math.max(0, s.at - along);
    const arriveLabel = N.arriveLabel;
    const arrived = left < ARRIVE_M;
    const text = arrived ? (arriveLabel || (sw() ? 'Umefika' : 'You have arrived')) : instruction(s, last, last ? arriveLabel : null);
    N.el.querySelector('#navArrow').innerHTML = arrowFor(s, last || arrived);
    N.el.querySelector('#navDist').textContent = arrived ? '' : distLabel(toTurn);
    N.el.querySelector('#navInstr').textContent = text;
    const nx = steps[k + 1], then = N.el.querySelector('#navThen');
    if (nx && !arrived && nx.at - s.at < 250) { then.hidden = false; then.innerHTML = `<span>${sw() ? 'Kisha' : 'Then'}</span>${arrowFor(nx, k + 1 === steps.length - 1)}`; }
    else then.hidden = true;

    const mins = Math.max(1, Math.round((dur * (left / (total || 1))) / 60));
    const at = new Date(Date.now() + mins * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    N.el.querySelector('#navEta').textContent = `${mins} min`;
    N.el.querySelector('#navMeta').textContent = `${distLabel(left)} · ${at}`;

    // Voice: once ahead of the turn, once just before it, and on arrival.
    const key = `${k}`;
    if (arrived) { if (!N.spoken.arrive) { N.spoken.arrive = 1; say(text); if (N.onArrive) setTimeout(() => N && N.onArrive && N.onArrive(), 2500); } }
    else if (fresh && !N.spoken[key + 'f']) { N.spoken[key + 'f'] = 1; say(toTurn > 60 ? `${spokenDist(toTurn)}, ${text}` : text); }
    else if (toTurn < 40 && !N.spoken[key + 'n']) { N.spoken[key + 'n'] = N.spoken[key + 'f'] = 1; say(text); }
    else if (toTurn < 250 && toTurn > 120 && !N.spoken[key + 'f']) { N.spoken[key + 'f'] = 1; say(`${spokenDist(toTurn)}, ${text}`); }

    follow();
  }

  // ---------- public ----------
  K.Nav = {
    active: () => !!N,
    target: () => N && N.target,
    /* opts: { map, loc, target:{lat,lng}, arriveLabel, externalUrl, onArrive, onExit } */
    start(opts) {
      if (N) K.Nav.stop(true);
      N = { ...opts, el: build(opts), follow: true, idx: 0, off: 0, spoken: {}, lastRoute: 0 };
      document.body.classList.add('nav-on');
      // Prime speech on the tap that started navigation (iOS only allows speech after a gesture).
      try { if (!muted() && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {}
      paintMute();
      const el = N.el;
      el.querySelector('#navExit').onclick = () => K.Nav.stop();
      el.querySelector('#navMute').onclick = () => { setMuted(!muted()); if (muted()) try { speechSynthesis.cancel(); } catch {} paintMute(); };
      el.querySelector('#navRecenter').onclick = () => { N.follow = true; el.querySelector('#navRecenter').hidden = true; follow(true); };
      N.onDrag = () => { if (!N) return; N.follow = false; el.querySelector('#navRecenter').hidden = false; };
      N.map.on('dragstart', N.onDrag);
      setTimeout(() => N && N.map.invalidateSize({ pan: false }), 50);
      follow(true);
      reroute(true);
    },
    update(loc) { if (!N || !loc) return; N.loc = loc; tick(false); },
    stop(silent) {
      if (!N) return;
      const n = N; N = null;
      try { speechSynthesis.cancel(); } catch {}
      n.map.off('dragstart', n.onDrag);
      if (n.casing) { n.map.removeLayer(n.casing); n.map.removeLayer(n.line); }
      n.el.remove();
      document.body.classList.remove('nav-on');
      setTimeout(() => n.map.invalidateSize({ pan: false }), 50);
      if (!silent && n.onExit) n.onExit();
    },
    _instruction: instruction,
  };
})();
