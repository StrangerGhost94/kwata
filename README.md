# Flytte 🏍️🚗📦✈️

Ride-hailing built for Kampala: **boda, car, comfort, parcel delivery and airport rides**, paid with **cash, MTN/Airtel Mobile Money, card or an in-app wallet**. Drivers keep **88%** of every fare.

One Node.js app serves everything:

| Address | What it is |
|---|---|
| `/` | The Flytte app itself: logo splash → phone sign in / sign up → services. Installable to the home screen (PWA). |
| `/driver` | Flytte Driver app (installs separately, gold icon) |
| `/about` | Marketing page for sharing on social media |
| `/admin` | Operations console (approve drivers, live map, pricing, SOS, payouts) |
| `/t/<code>` | Live trip link a rider shares with family |

## What works today

**Riders** – the familiar premium flow: *Where to?* → choose a ride (each option shows price, live ETA and arrival time, with the fastest flagged) → confirm pickup on a draggable pin → matching → live trip. Saved Home and Work, recent places, full-screen search, top-down car and boda markers that glide and turn on the map, in-app chat with quick replies, call driver, 4-digit PIN to start, share-trip link, safety centre with SOS and emergency contact, ratings, wallet with top-ups, Activity and Account tabs. Parcel bookings capture recipient name, phone and item.

**Drivers** – sign up with vehicle and permit details, wait for approval, tap **GO**, ring + vibrate on new requests with a countdown ring, navigation banner with distance and one-tap Google Maps, chat and call the rider, *slide to arrive* → enter PIN → *slide to complete*, earnings pill, today/7-day stats, cash out to Mobile Money. If a driver cancels, the rider is automatically re-matched with someone else.

**Admin** – live KPIs and map, approve/suspend drivers, block riders, all trips, edit every fare (base, per km, per minute, minimum, busy multiplier) and the commission live, SOS alerts with sound, payout queue.

**Money rules**
- Cash trip: driver collects cash, Flytte's commission is deducted from their balance.
- Wallet trip: fare comes from the rider's wallet, driver is credited fare minus commission.
- Mobile Money / card trip: rider pays at the end through Flutterwave; driver is credited once payment is confirmed with Flutterwave's servers (never trusting the browser).
- Every balance change is written to a `transactions` ledger.

**Anti-fraud** – the server recalculates every fare itself and rejects fake short distances; PINs are never sent to drivers; phone numbers are only visible during a live trip.

## Installing on a phone (PWA)

Open the Railway link in Chrome on Android: Flytte shows an **Install** card on the home screen, or use the browser menu → *Install app*. On iPhone, open it in Safari → Share → *Add to Home Screen*. It then opens full-screen from its own icon, with its own launch screen, like any app from the store. Drivers install `/driver` the same way and get a separate gold icon.

When you release changes to the app, bump `VERSION` at the top of `public/sw.js` so phones pick up the new version right away.

## Driver tools

Set in **Admin → Driver rules**:

- **Free waiting and no-show fee.** After the free waiting time the driver can leave as a no-show; the fee goes to the driver from the rider's wallet when it covers it. Defaults: 5 minutes, UGX 2,000.
- **Cash commission limit.** Commission on cash trips is taken from the driver's balance. When a driver owes more than the limit, they stop getting cash trips (Mobile Money and wallet trips continue) until they pay it from the app by Mobile Money. Default: UGX 30,000.
- **Heading home.** A driver picks a place and only gets trips that take them closer, up to N times a day. Default: 2.
- **Next trip lined up.** A request close to where the current trip ends can be offered just before drop-off.
- **Bonuses.** Trip targets per day or week; Flytte pays the reward into the driver's balance when it's reached. None are switched on until you add them.
- **Document reminders** before a driving permit or insurance expires. Default: 14 days.

**Ride alerts:** drivers who turn them on get requests on a locked phone (Web Push). On iPhone this needs iOS 16.4+ and the app added to the Home Screen. A driver with alerts on stays online for 15 minutes after the app goes to the background.

Acceptance and cancellation rates (last 30 days) show on the driver's profile and in Admin → Drivers.

## Run it on your Mac

```bash
cd kwata   # the project folder keeps its old name until you rename it
npm install
npm start
```

Open http://localhost:3000. No database setup needed locally — it uses a built-in Postgres stored in `./data`.

Local test admin: phone **0700000000**, password **admin123**. This account only exists on your own computer. On Railway the admin is whatever you set in `ADMIN_PHONE` and `ADMIN_PASSWORD` (changing `ADMIN_PASSWORD` and redeploying changes the password), and the test admin is deleted automatically.

To test a full ride on one computer: open `/admin` in one browser, `/driver` in a second browser (or incognito), `/rider` in a third. Register a driver, approve them in admin, go online, then book from the rider app. If location is blocked, the driver menu has **Set location on map (testing)**.

### Tests

Start the server (`npm start`), then:

- `npm test` runs the payment-safety checks, the full ride simulation, the growth features and the booking/payments/tracking rules.
- `npm run test:ui` drives a real browser through location denied → manual pickup → fares, payment options, offline banner, dialogs and sign-in (needs Chrome; set `CHROME=/path/to/chrome` if it isn't found).
- `test/nightshare.js` (part of `npm test`) also starts two short-lived servers of its own on ports 3117 and 3118: one with `SMS_DEMO=false` (like the live site without EgoSMS keys, so night trips fall back to a one-tap WhatsApp send) and one whose SMS sends fail.
- To check the "payments off" behaviour your live site has without Flutterwave keys, start a second server with `PORT=3101 PAYMENTS_DEMO=false npm start` and run the tests with `BASE=http://localhost:3101`.
- Sign-in and sign-up limits are 20x looser on a local server so a full test run fits; a live server keeps the real limits (e.g. 10 sign-ups per 10 minutes).

## Deploy to Railway

1. Push the folder to a new GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**, pick it.
3. **+ New → Database → PostgreSQL**, then in your app service add the variable `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
4. Add variables: `JWT_SECRET` (long random text, **required**: a live server won't start without it), `ADMIN_PHONE`, `ADMIN_PASSWORD`, `PUBLIC_URL` (your Railway or custom domain), and `SUPPORT_PHONE` once you have a real support line (or set it in Admin → Pricing).
5. Deploy. Tables are created automatically on first start.

## Taking real payments (Flutterwave)

Without keys, **local development** runs in test mode (payments succeed instantly so you can try every flow). A **live server** never fakes payments: until the keys are set, Mobile Money, card and wallet top-ups show as *Coming soon* and riders pay cash (or with wallet credit from rewards and invites). `PAYMENTS_DEMO=true` turns test mode on anyway, e.g. for a staging server.

1. Open a Flutterwave business account for Uganda and enable Mobile Money Uganda + cards.
2. Set `FLW_SECRET_KEY` on Railway.
3. In Flutterwave → Settings → Webhooks, set the URL to `https://YOUR-DOMAIN/api/payments/webhook` and a secret hash; put the same hash in `FLW_WEBHOOK_HASH`.

Driver payouts are currently sent by your team by Mobile Money and marked paid in admin. Automating them uses Flutterwave's Transfers API — a natural next step.

## Before public launch

- **Maps at scale**: the app uses OpenFreeMap vector maps (OpenStreetMap data), the public OSRM demo router, Nominatim for turning a dropped pin into an address, and the public Photon server for place search. These are fine for testing and a pilot but have usage limits and no uptime guarantee. Before heavy traffic, self-host Photon (set `PHOTON_URL`) or switch to a paid provider (Mapbox, Google Maps Platform), and self-host OSRM. The routing and map calls live in `public/js/common.js`, place search in `src/places.js`.
- **SMS verification**: add phone OTP at sign-up (e.g. Africa's Talking) so every number is real.
- **Driver vetting**: check permit, logbook, National ID and insurance in person before approving.
- **Legal**: confirm current Ministry of Works & Transport rules for digital ride-hailing operators and register as a data controller with Uganda's Personal Data Protection Office. Write terms of service and a privacy policy (the app has no Terms/Privacy pages yet, so sign-up doesn't link to any).
- **Support line**: set `SUPPORT_PHONE` (or Admin → Pricing). Until then, Help & Support and "Call support" buttons are hidden.
- **Service descriptions**: the blurbs in Admin settings (e.g. "Helmet provided", "Newer cars, AC, top-rated drivers") are shown to riders on the website; make sure every one is true for your fleet.
- **Name**: check that "Flytte" is free to trademark with URSB and grab the domain.
- **Secrets**: set a strong `JWT_SECRET` and change the default admin password.

## Next features worth building

Push notifications, scheduled rides, promo codes and referrals, automatic MoMo payouts, cancellation fees, heat-map surge pricing, driver document uploads, native Android build (wrap with Capacitor), Luganda/Swahili language toggle.

## Code map

```
server.js            starts Express + Socket.io, seeds admin
src/db.js            Postgres (Railway) or built-in Postgres (local), schema
src/pricing.js       ride types, fare formula, admin settings
src/realtime.js      live driver locations, dispatch to nearest driver, trip events
src/routes.js        all API endpoints
src/ledger.js        wallet, earnings and commission bookkeeping
src/payments.js      Flutterwave Mobile Money + card
src/places.js        place search: landmarks, popular places, OpenStreetMap (Photon)
src/landmarks.js     Kampala landmarks and their nicknames
public/              landing, rider, driver, admin, tracking pages
test/e2e.js          full ride simulation
```

## Pricing (how fares work)

Fares are upfront and calibrated to Kampala (about 8–10% below Bolt's published route prices):

`fare = max(minimum, base + per km × road km + per minute × minutes in traffic) × surge`

- **Traffic** – minutes come from free-flow route time × a Kampala time-of-day factor (rush hours 7:30–9:30 and 17:00–19:30 on weekdays, quieter at night). Bodas feel only about a third of the jam.
- **Dynamic surge** (`src/surge.js`) – per ~2 km area and per vehicle class (boda / car): ride requests in the last 10 minutes (plus people checking prices) vs free drivers within 3 km. Gentle curve, needs real requests, rises at most +0.3× per minute, falls −0.15× per minute, capped (1.8× boda, 2.0× car by default).
- **Rain** – live weather from Open-Meteo adds a small boost (more for boda). Open-Meteo's free API is for non-commercial use; for production set `OPEN_METEO_KEY` (their commercial plan) or switch rain off in Admin → Pricing.
- **Locked quotes** – every price shown is locked for 2 minutes; riders pay exactly what they accepted. If a lock expires and the price has risen more than 5%, the rider is shown the new price before booking.
- **Admin → Pricing** – edit rates, fixed boost, surge on/off, sensitivity, caps, rain boost, and see live conditions.

## Rider features added in October 2026

- **Driver checks before pickup.** The driver card shows "ID checked" (National ID on file, driver approved) and "Permit valid" (permit on file and not expired). Tapping the photo shows it full size with the plate and the month the driver joined.
- **Send arrival time.** During a trip, one tap opens WhatsApp with "I'll arrive at about 6:40 pm" and the live link.
- **Luganda.** Settings → Language now offers Luganda next to English and Kiswahili (`public/js/i18n.js`). It should be checked by a native speaker.
- **Rider cancellation fee.** If a rider cancels more than 2 minutes after a driver accepts, the driver gets UGX 1,000 from the rider's wallet (only if the wallet covers it). It's free if the driver has been on the way for 15+ minutes. Amounts are in Admin → Driver rules.
- **Woman driver.** Riders can ask for a woman driver on the ride options. Drivers say so at sign-up, and the team confirms it with the checkbox in the driver's documents.
- **Multiple stops.** Up to 2 stops per ride (not parcels). The fare covers the distance through every stop plus a per-stop fee (Admin → Pricing), and drivers tap "Done at stop" to go on.
- **Split the fare.** Riders send a link and friends pay their share by Mobile Money without an account. The money lands in the rider's Flytte Wallet, and Mobile Money/card trips can be paid from the wallet at the end.

## Account page

- **Header and stats.** Tap the header to edit: photo (only the rider sees it), name, and phone number. The new number is confirmed with a code sent to it. Below it: trips, rating, rider since, Rewards level. Flytte Wallet and Rewards are cards at the top.
- **Saved places.** Home, Work, and up to 10 places with the rider's own names. They show on Home and at the top of search.
- **Ride preferences.** Usual ride type, always ask for a woman driver, and a default pickup note. They're applied to every new booking.
- **Share night trips.** From a chosen time until 5 am, the emergency contact gets an SMS with the driver, plate and live link when a trip starts. It needs SMS set up (EgoSMS).
- **Monthly summary** with a CSV statement. **Signed-in devices** with sign out (sessions table, `sid` in the token). **Help centre** with answers, reports from all trips and contact options. **Rate Flytte** (Admin → Customer help shows ratings), **Share Flytte**, and the real app version.

## Place search

Riders search through Flytte's server (`/api/places/search`, `src/places.js`), which lists:

1. **Kampala landmarks** (`src/landmarks.js`): malls, markets, taxi parks, hospitals, campuses, hotels, stadiums and places of worship, found by the names people type ("owino", "mubs", "namboole", "ihk"). Positions come from OpenStreetMap and were checked by hand; the airport points at the passenger terminal.
2. **Places popular with riders**, learned from completed trips. A place is only suggested once 3 different riders have used it, and "Home", "Work" and similar are never learned, so nobody's own address is shown to others.
3. **OpenStreetMap results via Photon**, which allows search-as-you-type (Nominatim doesn't). Results within 80 km, nearest first. If Photon doesn't answer, landmarks and popular places still show.

To add a landmark, add a line to `src/landmarks.js` with coordinates from openstreetmap.org (right-click → "Show address").

## Growth features (bring riders in, bring them back)

- **First-ride discount** – automatic, default 50% off up to UGX 3,000 (Admin → Promotions).
- **Promo codes** – % or UGX off, max discount, min fare, total uses, uses per rider, expiry, ride type, first-rides-only; switch on/off any time. One discount per trip: the rider always gets the bigger one.
- **Invite friends** – every rider has a code and link (`/?ref=CODE`). When the friend finishes their first trip, both get wallet credit (default UGX 3,000 inviter / 2,000 friend).
- **Flytte Rewards** – 1 point per UGX 1,000 paid; 100 points = UGX 2,000 wallet credit; Bronze / Silver / Gold levels.
- **Tips** – after the trip, from the wallet (straight to the driver, no commission) or in cash.
- **Scheduled rides** – 20 minutes to 7 days ahead, never surge-priced, dispatch starts 10 minutes before (`SCHEDULE_LEAD_MIN`).
- **Book for someone else** – the driver sees and calls the passenger; the booker can text them the PIN and live link.
- **Parcel delivery code** – the recipient gives a 4-digit code to the rider; the delivery can't be completed without it.

Money rule: `fare` is the full price; the rider pays `fare − discount`; Flytte covers the discount, so the driver always earns on the full fare (cash trips: the discount is added to the driver's balance).

Tests: `node test/e2e.js` and `SCHEDULE_LEAD_MIN=30 node test/growth.js` (start the server with the same variable).
