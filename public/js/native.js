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
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

  K.native = true;
  K.platform = PLATFORM;
  document.documentElement.classList.add('native', 'native-' + PLATFORM);
  K.standalone = () => true;                              // no "install the app" cards inside the app

  // ---------- haptics ----------
  if (Haptics) {
    K.haptic = (style) => { if (K.reduced()) return; Haptics.impact({ style: style || 'LIGHT' }).catch(() => {}); };
    K.hapticNotify = (type) => { if (K.reduced()) return; Haptics.notification({ type: type || 'SUCCESS' }).catch(() => {}); };
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
    let onPos = null, watcher = null, starting = null;
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
          if (loc && onPos) onPos({ coords: { latitude: loc.latitude, longitude: loc.longitude, heading: loc.bearing == null ? null : loc.bearing, accuracy: loc.accuracy, speed: loc.speed } });
        }).then((id) => { watcher = id; starting = null; if (!K.geo.wantOn) K.geo.background(false); }).catch(() => { starting = null; });
      }
      if (!on && watcher) { BG.removeWatcher({ id: watcher }).catch(() => {}); watcher = null; }
      K.geo.wantOn = !!on;
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
