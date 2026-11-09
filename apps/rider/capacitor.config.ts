import type { CapacitorConfig } from '@capacitor/cli';

// Flytte: the store app loads the live web app (FLYTTE_URL, default https://flytte.co) and adds the
// native parts in public/js/native.js. To build against a test server: FLYTTE_URL=https://… npx cap sync
const site = (process.env.FLYTTE_URL || 'https://flytte.co').replace(/\/+$/, '');
const host = new URL(site).hostname;

const config: CapacitorConfig = {
  appId: process.env.ANDROID_PACKAGE_RIDER || 'co.flytte.rider',
  appName: 'Flytte',
  webDir: 'www',
  server: {
    url: site + '/',
    errorPath: 'offline.html',              // shown when the phone can't reach Flytte
    // Card checkout stays inside the app; every other site opens in the phone's browser.
    allowNavigation: [host, 'checkout.flutterwave.com', '*.flutterwave.com'],
  },
  // Only the plugins this app needs.
  includePlugins: ['@capacitor/app', '@capacitor/haptics', '@capacitor-firebase/messaging', '@capacitor/local-notifications',
    '@capacitor-community/in-app-review', '@capawesome/capacitor-app-shortcuts', '@capgo/capacitor-native-biometric'],
  backgroundColor: '#073B42',
  android: { appendUserAgent: 'FlytteApp/rider', allowMixedContent: false },
  ios: { appendUserAgent: 'FlytteApp/rider', contentInset: 'never' },
  plugins: {
    FirebaseMessaging: { presentationOptions: ['badge', 'sound', 'alert'] },
    // Long-press the app icon (handled in public/js/native.js).
    AppShortcuts: {
      shortcuts: [
        { id: 'boda', title: 'Book a boda', iosIcon: 'scooter' },
        { id: 'parcel', title: 'Send a parcel', iosIcon: 'shippingbox' },
        { id: 'airport', title: 'Ride to the airport', iosIcon: 'airplane' },
      ],
    },
  },
  // Avoids a Swift package name clash in the Firebase plugin (its README, iOS setup).
  experimental: { ios: { spm: { packageOptions: { '@capacitor-firebase/messaging': { symlink: true } } } } },
};

export default config;
