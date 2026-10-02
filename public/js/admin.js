// Kwata admin console
(function () {
  const root = document.getElementById('root');
  const TABS = [['overview', 'Overview'], ['drivers', 'Drivers'], ['riders', 'Riders'], ['trips', 'Trips'], ['pricing', 'Pricing'], ['safety', 'Safety'], ['payouts', 'Payouts']];
  let tab = location.hash.slice(1) || 'overview';
  let stats = {}, liveMap, liveLayer, liveTimer, sock;

  if (!K.token()) K.authScreen(root, { role: 'admin', title: 'Kwata Admin', onDone: start });
  else start();

  async function start() {
    root.innerHTML = `<div class="shell"><nav class="side" aria-label="Admin sections">
      <div class="logo"><span class="brand-dot"></span>Kwata</div><div class="checker"></div>
      ${TABS.map(([id, n]) => `<button data-t="${id}">${n}<span class="count hidden" id="c-${id}"></span></button>`).join('')}
      <button id="out" style="margin-top:20px">Sign out</button></nav><main id="main"></main></div>`;
    root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; location.hash = tab; show(); });
    K.$('#out').onclick = () => { K.session.clear(); location.reload(); };
    sock = K.socket(K.token());
    sock.on('admin:sos', (a) => { K.toast(`🚨 SOS from ${a.user} on trip #${a.tripId}`, 10000); beep(); refreshCounts(); if (tab === 'safety' || tab === 'overview') show(); });
    sock.on('admin:new_driver', (d) => { K.toast(`New driver signed up: ${d.name}`); refreshCounts(); });
    sock.on('admin:withdrawal', () => refreshCounts());
    sock.on('admin:trip', () => { if (tab === 'overview') loadLive(); });
    await refreshCounts();
    show();
  }

  async function refreshCounts() {
    stats = await K.api('/admin/stats');
    const set = (id, n) => { const el = K.$('#c-' + id); el.textContent = n; el.classList.toggle('hidden', !n); };
    set('drivers', stats.pendingDrivers); set('safety', stats.openSos); set('payouts', stats.pendingWithdrawals);
  }

  function show() {
    clearInterval(liveTimer);
    root.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-current', b.dataset.t === tab ? 'page' : 'false'));
    const main = K.$('#main');
    main.innerHTML = '<p class="muted">Loading…</p>';
    ({ overview, drivers, riders, trips, pricing, safety, payouts }[tab] || overview)(main).catch((e) => { main.innerHTML = `<p class="error">${K.esc(e.message)}</p>`; });
  }

  const badge = (s) => `<span class="badge ${({ approved: 'ok', completed: 'ok', paid: 'ok', pending: 'warn', requested: 'warn', accepted: 'warn', arrived: 'warn', in_progress: 'warn', suspended: 'bad', rejected: 'bad', cancelled: 'bad', no_drivers: 'bad' })[s] || ''}">${K.esc(String(s).replace('_', ' '))}</span>`;

  async function overview(main) {
    await refreshCounts();
    const s = stats;
    main.innerHTML = `
      <h1>Today in Kampala</h1>
      ${s.openSos ? `<div class="sos-live">🚨 ${s.openSos} open SOS alert${s.openSos > 1 ? 's' : ''}. <a href="#safety" style="color:#fff">Review now</a></div>` : ''}
      <div class="kpis">
        <div class="kpi"><span class="small muted">Trips (24h)</span><b>${s.today.trips}</b></div>
        <div class="kpi"><span class="small muted">Rider spend (24h)</span><b>${K.ugx(s.today.gmv)}</b></div>
        <div class="kpi"><span class="small muted">Kwata revenue (24h)</span><b>${K.ugx(s.today.revenue)}</b></div>
        <div class="kpi"><span class="small muted">Drivers online</span><b>${s.onlineDrivers}</b><span class="small muted">of ${s.drivers} approved</span></div>
        <div class="kpi"><span class="small muted">Live trips</span><b>${s.activeTrips}</b></div>
        <div class="kpi"><span class="small muted">Riders</span><b>${s.riders}</b></div>
      </div>
      <h2>Live map</h2>
      <p class="small muted">🏍️/🚗 free drivers · 🟡 drivers on a trip · 🙋 riders waiting</p>
      <div id="liveMap"></div>
      <h2 style="margin-top:24px">All time</h2>
      <div class="kpis">
        <div class="kpi"><span class="small muted">Completed trips</span><b>${s.allTime.trips}</b></div>
        <div class="kpi"><span class="small muted">Rider spend</span><b>${K.ugx(s.allTime.gmv)}</b></div>
        <div class="kpi"><span class="small muted">Kwata revenue</span><b>${K.ugx(s.allTime.revenue)}</b></div>
        ${s.byService.map((x) => `<div class="kpi"><span class="small muted">${K.SERVICE_LABEL[x.service] || x.service}</span><b>${x.trips}</b><span class="small muted">${K.ugx(x.gmv)}</span></div>`).join('')}
      </div>`;
    liveMap = K.map('liveMap', K.KAMPALA, 12);
    liveLayer = L.layerGroup().addTo(liveMap);
    await loadLive();
    liveTimer = setInterval(loadLive, 5000);
  }

  async function loadLive() {
    if (!liveLayer) return;
    const live = await K.api('/admin/live').catch(() => null);
    if (!live || !document.getElementById('liveMap')) return;
    liveLayer.clearLayers();
    live.drivers.forEach((d) => L.marker([d.lat, d.lng], { icon: K.icon(d.busy ? '🟡' : K.vehicleEmoji(d.vehicle)) }).bindPopup(`<b>${K.esc(d.name)}</b><br>${K.esc(d.plate)}<br>${d.busy ? 'On a trip' : 'Free'}`).addTo(liveLayer));
    live.trips.filter((t) => t.status === 'requested').forEach((t) => L.marker([t.pickup.lat, t.pickup.lng], { icon: K.icon('🙋') }).bindPopup(`Trip #${t.id} · ${K.esc(t.rider.name)} · waiting`).addTo(liveLayer));
  }

  async function drivers(main) {
    const list = await K.api('/admin/drivers');
    main.innerHTML = `<h1>Drivers</h1><p class="muted">Check each driver's permit, logbook and National ID in person before approving.</p>
      <div class="table-wrap"><table><thead><tr><th>Driver</th><th>Vehicle</th><th>Permit</th><th>Trips</th><th>Rating</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((d) => `<tr><td><b>${K.esc(d.name)}</b><br><span class="small muted">${K.esc(d.phone)}</span></td>
        <td>${K.vehicleEmoji(d.vehicleType)} <span class="plate" style="font-size:.8rem;padding:3px 6px">${K.esc(d.plate)}</span><br><span class="small muted">${K.esc(d.vehicle)}</span></td>
        <td>${K.esc(d.licenseNo)}</td><td>${d.trips}</td><td>${d.rating ? '★ ' + d.rating : '—'}</td><td>${K.ugx(d.balance)}</td><td>${badge(d.status)}</td>
        <td style="white-space:nowrap">${d.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-id="${d.id}" data-s="approved">Approve</button>` : `<button class="btn btn-sm" data-id="${d.id}" data-s="suspended">Suspend</button>`}
        ${d.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-id="${d.id}" data-s="rejected">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No drivers yet. Share the driver app link: ' + location.origin + '/driver</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => {
      await K.api(`/admin/drivers/${b.dataset.id}/status`, { status: b.dataset.s });
      K.toast(`Driver ${b.dataset.s}`); await refreshCounts(); show();
    });
  }

  async function riders(main) {
    const list = await K.api('/admin/riders');
    main.innerHTML = `<h1>Riders</h1><div class="table-wrap"><table><thead><tr><th>Rider</th><th>Joined</th><th>Trips</th><th>Wallet</th><th></th></tr></thead><tbody>
      ${list.map((u) => `<tr><td><b>${K.esc(u.name)}</b><br><span class="small muted">${K.esc(u.phone)}</span></td><td>${K.when(u.created_at)}</td><td>${u.trips}</td><td>${K.ugx(u.wallet_balance)}</td>
        <td><button class="btn btn-sm ${u.blocked ? '' : 'btn-ghost'}" data-id="${u.id}" data-b="${!u.blocked}">${u.blocked ? 'Unblock' : 'Block'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No riders yet.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-b]').forEach((b) => b.onclick = async () => {
      if (b.dataset.b === 'true' && !confirm('Block this rider? They will not be able to book.')) return;
      await K.api(`/admin/users/${b.dataset.id}/block`, { blocked: b.dataset.b === 'true' }); show();
    });
  }

  async function trips(main) {
    const list = await K.api('/admin/trips');
    main.innerHTML = `<h1>Trips</h1><div class="table-wrap"><table><thead><tr><th>#</th><th>When</th><th>Type</th><th>Route</th><th>Rider</th><th>Driver</th><th>Fare</th><th>Paid</th><th>Status</th></tr></thead><tbody>
      ${list.map((t) => `<tr><td>${t.id}</td><td class="small">${K.when(t.createdAt)}</td><td>${K.SERVICE_LABEL[t.service]}</td>
        <td class="small">${K.esc(t.pickup.address)}<br>→ ${K.esc(t.drop.address)}<br><span class="muted">${t.distanceKm.toFixed(1)} km</span></td>
        <td class="small">${K.esc(t.rider.name)}<br>${K.esc(t.rider.phone)}</td><td class="small">${t.driver ? K.esc(t.driver.name) + '<br>' + K.esc(t.driver.plate) : '—'}</td>
        <td><b>${K.ugx(t.fare)}</b><br><span class="small muted">cut ${K.ugx(t.commission)}</span></td><td class="small">${K.PAY_LABEL[t.paymentMethod]}<br>${badge(t.paymentStatus)}</td><td>${badge(t.status)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No trips yet.</td></tr>'}
      </tbody></table></div>`;
  }

  async function pricing(main) {
    const s = await K.api('/admin/settings');
    const ids = Object.keys(s.services);
    main.innerHTML = `<h1>Pricing</h1>
      <p class="muted">Fare = (base + per km × distance + per minute × time) × busy multiplier, never below the minimum. Rounded up to the nearest UGX 500.</p>
      <div class="table-wrap"><table class="price"><thead><tr><th>Ride type</th><th>Base</th><th>Per km</th><th>Per min</th><th>Minimum</th><th>Busy ×</th><th>On</th></tr></thead><tbody>
      ${ids.map((id) => { const v = s.services[id]; return `<tr data-id="${id}"><td>${v.icon} <b>${K.esc(v.name)}</b></td>
        ${['base', 'perKm', 'perMin', 'minFare'].map((f) => `<td><input type="number" min="0" step="50" data-f="${f}" value="${v[f]}" aria-label="${f}"></td>`).join('')}
        <td><input type="number" min="1" max="5" step="0.1" data-f="surge" value="${v.surge}" aria-label="busy multiplier"></td>
        <td><input type="checkbox" data-f="enabled" ${v.enabled ? 'checked' : ''} style="width:auto" aria-label="enabled"></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="kpis" style="max-width:720px">
        <div><label for="cp">Kwata commission (%)</label><input id="cp" type="number" min="0" max="50" value="${s.commissionPct}"></div>
        <div><label for="rad">Search radius (km)</label><input id="rad" type="number" min="1" max="30" value="${s.dispatchRadiusKm}"></div>
        <div><label for="to">Seconds to accept</label><input id="to" type="number" min="8" max="60" value="${s.offerTimeoutSec}"></div>
        <div><label for="mw">Min cash out (UGX)</label><input id="mw" type="number" min="0" value="${s.minWithdrawal}"></div>
        <div><label for="sp">Support phone</label><input id="sp" value="${K.esc(s.supportPhone)}"></div>
      </div>
      <button class="btn btn-primary" id="save">Save pricing</button>`;
    K.$('#save').onclick = async () => {
      const services = {};
      main.querySelectorAll('tr[data-id]').forEach((tr) => {
        const o = {};
        tr.querySelectorAll('[data-f]').forEach((i) => { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : +i.value; });
        services[tr.dataset.id] = o;
      });
      await K.api('/admin/settings', { services, commissionPct: +K.$('#cp').value, dispatchRadiusKm: +K.$('#rad').value, offerTimeoutSec: +K.$('#to').value, minWithdrawal: +K.$('#mw').value, supportPhone: K.$('#sp').value }, 'PUT');
      K.toast('Pricing saved. New requests use it right away.');
    };
  }

  async function safety(main) {
    const list = await K.api('/admin/sos');
    main.innerHTML = `<h1>Safety alerts</h1><p class="muted">Call the person first. If you can't reach them, call their emergency contact and the police (999).</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>From</th><th>Trip</th><th>Location</th><th>Emergency contact</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr style="${a.resolved ? '' : 'background:rgba(200,50,43,.08)'}"><td class="small">${K.when(a.created_at)}</td>
        <td><b>${K.esc(a.name)}</b> (${a.role})<br><a href="tel:${K.esc(a.phone)}">${K.esc(a.phone)}</a></td><td>#${a.trip_id}</td>
        <td>${a.lat ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${a.lat},${a.lng}">Open map</a>` : '—'}</td>
        <td>${a.emergency_contact ? `<a href="tel:${K.esc(a.emergency_contact)}">${K.esc(a.emergency_contact)}</a>` : '—'}</td>
        <td>${a.resolved ? badge('resolved') : `<button class="btn btn-sm btn-primary" data-id="${a.id}">Mark resolved</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No alerts. Good.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-id]').forEach((b) => b.onclick = async () => { await K.api(`/admin/sos/${b.dataset.id}/resolve`, {}); await refreshCounts(); show(); });
  }

  async function payouts(main) {
    const list = await K.api('/admin/withdrawals');
    main.innerHTML = `<h1>Driver cash outs</h1><p class="muted">Send the money by Mobile Money, then mark it paid. Rejecting returns the amount to the driver's balance.</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Driver</th><th>Send to</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((w) => `<tr><td class="small">${K.when(w.created_at)}</td><td><b>${K.esc(w.name)}</b><br><span class="small muted">${K.esc(w.phone)}</span></td><td>${K.esc(w.momo_number)}</td><td><b>${K.ugx(w.amount)}</b></td><td>${badge(w.status)}</td>
        <td style="white-space:nowrap">${w.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-id="${w.id}" data-s="paid">Mark paid</button> <button class="btn btn-ghost btn-sm" data-id="${w.id}" data-s="rejected">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No cash-out requests.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => { await K.api(`/admin/withdrawals/${b.dataset.id}`, { status: b.dataset.s }); await refreshCounts(); show(); });
  }

  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== tab) { tab = t; show(); } });

  function beep() {
    try { const c = new AudioContext(); const o = c.createOscillator(); o.frequency.value = 660; o.connect(c.destination); o.start(); o.stop(c.currentTime + .6); } catch {}
  }
})();
