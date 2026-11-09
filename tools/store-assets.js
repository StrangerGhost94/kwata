// Store artwork from the Flytte F, for both apps:
//   store/<app>/app-store-icon-1024.png   App Store icon (square, no transparency)
//   store/<app>/play-icon-512.png         Google Play icon
//   store/<app>/feature-graphic.png       Google Play feature graphic, 1024 × 500
// and, when the native projects exist (apps/), their launcher icons and launch screens.
// Run: node tools/store-assets.js   (needs Playwright's Chromium; set CHROMIUM=… if it isn't found)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { TEAL, GOLD, F, W, H, APP_COLORS, tile, jakartaFontFace, chromiumPath } = require('./brand');

const ROOT = path.join(__dirname, '..');
const APPS = {
  rider: { name: 'flytte', sub: '', tagline: 'Ride light. Arrive sure.', points: ['Boda', 'Car', 'Parcel', 'Airport'] },
  driver: { name: 'flytte', sub: 'Driver', tagline: 'Earn · Drive · Grow', points: ['Keep 88% of every fare', 'Cash out to Mobile Money'] },
};

// Width and height of an existing PNG (from its header), so launch images keep their sizes.
function pngSize(file) { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }

// Google Play feature graphic: the wordmark and tagline on the app's colour, F wings echoed large at the right.
function featureGraphic(app) {
  const a = APPS[app], { bg, fg } = APP_COLORS[app];
  const ink = app === 'rider' ? TEAL : '#FFFFFF', soft = app === 'rider' ? 'rgba(7,59,66,.72)' : '#CFE3E3';
  const big = 640, k = big / H;
  return `<!doctype html><html><head><style>
${jakartaFontFace(ROOT)}
html, body { margin: 0; }
.g { width: 1024px; height: 500px; position: relative; overflow: hidden; background: ${bg}; font-family: J, sans-serif; }
.echo { position: absolute; right: -70px; top: -70px; opacity: ${app === 'rider' ? '.16' : '.12'}; }
.c { position: absolute; left: 84px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
.wm { display: flex; align-items: baseline; font-weight: 700; font-size: 112px; line-height: 1; letter-spacing: -.02em; color: ${ink}; }
.wm svg { width: .746em; height: 1.41em; margin-right: .3em; transform: translateY(.26em); }
.wm span { font-size: .42em; font-weight: 700; margin-left: .35em; color: ${app === 'rider' ? TEAL : GOLD}; letter-spacing: -.01em; }
.t { font-size: 40px; font-weight: 700; color: ${ink}; letter-spacing: -.01em; margin-top: 26px; }
.p { display: flex; gap: 10px; flex-wrap: wrap; }
.p i { font-style: normal; font-size: 22px; font-weight: 600; padding: 8px 16px; border-radius: 999px; background: ${app === 'rider' ? 'rgba(7,59,66,.1)' : 'rgba(255,255,255,.1)'}; color: ${soft}; }
</style></head><body><div class="g">
<svg class="echo" width="${(W * k).toFixed(0)}" height="${big}" viewBox="0 0 ${W} ${H}"><path fill="${fg}" d="${F[0]}"/><path fill="${fg}" d="${F[1]}"/></svg>
<div class="c">
  <div class="wm"><svg viewBox="0 0 ${W} ${H}"><path fill="${fg}" d="${F[0]}"/><path fill="${fg}" d="${F[1]}"/></svg>${a.name}${a.sub ? `<span>${a.sub}</span>` : ''}</div>
  <div class="t">${a.tagline}</div>
  <div class="p">${a.points.map((x) => `<i>${x}</i>`).join('')}</div>
</div></div></body></html>`;
}

async function shot(page, html, file, w, h, transparent = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html.startsWith('<svg') ? `<html><body style="margin:0;background:transparent">${html}</body></html>` : html);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h }, omitBackground: transparent });
  console.log('wrote', path.relative(ROOT, file));
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const page = await browser.newPage();
  for (const app of Object.keys(APPS)) {
    const { bg, fg } = APP_COLORS[app];
    const out = path.join(ROOT, 'store', app);
    // ---- store listing
    await shot(page, tile(1024, bg, fg, 0.56), path.join(out, 'app-store-icon-1024.png'), 1024, 1024);
    await shot(page, tile(512, bg, fg, 0.56), path.join(out, 'play-icon-512.png'), 512, 512);
    await shot(page, featureGraphic(app), path.join(out, 'feature-graphic.png'), 1024, 500);

    // ---- native projects
    const android = path.join(ROOT, 'apps', app, 'android/app/src/main/res');
    if (fs.existsSync(android)) {
      const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
      for (const [d, m] of Object.entries(dens)) {
        const dir = path.join(android, `mipmap-${d}`);
        await shot(page, tile(48 * m, bg, fg, 0.56), path.join(dir, 'ic_launcher.png'), 48 * m, 48 * m);
        await shot(page, tile(48 * m, bg, fg, 0.5, { round: true }), path.join(dir, 'ic_launcher_round.png'), 48 * m, 48 * m, true);
        // Adaptive icon foreground: 108 dp, the F inside the 66 dp safe circle.
        await shot(page, tile(108 * m, null, fg, 0.4), path.join(dir, 'ic_launcher_foreground.png'), 108 * m, 108 * m, true);
      }
      fs.writeFileSync(path.join(android, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`);
      // Launch screen (before Android 12, and behind the icon after): the F on the app's colour.
      for (const dir of fs.readdirSync(android).filter((x) => /^drawable/.test(x))) {
        const f = path.join(android, dir, 'splash.png');
        if (!fs.existsSync(f)) continue;
        const { w, h } = pngSize(f), s = Math.min(w, h);
        await shot(page, `<html><body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:${bg}">${tile(s, null, fg, 0.28)}</body></html>`, f, w, h);
      }
    }
    const ios = path.join(ROOT, 'apps', app, 'ios/App/App/Assets.xcassets');
    if (fs.existsSync(ios)) {
      await shot(page, tile(1024, bg, fg, 0.56), path.join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 1024);
      for (const f of fs.readdirSync(path.join(ios, 'Splash.imageset')).filter((x) => x.endsWith('.png'))) {
        await shot(page, `<html><body style="margin:0;width:2732px;height:2732px;display:grid;place-items:center;background:${bg}">${tile(2732, null, fg, 0.1)}</body></html>`, path.join(ios, 'Splash.imageset', f), 2732, 2732);
      }
    }
  }
  await browser.close();
})();
