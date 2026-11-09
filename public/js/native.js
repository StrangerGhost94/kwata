// The store apps (Capacitor, apps/rider and apps/driver) load flytte.co inside a native shell.
// This file connects the web app to the phone where the web can't reach: push alerts through
// Firebase, location with the screen off for online drivers, real haptics, links that open the
// app, and "Update Flytte to continue" for versions too old to work. In a browser it does nothing.
(function () {
  const C = window.Capacitor, K = window.K;
  if (!C || !K || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
  const APP = document.body.dataset.app || 'rider';
  const PLATFORM = C.getPlatform();                       // 'ios' | 'android'
  const plugin = (name) => { try { return (C.Plugins && C.Plugins[name]) || C.registerPlugin(name); } catch { return null; } };
  const has = (name) => typeof C.isPluginAvailable !== 'function' || C.isPluginAvailable(name);
  const App = has('App') ? plugin('App') : null;
  const Haptics = has('Haptics') ? plugin('Haptics') : null;
  const FM = has('FirebaseMessaging') ? plugin('FirebaseMessaging') : null;
  const BG = APP === 'driver' && has('BackgroundGeolocation') ? plugin('BackgroundGeolocation') : null;
  const LN = PLATFORM === 'android' && APP === 'rider' && has('LocalNotifications') ? plugin('LocalNotifications') : null;
  const Review = APP === 'rider' && has('InAppReview') ? plugin('InAppReview') : null;
  const Shortcuts = has('AppShortcuts') ? plugin('AppShortcuts') : null;
  const Bio = APP === 'rider' && has('NativeBiometric') ? plugin('NativeBiometric') : null;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

  K.native = true;
  K.platform = PLATFORM;
  document.documentElement.classList.add('native', 'native-' + PLATFORM);
  K.standalone = () => true;                              // no "install the app" cards inside the app

  // ---------- haptics ----------
  if (Haptics) {
    K.haptic = (style) => { if (K.reduced()) return; Haptics.impact({ style: style || 'LIGHT' }).catch(() => {}); };
    K.hapticNotify = (type) => { if (K.reduced()) return; Haptics.notification({ type: type || 'SUCCESS' }).catch(() => {}); };   // the web vibration pattern isn't needed here
  }

  // ---------- push alerts (Firebase Cloud Messaging; src/fcm.js sends them) ----------
  const TOKEN = 'flytte_native_push_token', PERM = 'flytte_native_push_perm';
  async function register(token) {
    await K.api('/push/native', { token, platform: PLATFORM, app: APP });
    store.set(TOKEN, token);
  }
  if (FM) {
    K.push = {
      supported: () => true,
      iosBrowser: () => false,
      permission: () => store.get(PERM) || 'default',
      async current() {
        try {
          const p = await FM.checkPermissions();
          store.set(PERM, p.receive === 'prompt' || p.receive === 'prompt-with-rationale' ? 'default' : p.receive);
          if (p.receive !== 'granted') return null;
        } catch { return null; }
        const t = store.get(TOKEN);
        return t ? { native: true, token: t, unsubscribe: async () => {} } : null;
      },
      async enable() {
        let p = await FM.checkPermissions();
        if (p.receive !== 'granted') p = await FM.requestPermissions();
        store.set(PERM, p.receive === 'granted' ? 'granted' : 'denied');
        if (p.receive !== 'granted') throw new Error('Alerts are blocked. Allow notifications for Flytte in your phone’s Settings.');
        const { token } = await FM.getToken();
        if (!token) throw new Error('This phone couldn’t be set up for alerts. Try again in a minute.');
        await register(token);
        return true;
      },
      async disable() {
        const t = store.get(TOKEN);
        if (t) await K.api('/push/native/remove', { token: t }).catch(() => {});
        try { await FM.deleteToken(); } catch {}
        store.set(TOKEN, null);
      },
    };
    // Firebase sometimes replaces the token (reinstall, restore): send the new one if alerts are on.
    FM.addListener('tokenReceived', ({ token }) => { if (token && store.get(TOKEN) && token !== store.get(TOKEN) && K.token()) register(token).catch(() => {}); });
    // Tapping an alert just opens the app: the trip or the waiting request is shown on arrival.
    FM.addListener('notificationActionPerformed', () => {});
    if (PLATFORM === 'android') {
      // Ride requests get their own loud, heads-up channel; drivers can tune it in Android settings.
      if (APP === 'driver') FM.createChannel({ id: 'ride_requests', name: 'Ride requests', description: 'New trip requests while you’re online', importance: 5, visibility: 1, vibration: true, lights: true }).catch(() => {});
      FM.createChannel({ id: 'trip_updates', name: 'Trip updates', description: APP === 'driver' ? 'Changes to your trips and account' : 'Your driver is on the way, has arrived, and when your trip ends', importance: 4, visibility: 1, vibration: true }).catch(() => {});
    }
  }

  // ---------- location with the screen off (driver, while online) ----------
  // Online: a native watcher that keeps running when the phone locks (Android shows a "You're online"
  // notification while it runs). Offline: the normal in-app location, which stops in the background.
  if (BG) {
    let onPos = null, watcher = null, starting = null, lastHttp = 0;
    const Http = has('CapacitorHttp') ? plugin('CapacitorHttp') : null;
    // Screen off: Android slows the web view's own connections after a few minutes in the
    // background, so the position also goes to the server through native HTTP.
    function sendNative(loc) {
      if (!Http || !document.hidden || !K.token() || Date.now() - lastHttp < 8000) return;
      lastHttp = Date.now();
      Http.post({ url: location.origin + '/api/driver/location', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + K.token() },
        data: { lat: loc.latitude, lng: loc.longitude, heading: loc.bearing == null ? null : loc.bearing } }).catch(() => {});
    }
    const webWatch = K.geo.watch, webClear = K.geo.clear;
    K.geo.watch = (ok, err, opts) => { onPos = ok; return webWatch(ok, err, opts); };
    K.geo.clear = (id) => webClear(id);
    K.geo.background = (on) => {
      if (on && !watcher && !starting) {
        starting = BG.addWatcher({
          backgroundTitle: 'You’re online on Flytte Driver',
          backgroundMessage: 'Sharing your location so riders can find you. Go offline to stop.',
          requestPermissions: true, stale: false, distanceFilter: 10,
        }, (loc, error) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') K.toast('Allow location “Always” for Flytte Driver in Settings, or requests stop reaching you when your screen is off.', 7000);
            return;
          }
          if (loc) sendNative(loc);
          if (loc && onPos) onPos({ coords: { latitude: loc.latitude, longitude: loc.longitude, heading: loc.bearing == null ? null : loc.bearing, accuracy: loc.accuracy, speed: loc.speed } });
        }).then((id) => { watcher = id; starting = null; if (!K.geo.wantOn) K.geo.background(false); }).catch(() => { starting = null; });
      }
      if (!on && watcher) { BG.removeWatcher({ id: watcher }).catch(() => {}); watcher = null; }
      K.geo.wantOn = !!on;
    };
  }

  // ---------- live trip on the lock screen (Android) ----------
  // While a trip is on, an ongoing notification shows who's coming, the plate and where things are,
  // and taps back into the trip. It's quiet (updates don't buzz) and goes when the trip ends.
  // iPhones get the trip alerts instead (on the way, almost here, arrived, trip done).
  if (LN) {
    const ID = 4201;
    let channel = null, shown = null;
    const first = (n) => String(n || '').trim().split(/\s+/)[0] || 'Your driver';
    K.onTrip = async (t) => {
      try {
        const live = t && ['accepted', 'arrived', 'in_progress'].includes(t.status) && t.driver;
        if (!live) { if (shown) { shown = null; await LN.cancel({ notifications: [{ id: ID }] }); } return; }
        if ((await LN.checkPermissions()).display !== 'granted') return;   // alerts were never allowed: don't ask from here
        if (!channel) channel = LN.createChannel({ id: 'trip_live', name: 'Live trip', description: 'Your current trip, on the lock screen', importance: 2, visibility: 1, vibration: false }).catch(() => {});
        await channel;
        const d = t.driver, who = first(d.name), plate = d.plate ? ` · ${d.plate}` : '';
        const car = d.vehicle || '';
        const text = {
          accepted: [`${who} is on the way${plate}`, `${car ? car + ' · ' : ''}Pickup: ${String((t.pickup && t.pickup.address) || '').split(',')[0]}`],
          arrived: [`${who} has arrived${plate}`, `Meet them at the pickup${car ? ' · ' + car : ''}`],
          in_progress: [`On your way to ${String((t.drop && t.drop.address) || 'your destination').split(',')[0]}`, `With ${who}${plate}`],
        }[t.status];
        const key = t.id + t.status;
        if (shown === key) return;
        shown = key;
        await LN.schedule({ notifications: [{ id: ID, title: text[0], body: text[1], channelId: 'trip_live', ongoing: true, autoCancel: false,
          smallIcon: 'ic_stat_flytte', iconColor: '#073B42', extra: { tripId: t.id } }] });
      } catch {}
    };
    // Ended while the app was closed: don't leave a stale card behind.
    LN.cancel({ notifications: [{ id: ID }] }).catch(() => {});
  }

  // ---------- "Enjoying Flytte?" ----------
  // After a 5-star trip, ask the store to show its own rating prompt: from the second 5-star trip,
  // and at most every four months. The store decides whether it actually appears.
  if (Review) {
    K.onGreatRating = () => {
      const n = Number(store.get('flytte_five_stars') || 0) + 1;
      store.set('flytte_five_stars', String(n));
      const last = Number(store.get('flytte_review_asked') || 0);
      if (n < 2 || Date.now() - last < 120 * 86400e3) return;
      store.set('flytte_review_asked', String(Date.now()));
      setTimeout(() => Review.requestReview().catch(() => {}), 1200);   // after the thank-you, not over it
    };
  }

  // ---------- quick actions on the app icon (long-press) ----------
  // The list itself is in capacitor.config.ts, so it's there before the app is first opened.
  if (Shortcuts) {
    const go = { boda: '/?service=boda', parcel: '/?service=parcel', airport: '/?service=airport', online: '/driver?go=online', earnings: '/driver?tab=earnings' };
    Shortcuts.addListener('click', ({ shortcutId }) => { if (go[shortcutId]) location.href = go[shortcutId]; });
  }

  // ---------- wallet lock with the phone's own fingerprint / Face ID ----------
  // A random secret kept in the Keychain (iPhone) or Keystore (Android) that only opens after a live
  // biometric check; the server keeps a hash (src/walletlock.js). Replaces passkeys in the app.
  if (Bio && K.walletLock && K.walletLock.engine) {
    const SERVER = location.hostname + '/flytte-wallet', DEV = 'flytte_wallet_device';
    const eng = K.walletLock.engine;
    const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
    // Cancelled or not recognised: try again. Anything else (code 21: the secret is gone, e.g. new fingerprints): set up again.
    const cancelled = (e) => ['10', '11', '15', '16', '17'].includes(String(e && e.code)) || /cancel/i.test(String(e && e.message));
    let kind = 0;
    eng.supported = async () => { try { const r = await Bio.isAvailable({ useFallback: false }); kind = r.biometryType || 0; return !!r.isAvailable; } catch { return false; } };
    eng.bioName = () => (kind === 2 ? 'Face ID' : kind === 1 ? 'Touch ID' : PLATFORM === 'ios' ? 'Face ID or Touch ID' : 'fingerprint or face unlock');
    eng.prepare = async () => null;
    eng.create = async () => {
      const deviceId = hex(24), secret = hex(32);
      try {
        await Bio.setCredentials({ server: SERVER, username: deviceId, password: secret, accessControl: 2 });   // BIOMETRY_ANY
      } catch (e) { throw new Error(cancelled(e) ? 'Not set up. Try again when you’re ready.' : 'This phone couldn’t save your wallet lock. Check that fingerprint or face unlock is set up.'); }
      const out = await K.api('/wallet/lock/device', { deviceId, secret, device: PLATFORM === 'ios' ? 'iPhone (Flytte app)' : 'Android phone (Flytte app)' });
      store.set(DEV, deviceId);
      return out;
    };
    eng.options = async () => (store.get(DEV) ? { native: true } : { none: true });
    eng.assert = async () => {
      let c;
      try { c = await Bio.getSecureCredentials({ server: SERVER, reason: 'Confirm it’s you to pay from your Flytte Wallet', title: 'Flytte Wallet', subtitle: 'Confirm it’s you' }); }
      catch (e) { if (!cancelled(e)) store.set(DEV, null); throw new Error(cancelled(e) ? 'Not confirmed. Try again, or use a code.' : 'Your fingerprint or face changed on this phone. Use a code instead.'); }
      try { return (await K.api('/wallet/unlock/device', { deviceId: c.username, secret: c.password })).pass; }
      catch (e) { store.set(DEV, null); throw e; }
    };
  }

  // ---------- links to flytte.co open here (Android App Links, iOS Universal Links) ----------
  if (App) {
    App.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url);
        if (/(^|\.)flytte\.co$/.test(u.hostname) || u.hostname === location.hostname) location.href = u.pathname + u.search + u.hash;
      } catch {}
    });
  }

  // ---------- versions too old to work: "Update Flytte to continue" ----------
  const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function checkVersion() {
    if (!App || document.querySelector('.update-gate')) return;
    let info, cfg;
    try { info = await App.getInfo(); K.appVersion = info.version + ' (' + info.build + ')'; } catch { return; }
    try { cfg = await K.api('/config'); } catch { return; }
    const min = cfg && cfg.apps && cfg.apps.minVersion && cfg.apps.minVersion[APP];
    if (!min || !newer(min, info.version)) return;
    const link = cfg.apps.store && cfg.apps.store[APP] && cfg.apps.store[APP][PLATFORM];
    const name = APP === 'driver' ? 'Flytte Driver' : 'Flytte';
    const el = document.createElement('div');
    el.className = 'update-gate';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-labelledby', 'ugT');
    el.innerHTML = `<div class="ug-card"><div class="ug-ic" aria-hidden="true">${K.markSvg ? K.markSvg() : ''}</div>
      <h2 id="ugT">Update ${name} to continue</h2>
      <p>This version (${K.esc(info.version)}) no longer works with Flytte. The update takes a minute and keeps your account, trips and wallet.</p>
      ${link ? `<a class="btn btn-primary btn-block" href="${K.esc(link)}">Update ${name}</a>` : `<p class="ug-how">Open the ${PLATFORM === 'ios' ? 'App Store' : 'Play Store'}, search for ${name} and tap Update.</p>`}</div>`;
    document.body.appendChild(el);
    const a = el.querySelector('a'); if (a) a.focus();
  }
  checkVersion();
  if (App) App.addListener('resume', checkVersion);
})();
