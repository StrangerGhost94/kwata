# Putting Flytte on Google Play and the App Store

Two apps, each on both stores:

| App | Android package / iOS bundle ID | Opens | Icon |
|---|---|---|---|
| **Flytte** (riders) | `co.flytte.rider` | `https://flytte.co/` | gold tile, teal F |
| **Flytte Driver** | `co.flytte.driver` | `https://flytte.co/driver` | teal tile, gold F |

Both are Capacitor apps (`apps/rider`, `apps/driver`) that load the live web app and add native features through `public/js/native.js`:
- push alerts through Firebase
- location while the screen is off, for online drivers only
- haptics
- flytte.co links opening the app
- an "Update to continue" screen for versions that are too old

The rider app also has:
- the live trip on the lock screen: a quiet ongoing notification on Android, and a **Live Activity** on iPhone (lock screen and Dynamic Island, iOS 16.2+). It shows who's coming, the plate, minutes until pickup, and each step through to "You've arrived". The server keeps it current through Firebase even when the app is closed.
- the store's own rating prompt after a second 5-star trip, at most every four months
- long-press shortcuts on the icon: Book a boda, Send a parcel, Ride to the airport
- the wallet lock with the phone's own Face ID, Touch ID or fingerprint

The driver app has long-press shortcuts too: Go online, Earnings.

Web deploys reach the apps straight away. Only native changes need a new store version.

## What's already in the repo

- Android and iOS projects for both apps, with permissions, the reason for each permission, links to flytte.co, the iOS privacy manifest, icons and launch screens.
  - Both Android apps build (`assembleDebug`).
  - The iOS projects use Swift Package Manager and are built in Xcode on a Mac.
- Reviewer sign-in and demo trips on the server (`src/review.js`).
- Native push (`src/fcm.js`).
- Crash reporting (`src/monitor.js`).
- Store pages: <https://flytte.co/delete-account> and <https://flytte.co/support>.
- Store graphics in `store/<app>/`:
  - `app-store-icon-1024.png`, `play-icon-512.png` and `feature-graphic.png` (1024 × 500)
  - `screenshots/play/` (1080 × 1920)
  - `screenshots/app-store/` (1320 × 2868, iPhone 6.9")

To redraw them: `node tools/store-assets.js` and `node tools/store-screenshots.js`.

## 1. Accounts (start now, the waiting is the slow part)

1. Get a free **D-U-N-S number** for the company (dnb.com). It can take up to two weeks. Give `https://flytte.co/company` as the company website. Set the `COMPANY_…` variables first (section 3), so the page shows the same legal name and address as your registration documents.
2. Join the **Apple Developer Program** as an organisation (US$99 a year).
3. Create a **Google Play Console** organisation account (US$25 once). An organisation account doesn't need the 14-day, 12-tester closed test that new personal accounts must run.
4. Create a **Firebase** project (free), for push alerts.
5. Create a **Sentry** project (free tier), for crash reports.

## 2. Firebase (push alerts)

1. In the Firebase console, add four apps: Android `co.flytte.rider`, Android `co.flytte.driver`, iOS `co.flytte.rider` and iOS `co.flytte.driver`.
2. Put each app's config file in its project. They're needed to build with push.
   - `google-services.json` goes in `apps/rider/android/app/` and `apps/driver/android/app/`.
   - `GoogleService-Info.plist` goes in `apps/rider/ios/App/App/` and `apps/driver/ios/App/App/`. Add it to the App target in Xcode.
3. For iPhones:
   1. In Apple Developer → Keys, create an **APNs key**.
   2. Upload it in Firebase → Project settings → Cloud Messaging → Apple app configuration.
4. For the server:
   1. Go to Firebase → Project settings → Service accounts → **Generate new private key**.
   2. Put the whole JSON in Railway as `FIREBASE_SERVICE_ACCOUNT`.

## 3. Railway variables

| Variable | What to put | Needed for |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the service-account JSON (or base64 of it) | push alerts in the store apps |
| `SENTRY_DSN` | from Sentry → Project settings → Client Keys | crash reports |
| `APPLE_TEAM_ID` | 10 characters, developer.apple.com → Membership | flytte.co links open the iPhone apps; passkeys |
| `ANDROID_CERT_SHA256` | Play Console → Test and release → App integrity → App signing key certificate → SHA-256. For both apps, comma-separated. | flytte.co links open the Android apps |
| `APPSTORE_ID_RIDER`, `APPSTORE_ID_DRIVER` | the numeric App Store IDs, once the apps exist in App Store Connect | the "Update" button on iPhone |
| `MIN_APP_VERSION` (or `_RIDER` / `_DRIVER`) | e.g. `1.0.0`; leave unset until needed | forcing very old versions to update |
| `SUPPORT_EMAIL` | default `support@flytte.co` | the support page and the apps |
| `COMPANY_NAME`, `COMPANY_REG_NO`, `COMPANY_ADDRESS` (use ` \| ` between lines), and optionally `COMPANY_TIN`, `COMPANY_FOUNDED`, `COMPANY_DIRECTORS`, `COMPANY_EMAIL`, `COMPANY_PHONE` | the company's registered details, exactly as on the certificate of incorporation | the company page at `https://flytte.co/company`, which is the website to give Dun & Bradstreet, Apple and Google |
| `FLW_CARD_WALLETS` | `googlepay,applepay` (either or both), once Flutterwave has switched them on for your account and UGX | Google Pay / Apple Pay on card checkout. Apple Pay appears on the website in Safari; Apple turns it off inside apps' web pages, so the iPhone app shows cards. |
| `REVIEW_CODE`, `REVIEW_RIDER_PHONE`, `REVIEW_DRIVER_PHONE`, `REVIEW_PIN` | see section 5 | app review only |

## 4. Build and upload

Install the apps' tools once, then sync after any change to the native projects:

```bash
cd apps
npm install
npm run sync           # pages, `cap sync` for both apps, then the native settings
```

To build against a test server, prefix the command with its address: `FLYTTE_URL=https://flytte-staging.up.railway.app npm run sync`.

### Android (each app)

1. Open the project in Android Studio with `npm run open:rider:android` (or `open:driver:android`).
2. Bump the version in `android/app/build.gradle`: `versionCode` +1 each upload, and `versionName`.
3. Go to **Build → Generate Signed App Bundle** and create an upload key. Keep the key safe and backed up.
4. Upload the `.aab` in Play Console. Accept **Play App Signing**.
5. Copy the app-signing SHA-256 into `ANDROID_CERT_SHA256`.

### iOS (each app, on a Mac with Xcode)

1. Open the project in Xcode with `npm run open:rider:ios` (or `open:driver:ios`).
2. Go to **Signing & Capabilities** and set the Team to Flytte's.
3. Make sure these capabilities are present: **Push Notifications**, **Associated Domains** (already in `App.entitlements`) and **Background Modes**.
   - Background Modes: Remote notifications for both apps, plus Location updates for the driver app.
4. Choose **Product → Archive**, then **Distribute App → App Store Connect**.
5. Test with TestFlight before you submit.

The apps are iPhone-only and portrait.

**Rider app: the Live Activity.** The project has a second target, **FlytteTripWidget**: the lock-screen and Dynamic Island view. Its source is in `apps/ios-live-activity/`, and it's added by `apps/scripts/add-live-activity.rb` (part of `npm run sync`; it needs `gem install xcodeproj`).
- In **Signing & Capabilities**, set the same Team on the FlytteTripWidget target. Its bundle ID is `co.flytte.rider.FlytteTripWidget`.
- No extra Firebase setup is needed. The APNs key you uploaded for push also carries Live Activity updates.
- Updates while the app is closed need the rider's trip alerts to be on (that's how the server reaches the phone). With alerts off, the Live Activity still updates whenever the app is open.
- To test: in TestFlight, book a trip with the review rider. Lock the phone as the demo driver accepts, and watch it update until "You've arrived". Riders can switch it off in Settings → Flytte → Live Activities.

## 5. Review access (paste into both consoles)

Set these in Railway before you submit. Remove `REVIEW_CODE` after approval to switch review mode off.

```
REVIEW_CODE=246810                 (any 6 digits)
REVIEW_RIDER_PHONE=0700000101
REVIEW_DRIVER_PHONE=0700000102
REVIEW_PIN=1234
```

**App Store Connect → App Review Information → Sign-in required**, and **Play Console → App content → App access**. Paste this for **Flytte**:

> Sign in with phone number **0700 000 101** (country Uganda, +256) and code **246810**. No SMS is sent; the code works for this number only.
> Flytte operates in Kampala, Uganda. From outside Uganda, tap **Where to?**, type "Acacia Mall" as the destination and "Kampala Road" as the pickup, choose **Boda** or **Car**, pay with **Cash** and tap **Request**. A demo driver accepts, drives to the pickup, arrives and completes the trip in about two minutes. Nothing is charged.

Paste this for **Flytte Driver**:

> Sign in with **0700 000 102** (Uganda, +256) and code **246810**. The account is already approved.
> Tap **Go Online**. Within about 10 seconds a demo rider requests a trip; tap **Accept**, then slide to arrive, enter the trip PIN **1234**, and slide to complete. From outside Uganda your position is treated as central Kampala.
> Location "Always": while online, the app shares the driver's location so riders see the car approaching and new requests arrive with the screen off. It stops when the driver goes offline, and Android shows a persistent "You're online" notification while it runs.

## 6. Privacy forms

The answers below match `public/privacy.html` and the iOS privacy manifest (`PrivacyInfo.xcprivacy`).

**Apple App Privacy**:
- Data used to track you: **none**.
- Data linked to you, all for **App Functionality**:
  - Contact info: name, phone number, email address
  - Location: precise location
  - User content: photos (profile photo; driver documents and vehicle), customer support, other user content (in-trip chat)
  - Purchases: purchase history (trips, wallet)
  - Identifiers: device ID (push token)
- Data not linked to you: diagnostics (crash data).
- Face ID / Touch ID for the wallet lock isn't data collection: the check happens on the phone, and only a random secret's hash reaches Flytte.

**Google Data safety**:
- Data is encrypted in transit: **yes**.
- People can request deletion: **yes**, in the app and at `https://flytte.co/delete-account`.
- Data shared with third parties: **none**. Payment processors and SMS providers are service providers, which Google doesn't count as sharing.
- Collected (all for App functionality; required, except email):
  - Personal info: name, phone number, email address (optional)
  - Location: precise location (drivers: also while online in the background)
  - Photos: photos
  - Financial info: purchase history
  - Messages: other in-app messages
  - App activity: app interactions
  - App info and performance: crash logs, diagnostics
  - Device or other IDs: device ID (push token)

## 7. Other declarations

- **Play: Foreground service (driver app).**
  - Type: *location*.
  - Use: "Shares the driver's location with the rider they're picking up and with dispatch while the driver is online; a persistent notification shows while it runs; it stops when they go offline."
  - Record a 30-second screen video: Go Online, lock the phone, show the "You're online" notification, unlock, Go Offline. Upload it unlisted to YouTube and paste the link.
- **Play: Financial features.**
  - Answer: the app has a wallet for paying for rides and deliveries, and driver cash-outs to Mobile Money.
  - It is not a bank, loan or money-transfer service.
- **Payments.** Rides, deliveries, wallet top-ups and Flytte Pass pay for real-world services, so both stores allow them outside in-app purchase (Apple Guideline 3.1.5(a)). No in-app purchase is needed.
- **Content rating.** Complete the questionnaires. There is no violence, gambling or mature content, but there is user-to-user chat with a driver during a trip.
- **Target audience.** Set both apps to 18 and over, as the terms require.
- **Ads.** None.
- **Exact alarms (rider app).** Not used: the setup script removes the permission the notifications plugin would add, so Play won't ask about it.
- **Export compliance (iOS).** Already answered in Info.plist (`ITSAppUsesNonExemptEncryption = NO`): standard HTTPS only.
- **Uganda.** Register with the Personal Data Protection Office, and name the registered company in the privacy policy. Check the details with a local lawyer.

## 8. Store listing copy

**Flytte**
- **Name:** Flytte: Rides & Delivery
- **Subtitle (App Store):** Boda, car and parcels in Kampala
- **Short description (Play, 80 characters):** Boda, car, parcel and airport rides in Kampala. Upfront prices, safe trips.
- **Description:**

> Ride light. Arrive sure. Flytte gets you across Kampala on a boda, in a car or a comfortable SUV, sends your parcels, runs your errands and takes you to Entebbe Airport.
>
> • See the price before you book, and pay that price
> • Pay with cash, MTN or Airtel Mobile Money, card, or your Flytte Wallet
> • Watch your driver arrive on the map, chat or call them in the app
> • A 4-digit PIN to start every trip, live trip sharing, SOS and an emergency contact
> • Ask for a woman driver
> • Send parcels with a delivery code, or have a driver buy and bring what you need
> • Schedule rides up to a week ahead
>
> Available in Kampala. In English and Luganda.

**Flytte Driver**
- **Name:** Flytte Driver
- **Subtitle (App Store):** Drive and earn in Kampala
- **Short description (Play):** Drive a boda or car with Flytte in Kampala. Keep 88% of every fare.
- **Description:**

> Earn · Drive · Grow. Drive with Flytte in Kampala on your boda or car, and keep 88% of every fare.
>
> • Go online when you want; requests ring even with your screen off
> • See the pickup, the destination and what you'll earn before you accept
> • Turn-by-turn directions, chat and calls with your rider
> • Cash out your earnings to MTN or Airtel Mobile Money
> • Bonuses, heading-home trips and clear daily and weekly earnings
>
> Sign up in the app with your vehicle and documents. Our team reviews every driver before their first trip.

**Both apps**
- Support URL: `https://flytte.co/support`
- Privacy policy: `https://flytte.co/privacy`
- Marketing URL: `https://flytte.co/about`
- Category: Travel (rider) and Business (driver) on the App Store; Maps & Navigation (rider) and Business (driver) on Play.
