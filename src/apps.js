// The store apps (Capacitor, in apps/): their IDs, store links, the oldest version still allowed,
// and the files that let flytte.co links open the installed app.
//
// Railway → Variables (all optional):
//   ANDROID_PACKAGE_RIDER / ANDROID_PACKAGE_DRIVER   default co.flytte.rider / co.flytte.driver
//   IOS_BUNDLE_RIDER / IOS_BUNDLE_DRIVER             default the same as Android
//   APPSTORE_ID_RIDER / APPSTORE_ID_DRIVER           the numeric App Store id, once the app is created
//   APPLE_TEAM_ID                                    10 characters, from developer.apple.com → Membership
//   ANDROID_CERT_SHA256                              Play Console → App integrity → App signing key
//                                                    certificate → SHA-256 (comma-separate several)
//   MIN_APP_VERSION / MIN_APP_VERSION_RIDER / MIN_APP_VERSION_DRIVER
//                                                    older store apps show "Update Flytte to continue"
//   SUPPORT_EMAIL                                    default support@flytte.co
const env = (k, d = '') => String(process.env[k] || d).trim();

const ids = () => ({
  rider: { android: env('ANDROID_PACKAGE_RIDER', 'co.flytte.rider'), ios: env('IOS_BUNDLE_RIDER', env('ANDROID_PACKAGE_RIDER', 'co.flytte.rider')), appStoreId: env('APPSTORE_ID_RIDER') },
  driver: { android: env('ANDROID_PACKAGE_DRIVER', 'co.flytte.driver'), ios: env('IOS_BUNDLE_DRIVER', env('ANDROID_PACKAGE_DRIVER', 'co.flytte.driver')), appStoreId: env('APPSTORE_ID_DRIVER') },
});
const versionOk = (v) => /^\d+(\.\d+){0,2}$/.test(v) ? v : null;
const supportEmail = () => env('SUPPORT_EMAIL', 'support@flytte.co');

// What the apps need from /api/config.
function config() {
  const i = ids();
  const store = (app) => ({
    android: `https://play.google.com/store/apps/details?id=${i[app].android}`,
    ios: i[app].appStoreId ? `https://apps.apple.com/app/id${i[app].appStoreId}` : null,
  });
  return {
    minVersion: { rider: versionOk(env('MIN_APP_VERSION_RIDER', env('MIN_APP_VERSION'))), driver: versionOk(env('MIN_APP_VERSION_DRIVER', env('MIN_APP_VERSION'))) },
    store: { rider: store('rider'), driver: store('driver') },
    supportEmail: supportEmail(),
  };
}

// Android App Links: https://developer.android.com/training/app-links/verify-android-applinks
function assetLinks() {
  const certs = env('ANDROID_CERT_SHA256').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  if (!certs.length) return [];
  const i = ids();
  return ['rider', 'driver'].map((app) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: i[app].android, sha256_cert_fingerprints: certs },
  }));
}

// iOS Universal Links (and passkeys in the app): the apple-app-site-association file.
function appleAssociation() {
  const team = env('APPLE_TEAM_ID');
  if (!/^[A-Z0-9]{10}$/.test(team)) return null;
  const i = ids();
  const rider = `${team}.${i.rider.ios}`, driver = `${team}.${i.driver.ios}`;
  return {
    applinks: {
      details: [
        { appIDs: [driver], components: [{ '/': '/driver*' }] },
        { appIDs: [rider], components: [{ '/': '/t/*' }, { '/': '/split/*' }, { '/': '/business' }, { '/': '/shops' }, { '/': '/', '?': { ref: '?*' } }] },
      ],
    },
    webcredentials: { apps: [rider, driver] },
  };
}

module.exports = { ids, config, assetLinks, appleAssociation, supportEmail };
