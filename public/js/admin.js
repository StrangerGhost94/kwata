// Flytte admin console
(function () {
  const root = document.getElementById('root');
  const TABS = [['overview', 'Overview'], ['drivers', 'Drivers'], ['checks', 'Photo & plate checks'], ['driverRules', 'Driver rules'], ['riders', 'Riders'], ['trips', 'Trips'], ['pricing', 'Pricing'], ['promos', 'Promotions'], ['help', 'Customer help'], ['safety', 'Safety'], ['payouts', 'Payouts']];
  // Phones: four sections at the bottom, the rest under More.
  const MTABS = [['overview', 'Overview', 'chart'], ['drivers', 'Drivers', 'idcard'], ['checks', 'Checks', 'camera'], ['trips', 'Trips', 'list'], ['more', 'More', 'menu']];
  const MORE = [['help', 'Customer help', 'help'], ['riders', 'Riders', 'person'], ['payouts', 'Driver cash outs', 'cash'], ['safety', 'Safety alerts', 'shield'], ['driverRules', 'Driver rules', 'settings'], ['pricing', 'Pricing', 'tag'], ['promos', 'Promotions', 'gift']];
  let fitRaf = 0;
  let tab = location.hash.slice(1) || 'overview';
  let stats = {}, liveMap, liveLayer, liveTimer, sock;

  K.boot(start, () => K.authScreen(root, { role: 'admin', title: 'Flytte Admin', onDone: start }));

  async function start() {
    root.innerHTML = `<div class="shell"><nav class="side" aria-label="Admin sections">
      <div class="logo" style="display:flex;align-items:center;gap:8px"><svg width="34" height="24" viewBox="0 0 140 100" aria-hidden="true"><g fill="#FFC400"><path d="M14 18H46L43 28H11Z"/><path d="M6 38H42L39 48H3Z"/><path d="M14 58H38L35 68H11Z"/><path d="M52 6H78L60 94H34Z"/><path d="M74 6H138L133.5 28H69.5Z"/><path d="M66.6 42H120L115.9 62H62.5Z"/></g></svg><span>Flytte</span></div>
      ${TABS.map(([id, n]) => `<button data-t="${id}">${n}<span class="count hidden" id="c-${id}"></span></button>`).join('')}
      <button id="out" style="margin-top:20px">Sign out</button></nav>
      <header class="m-top"><svg width="30" height="22" viewBox="0 0 140 100" aria-hidden="true"><g fill="#FFC400"><path d="M14 18H46L43 28H11Z"/><path d="M6 38H42L39 48H3Z"/><path d="M14 58H38L35 68H11Z"/><path d="M52 6H78L60 94H34Z"/><path d="M74 6H138L133.5 28H69.5Z"/><path d="M66.6 42H120L115.9 62H62.5Z"/></g></svg>
        <b>Flytte <span>Admin</span></b><a class="m-sos hidden" id="m-sos" href="#safety">SOS</a></header>
      <main id="main"></main>
      <nav class="m-tabs" aria-label="Admin sections">${MTABS.map(([id, n, ic]) => `<button data-mt="${id}"><span class="m-ic">${K.ic(ic)}<i class="m-count hidden" id="m-${id}"></i></span><span>${n}</span></button>`).join('')}</nav></div>`;
    root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; location.hash = tab; show(); });
    root.querySelectorAll('[data-mt]').forEach((b) => b.onclick = () => { K.haptic && K.haptic(); if (b.dataset.mt === 'more') return moreSheet(); tab = b.dataset.mt; location.hash = tab; show(); });
    new MutationObserver(() => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(() => fitPhone(K.$('#main'))); }).observe(K.$('#main'), { childList: true, subtree: true });
    K.$('#out').onclick = () => K.logout();
    sock = K.socket(K.token());
    sock.on('admin:sos', (a) => { K.toast(`🚨 SOS from ${a.user} on trip #${a.tripId}`, 10000); beep(); refreshCounts(); if (tab === 'safety' || tab === 'overview') show(); });
    sock.on('admin:new_driver', (d) => { K.toast(`New driver signed up: ${d.name}`); refreshCounts(); });
    sock.on('admin:withdrawal', () => refreshCounts());
    sock.on('admin:change', (c) => { K.toast(`${c.name} sent a new ${c.kind === 'photo' ? 'profile photo' : 'vehicle / number plate'} to check`); refreshCounts(); if (tab === 'checks') show(); });
    sock.on('admin:report', (r) => { K.toast(`⚠️ ${r.label}: ${r.driver} (trip #${r.tripId})${r.paused ? ' · driver paused automatically' : ''}`, 10000); beep(); refreshCounts(); if (tab === 'checks') show(); });
    sock.on('admin:trip', () => { if (tab === 'overview') loadLive(); });
    sock.on('admin:issue', (i) => { K.toast(`New ${i.role} report: ${i.label} (trip #${i.tripId})`, 8000); refreshCounts(); if (tab === 'help') show(); });
    await refreshCounts();
    show();
  }

  async function refreshCounts() {
    stats = await K.api('/admin/stats');
    const set = (id, n) => { for (const el of [K.$('#c-' + id), K.$('#m-' + id)]) if (el) { el.textContent = n > 99 ? '99+' : n; el.classList.toggle('hidden', !n); } };
    set('drivers', stats.pendingDrivers); set('safety', stats.openSos); set('help', stats.openIssues); set('payouts', stats.pendingWithdrawals);
    set('checks', (stats.pendingChanges || 0) + (stats.openReports || 0));
    set('more', (stats.openSos || 0) + (stats.pendingWithdrawals || 0) + (stats.openIssues || 0));
    const sos = K.$('#m-sos'); if (sos) { sos.textContent = `SOS ${stats.openSos}`; sos.classList.toggle('hidden', !stats.openSos); }
  }

  function show() {
    clearInterval(liveTimer);
    root.querySelectorAll('[data-t]').forEach((b) => b.setAttribute('aria-current', b.dataset.t === tab ? 'page' : 'false'));
    const inMore = MORE.some(([id]) => id === tab);
    root.querySelectorAll('[data-mt]').forEach((b) => b.setAttribute('aria-current', (b.dataset.mt === tab || (inMore && b.dataset.mt === 'more')) ? 'page' : 'false'));
    window.scrollTo(0, 0);
    const main = K.$('#main');
    main.innerHTML = K.skeleton('title-list', 5);
    ({ overview, drivers, checks, driverRules, riders, trips, pricing, promos, help, safety, payouts }[tab] || overview)(main).catch((e) => { main.innerHTML = `<p class="error">${K.esc(e.message)}</p>`; });
  }

  // The rest of the sections, as a sheet.
  function moreSheet() {
    const c = { payouts: stats.pendingWithdrawals, safety: stats.openSos, help: stats.openIssues };
    const m = K.modal(`<div class="more-sheet"><h2>More</h2>
      ${MORE.map(([id, n, ic]) => `<button class="more-row ${tab === id ? 'on' : ''}" data-go="${id}"><span class="mr-ic">${K.ic(ic)}</span><span class="grow">${n}</span>${c[id] ? `<span class="count ${id === 'safety' ? 'red' : ''}">${c[id]}</span>` : ''}${K.ic('chev')}</button>`).join('')}
      <button class="more-row out" data-go="out"><span class="mr-ic">${K.ic('logout')}</span><span class="grow">Sign out</span></button></div>`);
    m.el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => {
      m.close();
      if (b.dataset.go === 'out') { K.logout(); return; }
      tab = b.dataset.go; location.hash = tab; show();
    });
  }

  // Phones: tables become cards (each value labelled with its column), and long notes fold to two lines.
  function fitPhone(main) {
    if (!main) return;
    main.querySelectorAll('table:not(.fitted)').forEach((t) => {
      t.classList.add('fitted', 'cards');
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach((tr) => {
        const tds = [...tr.children];
        if (tds.length === 1) { tds[0].classList.add('c-empty'); return; }
        tds.forEach((td, i) => {
          td.dataset.label = heads[i] || '';
          if (i === 0) td.classList.add('c-head');
          else if (!heads[i] && td.querySelector('button, a.btn')) td.classList.add('c-actions');
          else if (td.querySelector('input[type=text], input:not([type])') || td.textContent.trim().length > 34) td.classList.add('c-wide');
        });
      });
    });
    main.querySelectorAll('p.muted:not(.folded)').forEach((p) => {
      p.classList.add('folded');
      if (p.textContent.trim().length < 110 || p.closest('.card, table, .kpi')) return;
      p.classList.add('fold');
      const more = document.createElement('button'); more.type = 'button'; more.className = 'fold-btn'; more.textContent = 'More';
      more.onclick = () => { const open = p.classList.toggle('open'); more.textContent = open ? 'Less' : 'More'; };
      p.after(more);
    });
    ['save', 'saveR', 'saveG'].forEach((id) => { const b = main.querySelector('#' + id); if (b) b.classList.add('save-sticky'); });
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
        <div class="kpi"><span class="small muted">Flytte revenue (24h)</span><b>${K.ugx(s.today.revenue)}</b></div>
        <div class="kpi"><span class="small muted">Drivers online</span><b>${s.onlineDrivers}</b><span class="small muted">of ${s.drivers} approved</span></div>
        <div class="kpi"><span class="small muted">Live trips</span><b>${s.activeTrips}</b></div>
        <div class="kpi"><span class="small muted">Riders</span><b>${s.riders}</b></div>
      </div>
      ${nightShareBlock(s.nightShare)}
      <h2>Live map</h2>
      <p class="small muted">Black vehicles are free drivers, gold markers are drivers on a trip, white circles are riders waiting.</p>
      <div id="liveMap"></div>
      <h2 style="margin-top:24px">All time</h2>
      <div class="kpis">
        <div class="kpi"><span class="small muted">Completed trips</span><b>${s.allTime.trips}</b></div>
        <div class="kpi"><span class="small muted">Rider spend</span><b>${K.ugx(s.allTime.gmv)}</b></div>
        <div class="kpi"><span class="small muted">Flytte revenue</span><b>${K.ugx(s.allTime.revenue)}</b></div>
        ${s.byService.map((x) => `<div class="kpi"><span class="small muted">${K.SERVICE_LABEL[x.service] || x.service}</span><b>${x.trips}</b><span class="small muted">${K.ugx(x.gmv)}</span></div>`).join('')}
      </div>`;
    liveMap = K.map('liveMap', K.KAMPALA, 12);
    liveLayer = L.layerGroup().addTo(liveMap);
    await loadLive();
    liveTimer = setInterval(loadLive, 5000);
  }

  // Night-trip sharing: whether SMS is set up, and what went out since Monday (Kampala time).
  function nightShareBlock(n) {
    if (!n) return '';
    const w = n.week || {};
    const state = n.sms === 'live' ? `<b style="color:var(--go)">SMS is on</b><span class="small muted">EgoSMS keys are set${n.senderId ? ' · own sender ID' : ' · default sender'}</span>`
      : n.sms === 'demo' ? '<b>Test mode</b><span class="small muted">Local server: texts are printed in the log</span>'
      : '<b style="color:var(--stop)">SMS is off</b><span class="small muted">Add EGOSMS_USERNAME and EGOSMS_PASSWORD in Railway. Riders get a one-tap WhatsApp send meanwhile.</span>';
    return `<h2 style="margin-top:24px">Night-trip sharing</h2>
      <div class="kpis" id="nightShareKpis">
        <div class="kpi"><span class="small muted">Texts</span>${state}</div>
        <div class="kpi"><span class="small muted">Sent by SMS this week</span><b>${w.sms || 0}</b></div>
        <div class="kpi"><span class="small muted">Offered on WhatsApp this week</span><b>${w.whatsapp || 0}</b><span class="small muted">${w.opened || 0} opened by the rider</span></div>
        <div class="kpi"><span class="small muted">Failed this week</span><b>${w.failed || 0}</b></div>
      </div>`;
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
      <div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Driver</th><th>Vehicle</th><th>Permit</th><th>Trips</th><th>Rating</th><th title="Last 30 days: requests accepted · trips cancelled by the driver">Accept · cancel</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((d) => `<tr><td><b>${K.esc(d.name)}</b><br><span class="small muted">${K.esc(K.prettyPhone(d.phone))}</span></td>
        <td>${K.vehicleEmoji(d.vehicleType)} <span class="plate-tag">${K.esc(d.plate)}</span><br><span class="small muted">${K.esc(d.vehicle)}</span></td>
        <td>${K.esc(d.licenseNo)}${expiryTag(d.nextExpiry)}</td><td>${d.trips}</td><td>${d.rating ? '★ ' + d.rating : '—'}</td>
        <td>${d.acceptanceRate == null ? '<span class="muted">—</span>' : `${d.acceptanceRate}% / ${d.cancellationRate ?? 0}%`}</td>
        <td>${d.balance < 0 ? `<span style="color:var(--stop)">${K.ugx(d.balance)}</span><br><span class="tiny muted">owes commission</span>` : K.ugx(d.balance)}</td><td>${badge(d.status)}</td>
        <td style="white-space:nowrap"><button class="btn btn-sm" data-docs="${d.id}" data-name="${K.esc(d.name)}" data-status="${d.status}" data-plate="${K.esc(d.plate)}" data-veh="${K.esc(d.vehicle)}" data-woman="${d.woman ? 1 : ''}">${d.status === 'pending' ? 'Check & approve' : 'Documents'} (${d.docs || 0}/4)</button>
        ${d.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-id="${d.id}" data-s="approved">Approve</button>` : `<button class="btn btn-sm" data-id="${d.id}" data-s="suspended">Suspend</button>`}
        <button class="btn btn-ghost btn-sm" data-pw="${d.id}" data-name="${K.esc(d.name)}">Reset password</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No drivers yet. Click “Add driver” after you’ve met and checked them.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => {
      await K.api(`/admin/drivers/${b.dataset.id}/status`, { status: b.dataset.s });
      K.toast(`Driver ${b.dataset.s}`); await refreshCounts(); show();
    });
    bindReset(main);
    K.$('#addDriver').onclick = addDriver;
    main.querySelectorAll('[data-docs]').forEach((b) => b.onclick = () => showDocs(b.dataset.docs, b.dataset.name, b.dataset.status, { plate: b.dataset.plate, vehicle: b.dataset.veh, woman: !!b.dataset.woman }));
  }

  function expiryTag(day) {
    if (!day) return '';
    const days = Math.round((Date.parse(day) - Date.parse(new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10))) / 86400e3);
    if (days < 0) return `<br><span class="badge bad">Document expired ${day}</span>`;
    if (days <= 30) return `<br><span class="badge warn">Expires in ${days} day${days === 1 ? '' : 's'}</span>`;
    return `<br><span class="tiny muted">Next expiry ${day}</span>`;
  }

  // Photo & plate checks: changes drivers asked for, and riders' reports that something didn't match.
  async function checks(main) {
    const [changes, reports] = await Promise.all([K.api('/admin/changes'), K.api('/admin/reports')]);
    const img = (src, cap) => `<figure>${src ? `<a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${K.esc(cap)}"></a>` : '<div class="noimg">None</div>'}<figcaption>${K.esc(cap)}</figcaption></figure>`;
    const veh = (v) => `<b class="plate-tag">${K.esc(v.plate || '—')}</b><br><span class="small muted">${K.esc([v.vehicleColor, v.vehicleMake].filter(Boolean).join(' ') || '—')}</span>`;
    const open = reports.filter((r) => !r.resolved), done = reports.filter((r) => r.resolved);
    main.innerHTML = `<h1>Photo & plate checks</h1>
      <p class="muted" style="max-width:760px">Drivers can’t change their photo or number plate on their own. Check each request against their ID, permit and vehicle photo. Riders keep seeing the approved details until you approve.</p>
      <h2 style="margin-top:22px">Waiting for you (${changes.length})</h2>
      ${changes.length ? changes.map((c) => `<div class="check-card" data-c="${c.id}">
          <div class="cc-head"><span><b>${K.esc(c.driver.name)}</b> <span class="small muted">${K.esc(c.driver.phone)} · ${K.when(c.at)}</span></span><span class="badge warn">${c.kind === 'photo' ? (c.driver.status === 'approved' ? 'New profile photo' : 'Sign-up photo') : 'Vehicle / plate change'}</span></div>
          ${c.kind === 'photo'
            ? `<div class="doc-thumbs four">${img(c.current.photo, 'Approved photo')}${img(c.requested.photo, 'New photo')}${img(c.compare.national_id, 'National ID')}${img(c.compare.license, 'Driving permit')}</div>
               <p class="small muted">Approve only if the new photo is clearly the same person as on the ID and permit.</p>`
            : `<div class="veh-compare"><div><span class="small muted">Now</span><br>${veh(c.current)}</div><div class="arrow">→</div><div><span class="small muted">Asked for</span><br>${veh(c.requested)}</div></div>
               <div class="doc-thumbs">${img(c.current.photo, 'Current vehicle photo')}${img(c.requested.photo, 'New vehicle photo (live)')}</div>
               <p class="small muted">Approve only if the plate in the new photo is readable and matches what they typed. Check the registration if anything looks off.</p>`}
          <div class="row" style="gap:8px;flex-wrap:wrap"><input class="fill" data-note placeholder="Reason, if you reject (the driver sees this)" maxlength="200" style="min-width:220px">
            <button class="btn btn-danger-soft" data-dec="reject">Reject</button><button class="btn btn-primary" data-dec="approve">Approve</button></div>
        </div>`).join('') : '<div class="card muted">Nothing waiting.</div>'}
      <h2 style="margin-top:28px">Reports from riders (${open.length} open)</h2>
      <p class="muted" style="max-width:760px">When riders report the wrong face or number plate, the driver is paused automatically after the number set in Driver rules (different riders, last 30 days).</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Report</th><th>Driver</th><th>Rider</th><th>Reports (30 days)</th><th></th></tr></thead><tbody>
        ${[...open, ...done].map((r) => `<tr class="${r.resolved ? 'faded' : ''}"><td>${K.when(r.at)}<br><span class="small muted">Trip #${r.tripId}</span></td>
          <td><b>${K.esc(r.label)}</b>${r.note ? `<br><span class="small">“${K.esc(r.note)}”</span>` : ''}</td>
          <td>${K.esc(r.driver.name)}<br><span class="plate-tag">${K.esc(r.driver.plate)}</span> ${badge(r.driver.status)}</td>
          <td>${K.esc(r.rider)}</td><td>${r.reports30}</td>
          <td style="white-space:nowrap">${r.resolved ? `<span class="small muted">${r.dismissed ? 'Not a problem' : 'Confirmed'}</span>`
            : `<button class="btn btn-sm" data-rep="${r.id}" data-act="confirm">Confirmed</button><button class="btn btn-ghost btn-sm" data-rep="${r.id}" data-act="dismiss">Not a problem</button>`}
            ${r.driver.status === 'approved' ? `<button class="btn btn-danger-soft btn-sm" data-drv="${r.driver.id}" data-s="suspended">Pause driver</button>` : r.driver.status === 'suspended' ? `<button class="btn btn-sm" data-drv="${r.driver.id}" data-s="approved">Reactivate</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No reports.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-c]').forEach((card) => card.querySelectorAll('[data-dec]').forEach((b) => b.onclick = async () => {
      const note = card.querySelector('[data-note]').value.trim();
      if (b.dataset.dec === 'reject' && !note) { K.toast('Write the reason first, so the driver can fix it.'); card.querySelector('[data-note]').focus(); return; }
      try { await K.api(`/admin/changes/${card.dataset.c}`, { decision: b.dataset.dec, note }); K.toast(b.dataset.dec === 'approve' ? 'Approved. Riders see it from now on.' : 'Rejected. The driver has been told why.'); await refreshCounts(); show(); }
      catch (e) { K.toast(e.message); }
    }));
    main.querySelectorAll('[data-rep]').forEach((b) => b.onclick = async () => { await K.api(`/admin/reports/${b.dataset.rep}`, { action: b.dataset.act }); await refreshCounts(); show(); });
    main.querySelectorAll('[data-drv]').forEach((b) => b.onclick = async () => { await K.api(`/admin/drivers/${b.dataset.drv}/status`, { status: b.dataset.s }); K.toast(b.dataset.s === 'approved' ? 'Driver reactivated' : 'Driver paused'); show(); });
  }

  // Driver rules: waiting time, no-show fee, cash commission limit, heading home, next trips, bonuses.
  async function driverRules(main) {
    const s = await K.api('/admin/settings');
    const d = s.drivers, bonuses = s.bonuses.slice();
    const draw = () => {
      main.innerHTML = `<h1>Driver rules</h1>
        <p class="muted" style="max-width:720px">These protect drivers and keep commission collected. Changes apply to new trips straight away.</p>
        <div class="kpis" style="max-width:720px">
          <div><label for="fw">Free waiting at pickup (min)</label><input id="fw" type="number" min="0" max="30" value="${d.freeWaitMin}"></div>
          <div><label for="nf">No-show fee to driver (UGX)</label><input id="nf" type="number" min="0" step="500" value="${d.noShowFee}"></div>
          <div><label for="cf">Late cancellation fee to driver (UGX)</label><input id="cf" type="number" min="0" step="500" value="${d.cancelFee}"></div>
          <div><label for="cg">Free cancellation after a driver accepts (minutes)</label><input id="cg" type="number" min="0" max="30" value="${d.cancelGraceMin}"></div>
          <div><label for="dl">Pause cash trips when owed (UGX)</label><input id="dl" type="number" min="0" step="1000" value="${d.cashDebtLimit}"></div>
          <div><label for="hh">Heading home uses per day</label><input id="hh" type="number" min="0" max="10" value="${d.headingHomePerDay}"></div>
          <div><label for="rd">Document reminder (days before)</label><input id="rd" type="number" min="1" max="90" value="${d.docReminderDays}"></div>
          <div><label for="mp">Pause driver after reports of wrong face or plate</label><input id="mp" type="number" min="0" max="20" value="${d.mismatchPauseReports}"></div>
          <div><label><input type="checkbox" id="qn" ${d.queueNext ? 'checked' : ''} style="width:auto"> Line up the next trip near drop-off</label></div>
          <div><label><input type="checkbox" id="sd" ${d.showDestination !== false ? 'checked' : ''} style="width:auto"> Show the destination before a driver accepts</label>
            <span class="small muted" style="display:block">Off: drivers see only the trip length until they accept. Fewer drivers skip short or out-of-the-way trips, but some may cancel after accepting.</span></div>
        </div>
        <p class="small muted" style="max-width:720px">Reports count different riders in the last 30 days; 0 means never pause automatically. The no-show fee is taken from the rider’s wallet only when it covers it. Set the cash limit to 0 to never pause cash trips. Set heading home to 0 to switch it off.</p>
        <h2 style="margin-top:26px">Bonuses</h2>
        <p class="muted" style="max-width:720px">Flytte pays these into the driver’s balance as soon as the target is reached, once per day or week (Kampala time). Drivers see their progress on the home screen.</p>
        <div class="table-wrap" style="max-width:820px"><table><thead><tr><th>Name drivers see</th><th>Trips</th><th>Reward (UGX)</th><th>Every</th><th>On</th><th></th></tr></thead><tbody>
          ${bonuses.map((b, i) => `<tr data-i="${i}"><td><input data-f="title" maxlength="60" value="${K.esc(b.title)}"></td>
            <td><input data-f="trips" type="number" min="1" max="200" value="${b.trips}" style="width:80px"></td>
            <td><input data-f="reward" type="number" min="0" step="500" value="${b.reward}" style="width:110px"></td>
            <td><select data-f="period"><option value="day" ${b.period === 'day' ? 'selected' : ''}>Day</option><option value="week" ${b.period === 'week' ? 'selected' : ''}>Week</option></select></td>
            <td><input data-f="active" type="checkbox" ${b.active ? 'checked' : ''} style="width:auto"></td>
            <td><button class="btn btn-ghost btn-sm" data-del="${i}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No bonuses yet.</td></tr>'}
        </tbody></table></div>
        <button class="btn btn-sm" id="addB" style="margin:10px 0 22px" ${bonuses.length >= 10 ? 'disabled' : ''}>${K.ic('plus', 'sm')} Add bonus</button><br>
        <button class="btn btn-primary" id="saveR">Save driver rules</button>`;
      const read = () => main.querySelectorAll('tr[data-i]').forEach((tr) => {
        const b = bonuses[+tr.dataset.i];
        tr.querySelectorAll('[data-f]').forEach((x) => { b[x.dataset.f] = x.type === 'checkbox' ? x.checked : x.type === 'number' ? +x.value : x.value; });
      });
      K.$('#addB').onclick = () => { read(); bonuses.push({ title: 'Complete 10 trips today', trips: 10, reward: 5000, period: 'day', active: false }); draw(); };
      main.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { read(); bonuses.splice(+b.dataset.del, 1); draw(); });
      K.$('#saveR').onclick = async () => {
        read();
        try {
          const out = await K.api('/admin/settings', { drivers: { freeWaitMin: +K.$('#fw').value, noShowFee: +K.$('#nf').value, cancelFee: +K.$('#cf').value, cancelGraceMin: +K.$('#cg').value, cashDebtLimit: +K.$('#dl').value, headingHomePerDay: +K.$('#hh').value, docReminderDays: +K.$('#rd').value, mismatchPauseReports: +K.$('#mp').value, queueNext: K.$('#qn').checked, showDestination: K.$('#sd').checked }, bonuses }, 'PUT');
          Object.assign(d, out.drivers); bonuses.splice(0, bonuses.length, ...out.bonuses);
          K.toast('Driver rules saved.'); draw();
        } catch (e) { K.toast(e.message); }
      };
    };
    draw();
  }

  // Approving a driver: their photo next to the National ID and permit, and the plate they typed
  // next to the vehicle photo. Approving the driver approves the photo and plate too.
  async function showDocs(id, name, status, veh = {}) {
    const m = K.modal(`<h2>${K.esc(name)}</h2><div class="doc-thumbs"><i class="sk" style="height:180px"></i><i class="sk" style="height:180px"></i></div>`);
    m.el.classList.add('wide-modal');
    try {
      const docs = await K.api(`/admin/drivers/${id}/documents`);
      const by = (k) => docs.find((d) => d.kind === k && d.pending) || docs.find((d) => d.kind === k);
      const fig = (d, cap) => `<figure>${d ? `<a href="${d.url}" target="_blank" rel="noopener"><img src="${d.url}" alt="${K.esc(cap)}"></a>` : '<div class="noimg">Not uploaded</div>'}<figcaption>${K.esc(cap)}${d ? `<br><span class="muted" style="font-weight:500">${K.when(d.at)}</span>` : ''}</figcaption></figure>`;
      const photo = by('photo');
      m.el.innerHTML = `<h2>${K.esc(name)}</h2>
        <h3 style="margin:10px 0 6px">Is this the same person?</h3>
        <div class="doc-thumbs four">${fig(photo, photo && photo.pending ? 'Profile photo (to check)' : 'Profile photo')}${fig(by('national_id'), 'National ID')}${fig(by('license'), 'Driving permit')}${fig(by('insurance'), 'Insurance (optional)')}</div>
        <h3 style="margin:14px 0 6px">Does the plate match?</h3>
        <div class="veh-compare"><div><span class="small muted">Typed at sign-up</span><br><b class="plate-tag">${K.esc(veh.plate || '—')}</b><br><span class="small muted">${K.esc(veh.vehicle || '')}</span></div>
          <div style="flex:1;max-width:260px">${fig(by('vehicle'), 'Vehicle photo')}</div></div>
        <p class="small muted">${status !== 'approved' ? 'Approve only if the photo is clearly the person on the ID and permit, and the plate in the vehicle photo is the one typed. Approving the driver approves their photo and plate.' : 'This driver is approved. Photo and plate changes come to Photo & plate checks.'}</p>
        <label class="row" style="gap:8px;align-items:flex-start;margin-top:12px;font-weight:600"><input type="checkbox" id="wd" ${veh.woman ? 'checked' : ''} style="width:auto;margin-top:3px">
          <span>Woman driver<br><span class="small muted" style="font-weight:400">Gets requests from riders who ask for a woman driver. Tick only when the ID confirms it.</span></span></label>
        <div class="row" style="margin-top:14px">
          ${status !== 'approved' ? `<button class="btn btn-danger-soft fill" data-st="rejected">Reject</button><button class="btn btn-primary fill" data-st="approved">Approve driver</button>` : '<button class="btn fill" data-close>Close</button>'}
        </div>`;
      K.$('#wd', m.el).onchange = async (e) => {
        try { await K.api(`/admin/drivers/${id}/woman`, { woman: e.target.checked }); K.toast(e.target.checked ? 'Marked as a woman driver' : 'No longer marked as a woman driver'); }
        catch (err) { e.target.checked = !e.target.checked; K.toast(err.message); }
      };
      m.el.querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => {
        await K.api(`/admin/drivers/${id}/status`, { status: b.dataset.st });
        m.close(); K.toast(b.dataset.st === 'approved' ? 'Driver approved, with their photo and plate.' : 'Driver rejected'); await refreshCounts(); show();
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
      ${list.map((u) => `<tr><td><b>${K.esc(u.name)}</b><br><span class="small muted">${K.esc(K.prettyPhone(u.phone))}</span></td><td>${K.when(u.created_at)}</td><td>${u.trips}</td><td>${K.ugx(u.wallet_balance)}</td>
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
    main.innerHTML = `<h1>Trips</h1><div class="table-wrap"><table><thead><tr><th>Trip</th><th>Route</th><th>Rider</th><th>Driver</th><th>Fare</th><th>Paid</th></tr></thead><tbody>
      ${list.map((t) => `<tr><td><span class="trip-id"><b>#${t.id}</b> · ${K.SERVICE_LABEL[t.service]}</span> ${badge(t.status)}<br><span class="small muted">${K.when(t.createdAt)}</span></td>
        <td class="small">${K.esc(t.pickup.address)} → ${K.esc(t.drop.address)}<br><span class="muted">${t.distanceKm.toFixed(1)} km</span></td>
        <td class="small">${K.esc(t.rider.name)}<br><span class="muted">${K.esc(K.prettyPhone(t.rider.phone))}</span></td><td class="small">${t.driver ? K.esc(t.driver.name) + '<br><span class="plate-tag">' + K.esc(t.driver.plate) + '</span>' : '—'}</td>
        <td><b>${K.ugx(t.fare)}</b><br><span class="small muted">Flytte ${K.ugx(t.commission)}</span></td><td class="small">${K.PAY_LABEL[t.paymentMethod]}<br>${badge(t.paymentStatus)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No trips yet.</td></tr>'}
      </tbody></table></div>`;
  }

  async function pricing(main) {
    const s = await K.api('/admin/settings');
    const ids = Object.keys(s.services);
    main.innerHTML = `<h1>Pricing</h1>
      <p class="muted">Fare = (base + per km × distance + per minute × time in traffic, never below the minimum) × surge. Rounded to the nearest UGX 100 (nearest 500 above UGX 20,000). Default rates are set about 8–10% below Bolt’s Kampala prices.</p>
      <div class="table-wrap"><table class="price"><thead><tr><th>Ride type</th><th>Base</th><th>Per km</th><th>Per min</th><th>Minimum</th><th>Fixed boost ×</th><th>On</th><th>Description riders see</th></tr></thead><tbody>
      ${ids.map((id) => { const v = s.services[id]; return `<tr data-id="${id}"><td>${v.icon} <b>${K.esc(v.name)}</b></td>
        ${['base', 'perKm', 'perMin', 'minFare'].map((f) => `<td><input type="number" min="0" step="50" data-f="${f}" value="${v[f]}" aria-label="${f}"></td>`).join('')}
        <td><input type="number" min="1" max="5" step="0.1" data-f="surge" value="${v.surge}" aria-label="busy multiplier"></td>
        <td><input type="checkbox" data-f="enabled" ${v.enabled ? 'checked' : ''} style="width:auto" aria-label="enabled"></td>
        <td><input type="text" maxlength="60" data-f="blurb" value="${K.esc(v.blurb || '')}" aria-label="${K.esc(v.name)} description" style="min-width:200px"></td></tr>`; }).join('')}
      </tbody></table></div>
      <div class="kpis" style="max-width:720px">
        <div><label for="cp">Flytte commission (%)</label><input id="cp" type="number" min="0" max="50" value="${s.commissionPct}"></div>
        <div><label for="rad">Search radius (km)</label><input id="rad" type="number" min="1" max="30" value="${s.dispatchRadiusKm}"></div>
        <div><label for="to">Seconds to accept</label><input id="to" type="number" min="8" max="60" value="${s.offerTimeoutSec}"></div>
        <div><label for="mw">Min cash out (UGX)</label><input id="mw" type="number" min="0" value="${s.minWithdrawal}"></div>
        <div><label for="sf">Fee per extra stop (UGX)</label><input id="sf" type="number" min="0" step="500" value="${s.stopFee}"></div>
        <div><label for="ef">Errand shopping fee (UGX)</label><input id="ef" type="number" min="0" step="500" value="${(s.errand || {}).shopFee ?? 2000}"></div>
        <div><label for="eb">Most a courier spends on one errand (UGX)</label><input id="eb" type="number" min="5000" step="5000" value="${(s.errand || {}).maxBudget ?? 200000}"></div>
        <div><label for="sp">Support phone</label><input id="sp" type="tel" value="${K.esc(s.supportPhone || '')}" placeholder="Not set: hidden in the apps"></div>
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
        tr.querySelectorAll('[data-f]').forEach((i) => { o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.type === 'text' ? i.value : +i.value; });
        services[tr.dataset.id] = o;
      });
      await K.api('/admin/settings', { services, commissionPct: +K.$('#cp').value, dispatchRadiusKm: +K.$('#rad').value, offerTimeoutSec: +K.$('#to').value, minWithdrawal: +K.$('#mw').value, stopFee: +K.$('#sf').value, errand: { shopFee: +K.$('#ef').value, maxBudget: +K.$('#eb').value }, supportPhone: K.$('#sp').value,
        dynamic: { enabled: K.$('#dyn').checked, weather: K.$('#wx').checked, sensitivity: +K.$('#sens').value, maxBoda: +K.$('#mb').value, maxCar: +K.$('#mc').value } }, 'PUT');
      K.toast('Pricing saved. New requests use it right away.');
    };
  }

  async function promos(main) {
    const [s, data] = await Promise.all([K.api('/admin/settings'), K.api('/admin/promos')]);
    const g = s.growth;
    const svcs = Object.entries(s.services);
    main.innerHTML = `<h1>Promotions</h1>
      <p class="muted" style="max-width:720px">Flytte pays for every discount and reward. Drivers always earn on the full fare.</p>
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
        <div><label><input type="checkbox" id="rw-on" ${g.rewards.enabled ? 'checked' : ''} style="width:auto"> Flytte Rewards</label>
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
        <td><b>${K.esc(a.name)}</b> (${a.role})<br><a href="tel:${K.esc(a.phone)}">${K.esc(K.prettyPhone(a.phone))}</a></td><td>#${a.trip_id}</td>
        <td>${a.lat ? `<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${a.lat},${a.lng}">Open map</a>` : '—'}</td>
        <td>${a.emergency_contact ? `<a href="tel:${K.esc(a.emergency_contact)}">${K.esc(a.emergency_contact)}</a>` : '—'}</td>
        <td>${a.resolved ? badge('resolved') : `<button class="btn btn-sm btn-primary" data-id="${a.id}">Mark resolved</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No alerts. Good.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-id]').forEach((b) => b.onclick = async () => { await K.api(`/admin/sos/${b.dataset.id}/resolve`, {}); await refreshCounts(); show(); });
  }

  // Customer help: reports from a trip (lost items, fares, behaviour). Reply closes it and alerts the customer.
  async function help(main) {
    const [list, fb] = await Promise.all([K.api('/admin/issues'), K.api('/admin/feedback').catch(() => null)]);
    const open = list.filter((i) => i.status === 'open'), done = list.filter((i) => i.status !== 'open');
    const card = (i) => `<div class="card issue-card ${i.status}" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${K.esc(i.label)}</b><span class="small muted">${K.when(i.at)} · trip #${i.tripId}</span></div>
      <p style="margin:6px 0">${K.esc(i.details || '')}</p>
      <p class="small muted" style="margin:0">From <b>${K.esc(i.from.name)}</b> (${i.role}) · <a href="tel:${K.esc(i.from.phone)}">${K.esc(K.prettyPhone(i.from.phone))}</a></p>
      <p class="small muted" style="margin:4px 0 0">${K.esc(String(i.trip.pickup).split(',')[0])} → ${K.esc(String(i.trip.drop).split(',')[0])} · ${K.ugx(i.trip.fare)} · ${K.esc(i.trip.paymentMethod)}</p>
      <p class="small muted" style="margin:4px 0 0">Rider: ${K.esc(i.trip.rider.name || '—')} <a href="tel:${K.esc(i.trip.rider.phone || '')}">${K.esc(K.prettyPhone(i.trip.rider.phone || ''))}</a>
        ${i.trip.driver ? ` · Driver: ${K.esc(i.trip.driver.name)} (${K.esc(i.trip.driver.plate || '')}) <a href="tel:${K.esc(i.trip.driver.phone)}">${K.esc(K.prettyPhone(i.trip.driver.phone))}</a>` : ''}</p>
      ${i.status === 'open' ? `<label for="rp${i.id}" style="margin-top:10px">Reply to the ${i.role}</label><textarea id="rp${i.id}" rows="2" maxlength="1000" placeholder="${i.kind === 'lost_item' ? 'e.g. Your driver has the phone and will drop it at the Kampala Road office tomorrow at 10am.' : 'What you found and what happens next'}"></textarea>
        <button class="btn btn-primary btn-sm" style="margin-top:8px" data-reply="${i.id}">Send reply and close</button>`
        : `<div class="issue-reply" style="margin-top:8px"><small>Your reply · ${K.when(i.resolvedAt)}</small>${K.esc(i.reply || '')}</div>`}</div>`;
    main.innerHTML = `<h1>Customer help</h1><p class="muted">Reports riders and drivers send from a trip. Call them if it’s urgent; your reply reaches them in the app and as a notification.</p>
      <h2>Open (${open.length})</h2>${open.map(card).join('') || '<p class="muted">Nothing waiting.</p>'}
      ${done.length ? `<h2 style="margin-top:24px">Resolved</h2>${done.slice(0, 40).map(card).join('')}` : ''}
      ${fb && fb.count ? `<h2 style="margin-top:24px">App ratings · ★ ${fb.average} from ${fb.count}</h2>${fb.items.slice(0, 30).map((f) => `<div class="card" style="margin-bottom:8px"><b>${'★'.repeat(f.stars)}${'☆'.repeat(5 - f.stars)}</b> <span class="small muted">${K.esc(f.name)} · ${K.when(f.at)}</span>${f.note ? `<p style="margin:6px 0 0">${K.esc(f.note)}</p>` : ''}</div>`).join('')}` : ''}`;
    main.querySelectorAll('[data-reply]').forEach((b) => b.onclick = async () => {
      const ta = K.$('#rp' + b.dataset.reply, main);
      if (!ta.value.trim()) { ta.focus(); return; }
      b.disabled = true;
      try { await K.api(`/admin/issues/${b.dataset.reply}`, { reply: ta.value.trim() }); K.toast('Reply sent'); await refreshCounts(); show(); }
      catch (e) { K.toast(e.message); b.disabled = false; }
    });
  }

  async function payouts(main) {
    const list = await K.api('/admin/withdrawals');
    main.innerHTML = `<h1>Driver cash outs</h1><p class="muted">Send the money by Mobile Money, then mark it paid. Rejecting returns the amount to the driver's balance.</p>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Driver</th><th>Send to</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((w) => `<tr><td class="small">${K.when(w.created_at)}</td><td><b>${K.esc(w.name)}</b><br><span class="small muted">${K.esc(K.prettyPhone(w.phone))}</span></td><td>${K.esc(K.prettyPhone(w.momo_number))}</td><td><b>${K.ugx(w.amount)}</b></td><td>${badge(w.status)}</td>
        <td style="white-space:nowrap">${w.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-id="${w.id}" data-s="paid">Mark paid</button> <button class="btn btn-ghost btn-sm" data-id="${w.id}" data-s="rejected">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No cash-out requests.</td></tr>'}
      </tbody></table></div>`;
    main.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => { await K.api(`/admin/withdrawals/${b.dataset.id}`, { status: b.dataset.s }); await refreshCounts(); show(); });
  }

  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && t !== tab) { tab = t; show(); } });

  function beep() {
    try { const c = new AudioContext(); const o = c.createOscillator(); o.frequency.value = 660; o.connect(c.destination); o.start(); o.stop(c.currentTime + .6); } catch {}
  }
})();
