# Kwata 🏍️🚗📦✈️

Ride-hailing built for Kampala: **boda, car, comfort, parcel delivery and airport rides**, paid with **cash, MTN/Airtel Mobile Money, card or an in-app wallet**. Drivers keep **88%** of every fare.

One Node.js app serves everything:

| Address | What it is |
|---|---|
| `/` | Public landing page |
| `/rider` | Rider app (install to home screen like a normal app) |
| `/driver` | Driver app |
| `/admin` | Operations console (approve drivers, live map, pricing, SOS, payouts) |
| `/t/<code>` | Live trip link a rider shares with family |

## What works today

**Riders** – the familiar premium flow: *Where to?* → choose a ride (each option shows price, live ETA and arrival time, with the fastest flagged) → confirm pickup on a draggable pin → matching → live trip. Saved Home and Work, recent places, full-screen search, top-down car and boda markers that glide and turn on the map, in-app chat with quick replies, call driver, 4-digit PIN to start, share-trip link, safety centre with SOS and emergency contact, ratings, wallet with top-ups, Activity and Account tabs, light and dark mode. Parcel bookings capture recipient name, phone and item.

**Drivers** – sign up with vehicle and permit details, wait for approval, tap **GO**, ring + vibrate on new requests with a countdown ring, navigation banner with distance and one-tap Google Maps, chat and call the rider, *slide to arrive* → enter PIN → *slide to complete*, earnings pill, today/7-day stats, cash out to Mobile Money. If a driver cancels, the rider is automatically re-matched with someone else.

**Admin** – live KPIs and map, approve/suspend drivers, block riders, all trips, edit every fare (base, per km, per minute, minimum, busy multiplier) and the commission live, SOS alerts with sound, payout queue.

**Money rules**
- Cash trip: driver collects cash, Kwata's commission is deducted from their balance.
- Wallet trip: fare comes from the rider's wallet, driver is credited fare minus commission.
- Mobile Money / card trip: rider pays at the end through Flutterwave; driver is credited once payment is confirmed with Flutterwave's servers (never trusting the browser).
- Every balance change is written to a `transactions` ledger.

**Anti-fraud** – the server recalculates every fare itself and rejects fake short distances; PINs are never sent to drivers; phone numbers are only visible during a live trip.

## Run it on your Mac

```bash
cd kwata
npm install
npm start
```

Open http://localhost:3000. No database setup needed locally — it uses a built-in Postgres stored in `./data`.

Local test admin: phone **0700000000**, password **admin123**. This account only exists on your own computer. On Railway the admin is whatever you set in `ADMIN_PHONE` and `ADMIN_PASSWORD` (changing `ADMIN_PASSWORD` and redeploying changes the password), and the test admin is deleted automatically.

To test a full ride on one computer: open `/admin` in one browser, `/driver` in a second browser (or incognito), `/rider` in a third. Register a driver, approve them in admin, go online, then book from the rider app. If location is blocked, the driver menu has **Set location on map (testing)**.

`npm test` runs the automated end-to-end test (server must be running).

## Deploy to Railway

1. Push the folder to a new GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**, pick it.
3. **+ New → Database → PostgreSQL**, then in your app service add the variable `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
4. Add variables: `JWT_SECRET` (long random text), `ADMIN_PHONE`, `ADMIN_PASSWORD`, `PUBLIC_URL` (your Railway or custom domain).
5. Deploy. Tables are created automatically on first start.

## Taking real payments (Flutterwave)

Without keys the app runs in **test mode**: payments succeed instantly so you can try every flow.

1. Open a Flutterwave business account for Uganda and enable Mobile Money Uganda + cards.
2. Set `FLW_SECRET_KEY` on Railway.
3. In Flutterwave → Settings → Webhooks, set the URL to `https://YOUR-DOMAIN/api/payments/webhook` and a secret hash; put the same hash in `FLW_WEBHOOK_HASH`.

Driver payouts are currently sent by your team by Mobile Money and marked paid in admin. Automating them uses Flutterwave's Transfers API — a natural next step.

## Before public launch

- **Maps at scale**: the app uses CARTO basemaps (on OpenStreetMap data), OSRM routing and Nominatim search. CARTO's free basemaps are meant for low-volume use; get a CARTO or Mapbox plan before you launch commercially. These are fine for testing and a pilot but have usage limits. Before heavy traffic, switch to a paid provider (Mapbox, Google Maps Platform, or self-hosted OSRM) — the calls live in `public/js/common.js`.
- **SMS verification**: add phone OTP at sign-up (e.g. Africa's Talking) so every number is real.
- **Driver vetting**: check permit, logbook, National ID and insurance in person before approving.
- **Legal**: confirm current Ministry of Works & Transport rules for digital ride-hailing operators and register as a data controller with Uganda's Personal Data Protection Office. Write terms of service and a privacy policy.
- **Name**: check that "Kwata" is free to trademark with URSB and grab the domain.
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
public/              landing, rider, driver, admin, tracking pages
test/e2e.js          full ride simulation
```
