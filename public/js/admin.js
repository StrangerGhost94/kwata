// Kwata admin console
(function () {
  const root = document.getElementById('root');
  const TABS = [['overview', 'Overview'], ['drivers', 'Drivers'], ['riders', 'Riders'], ['trips', 'Trips'], ['pricing', 'Pricing'], ['promos', 'Promotions'], ['safety', 'Safety'], ['payouts', 'Payouts']];
  let tab = location.hash.slice(1) || 'overview';
  let stats = {}, liveMap, liveLayer, liveTimer, sock;

  if (!K.token()) K.authScreen(root, { role: 'admin', title: 'Kwata Admin', onDone: start });
  else start();

  async function start() {
    root.innerHTML = `<div class="shell"><nav class="side" aria-label="Admin sections">
      <div class="logo" style="display:flex;align-items:center;gap:8px"><svg width="34" height="24" viewBox="0 0 140 100" aria-hidden="true"><g fill="#FFC400"><path d="M14 18H46L43 28H11Z"/><path d="M6 38H42L39 48H3Z"/><path d="M14 58H38L35 68H11Z"/><path d="M52 6H78L60 94H34Z"/><path d="M66 50L110 6H138L80 60Z"/><path d="M64 52L88 48L122 94H94Z"/></g></svg><span>Kwata</span></div>
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
    main.innerHTML = K.skeleton('title-list', 5);
    ({ overview, drivers, riders, trips, pricing, promos, safety, payouts }[tab] || overview)(main).catch((e) => { main.innerHTML = `<p class="error">${K.esc(e.message)}</p>`; });
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
      <p class="small muted">Black vehicles are free drivers, gold markers are drivers on a trip, white circles are riders waiting.</p>
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
    live.drivers.forEach((d) => L.marker([d.lat, d.lng], { icon: d.busy ? K.divIcon('<div style="width:16px;height:16px;border-radius:50%;background:#E8B100;border:3px solid #000"></div>', [16, 16]) : K.divIcon(`<div class="veh" style="width:30px;height:30px">${d.vehicle === 'car' ? '<svg viewBox="0 0 40 40" style="width:26px;height:26px"><rect x="12.5" y="4" width="15" height="32" rx="6" fill="#141414" stroke="#fff" stroke-width="1.6"/></svg>' : '<svg viewBox="0 0 40 40" style="width:26px;height:26px"><rect x="17" y="3" width="6" height="34" rx="3" fill="#141414" stroke="#fff" stroke-width="1.4"/><circle cx="20" cy="21" r="5.5" fill="#E8B100" stroke="#141414" stroke-width="1.8"/></svg>'}</div>`, [30, 30]) }).bindPopup(`<b>${K.esc(d.name)}</b><br>${K.esc(d.plate)}<br>${d.busy ? 'On a trip' : 'Free'}`).addTo(liveLayer));
    live.trips.filter((t) => t.status === 'requested').forEach((t) => L.marker([t.pickup.lat, t.pickup.lng], { icon: K.divIcon('<div class="pin-ci" style="background:#fff;border-color:#000"></div>', [16, 16]) }).bindPopup(`Trip #${t.id} · ${K.esc(t.rider.name)} · waiting`).addTo(liveLayer));
  }

  async function drivers(main) {
    const list = await K.api('/admin/drivers');
    main.innerHTML = `<div class="row" style="align-items:flex-end;margin-bottom:6px"><div class="grow"><h1 style="margin:0">Drivers</h1>
        <p class="muted" style="margin:6px 0 0">Drivers apply in the Driver app and upload their documents. Check them here before approving, or add a driver you’ve met in person.</p></div>
        <button class="btn btn-primary" id="addDriver" style="flex:none">${K.ic('plus')} Add driver</button></div>
      <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Driver</th><th>Vehicle</th><th>Permit</th><th>Trips</th><th>Rating</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((d) => `<tr><td><b>${K.esc(d.name)}</b><br><span class="small muted">${K.esc(d.phone)}</span></td>
        <td>${K.vehicleEmoji(d.vehicleType)} <span class="plate-tag">${K.esc(d.plate)}</span><br><span class="small muted">${K.esc(d.vehicle)}</span></td>
        <td>${K.esc(d.licenseNo)}</td><td>${d.trips}</td><td>${d.rating ? '★ ' + d.rating : '—'}</td><td>${K.ugx(d.balance)}</td><td>${badge(d.status)}</td>
        <td style="white-space:nowrap"><button class="btn btn-sm" data-docs="${d.id}" data-name="${K.esc(d.name)}" data-status="${d.status}">Documents (${d.docs || 0}/4)</button>
        ${d.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-id="${d.id}" data-s="approved">Approve</button>` : `<button class="btn btn-sm" data-id="${d.id}" data-s="suspended">Suspend</button>`}
        <button class="btn btn-ghost btn-sm" data-pw="${d.id}" data-name="${K.esc(d.name)}">Reset password</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No drivers yet. Click “Add driver” after you’ve met and checked them.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => {
      await K.api(`/admin/drivers/${b.dataset.id}/status`, { status: b.dataset.s });
      K.toast(`Driver ${b.dataset.s}`); await refreshCounts(); show();
    });
    bindReset(main);
    K.$('#addDriver').onclick = addDriver;
    main.querySelectorAll('[data-docs]').forEach((b) => b.onclick = () => showDocs(b.dataset.docs, b.dataset.name, b.dataset.status));
  }

  async function showDocs(id, name, status) {
    const m = K.modal(`<h2>${name}</h2><div class="doc-thumbs"><i class="sk" style="height:180px"></i><i class="sk" style="height:180px"></i></div>`);
    try {
      const docs = await K.api(`/admin/drivers/${id}/documents`);
      m.el.innerHTML = `<h2>${name}</h2><p class="small muted">Check that the name, photo and number plate match before approving.</p>
        ${docs.length ? `<div class="doc-thumbs">${docs.map((d) => `<figure><a href="${d.url}" target="_blank" rel="noopener"><img src="${d.url}" alt="${K.esc(d.label)}"></a><figcaption>${K.esc(d.label)}<br><span class="muted" style="font-weight:500">${K.when(d.at)}</span></figcaption></figure>`).join('')}</div>`
          : '<div class="card" style="margin:10px 0">This driver hasn’t uploaded any documents yet.</div>'}
        <div class="row" style="margin-top:14px">
          ${status !== 'approved' ? `<button class="btn btn-danger-soft fill" data-st="rejected">Reject</button><button class="btn btn-primary fill" data-st="approved">Approve</button>` : '<button class="btn fill" data-close>Close</button>'}
        </div>`;
      m.el.querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => {
        await K.api(`/admin/drivers/${id}/status`, { status: b.dataset.st });
        m.close(); K.toast(`Driver ${b.dataset.st}`); await refreshCounts(); show();
      });
    } catch (e) { m.el.innerHTML = `<p class="error">${K.esc(e.message)}</p>`; }
  }

  function addDriver() {
    const m = K.modal(`<h2>Add a driver</h2>
      <p class="muted small">Only add drivers whose permit, logbook and National ID you’ve checked. Give them the phone and password to sign in to the Driver app at <b>${location.origin}/driver</b>.</p>
      <form id="df" novalidate>
        <label for="d-name">Full name</label><input id="d-name" name="name" required>
        <div class="row"><div class="fill"><label for="d-phone">Phone</label><input id="d-phone" name="phone" type="tel" placeholder="0772 123456" required></div>
          <div class="fill"><label for="d-pw">Starting password</label><input id="d-pw" name="password" minlength="6" required></div></div>
        <div class="row"><div class="fill"><label for="d-vt">Vehicle</label><select id="d-vt" name="vehicleType"><option value="boda">Boda boda</option><option value="car">Car</option></select></div>
          <div class="fill"><label for="d-plate">Number plate</label><input id="d-plate" name="plate" placeholder="UFA 123X" required></div></div>
        <div class="row"><div class="fill"><label for="d-make">Make and model</label><input id="d-make" name="vehicleMake" placeholder="Bajaj Boxer"></div>
          <div class="fill"><label for="d-color">Colour</label><input id="d-color" name="vehicleColor" placeholder="Red"></div></div>
        <div class="row"><div class="fill"><label for="d-lic">Driving permit no.</label><input id="d-lic" name="licenseNo" required></div>
          <div class="fill"><label for="d-momo">Mobile Money for payouts</label><input id="d-momo" name="momoNumber" type="tel" placeholder="Same as phone"></div></div>
        <p class="error" id="err"></p>
        <button class="btn btn-primary btn-block btn-lg" type="submit">Add driver</button>
      </form>`);
    const f = K.$('#df', m.el);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f).entries());
      try { await K.api('/admin/drivers', data); m.close(); K.toast(`${data.name} added. They can sign in to the Driver app now.`); await refreshCounts(); show(); }
      catch (ex) { K.$('#err', m.el).textContent = ex.message; }
    };
  }

  function bindReset(root) {
    root.querySelectorAll('[data-pw]').forEach((b) => b.onclick = () => {
      const m = K.modal(`<h2>Reset password</h2><p class="muted small">Set a new password for <b>${b.dataset.name}</b> and tell them in person or by phone.</p>
        <label for="np">New password</label><input id="np" minlength="6" autocomplete="off">
        <p class="error" id="err"></p><button class="btn btn-primary btn-block btn-lg" id="go">Save password</button>`);
      K.$('#go', m.el).onclick = async () => {
        try { await K.api(`/admin/users/${b.dataset.pw}/password`, { password: K.$('#np', m.el).value }); m.close(); K.toast('Password updated'); }
        catch (ex) { K.$('#err', m.el).textContent = ex.message; }
      };
    });
  }

  async function riders(main) {
    const list = await K.api('/admin/riders');
    main.innerHTML = `<h1>Riders</h1><div class="table-wrap"><table><thead><tr><th>Rider</th><th>Joined</th><th>Trips</th><th>Wallet</th><th></th></tr></thead><tbody>
      ${list.map((u) => `<tr><td><b>${K.esc(u.name)}</b><br><span class="small muted">${K.esc(u.phone)}</span></td><td>${K.when(u.created_at)}</td><td>${u.trips}</td><td>${K.ugx(u.wallet_balance)}</td>
        <td style="white-space:nowrap"><button class="btn btn-sm ${u.blocked ? '' : 'btn-ghost'}" data-id="${u.id}" data-b="${!u.blocked}">${u.blocked ? 'Unblock' : 'Block'}</button>
        <button class="btn btn-ghost btn-sm" data-pw="${u.id}" data-name="${K.esc(u.name)}">Reset password</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No riders yet.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-b]').forEach((b) => b.onclick = async () => {
      if (b.dataset.b === 'true' && !confirm('Block this rider? They will not be able to book.')) return;
      await K.api(`/admin/users/${b.dataset.id}/block`, { blocked: b.dataset.b === 'true' }); show();
    });
    bindReset(main);
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
      <p class="muted">Fare = (base + per km × distance + per minute × time in traffic, never below the minimum) × surge. Rounded to the nearest UGX 100 (nearest 500 above UGX 20,000). Default rates are set about 8–10% below Bolt’s Kampala prices.</p>
      <div class="table-wrap"><table class="price"><thead><tr><th>Ride type</th><th>Base</th><th>Per km</th><th>Per min</th><th>Minimum</th><th>Fixed boost ×</th><th>On</th></tr></thead><tbody>
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
      <h2 style="margin-top:26px">Dynamic pricing</h2>
      <p class="muted" style="max-width:720px">Like Bolt and Uber, fares rise automatically when an area has more ride requests than free drivers, or when it rains. Increases are gentle, smoothed and capped, and riders always pay the upfront price they accepted. “Fixed boost” above is a manual minimum on top of this.</p>
      <div class="kpis" style="max-width:720px">
        <div><label><input type="checkbox" id="dyn" ${s.dynamic.enabled ? 'checked' : ''} style="width:auto"> Automatic surge</label></div>
        <div><label><input type="checkbox" id="wx" ${s.dynamic.weather ? 'checked' : ''} style="width:auto"> Rain boost (live weather)</label></div>
        <div><label for="sens">Sensitivity (0.05–1)</label><input id="sens" type="number" min="0.05" max="1" step="0.05" value="${s.dynamic.sensitivity}"></div>
        <div><label for="mb">Max boda surge ×</label><input id="mb" type="number" min="1" max="3" step="0.1" value="${s.dynamic.maxBoda}"></div>
        <div><label for="mc">Max car surge ×</label><input id="mc" type="number" min="1" max="3" step="0.1" value="${s.dynamic.maxCar}"></div>
      </div>
      <div class="card" id="live" style="max-width:720px;margin:14px 0">Checking live conditions…</div>
      <div class="row" style="max-width:720px;margin-bottom:18px"><span class="grow small muted">Weather feed wrong or offline? Switch rain on or off by hand.</span>
        <button class="btn btn-sm" data-rain="4">It’s raining</button><button class="btn btn-sm" data-rain="0">Dry</button><button class="btn btn-sm btn-ghost" data-rain="">Use live weather</button></div>
      <button class="btn btn-primary" id="save">Save pricing</button>`;
    const live = async () => {
      try {
        const c = await K.api('/admin/pricing/live');
        const row = (n, x) => `<b>${n}:</b> ×${x.mult}${x.reasons.length ? ' (' + x.reasons.join(', ') + ')' : ''}`;
        K.$('#live').innerHTML = `<b>Central Kampala now</b><br>${row('Boda & parcel', c.boda)} · ${row('Cars', c.car)}<br>
          <span class="small muted">Rain: ${c.rainMm} mm/h${c.raining ? ' (raining)' : ''} · Traffic: ${c.traffic}${c.bodaDebug ? ` · Boda demand ${c.bodaDebug.demand.score.toFixed(1)} vs ${c.bodaDebug.supply} free riders · Car demand ${c.carDebug.demand.score.toFixed(1)} vs ${c.carDebug.supply} free drivers` : ''}</span>`;
      } catch (e) { K.$('#live').textContent = e.message; }
    };
    live();
    main.querySelectorAll('[data-rain]').forEach((b) => b.onclick = async () => {
      await K.api('/admin/pricing/rain', { mm: b.dataset.rain === '' ? null : +b.dataset.rain });
      K.toast(b.dataset.rain === '' ? 'Using live weather' : b.dataset.rain === '0' ? 'Rain boost off' : 'Rain boost on'); live();
    });
    K.$('#save').onclick = async () => {
      const services = {};
      main.querySelectorAll('tr[data-id]').forEach((tr) => {
        const o = {};
        tr.querySelectorAll('[data-f]').forEach((i) => { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : +i.value; });
        services[tr.dataset.id] = o;
      });
      await K.api('/admin/settings', { services, commissionPct: +K.$('#cp').value, dispatchRadiusKm: +K.$('#rad').value, offerTimeoutSec: +K.$('#to').value, minWithdrawal: +K.$('#mw').value, supportPhone: K.$('#sp').value,
        dynamic: { enabled: K.$('#dyn').checked, weather: K.$('#wx').checked, sensitivity: +K.$('#sens').value, maxBoda: +K.$('#mb').value, maxCar: +K.$('#mc').value } }, 'PUT');
      K.toast('Pricing saved. New requests use it right away.');
    };
  }

  async function promos(main) {
    const [s, data] = await Promise.all([K.api('/admin/settings'), K.api('/admin/promos')]);
    const g = s.growth;
    const svcs = Object.entries(s.services);
    main.innerHTML = `<h1>Promotions</h1>
      <p class="muted" style="max-width:720px">Kwata pays for every discount and reward. Drivers always earn on the full fare.</p>
      <div class="kpis" style="max-width:900px">
        <div class="kpi"><span class="small muted">First-ride discounts given</span><b>${data.firstRide.n}</b><span class="small muted">${K.ugx(data.firstRide.spent)}</span></div>
        <div class="kpi"><span class="small muted">Invite & points rewards paid</span><b>${data.rewardsPaid.n}</b><span class="small muted">${K.ugx(data.rewardsPaid.spent)}</span></div>
        <div class="kpi"><span class="small muted">Active promo codes</span><b>${data.promos.filter((p) => p.active).length}</b><span class="small muted">${K.ugx(data.promos.reduce((a, p) => a + p.spent, 0))} spent</span></div>
      </div>
      <h2 style="margin-top:22px">Automatic offers</h2>
      <div class="kpis" style="max-width:900px">
        <div><label><input type="checkbox" id="fr-on" ${g.firstRide.enabled ? 'checked' : ''} style="width:auto"> First-ride discount</label>
          <div class="row g-fields"><span><small>% off</small><input id="fr-p" type="number" min="0" max="100" value="${g.firstRide.percent}"></span><span><small>Up to (UGX)</small><input id="fr-m" type="number" min="0" step="500" value="${g.firstRide.max}"></span></div></div>
        <div><label><input type="checkbox" id="rf-on" ${g.referral.enabled ? 'checked' : ''} style="width:auto"> Invite a friend</label>
          <div class="row g-fields"><span><small>Inviter gets (UGX)</small><input id="rf-a" type="number" min="0" step="500" value="${g.referral.referrer}"></span><span><small>Friend gets (UGX)</small><input id="rf-b" type="number" min="0" step="500" value="${g.referral.friend}"></span></div></div>
        <div><label><input type="checkbox" id="rw-on" ${g.rewards.enabled ? 'checked' : ''} style="width:auto"> Kwata Rewards</label>
          <div class="row g-fields"><span><small>Points per UGX 1,000</small><input id="rw-e" type="number" min="0" value="${g.rewards.pointsPer1000}"></span><span><small>Points to redeem</small><input id="rw-p" type="number" min="1" value="${g.rewards.redeemPoints}"></span><span><small>Worth (UGX)</small><input id="rw-v" type="number" min="0" step="500" value="${g.rewards.redeemValue}"></span></div></div>
      </div>
      <button class="btn btn-primary" id="saveG">Save offers</button>
      <h2 style="margin-top:26px">Promo codes</h2>
      <form id="pf" class="card" style="max-width:900px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end">
        <div><label for="p-code">Code</label><input id="p-code" placeholder="KAMPALA20" style="text-transform:uppercase" required></div>
        <div><label for="p-kind">Type</label><select id="p-kind"><option value="percent">% off</option><option value="flat">UGX off</option></select></div>
        <div><label for="p-val">Value</label><input id="p-val" type="number" min="1" placeholder="20" required></div>
        <div><label for="p-max">Max discount (UGX)</label><input id="p-max" type="number" min="0" placeholder="optional"></div>
        <div><label for="p-min">Min fare (UGX)</label><input id="p-min" type="number" min="0" placeholder="0"></div>
        <div><label for="p-uses">Total uses</label><input id="p-uses" type="number" min="1" placeholder="unlimited"></div>
        <div><label for="p-per">Uses per rider</label><input id="p-per" type="number" min="1" value="1"></div>
        <div><label for="p-exp">Expires</label><input id="p-exp" type="date"></div>
        <div><label for="p-svc">Ride type</label><select id="p-svc"><option value="">All</option>${svcs.map(([id, v]) => `<option value="${id}">${K.esc(v.name)}</option>`).join('')}</select></div>
        <div><label><input type="checkbox" id="p-first" style="width:auto"> First rides only</label></div>
        <div><button class="btn btn-primary btn-block" type="submit">Create code</button></div>
        <p class="error" id="perr" style="grid-column:1/-1;margin:0"></p>
      </form>
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Code</th><th>Offer</th><th>Rules</th><th>Used</th><th>Spent</th><th>Status</th><th></th></tr></thead><tbody>
        ${data.promos.map((p) => `<tr><td><b>${K.esc(p.code)}</b>${p.note ? `<br><span class="small muted">${K.esc(p.note)}</span>` : ''}</td>
          <td>${p.kind === 'flat' ? K.ugx(p.value) + ' off' : p.value + '% off'}${p.max_discount ? `<br><span class="small muted">max ${K.ugx(p.max_discount)}</span>` : ''}</td>
          <td class="small">${[p.first_ride_only ? 'First rides' : '', p.min_fare ? 'Min ' + K.ugx(p.min_fare) : '', p.services ? p.services : '', p.per_user + '× per rider', p.expires_at ? 'Until ' + new Date(p.expires_at).toLocaleDateString('en-UG') : ''].filter(Boolean).join(' · ')}</td>
          <td>${p.uses}${p.max_uses ? ' / ' + p.max_uses : ''}</td><td>${K.ugx(p.spent)}</td>
          <td>${badge(p.active ? 'approved' : 'suspended').replace('approved', 'active').replace('suspended', 'off')}</td>
          <td><button class="btn btn-sm" data-code="${K.esc(p.code)}" data-on="${!p.active}">${p.active ? 'Switch off' : 'Switch on'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No promo codes yet.</td></tr>'}
      </tbody></table></div>`;
    const v = (id) => K.$('#' + id).value;
    K.$('#saveG').onclick = async () => {
      await K.api('/admin/settings', { growth: {
        firstRide: { enabled: K.$('#fr-on').checked, percent: +v('fr-p'), max: +v('fr-m') },
        referral: { enabled: K.$('#rf-on').checked, referrer: +v('rf-a'), friend: +v('rf-b') },
        rewards: { enabled: K.$('#rw-on').checked, pointsPer1000: +v('rw-e'), redeemPoints: +v('rw-p'), redeemValue: +v('rw-v') },
      } }, 'PUT');
      K.toast('Offers saved');
    };
    K.$('#pf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await K.api('/admin/promos', { code: v('p-code'), kind: v('p-kind'), value: +v('p-val'), maxDiscount: v('p-max'), minFare: v('p-min'), maxUses: v('p-uses'), perUser: v('p-per'), expiresAt: v('p-exp') ? v('p-exp') + 'T23:59:59' : null, services: v('p-svc') ? [v('p-svc')] : [], firstRideOnly: K.$('#p-first').checked });
        K.toast('Promo code created'); promos(main);
      } catch (err) { K.$('#perr').textContent = err.message; }
    };
    main.querySelectorAll('[data-code]').forEach((b) => b.onclick = async () => { await K.api(`/admin/promos/${b.dataset.code}/active`, { active: b.dataset.on === 'true' }); promos(main); });
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
