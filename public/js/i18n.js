// Kiswahili for the rider and driver apps.
// Only exact interface phrases are swapped, so names, addresses and places are never touched.
// Loaded on every page; does nothing unless Kiswahili is chosen in Settings.
(function () {
  let lang = 'en';
  try { lang = localStorage.getItem('flytte_lang') || 'en'; } catch {}
  window.FLYTTE_LANG = lang;
  if (lang !== 'sw') return;
  document.documentElement.lang = 'sw';

  const SW = {
    // sign in
    'Notifications': 'Arifa', 'Trip alerts': 'Arifa za safari', 'Trip alerts are on': 'Arifa za safari zimewashwa', 'Know when your driver arrives': 'Jua dereva wako akifika', 'Get a notification when your driver is close and when they’ve arrived, even with your phone locked.': 'Pata arifa dereva akikaribia na akifika, hata simu ikiwa imefungwa.', 'Turn on trip alerts': 'Washa arifa za safari', 'Not now': 'Sio sasa', 'Book again': 'Agiza tena', 'Receipt': 'Risiti', 'Get help': 'Pata msaada', 'Your reports': 'Ripoti zako', 'In review': 'Inakaguliwa', 'Resolved': 'Imetatuliwa', 'Flytte support': 'Msaada wa Flytte', 'We usually reply within a few hours.': 'Kwa kawaida tunajibu ndani ya saa chache.', 'I lost an item': 'Nimepoteza kitu', 'I was charged the wrong amount': 'Nimetozwa kiasi kisicho sahihi', 'The route was longer than it should be': 'Njia ilikuwa ndefu kuliko inavyopaswa', 'Driver behaviour': 'Tabia ya dereva', 'Safety concern': 'Wasiwasi wa usalama', 'Something else': 'Kitu kingine', 'Send to Flytte': 'Tuma kwa Flytte', 'Report sent': 'Ripoti imetumwa', 'Call support': 'Piga simu msaada', 'What happened?': 'Nini kilitokea?', 'What did you leave, and where in the vehicle?': 'Uliacha nini, na wapi ndani ya chombo?', 'Share': 'Shiriki', 'Save as PDF': 'Hifadhi kama PDF', 'Total': 'Jumla', 'Trip fare': 'Nauli ya safari', 'Pickup note': 'Maelezo ya kuchukuliwa', 'Save note': 'Hifadhi maelezo', 'Remove': 'Ondoa', 'Your pickup note': 'Maelezo yako ya kuchukuliwa', 'At the main gate': 'Kwenye geti kuu', 'Call me when you arrive': 'Nipigie ukifika', 'Opposite the petrol station': 'Mkabala na kituo cha mafuta', 'At the stage': 'Kwenye stage', 'How it’s priced': 'Bei inavyopangwa', 'Base fare': 'Nauli ya msingi', 'Minimum fare': 'Nauli ya chini kabisa', 'Busy-time pricing': 'Bei ya wakati wa shughuli nyingi', 'You pay': 'Unalipa', 'Taking longer than usual': 'Inachukua muda mrefu kuliko kawaida', 'Drivers nearby are busy. We’re still asking.': 'Madereva wa karibu wana shughuli. Bado tunaendelea kutafuta.', 'Shown after you accept': 'Inaonyeshwa ukikubali', 'Trip help': 'Msaada wa safari', 'A rider left an item': 'Abiria ameacha kitu', 'I wasn’t paid for this trip': 'Sikulipwa kwa safari hii', 'Rider behaviour': 'Tabia ya abiria', 'Per trip': 'Kwa safari',
    'Wallet lock': 'Kufuli ya pochi', 'Wallet lock is on': 'Kufuli ya pochi imewashwa', 'Wallet lock is off': 'Kufuli ya pochi imezimwa', 'Confirm it’s you': 'Thibitisha ni wewe', 'Use a code instead': 'Tumia nambari badala yake', 'Turn off wallet lock?': 'Zima kufuli ya pochi?', 'Your Flytte Wallet is locked.': 'Pochi yako ya Flytte imefungwa.', 'Use Face ID or Touch ID': 'Tumia Face ID au Touch ID', 'Use fingerprint or face unlock': 'Tumia alama ya kidole au uso', 'Confirm': 'Thibitisha', 'Not confirmed. Try again, or use a code.': 'Haijathibitishwa. Jaribu tena, au tumia nambari.',
    'Report a mismatch': 'Ripoti tofauti', 'Report received': 'Ripoti imepokelewa', 'Parcel delivered': 'Kifurushi kimefikishwa', 'You’ve arrived': 'Umefika', 'Your package has been handed over': 'Kifurushi chako kimekabidhiwa', 'Thanks for riding with Flytte': 'Asante kwa kusafiri na Flytte', 'Promo applied': 'Ofa imetumika', 'Tip sent. Thank you.': 'Bakshishi imetumwa. Asante.', 'Payment received': 'Malipo yamepokelewa', 'Commission paid': 'Kamisheni imelipwa',
    'You’ve reached the pickup': 'Umefika mahali pa kuchukua', 'You’ve reached the destination': 'Umefika unakoenda', 'You’ve reached the drop-off': 'Umefika mahali pa kukabidhi', 'Navigate': 'Ongoza njia',
    'Rating is optional': 'Kukadiria si lazima', 'Done': 'Imekamilika',
    'Welcome to Flytte': 'Karibu Flytte',
    'Drive with Flytte': 'Endesha na Flytte',
    'Sign in or create an account with your mobile number.': 'Ingia au fungua akaunti kwa namba yako ya simu.',
    'Sign in, or apply to drive, with your mobile number.': 'Ingia, au omba kuendesha, kwa namba yako ya simu.',
    'Mobile number': 'Namba ya simu', 'Mobile number. You can start with 0.': 'Namba ya simu. Unaweza kuanza na 0.',
    'Phone number': 'Namba ya simu', 'Country': 'Nchi', 'Country code': 'Msimbo wa nchi',
    'Sign In': 'Ingia', 'Sign in': 'Ingia', 'Log In': 'Ingia', 'Continue': 'Endelea', 'Please wait…': 'Tafadhali subiri…',
    'We’ll send a one-time code to verify your number.': 'Tutakutumia nambari ya siri ya mara moja kuthibitisha namba yako.',
    'We’ll send a one-time code to verify your number. New drivers are reviewed before their first trip.': 'Tutakutumia nambari ya siri ya mara moja kuthibitisha namba yako. Madereva wapya hukaguliwa kabla ya safari yao ya kwanza.',
    'By continuing, you agree to Flytte’s': 'Kwa kuendelea, unakubali',
    'Terms of Service': 'Masharti ya Huduma', 'Privacy Policy': 'Sera ya Faragha', 'and': 'na',
    'Verify your number': 'Thibitisha namba yako', 'Choose how to receive your 6-digit code for': 'Chagua jinsi ya kupokea nambari yako ya tarakimu 6 kwa',
    'We’ll send a 6-digit code to': 'Tutatuma nambari ya tarakimu 6 kwa',
    'Works on Wi-Fi or mobile data': 'Inafanya kazi kwenye Wi-Fi au data',
    'Delivered in the Telegram app': 'Inafika kwenye programu ya Telegram',
    'Standard text message': 'Ujumbe mfupi wa kawaida',
    'Enter your code': 'Weka nambari yako',
    'Sent by SMS to': 'Imetumwa kwa SMS kwa',
    'Sent on WhatsApp to': 'Imetumwa kwa WhatsApp kwa',
    'Sent in Telegram to': 'Imetumwa kwenye Telegram kwa',
    '6-digit code': 'Nambari ya tarakimu 6', 'Change': 'Badilisha', 'Didn’t receive it?': 'Hukuipokea?',
    'Send by SMS': 'Tuma kwa SMS', 'Send on WhatsApp': 'Tuma kwa WhatsApp', 'Send in Telegram': 'Tuma kwenye Telegram',
    'Resend code': 'Tuma tena', 'Code resent': 'Nambari imetumwa tena', 'Use WhatsApp': 'Tumia WhatsApp', 'Use Telegram': 'Tumia Telegram', 'Use SMS': 'Tumia SMS', 'Enter all 6 digits.': 'Weka tarakimu zote 6.',
    'Create your account': 'Fungua akaunti yako', 'Add your name to finish setting up.': 'Weka jina lako kukamilisha.',
    'Full name': 'Jina kamili', 'e.g. Grace Nalubega': 'mf. Grace Nalubega', 'Create account': 'Fungua akaunti',
    'Have an invite code?': 'Una nambari ya mwaliko?', 'Invite code': 'Nambari ya mwaliko', 'e.g. GRACE123': 'mf. GRACE123',
    'Your details': 'Taarifa zako', 'These are verified before your first trip.': 'Hizi huthibitishwa kabla ya safari yako ya kwanza.',
    'What do you drive?': 'Unaendesha nini?', 'Boda boda (motorcycle)': 'Bodaboda (pikipiki)', 'Car': 'Gari',
    'Number plate': 'Namba ya usajili', 'Colour': 'Rangi', 'Make and model': 'Aina na modeli',
    'Driving permit number': 'Namba ya leseni ya udereva', 'Mobile Money for payouts': 'Mobile Money ya malipo',
    'Same as your phone if empty': 'Sawa na simu yako ikiachwa wazi', 'Welcome back': 'Karibu tena',
    'Enter your password to continue.': 'Weka nenosiri lako kuendelea.', 'Password': 'Nenosiri', 'Forgot password?': 'Umesahau nenosiri?',

    // tabs and common
    'Home': 'Nyumbani', 'Activity': 'Shughuli', 'Account': 'Akaunti', 'Earnings': 'Mapato', 'Profile': 'Wasifu',
    'Back': 'Rudi', 'Close': 'Funga', 'Save': 'Hifadhi', 'Add': 'Ongeza', 'Manage': 'Simamia', 'Upload': 'Pakia',
    'Default': 'Chaguo-msingi', 'Not set': 'Haijawekwa', 'optional': 'si lazima', 'New': 'Mpya', 'Now': 'Sasa',
    'Today': 'Leo', 'This week': 'Wiki hii', 'All': 'Zote', 'Map': 'Ramani', 'Settings': 'Mipangilio',
    'Log out': 'Toka', 'Help & Support': 'Msaada', 'Driver support': 'Msaada kwa madereva',

    // rider home
    'Where to?': 'Unaenda wapi?', 'Where are you going?': 'Unaenda wapi?', 'Good morning,': 'Habari za asubuhi,',
    'Good afternoon,': 'Habari za mchana,', 'Good evening,': 'Habari za jioni,',
    'Boda': 'Boda', 'Comfort': 'Starehe', 'Parcel': 'Kifurushi', 'Airport': 'Uwanja wa ndege',
    'Rides': 'Safari', 'Deliveries': 'Usafirishaji', 'Book a ride': 'Agiza safari', 'Send a package': 'Tuma kifurushi',
    'Airport transfer': 'Usafiri wa uwanja wa ndege', 'Flying out of Entebbe?': 'Unasafiri kutoka Entebbe?',
    'Picked up and delivered across Kampala': 'Kuchukuliwa na kufikishwa kote Kampala',
    'Book now, or schedule ahead at the regular price': 'Agiza sasa, au panga mapema kwa bei ya kawaida',
    'Set your pickup point': 'Weka mahali pa kuchukuliwa', 'Pickup point': 'Mahali pa kuchukuliwa',
    'Destination': 'Unakoenda', 'Set destination on map': 'Weka unakoenda kwenye ramani', 'Pickup time': 'Muda wa kuchukuliwa',
    'Centre on me': 'Nionyeshe nilipo', 'Go to my location': 'Nenda nilipo', 'Resize sheet': 'Badilisha ukubwa',
    'Work': 'Kazini', 'For you': 'Kwa ajili yako', 'Welcome offer': 'Ofa ya kukaribisha',
    '50% off your first ride': 'Punguzo la 50% kwenye safari yako ya kwanza',

    // activity
    'No trips yet': 'Bado hakuna safari', 'Your rides and deliveries will show here.': 'Safari na usafirishaji wako vitaonekana hapa.',
    'Trips': 'Safari', 'Trip history': 'Historia ya safari',

    // account
    '★ New rider rating': '★ Mteja mpya', 'Invite friends': 'Alika marafiki', 'Flytte Rewards': 'Zawadi za Flytte',
    'Payment methods': 'Njia za malipo', 'Saved places': 'Maeneo yaliyohifadhiwa', 'Flytte Wallet': 'Pochi ya Flytte',
    'Safety': 'Usalama', 'Add an emergency contact': 'Ongeza mtu wa dharura', 'Emergency contact': 'Mtu wa dharura',
    'Appearance, language, privacy': 'Mwonekano, lugha, faragha',
    'Your default is used for every trip. Change it any time.': 'Chaguo lako hutumika kwa kila safari. Libadilishe wakati wowote.',
    'Default payment method': 'Njia kuu ya malipo', 'Cash': 'Pesa taslimu', 'Card': 'Kadi',
    'Pay your rider or driver directly': 'Mlipe dereva wako moja kwa moja', 'Visa or Mastercard, paid at the end': 'Visa au Mastercard, unalipa mwishoni',
    'MTN Mobile Money': 'MTN Mobile Money', 'Airtel Money': 'Airtel Money',
    'Change Mobile Money number': 'Badilisha namba ya Mobile Money',
    'Top up once with Mobile Money and pay for trips in one tap.': 'Weka pesa mara moja kwa Mobile Money na ulipie safari kwa kugusa mara moja.',
    'Add money to wallet': 'Weka pesa kwenye pochi', 'Amount (UGX)': 'Kiasi (UGX)',
    'If you press SOS during a trip, we’ll help you alert this person with your live location.': 'Ukibonyeza SOS wakati wa safari, tutakusaidia kumjulisha mtu huyu pamoja na mahali ulipo.',
    'Share your code. When a friend signs up with it and takes their first trip, you both get Flytte Wallet credit.': 'Shiriki nambari yako. Rafiki akijisajili nayo na kufanya safari yake ya kwanza, nyote mnapata salio kwenye Pochi ya Flytte.',
    'Your invite code': 'Nambari yako ya mwaliko', 'Share my invite': 'Shiriki mwaliko wangu', 'How it works': 'Jinsi inavyofanya kazi',
    'Friends joined': 'Marafiki waliojiunga', 'Took a trip': 'Walisafiri', 'You earned': 'Umepata',
    'Credit arrives in your wallet automatically and pays for your next trips. One reward per new friend.': 'Salio linaingia kwenye pochi yako moja kwa moja na kulipia safari zako zijazo. Zawadi moja kwa kila rafiki mpya.',
    'Redeem': 'Tumia', 'points': 'pointi', 'Bronze member': 'Mwanachama wa Shaba', 'Next level: Silver': 'Kiwango kijacho: Fedha',
    '1 point for every UGX 1,000 you pay': 'Pointi 1 kwa kila UGX 1,000 unayolipa',
    'Your level': 'Kiwango chako', 'How you earn': 'Jinsi unavyopata', 'Recent points': 'Pointi za karibuni', 'to reward': 'kufikia zawadi',
    'Ride or send a parcel': 'Safiri au tuma kifurushi', 'Points arrive when the trip ends': 'Pointi zinafika safari ikiisha',
    'On every completed trip, any payment method': 'Kwa kila safari iliyokamilika, njia yoyote ya malipo',
    'Swap for wallet credit': 'Badilisha kuwa salio la pochi', 'Points from your trips will appear here.': 'Pointi kutoka safari zako zitaonekana hapa.',
    'Lifetime points count every point you’ve earned, so your level never drops when you swap points.': 'Pointi za maisha zinahesabu kila pointi uliyowahi kupata, hivyo kiwango chako hakishuki unapobadilisha pointi.',
    'Bronze': 'Shaba', 'Silver': 'Fedha', 'Gold': 'Dhahabu', 'Rewards are paused right now. Your points are safe.': 'Zawadi zimesitishwa kwa sasa. Pointi zako ziko salama.',

    // settings
    'Appearance': 'Mwonekano', 'Automatic': 'Otomatiki', 'Light': 'Mwanga', 'Dark': 'Giza',
    'Follows your phone’s light or dark setting.': 'Inafuata mpangilio wa mwanga au giza wa simu yako.',
    'Easier on the eyes at night.': 'Rahisi kwa macho usiku.', 'The classic Flytte look.': 'Mwonekano wa kawaida wa Flytte.',
    'Language': 'Lugha', 'Legal': 'Kisheria', 'Delete my account': 'Futa akaunti yangu',
    'Delete your account?': 'Futa akaunti yako?', 'This can’t be undone.': 'Hili haliwezi kurudishwa.',
    'Delete account': 'Futa akaunti', 'Keep my account': 'Baki na akaunti yangu', 'Delete anyway': 'Futa hata hivyo',
    'Past trips and payments are kept only as anonymous records, as the law requires.': 'Safari na malipo ya zamani yanahifadhiwa bila majina tu, kama sheria inavyotaka.',
    'You can sign up again later with the same number.': 'Unaweza kujisajili tena baadaye kwa namba hiyo hiyo.',
    'Any Flytte Wallet balance and Rewards points are lost.': 'Salio lolote la Pochi ya Flytte na pointi za Zawadi vitapotea.',
    'You’ll stop getting requests straight away.': 'Utaacha kupokea maombi mara moja.',
    'Your account has been deleted.': 'Akaunti yako imefutwa.',
    'Your name, phone number, saved places and emergency contact are erased.': 'Jina lako, namba ya simu, maeneo yaliyohifadhiwa na mtu wa dharura vinafutwa.',
    'Your name, phone number, documents, photos, saved places and emergency contact are erased.': 'Jina lako, namba ya simu, nyaraka, picha, maeneo yaliyohifadhiwa na mtu wa dharura vinafutwa.',
    'Deleting…': 'Inafuta…',

    // driver
    'Go Online': 'Ingia kazini', 'Go Offline': 'Toka kazini', 'Offline': 'Nje ya kazi', 'Online': 'Kazini',
    'Go online to get your first trip.': 'Ingia kazini upate safari yako ya kwanza.',
    'Today’s earnings': 'Mapato ya leo', 'Trips today': 'Safari za leo', 'Rating': 'Ukadiriaji', 'Balance (UGX)': 'Salio (UGX)',
    'You keep 88% of every fare.': 'Unabaki na 88% ya kila nauli.', 'Verified driver': 'Dereva aliyethibitishwa',
    'Acceptance': 'Kukubali', 'Cancellation': 'Kughairi', 'Requests': 'Maombi',
    'Last 30 days. Missed requests count as not accepted. No-shows don’t count as cancellations.': 'Siku 30 zilizopita. Maombi yaliyokosa huhesabiwa kama hayakukubaliwa. Wateja wasiofika hawahesabiwi kama kughairi.',
    'Photo & vehicle': 'Picha na chombo', 'Profile photo, vehicle and number plate': 'Picha, chombo na namba ya usajili',
    'Documents': 'Nyaraka', 'ID, driving permit, insurance, vehicle, photo': 'Kitambulisho, leseni, bima, chombo, picha',
    'Ride alerts': 'Arifa za safari', 'Off · turn on to get requests when your phone is locked': 'Imezimwa · iwashe upokee maombi simu ikiwa imefungwa',
    'Set position on map': 'Weka mahali kwenye ramani', 'For testing without GPS': 'Kwa majaribio bila GPS',
    'Profile photo': 'Picha ya wasifu', 'Change photo': 'Badilisha picha', 'Change vehicle or number plate': 'Badilisha chombo au namba ya usajili',
    'This is what riders see when you pick them up. Changes are checked by the Flytte team first, so riders always see details that match you and your vehicle.': 'Hiki ndicho wateja wanaona unapowachukua. Mabadiliko hukaguliwa kwanza na timu ya Flytte, ili wateja waone taarifa zinazolingana nawe na chombo chako.',
    'National ID': 'Kitambulisho cha Taifa', 'Driving permit': 'Leseni ya udereva', 'Insurance sticker': 'Stika ya bima',
    'Vehicle photo': 'Picha ya chombo', 'Not uploaded': 'Haijapakiwa', 'Expiry date': 'Tarehe ya kuisha',
    'We remind you on your home screen before your driving permit or insurance runs out. Keep them current to stay on the road.': 'Tunakukumbusha kwenye skrini kuu kabla leseni au bima yako haijaisha. Zihuishe ili uendelee kufanya kazi.',
    'Earnings for the last 7 days': 'Mapato ya siku 7 zilizopita', 'Last 7 days': 'Siku 7 zilizopita',
    '7 days': 'Siku 7', '30 days': 'Siku 30', 'Earned (UGX)': 'Ulichopata (UGX)', 'Fares': 'Nauli',
    'Flytte commission': 'Kamisheni ya Flytte', 'Commission': 'Kamisheni', 'Tips, fees & bonuses': 'Bakshishi, ada na bonasi',
    'Cash collected': 'Pesa taslimu ulizopokea', 'Balance you can cash out': 'Salio unaloweza kutoa', 'Cash out': 'Toa pesa',
    'Completed trips': 'Safari zilizokamilika', 'Statement': 'Taarifa', 'Download CSV': 'Pakua CSV',
    'Complete your first trip to see earnings here.': 'Kamilisha safari yako ya kwanza uone mapato hapa.',
    'No trips in this period yet.': 'Bado hakuna safari katika kipindi hiki.',
    'Mon': 'Jtt', 'Tue': 'Jnn', 'Wed': 'Jtn', 'Thu': 'Alh', 'Fri': 'Iju', 'Sat': 'Jms', 'Sun': 'Jpl',
  };
  // Phrases with numbers or names in them.
  const DAYS = { Mon: 'Jtt', Tue: 'Jnn', Wed: 'Jtn', Thu: 'Alh', Fri: 'Iju', Sat: 'Jms', Sun: 'Jpl' };
  const PAT = [
    [/^Try (.+) instead$/, (m) => `Jaribu ${m[1]} badala yake`],
    [/^Pickup note from (.+)$/, (m) => `Maelezo ya kuchukuliwa kutoka kwa ${m[1]}`],
    [/^(.+) is here · look for$/, (m) => `${m[1]} amefika · tafuta`],
    [/^Resend code in 0:(\d+)$/, (m) => `Tuma tena baada ya 0:${m[1]}`],
    [/^Get UGX ([\d,]+) for each friend$/, (m) => `Pata UGX ${m[1]} kwa kila rafiki`],
    [/^Get UGX ([\d,]+) per friend$/, (m) => `Pata UGX ${m[1]} kwa kila rafiki`],
    [/^Give UGX ([\d,]+), get UGX ([\d,]+)$/, (m) => `Toa UGX ${m[1]}, pata UGX ${m[2]}`],
    [/^They get UGX ([\d,]+) after their first trip$/, (m) => `Wanapata UGX ${m[1]} baada ya safari yao ya kwanza`],
    [/^Balance UGX ([\d,]+)$/, (m) => `Salio UGX ${m[1]}`],
    [/^Cash out to (.+)$/, (m) => `Toa pesa kwenda ${m[1]}`],
    [/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun): (.+)$/, (m) => `${DAYS[m[1]]}: ${m[2]}`],
    [/^([\d,]+) points · (\w+)$/, (m) => `Pointi ${m[1]} · ${({ Bronze: 'Shaba', Silver: 'Fedha', Gold: 'Dhahabu' })[m[2]] || m[2]}`],
    [/^(\d+) trips?$/, (m) => `Safari ${m[1]}`],
    [/^Redeem ([\d,]+) points for UGX ([\d,]+)$/, (m) => `Tumia pointi ${m[1]} kupata UGX ${m[2]}`],
    [/^([\d,]+) points = UGX ([\d,]+) wallet credit$/, (m) => `Pointi ${m[1]} = UGX ${m[2]} kwenye pochi`],
    [/^([\d,]+) more points for UGX ([\d,]+)$/, (m) => `Pointi ${m[1]} zaidi kupata UGX ${m[2]}`],
    [/^Up to UGX ([\d,]+) · applied automatically$/, (m) => `Hadi UGX ${m[1]} · inawekwa moja kwa moja`],
    [/^Test mode \(no (\w+) set up\): your code is (\d+)$/, (m) => `Hali ya majaribio: nambari yako ni ${m[2]}`],
    [/^Code sent (by SMS|on WhatsApp|in Telegram)$/, (m) => `Nambari imetumwa ${({ 'by SMS': 'kwa SMS', 'on WhatsApp': 'kwa WhatsApp', 'in Telegram': 'kwenye Telegram' })[m[1]]}`],
    [/^Enter a valid (.+) mobile number, e\.g\. (.+)\.$/, (m) => `Weka namba sahihi ya simu, mf. ${m[2]}.`],
    [/^You can request a new code in (\d+)s\.$/, (m) => `Unaweza kuomba nambari mpya baada ya sekunde ${m[1]}.`],
    [/^Call (.+)$/, (m) => `Piga ${m[1]}`],
    [/^(Bronze|Silver|Gold) member$/, (m) => `Mwanachama wa ${({ Bronze: 'Shaba', Silver: 'Fedha', Gold: 'Dhahabu' })[m[1]]}`],
    [/^Ready to swap for (UGX [\d,]+)$/, (m) => `Tayari kubadilisha kupata ${m[1]}`],
    [/^Swap (\d+) points for (UGX [\d,]+)$/, (m) => `Badilisha pointi ${m[1]} upate ${m[2]}`],
    [/^Swap at (\d+) points$/, (m) => `Badilisha ukifika pointi ${m[1]}`],
    [/^Swapped for (UGX [\d,]+)$/, (m) => `Imebadilishwa kupata ${m[1]}`],
    [/^(\d+) points? for every UGX 1,000 you pay$/, (m) => `Pointi ${m[1]} kwa kila UGX 1,000 unayolipa`],
    [/^(\d+) points = (UGX [\d,]+), spent on your next trips$/, (m) => `Pointi ${m[1]} = ${m[2]}, kwa safari zako zijazo`],
    [/^([\d,]+) more points for (UGX [\d,]+)$/, (m) => `Pointi ${m[1]} zaidi kupata ${m[2]}`],
  ];
  const tr = (t) => {
    if (SW[t]) return SW[t];
    for (const [re, f] of PAT) { const m = re.exec(t); if (m) return f(m); }
    return null;
  };
  const doText = (n) => {
    const v = n.nodeValue; if (!v) return;
    const t = v.trim(); if (!t || t.length > 300) return;
    const out = tr(t); if (out && out !== t) n.nodeValue = v.replace(t, out);
  };
  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const doEl = (el) => { for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v) { const out = tr(v.trim()); if (out) el.setAttribute(a, out); } } };
  const walk = (root) => {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || root.closest && root.closest('script,style,svg,[data-no-tr]')) return;
    doEl(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (w.nextNode()) { const n = w.currentNode; if (n.nodeType === 3) doText(n); else if (!/^(SCRIPT|STYLE|svg)$/.test(n.nodeName)) doEl(n); }
  };
  const start = () => {
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doEl(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
