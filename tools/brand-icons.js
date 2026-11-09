// Renders the Flytte app icons and the email logo from the F (logo concept 01).
// Run after changing the mark:  node tools/brand-icons.js   (needs Playwright's Chromium)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const TEAL = '#073B42', LAGOON = '#0E6E73', GOLD = '#F2B544';
// The F: two swept wings, drawn in a 76.82 × 145.05 box.
const F = [
  'M76.82 0V21.29C76.82 27.37 73.58 32.99 68.31 36.03L26.95 59.91C23.05 62.16 7.5 68.5 0 86.42V57.23C0 49.27 4.25 41.9 11.15 37.92L26.95 28.8Z',
  'M68.7 52.48V72.14C68.7 79.23 64.92 85.78 58.78 89.33L38.18 101.22C31.23 105.24 26.95 112.65 26.95 120.68V145.05H0V116.04C0 101.26 7.89 87.6 20.69 80.2L26.95 76.59Z',
];
const W = 76.82, H = 145.05;

// A square tile with the F centred; `scale` is the F's height as a share of the tile.
function tile(size, bg, fg, scale, radius = 0) {
  const h = size * scale, k = h / H, w = W * k;
  const x = (size - w) / 2 + w * 0.02, y = (size - h) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>
<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)})" fill="${fg}"><path d="${F[0]}"/><path d="${F[1]}"/></g></svg>`;
}

const ICONS = [
  // rider: Deep Teal tile, gold F
  ['public/icons/flytte-icon-192.png', tile(192, TEAL, GOLD, 0.6)],
  ['public/icons/flytte-icon-512.png', tile(512, TEAL, GOLD, 0.6)],
  ['public/icons/flytte-maskable-512.png', tile(512, TEAL, GOLD, 0.48)],
  ['public/icons/flytte-apple-touch-icon.png', tile(180, TEAL, GOLD, 0.58)],
  // driver: Saffron Gold tile, teal F
  ['public/icons/flytte-driver-192.png', tile(192, GOLD, TEAL, 0.6)],
  ['public/icons/flytte-driver-512.png', tile(512, GOLD, TEAL, 0.6)],
  ['public/icons/flytte-driver-maskable-512.png', tile(512, GOLD, TEAL, 0.48)],
  ['public/icons/flytte-driver-apple-touch-icon.png', tile(180, GOLD, TEAL, 0.58)],
];

// Email header logo (sits on Deep Teal): gold F + white "flytte", 3x for sharp mail clients.
function emailLogo() {
  const font = fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2')).toString('base64');
  return `<!doctype html><html><head><style>
@font-face { font-family: J; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 200 800; }
html, body { margin: 0; background: transparent; }
.l { display: inline-flex; align-items: baseline; padding: 4px 6px 30px 2px; font: 700 96px/1 J; letter-spacing: -.02em; color: #fff; }
svg { width: .746em; height: 1.41em; margin-right: .3em; transform: translateY(.26em); }
</style></head><body><div class="l"><svg viewBox="0 0 ${W} ${H}" fill="${GOLD}"><path d="${F[0]}"/><path d="${F[1]}"/></svg>flytte</div></body></html>`;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const page = await browser.newPage();
  for (const [file, svg] of ICONS) {
    const size = +svg.match(/width="(\d+)"/)[1];
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, file), clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', file);
  }
  fs.writeFileSync(path.join(ROOT, 'public/icon.svg'), tile(100, TEAL, GOLD, 0.6).replace(/ width="100" height="100"/, '') + '\n');
  console.log('wrote public/icon.svg');
  await page.setViewportSize({ width: 800, height: 300 });
  await page.setContent(emailLogo());
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('.l');
  await el.screenshot({ path: path.join(ROOT, 'public/img/email-logo.png'), omitBackground: true });
  // Trim the transparent edge, then leave a 6px margin (ImageMagick).
  try { require('child_process').execFileSync('convert', [path.join(ROOT, 'public/img/email-logo.png'), '-trim', '+repage', '-bordercolor', 'none', '-border', '6', path.join(ROOT, 'public/img/email-logo.png')]); } catch (e) { console.warn('ImageMagick not found: email logo left untrimmed'); }
  console.log('wrote public/img/email-logo.png');
  await browser.close();
})();
