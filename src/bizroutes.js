// API for Flytte for Business (company accounts), Flytte for Shops (deliveries and the shop's order link)
// and school runs. Mounted by src/routes.js.
const db = require('./db');
const auth = require('./auth');
const rt = require('./realtime');
const payments = require('./payments');
const sms = require('./sms');
const places = require('./places');
const biz = require('./business');
const { getSettings } = require('./pricing');

module.exports = function mount(r, { wrap, bad, limit, clean, baseUrl, point }) {
  const prettyTime = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const admin = async (req, res) => {
    const c = await biz.adminOf(req.user.id, Number(req.params.id));
    if (!c) { bad(res, 'Only an admin of this account can do that.', 403); return null; }
    return c;
  };
  const monthRange = (m) => {
    const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
    const from = ok ? new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 1) - 3 * 3600e3) : biz.monthStart();
    const k = new Date(from.getTime() + 3 * 3600e3);
    const to = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 1) - 3 * 3600e3);
    return { from, to, label: k.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }), key: k.toISOString().slice(0, 7) };
  };
  const tripRow = (t) => ({
    id: t.id, at: t.created_at, completedAt: t.completed_at, status: t.status, service: t.service, from: t.pickup_address, to: t.drop_address,
    amount: t.fare - (t.discount || 0), by: t.rider_name, byPhone: t.rider_phone, merchant: t.merchant,
    customer: t.parcel ? JSON.parse(t.parcel) : null, track: t.share_token ? `/t/${t.share_token}` : null,
  });
  const shopOf = (b) => {
    const p = point(b && b.shop);
    return p && p.address !== 'Pinned location' ? p : null;
  };

  // ---------- Accounts ----------
  r.get('/business/me', auth.requireAuth('rider'), wrap(async (req, res) => {
    const s = await getSettings();
    res.json({ companies: await biz.myCompanies(req.user.id), enabled: s.business.enabled });
  }));

  r.post('/business', auth.requireAuth('rider'), limit(5, 3600e3, (req) => 'user:' + req.user.id), wrap(async (req, res) => {
    const s = await getSettings();
    if (!s.business.enabled) return bad(res, 'Flytte for Business isn’t open for sign-ups right now.');
    const b = req.body || {};
    const kind = b.kind === 'merchant' ? 'merchant' : 'business';
    const name = clean(b.name, 60);
    if (name.length < 2) return bad(res, kind === 'merchant' ? 'Enter your shop’s name.' : 'Enter your company’s name.');
    const email = b.email ? String(b.email).trim().slice(0, 120) : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address for statements.');
    const shop = shopOf(b);
    if (kind === 'merchant' && !shop) return bad(res, 'Set where riders collect deliveries from your shop.');
    const mine = await db.one("SELECT COUNT(*)::int AS n FROM company_members WHERE user_id = $1 AND role = 'admin'", [req.user.id]);
    if (mine.n >= 3) return bad(res, 'You already run 3 accounts. Contact Flytte to add more.');
    const c = await db.one(`INSERT INTO companies(kind, name, slug, email, phone, shop_address, shop_lat, shop_lng, credit_limit, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [kind, name, kind === 'merchant' ? await biz.slugFor(name) : null, email, req.user.phone, shop ? shop.address : null, shop ? shop.lat : null, shop ? shop.lng : null, s.business.creditLimit, req.user.id]);
    await db.query("INSERT INTO company_members(company_id, user_id, role) VALUES ($1,$2,'admin')", [c.id, req.user.id]);
    res.json({ id: c.id, companies: await biz.myCompanies(req.user.id) });
  }));

  // The admin's dashboard: what's owed, this month, staff and their budgets, recent trips, shop requests.
  r.get('/business/:id', auth.requireAuth('rider'), wrap(async (req, res) => {
    const c = await admin(req, res); if (!c) return;
    const m = monthRange();
    const { rows: staff } = await db.query(`SELECT m.user_id, m.role, m.monthly_budget, m.active, u.name, u.phone FROM company_members m JOIN users u ON u.id = m.user_id
      WHERE m.company_id = $1 ORDER BY m.active DESC, m.role, u.name`, [c.id]);
    for (const x of staff) x.spent = await biz.spentThisMonth(c.id, x.user_id);
    const list = await biz.trips(c.id, new Date(Date.now() - 45 * 86400e3), new Date(Date.now() + 86400e3));
    const month = list.filter((t) => t.status === 'completed' && new Date(t.created_at) >= m.from);
    const { rows: reqs } = c.kind === 'merchant' ? await db.query("SELECT * FROM delivery_requests WHERE company_id = $1 AND status = 'new' ORDER BY id DESC LIMIT 50", [c.id]) : { rows: [] };
    res.json({
      id: c.id, kind: c.kind, name: c.name, email: c.email, slug: c.slug, link: c.slug ? `${baseUrl(req)}/shop/${c.slug}` : null,
      shop: c.shop_lat ? { address: c.shop_address, lat: c.shop_lat, lng: c.shop_lng } : null,
      balanceDue: c.balance_due, creditLimit: c.credit_limit, payments: payments.available(),
      month: { label: m.label, trips: month.length, spent: month.reduce((a, t) => a + t.fare - (t.discount || 0), 0) },
      staff: staff.map((x) => ({ userId: x.user_id, name: x.name, phone: x.phone, role: x.role, budget: x.monthly_budget, active: x.active, spent: x.spent, me: x.user_id === req.user.id })),
      trips: list.slice(0, 40).map(tripRow),
      live: list.filter((t) => ['requested', 'accepted', 'arrived', 'in_progress'].includes(t.status)).length,
      requests: reqs.map((q) => ({ id: q.id, name: q.name, phone: q.phone, address: q.address, lat: q.lat, lng: q.lng, note: q.note, at: q.created_at })),
    });
  }));

  r.patch('/business/:id', auth.requireAuth('rider'), wrap(async (req, res) => {
    const c = await admin(req, res); if (!c) return;
    const b = req.body || {};
    const name = b.name !== undefined ? clean(b.name, 60) : c.name;
    if (name.length < 2) return bad(res, 'Enter a name.');
    const email = b.email !== undefined ? (String(b.email).trim().slice(0, 120) || null) : c.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address.');
    const shop = b.shop !== undefined ? shopOf(b) : null;
    await db.query('UPDATE companies SET name = $1, email = $2, shop_address = COALESCE($3, shop_address), shop_lat = COALESCE($4, shop_lat), shop_lng = COALESCE($5, shop_lng) WHERE id = $6',
      [name, email, shop ? shop.address : null, shop ? shop.lat : null, shop ? shop.lng : null, c.id]);
    res.json({ ok: true });
  }));

  // Staff are added by the phone number they use on Flytte.
  r.post('/business/:id/members', auth.requireAuth('rider'), limit(60, 3600e3, (req) => 'user:' + req.user.id), wrap(async (req, res) => {
    const c = await admin(req, res); if (!c) return;
    const b = req.body || {};
    const phone = auth.normalizePhone(b.phone, auth.ccOf(req.user.phone));
    if (!phone) return bad(res, 'Enter their phone number, e.g. 0772 123456.');
    const u = await db.one("SELECT id, name, role FROM users WHERE phone = $1", [phone]);
    if (!u || u.role !== 'rider') return bad(res, 'Nobody has signed up to Flytte with that number yet. Ask them to get the app, then add them.');
    const budget = Math.max(0, Math.min(10000000, Math.round(Number(b.budget) || 0)));
    const role = b.role === 'admin' ? 'admin' : 'staff';
    await db.query(`INSERT INTO company_members(company_id, user_id, role, monthly_budget) VALUES ($1,$2,$3,$4)
      ON CONFLICT (company_id, user_id) DO UPDATE SET active = TRUE, role = EXCLUDED.role, monthly_budget = EXCLUDED.monthly_budget`, [c.id, u.id, role, budget]);
    rt.notify(u.id, 'toast', { text: `You’ve been added to ${c.name} on Flytte for Business. Choose it as your payment for work trips.` });
    res.json({ ok: true, name: u.name });
  }));

  r.patch('/business/:id/members/:uid', auth.requireAuth('rider'), wrap(async (req, res) => {
    const c = await admin(req, res); if (!c) return;
    const uid = Number(req.params.uid), b = req.body || {};
    const m = await db.one('SELECT * FROM company_members WHERE company_id = $1 AND user_id = $2', [c.id, uid]);
    if (!m) return bad(res, 'That person isn’t on this account.', 404);
    const role = b.role === 'admin' || b.role === 'staff' ? b.role : m.role;
    const active = b.active === undefined ? m.active : b.active !== false;
    if ((role !== 'admin' || !active) && m.role === 'admin') {
      const others = await db.one("SELECT COUNT(*)::int AS n FROM company_members WHERE company_id = $1 AND role = 'admin' AND active AND user_id <> $2", [c.id, uid]);
      if (!others.n) return bad(res, 'An account needs at least one admin. Make someone else an admin first.');
    }
    const budget = b.budget === undefined ? m.monthly_budget : Math.max(0, Math.min(10000000, Math.round(Number(b.budget) || 0)));
    await db.query('UPDATE company_members SET role = $1, active = $2, monthly_budget = $3 WHERE company_id = $4 AND user_id = $5', [role, active, budget, c.id, uid]);
    res.json({ ok: true });
  }));

  // A month's statement: every trip charged to the account, and what was paid.
  r.get('/business/:id/statement', auth.requireAuth('rider'), wrap(async (req, res) => {
    const c = await admin(req, res); if (!c) return;
    const m = monthRange(req.query.month);
    const rows = (await biz.trips(c.id, m.from, m.to)).filter((t) => t.status === 'completed');
    const { rows: paid } = await db.query("SELECT amount, note, created_at FROM company_ledger WHERE company_id = $1 AND kind = 'payment' AND created_at >= $2 AND created_at < $3 ORDER BY id", [c.id, m.from, m.to]);
    const byPerson = {};
    for (const t of rows) { const k = t.rider_name; byPerson[k] = byPerson[k] || { name: k, trips: 0, spent: 0 }; byPerson[k].trips++; byPerson[k].spent += t.fare - (t.discount || 0); }
    res.json({
      company: c.name, month: m.key, label: m.label, balanceDue: c.balance_due,
      trips: rows.map((t) => ({ ...tripRow(t), when: prettyTime(t.completed_at || t.created_at) })),
      total: rows.reduce((a, t) => a + t.fare - (t.discount || 0), 0),
      people: Object.values(byPerson).sort((a, b) => b.spent - a.spent),
      payments: paid.map((p) => ({ amount: -p.amount, note: p.note, when: prettyTime(p.created_at) })),
    });
  }));

  r.post('/business/:id/pay', auth.requireAuth('rider'), limit(10, 3600e3, (req) => 'user:' + req.user.id), wrap(async (req, res) => {
    const c = await admin(req, res); if (!c) return;
    const amount = Math.round(Number((req.body || {}).amount) || c.balance_due);
    if (!(amount >= 1000)) return bad(res, 'There’s nothing to pay right now.');
    if (amount > c.balance_due) return bad(res, `The account owes UGX ${c.balance_due.toLocaleString()}.`);
    let out;
    const pick = await payments.chosenPhone(req.user, req.body);
    if (pick.error) return bad(res, pick.error);
    try { out = await payments.createCheckout({ user: req.user, amount, purpose: 'company', method: 'momo', baseUrl: baseUrl(req), companyId: c.id, phone: pick.phone }); }
    catch (e) { if (e instanceof payments.PaymentsUnavailable) return bad(res, e.message, 503); throw e; }
    res.json(out);
  }));

  // ---------- Shops: the order link customers use (no sign-in) ----------
  const shopBySlug = (slug) => db.one("SELECT * FROM companies WHERE slug = $1 AND kind = 'merchant' AND status = 'active'", [String(slug || '').slice(0, 40)]);
  r.get('/shop/:slug', wrap(async (req, res) => {
    const c = await shopBySlug(req.params.slug);
    if (!c) return bad(res, 'This shop link isn’t valid.', 404);
    res.json({ name: c.name, area: c.shop_address ? String(c.shop_address).split(',')[0] : null });
  }));
  r.get('/shop/:slug/places', limit(120, 10 * 60e3), wrap(async (req, res) => {
    const c = await shopBySlug(req.params.slug);
    if (!c) return bad(res, 'This shop link isn’t valid.', 404);
    const near = c.shop_lat ? { lat: c.shop_lat, lng: c.shop_lng } : undefined;
    const out = await places.search(String(req.query.q || '').slice(0, 80), near);
    res.json({ results: out.results.slice(0, 6).map((p) => ({ name: p.name, address: p.address, lat: p.lat, lng: p.lng })) });
  }));
  r.post('/shop/:slug/request', limit(5, 10 * 60e3), wrap(async (req, res) => {
    const c = await shopBySlug(req.params.slug);
    if (!c) return bad(res, 'This shop link isn’t valid.', 404);
    const b = req.body || {};
    const name = clean(b.name, 60), phone = auth.normalizePhone(b.phone);
    if (name.length < 2) return bad(res, 'Enter your name.');
    if (!phone) return bad(res, 'Enter your phone number, e.g. 0772 123456.');
    const p = point(b.drop);
    if (!p) return bad(res, 'Choose where it should be delivered.');
    const note = clean(b.note, 300);
    if (note.length < 2) return bad(res, 'Say what you’re ordering, or your order number.');
    const recent = await db.one("SELECT COUNT(*)::int AS n FROM delivery_requests WHERE company_id = $1 AND phone = $2 AND created_at > NOW() - INTERVAL '1 hour'", [c.id, phone]);
    if (recent.n >= 3) return bad(res, 'You’ve sent a few requests already. The shop will be in touch.');
    const q = await db.one('INSERT INTO delivery_requests(company_id, name, phone, address, lat, lng, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [c.id, name, phone, p.address, p.lat, p.lng, note]);
    const { rows } = await db.query('SELECT user_id FROM company_members WHERE company_id = $1 AND active', [c.id]);
    for (const m of rows) {
      rt.notify(m.user_id, 'toast', { text: `New delivery request from ${name} for ${c.name}` });
      require('./drivers').push(m.user_id, { app: 'rider', type: 'shop', title: `New delivery request · ${c.name}`, body: `${name}: ${note.slice(0, 80)}` }, { ttl: 3600, urgency: 'normal' }).catch(() => {});
    }
    res.json({ ok: true, id: q.id });
  }));

  // Staff answer a request: "sent" (with the trip they booked) or "declined".
  r.post('/business/:id/requests/:rid', auth.requireAuth('rider'), wrap(async (req, res) => {
    const m = await db.one('SELECT c.* FROM company_members m JOIN companies c ON c.id = m.company_id WHERE m.user_id = $1 AND m.company_id = $2 AND m.active', [req.user.id, Number(req.params.id)]);
    if (!m) return bad(res, 'You’re not on this account.', 403);
    const b = req.body || {};
    const status = b.status === 'declined' ? 'declined' : 'sent';
    const tripId = status === 'sent' ? Number(b.tripId) : null;
    if (status === 'sent' && !(await db.one('SELECT id FROM trips WHERE id = $1 AND company_id = $2', [tripId, m.id]))) return bad(res, 'Book the delivery first.');
    const q = await db.one("UPDATE delivery_requests SET status = $1, trip_id = $2 WHERE id = $3 AND company_id = $4 AND status = 'new' RETURNING *", [status, tripId, Number(req.params.rid), m.id]);
    if (!q) return bad(res, 'Someone has already handled this request.');
    if (status === 'declined' && sms.enabled()) sms.send(q.phone, `${m.name} can't deliver your order through Flytte right now. Please contact the shop.`).catch(() => {});
    res.json({ ok: true });
  }));

  // After booking a shop delivery: text the customer the live link and their delivery code (when SMS is set
  // up); the app also offers the same message on WhatsApp.
  r.post('/business/:id/deliveries/:tripId/notify', auth.requireAuth('rider'), limit(60, 3600e3, (req) => 'user:' + req.user.id), wrap(async (req, res) => {
    const t = await db.one('SELECT t.*, c.name AS company FROM trips t JOIN companies c ON c.id = t.company_id JOIN company_members m ON m.company_id = c.id AND m.user_id = $1 AND m.active WHERE t.id = $2 AND t.company_id = $3',
      [req.user.id, Number(req.params.tripId), Number(req.params.id)]);
    if (!t || !t.parcel) return bad(res, 'Delivery not found.', 404);
    const pc = JSON.parse(t.parcel);
    const text = `${t.company}: your order is on its way with Flytte. Follow it live: ${baseUrl(req)}/t/${t.share_token}${t.drop_code ? ` · Give the rider this code when it arrives: ${t.drop_code}` : ''}`;
    let texted = false;
    if (sms.enabled()) texted = await sms.send(pc.recipientPhone, text).then(() => true).catch(() => false);
    res.json({ texted, text, phone: pc.recipientPhone });
  }));

  // Shop deliveries in progress (they aren't the staff member's own trip, so the app asks here).
  r.get('/business/:id/deliveries', auth.requireAuth('rider'), wrap(async (req, res) => {
    const m = await db.one('SELECT 1 FROM company_members WHERE user_id = $1 AND company_id = $2 AND active', [req.user.id, Number(req.params.id)]);
    if (!m) return bad(res, 'You’re not on this account.', 403);
    const { rows } = await db.query("SELECT id FROM trips WHERE company_id = $1 AND merchant AND (status IN ('requested','accepted','arrived','in_progress') OR created_at > NOW() - INTERVAL '12 hours') ORDER BY id DESC LIMIT 30", [Number(req.params.id)]);
    const out = [];
    for (const x of rows) out.push(rt.view(await rt.loadTrip(x.id), 'rider'));
    res.json(out);
  }));

  // ---------- School runs ----------
  const school = require('./school');
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const planView = async (p) => {
    const d = p.preferred_driver_id ? await db.one(`SELECT u.name, dv.plate, dv.vehicle_make, dv.vehicle_color, (SELECT dd.created_at FROM driver_docs dd WHERE dd.user_id = u.id AND dd.kind = 'photo') AS photo
      FROM users u JOIN drivers dv ON dv.user_id = u.id WHERE u.id = $1`, [p.preferred_driver_id]) : null;
    const { rows: next } = await db.query("SELECT id, plan_leg, scheduled_for, status FROM trips WHERE plan_id = $1 AND status IN ('scheduled','requested','accepted','arrived','in_progress') ORDER BY COALESCE(scheduled_for, created_at) LIMIT 4", [p.id]);
    return {
      id: p.id, child: p.child_name, active: p.active, days: String(p.days).split(',').map(Number), morning: p.morning, afternoon: p.afternoon,
      home: { address: p.home_address, lat: p.home_lat, lng: p.home_lng }, school: { address: p.school_address, lat: p.school_lat, lng: p.school_lng },
      contact: p.school_contact_name ? { name: p.school_contact_name, phone: p.school_contact_phone } : null,
      payment: p.payment_method, handoverCode: p.handover_code,
      driver: d ? { id: p.preferred_driver_id, name: d.name, plate: d.plate, vehicle: [d.vehicle_color, d.vehicle_make].filter(Boolean).join(' '), photo: d.photo ? `/api/drivers/${p.preferred_driver_id}/photo?v=${new Date(d.photo).getTime()}` : null } : null,
      next: next.map((t) => ({ id: t.id, leg: t.plan_leg, at: t.scheduled_for, status: t.status })),
    };
  };
  const ownPlan = async (req, res) => {
    const p = await db.one('SELECT * FROM ride_plans WHERE id = $1 AND parent_id = $2', [Number(req.params.id), req.user.id]);
    if (!p) bad(res, 'School run not found.', 404);
    return p;
  };
  const cancelFuture = (planId) => db.query("UPDATE trips SET status = 'cancelled', cancelled_by = 'rider', cancel_reason = 'School run paused' WHERE plan_id = $1 AND status = 'scheduled'", [planId]);

  r.get('/school/plans', auth.requireAuth('rider'), wrap(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM ride_plans WHERE parent_id = $1 AND (active OR created_at > NOW() - INTERVAL \'90 days\') ORDER BY id', [req.user.id]);
    const out = [];
    for (const p of rows) out.push(await planView(p));
    res.json(out);
  }));

  r.post('/school/plans', auth.requireAuth('rider'), limit(10, 3600e3, (req) => 'user:' + req.user.id), wrap(async (req, res) => {
    const b = req.body || {};
    const child = clean(b.child, 40);
    if (child.length < 2) return bad(res, 'Enter your child’s name.');
    const home = point(b.home), sch = point(b.school);
    if (!home) return bad(res, 'Set where your child is picked up (home).');
    if (!sch) return bad(res, 'Choose the school.');
    const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
    if (!days.length) return bad(res, 'Choose the school days.');
    const morning = b.morning ? String(b.morning) : null, afternoon = b.afternoon ? String(b.afternoon) : null;
    if (!morning && !afternoon) return bad(res, 'Set a time to school, from school, or both.');
    if ((morning && !TIME.test(morning)) || (afternoon && !TIME.test(afternoon))) return bad(res, 'Times look like 07:00.');
    const contactName = clean(b.contactName, 60) || null;
    const contactPhone = b.contactPhone ? auth.normalizePhone(b.contactPhone, auth.ccOf(req.user.phone)) : null;
    if (b.contactPhone && !contactPhone) return bad(res, 'Enter a valid phone number for the school contact.');
    const pay = b.payment === 'wallet' ? 'wallet' : 'cash';
    const n = await db.one('SELECT COUNT(*)::int AS n FROM ride_plans WHERE parent_id = $1 AND active', [req.user.id]);
    if (n.n >= 5) return bad(res, 'You can have up to 5 school runs.');
    const p = await db.one(`INSERT INTO ride_plans(parent_id, child_name, home_address, home_lat, home_lng, school_address, school_lat, school_lng, school_contact_name, school_contact_phone, days, morning, afternoon, payment_method, handover_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [req.user.id, child, home.address, home.lat, home.lng, sch.address, sch.lat, sch.lng, contactName, contactPhone, days.join(','), morning, afternoon, pay, school.code()]);
    await school.scheduleDue();
    if (contactPhone && sms.enabled()) sms.send(contactPhone, `Flytte school run for ${child}: the driver will ask you for handover code ${p.handover_code}. Only give it to the driver collecting or dropping ${child}.`).catch(() => {});
    res.json(await planView(await db.one('SELECT * FROM ride_plans WHERE id = $1', [p.id])));
  }));

  r.patch('/school/plans/:id', auth.requireAuth('rider'), wrap(async (req, res) => {
    const p = await ownPlan(req, res); if (!p) return;
    const b = req.body || {};
    if (b.active === false) { await db.query('UPDATE ride_plans SET active = FALSE WHERE id = $1', [p.id]); await cancelFuture(p.id); }
    if (b.active === true) { await db.query('UPDATE ride_plans SET active = TRUE WHERE id = $1', [p.id]); await school.scheduleDue(); }
    if (b.newDriver === true) await db.query('UPDATE ride_plans SET preferred_driver_id = NULL WHERE id = $1', [p.id]);   // the next run finds a new usual driver
    if (b.newCode === true) { await db.query('UPDATE ride_plans SET handover_code = $1 WHERE id = $2', [school.code(), p.id]); await cancelFuture(p.id); await school.scheduleDue(); }
    if (b.morning !== undefined || b.afternoon !== undefined || b.days !== undefined) {
      const m = b.morning !== undefined ? (b.morning || null) : p.morning, a = b.afternoon !== undefined ? (b.afternoon || null) : p.afternoon;
      if ((m && !TIME.test(m)) || (a && !TIME.test(a)) || (!m && !a)) return bad(res, 'Times look like 07:00, and you need at least one.');
      const days = b.days !== undefined ? [...new Set((b.days || []).map(Number).filter((d) => d >= 1 && d <= 7))].sort() : String(p.days).split(',');
      if (!days.length) return bad(res, 'Choose the school days.');
      await db.query('UPDATE ride_plans SET morning = $1, afternoon = $2, days = $3 WHERE id = $4', [m, a, days.join(','), p.id]);
      await cancelFuture(p.id); await school.scheduleDue();
    }
    res.json(await planView(await db.one('SELECT * FROM ride_plans WHERE id = $1', [p.id])));
  }));
};
