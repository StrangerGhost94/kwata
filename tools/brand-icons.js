// Renders the Flytte app icons and the email logo from the F (logo concept 01).
// Run after changing the mark:  node tools/brand-icons.js   (needs Playwright's Chromium)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const { TEAL, GOLD, F, W, H, jakartaFontFace, chromiumPath } = require('./brand');
const tile = (size, bg, fg, scale, radius = 0) => require('./brand').tile(size, bg, fg, scale, { radius });

const ICONS = [
  // rider: Saffron Gold tile, teal F
  ['public/icons/flytte-icon-192.png', tile(192, GOLD, TEAL, 0.6)],
  ['public/icons/flytte-icon-512.png', tile(512, GOLD, TEAL, 0.6)],
  ['public/icons/flytte-maskable-512.png', tile(512, GOLD, TEAL, 0.48)],
  ['public/icons/flytte-apple-touch-icon.png', tile(180, GOLD, TEAL, 0.58)],
  // driver: Deep Teal tile, gold F
  ['public/icons/flytte-driver-192.png', tile(192, TEAL, GOLD, 0.6)],
  ['public/icons/flytte-driver-512.png', tile(512, TEAL, GOLD, 0.6)],
  ['public/icons/flytte-driver-maskable-512.png', tile(512, TEAL, GOLD, 0.48)],
  ['public/icons/flytte-driver-apple-touch-icon.png', tile(180, TEAL, GOLD, 0.58)],
];

// Email header logo (sits on Deep Teal): gold F + white "flytte", 3x for sharp mail clients.
function emailLogo() {
  return `<!doctype html><html><head><style>
${jakartaFontFace(ROOT)}
html, body { margin: 0; background: transparent; }
.l { display: inline-flex; align-items: baseline; padding: 4px 6px 30px 2px; font: 700 96px/1 J; letter-spacing: -.02em; color: #fff; }
svg { width: .746em; height: 1.41em; margin-right: .3em; transform: translateY(.26em); }
</style></head><body><div class="l"><svg viewBox="0 0 ${W} ${H}" fill="${GOLD}"><path d="${F[0]}"/><path d="${F[1]}"/></svg>flytte</div></body></html>`;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const page = await browser.newPage();
  for (const [file, svg] of ICONS) {
    const size = +svg.match(/width="(\d+)"/)[1];
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, file), clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', file);
  }
  fs.writeFileSync(path.join(ROOT, 'public/icon.svg'), tile(100, GOLD, TEAL, 0.6).replace(/ width="100" height="100"/, '') + '\n');
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
