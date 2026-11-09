// Flytte brand basics shared by the asset tools: the F (logo concept 01) and the palette.
const TEAL = '#073B42', LAGOON = '#0E6E73', GOLD = '#F2B544';
// The F: two swept wings, drawn in a 76.82 × 145.05 box.
const F = [
  'M76.82 0V21.29C76.82 27.37 73.58 32.99 68.31 36.03L26.95 59.91C23.05 62.16 7.5 68.5 0 86.42V57.23C0 49.27 4.25 41.9 11.15 37.92L26.95 28.8Z',
  'M68.7 52.48V72.14C68.7 79.23 64.92 85.78 58.78 89.33L38.18 101.22C31.23 105.24 26.95 112.65 26.95 120.68V145.05H0V116.04C0 101.26 7.89 87.6 20.69 80.2L26.95 76.59Z',
];
const W = 76.82, H = 145.05;
// Each app's icon colours: riders gold with a teal F, drivers teal with a gold F.
const APP_COLORS = { rider: { bg: GOLD, fg: TEAL }, driver: { bg: TEAL, fg: GOLD } };

// A square (or rounded/round) tile with the F centred; `scale` is the F's height as a share of the tile.
// bg null leaves it transparent (Android adaptive-icon foreground).
function tile(size, bg, fg, scale, { radius = 0, round = false } = {}) {
  const h = size * scale, k = h / H, w = W * k;
  const x = (size - w) / 2 + w * 0.02, y = (size - h) / 2;
  const back = !bg ? '' : round ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${bg}"/>` : `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${back}
<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)})" fill="${fg}"><path d="${F[0]}"/><path d="${F[1]}"/></g></svg>`;
}

// Plus Jakarta Sans (the wordmark font) as a data URL, for pages rendered offline.
function jakartaFontFace(root) {
  const font = require('fs').readFileSync(require('path').join(root, 'node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2')).toString('base64');
  return `@font-face { font-family: J; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 200 800; }`;
}

// Chromium for rendering: CHROMIUM, else Playwright's own.
function chromiumPath() {
  const fs = require('fs'), path = require('path');
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  try {
    const d = '/opt/pw-browsers'; const c = fs.readdirSync(d).find((x) => /^chromium-\d+$/.test(x));
    return c && ['chrome-linux64/chrome', 'chrome-linux/chrome'].map((x) => path.join(d, c, x)).find((x) => fs.existsSync(x));
  } catch { return undefined; }
}

module.exports = { TEAL, LAGOON, GOLD, F, W, H, APP_COLORS, tile, jakartaFontFace, chromiumPath };
