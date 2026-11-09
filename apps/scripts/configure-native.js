// Sets up the native Android and iOS projects of both apps after `npx cap add` / `cap sync`:
// permissions and the reasons shown in permission prompts, background location for the driver,
// push notifications, links to flytte.co opening the app, portrait iPhone-only layout, the iOS
// privacy manifest and the Android notification icon. Safe to run again: it only adds what's missing.
// Run by `npm run sync`; on its own: node scripts/configure-native.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const HOST = new URL(process.env.FLYTTE_URL || 'https://flytte.co').hostname;
const VERSION = require('../package.json').version;
const F = [
  'M76.82 0V21.29C76.82 27.37 73.58 32.99 68.31 36.03L26.95 59.91C23.05 62.16 7.5 68.5 0 86.42V57.23C0 49.27 4.25 41.9 11.15 37.92L26.95 28.8Z',
  'M68.7 52.48V72.14C68.7 79.23 64.92 85.78 58.78 89.33L38.18 101.22C31.23 105.24 26.95 112.65 26.95 120.68V145.05H0V116.04C0 101.26 7.89 87.6 20.69 80.2L26.95 76.59Z',
];

const APPS = {
  rider: {
    name: 'Flytte',
    links: ['/t/', '/split/', '/business', '/shops'],
    text: {
      NSLocationWhenInUseUsageDescription: 'Flytte uses your location to set your pickup point, show drivers near you and share your trip with people you choose.',
      NSCameraUsageDescription: 'Flytte uses the camera when you take a profile photo.',
      NSPhotoLibraryUsageDescription: 'Flytte opens your photos when you choose a profile photo.',
      NSFaceIDUsageDescription: 'Flytte uses Face ID to confirm it’s you before money leaves your Flytte Wallet, if you turn on the wallet lock.',
    },
    backgroundModes: ['remote-notification'],
  },
  driver: {
    name: 'Flytte Driver',
    links: ['/driver'],
    text: {
      NSLocationWhenInUseUsageDescription: 'Flytte Driver uses your location to match you with riders nearby and guide you to pickups and destinations.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'While you’re online, Flytte Driver shares your location so riders see you coming and new requests reach you, even with the screen off. It stops when you go offline.',
      NSCameraUsageDescription: 'Flytte Driver uses the camera to photograph your documents, your vehicle, your profile photo and errand receipts.',
      NSPhotoLibraryUsageDescription: 'Flytte Driver opens your photos when you upload a document or profile photo.',
    },
    backgroundModes: ['location', 'remote-notification'],
  },
};

const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, s, before) => { if (s !== before) { fs.writeFileSync(f, s); console.log('  updated', path.relative(ROOT, f)); } };
const exists = (f) => fs.existsSync(f);

// ---------- Android ----------
function android(app, cfg) {
  const main = path.join(ROOT, app, 'android/app/src/main');
  if (!exists(main)) return;
  const mf = path.join(main, 'AndroidManifest.xml');
  const before = read(mf);
  let s = before;
  const perms = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS', 'VIBRATE'];
  for (const p of perms) {
    if (!s.includes(`android.permission.${p}"`)) s = s.replace('</manifest>', `    <uses-permission android:name="android.permission.${p}" />\n</manifest>`);
  }
  // The lock-screen trip card is shown straight away, never scheduled: drop the exact-alarm permission
  // the notifications plugin brings, which Google Play only allows for alarm and calendar apps.
  if (app === 'rider' && !s.includes('SCHEDULE_EXACT_ALARM')) {
    if (!s.includes('xmlns:tools=')) s = s.replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android"', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"');
    s = s.replace('</manifest>', '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:node="remove" />\n</manifest>');
  }
  for (const f of ['android.hardware.location.gps', 'android.hardware.camera']) {
    if (!s.includes(`"${f}"`)) s = s.replace('</manifest>', `    <uses-feature android:name="${f}" android:required="false" />\n</manifest>`);
  }
  // Portrait, like the web app's manifest.
  if (!s.includes('android:screenOrientation')) s = s.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="portrait"');
  // flytte.co links open the app (verified through /.well-known/assetlinks.json).
  if (!s.includes('android:autoVerify="true"')) {
    const data = cfg.links.map((p) => `                <data android:pathPrefix="${p}" />`).join('\n');
    s = s.replace(/(<category android:name="android.intent.category.LAUNCHER" \/>\s*<\/intent-filter>)/, `$1

            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${HOST}" />
${data}
            </intent-filter>`);
  }
  // Push notifications: the small F icon, and the trip-updates channel by default.
  if (!s.includes('default_notification_icon')) {
    s = s.replace(/(\s*<provider)/, `
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_flytte" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/flytte_teal" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="trip_updates" />
$1`);
  }
  write(mf, s, before);

  // Small notification icon: the F in white (Android tints it).
  const drawable = path.join(main, 'res/drawable/ic_stat_flytte.xml');
  const scale = 18 / 145.05, x = (24 - 76.82 * scale) / 2;
  const icon = `<?xml version="1.0" encoding="utf-8"?>
<!-- The Flytte F, for the status bar. Generated by apps/scripts/configure-native.js -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <group android:translateX="${x.toFixed(3)}" android:translateY="3" android:scaleX="${scale.toFixed(5)}" android:scaleY="${scale.toFixed(5)}">
        <path android:fillColor="#FFFFFFFF" android:pathData="${F[0]}" />
        <path android:fillColor="#FFFFFFFF" android:pathData="${F[1]}" />
    </group>
</vector>
`;
  write(drawable, icon, exists(drawable) ? read(drawable) : '');
  const colors = path.join(main, 'res/values/flytte_colors.xml');
  write(colors, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="flytte_teal">#073B42</color>
    <color name="flytte_gold">#F2B544</color>
</resources>
`, exists(colors) ? read(colors) : '');
  if (app === 'driver') {
    // The "You're online" notification while location runs in the background.
    const strings = path.join(main, 'res/values/strings.xml');
    const sb = read(strings);
    let ss = sb;
    if (!ss.includes('capacitor_background_geolocation_notification_channel_name')) {
      ss = ss.replace('</resources>', `    <string name="capacitor_background_geolocation_notification_channel_name">Online status</string>
    <string name="capacitor_background_geolocation_notification_icon">drawable/ic_stat_flytte</string>
</resources>`);
    }
    write(strings, ss, sb);
  }
  // Android 12+ launch screen: the icon on the app's own colour (not white).
  const styles = path.join(main, 'res/values/styles.xml');
  const stb = read(styles);
  let st = stb;
  if (!st.includes('windowSplashScreenBackground')) {
    st = st.replace('<item name="android:background">@drawable/splash</item>', '<item name="android:background">@drawable/splash</item>\n        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>');
  }
  write(styles, st, stb);
  // Version shown in the store.
  const gradle = path.join(ROOT, app, 'android/app/build.gradle');
  const gb = read(gradle);
  write(gradle, gb.replace(/versionName "[^"]*"/, `versionName "${VERSION}"`), gb);
}

// ---------- iOS ----------
const plistString = (v) => `<string>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`;
function setPlist(s, key, valueXml) {
  const re = new RegExp(`\\s*<key>${key}</key>\\s*(<string>[^<]*</string>|<array>[\\s\\S]*?</array>|<true/>|<false/>)`);
  const entry = `\n\t<key>${key}</key>\n\t${valueXml}`;
  if (re.test(s)) return s.replace(re, entry);
  return s.replace(/\n<\/dict>\s*<\/plist>\s*$/, `${entry}\n</dict>\n</plist>\n`);
}
const arr = (items) => `<array>\n${items.map((i) => `\t\t<string>${i}</string>`).join('\n')}\n\t</array>`;

function ios(app, cfg) {
  const dir = path.join(ROOT, app, 'ios/App');
  if (!exists(dir)) return;
  // Info.plist: permission prompts, background modes, portrait, encryption answer.
  const plist = path.join(dir, 'App/Info.plist');
  const pb = read(plist);
  let p = pb;
  for (const [k, v] of Object.entries(cfg.text)) p = setPlist(p, k, plistString(v));
  p = setPlist(p, 'UIBackgroundModes', arr(cfg.backgroundModes));
  p = setPlist(p, 'UISupportedInterfaceOrientations', arr(['UIInterfaceOrientationPortrait']));
  p = setPlist(p, 'UIRequiredDeviceCapabilities', arr(['arm64']));
  p = setPlist(p, 'ITSAppUsesNonExemptEncryption', '<false/>');   // only standard HTTPS
  if (app === 'rider') p = setPlist(p, 'NSSupportsLiveActivities', '<true/>');   // the trip on the lock screen and Dynamic Island
  write(plist, p, pb);

  // Entitlements: push, flytte.co links, passkeys for the wallet lock.
  const ent = path.join(dir, 'App/App.entitlements');
  write(ent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>development</string>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:${HOST}</string>
		<string>webcredentials:${HOST}</string>
	</array>
</dict>
</plist>
`, exists(ent) ? read(ent) : '');

  // Privacy manifest: what the app collects and why (App Store Connect's privacy answers must match).
  const pm = path.join(dir, 'App/PrivacyInfo.xcprivacy');
  const collected = [
    ['Name', true], ['PhoneNumber', true], ['EmailAddress', true], ['PreciseLocation', true], ['PhotosorVideos', true],
    ['PurchaseHistory', true], ['DeviceID', true], ['CustomerSupport', true], ['OtherUserContent', true], ['CrashData', false],
  ];
  write(pm, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<false/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
${collected.map(([t, linked]) => `		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataType${t}</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<${linked}/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>`).join('\n')}
	</array>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>CA92.1</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`, exists(pm) ? read(pm) : '');

  // Xcode project: use the entitlements, ship the privacy manifest, iPhone only, version.
  const proj = path.join(dir, 'App.xcodeproj/project.pbxproj');
  const xb = read(proj);
  let x = xb;
  if (!x.includes('CODE_SIGN_ENTITLEMENTS')) x = x.replace(/(\n(\t+)INFOPLIST_FILE = App\/Info.plist;)/g, '\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1');
  x = x.replace(/TARGETED_DEVICE_FAMILY = "1,2";/g, 'TARGETED_DEVICE_FAMILY = 1;');
  x = x.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${VERSION};`);
  if (!x.includes('PrivacyInfo.xcprivacy')) {
    const FILE = 'F1A7E0010000000000000001', BUILD = 'F1A7E0010000000000000002';
    x = x.replace(/(\/\* Begin PBXBuildFile section \*\/\n)/, `$1\t\t${BUILD} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE} /* PrivacyInfo.xcprivacy */; };\n`);
    x = x.replace(/(\/\* Begin PBXFileReference section \*\/\n)/, `$1\t\t${FILE} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n`);
    x = x.replace(/(\n(\t+)[0-9A-F]{24} \/\* config.xml \*\/,)/, `$1\n$2${FILE} /* PrivacyInfo.xcprivacy */,`);
    x = x.replace(/(\n(\t+)[0-9A-F]{24} \/\* config.xml in Resources \*\/,)/, `$1\n$2${BUILD} /* PrivacyInfo.xcprivacy in Resources */,`);
  }
  write(proj, x, xb);

  // Push: hand the APNs token and background messages to the Firebase plugin.
  const ad = path.join(dir, 'App/AppDelegate.swift');
  const ab = read(ad);
  let a = ab;
  if (!a.includes('capacitorDidRegisterForRemoteNotifications')) {
    a = a.replace(/\n}\s*$/, `

    // Push notifications (@capacitor-firebase/messaging)
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name.init("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }
}
`);
  }
  write(ad, a, ab);
}

for (const [app, cfg] of Object.entries(APPS)) {
  console.log(cfg.name);
  android(app, cfg);
  ios(app, cfg);
}

// The rider app's trip Live Activity (widget extension + plugin): an Xcode target, added with the
// xcodeproj gem (comes with CocoaPods). Skipped with a note when Ruby or the gem isn't there.
if (fs.existsSync(path.join(ROOT, 'rider/ios/App'))) {
  try { process.stdout.write(require('child_process').execFileSync('ruby', [path.join(__dirname, 'add-live-activity.rb')], { encoding: 'utf8' })); }
  catch (e) { console.warn('  Live Activity not added: install the xcodeproj gem (gem install xcodeproj), then run npm run sync again.'); }
}
