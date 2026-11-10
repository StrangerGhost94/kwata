// Flytte's own map look: calm greys with soft teal water and parks, white roads, fewer labels,
// so the route, the pins and the vehicles stand out. Built from OpenFreeMap's Positron (light)
// and Dark styles by recolouring their layers; the map data and fonts still come from OpenFreeMap.
//   public/map/flytte-light.json   public/map/flytte-dark.json
// Run after changing the colours below:  node tools/map-style.js   (needs internet access)
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'map');

const LIGHT = {
  background: '#F3F5F4', residential: '#EEF1EF', park: '#DCEBE3', wood: '#D5E6DD', water: '#BCDCDF',
  building: '#E6EBE9', buildingEdge: '#DAE1DE',
  minor: '#FFFFFF', major: '#FFFFFF', casing: '#D3DBD9', path: '#E4E9E7', rail: '#D9DFDD', railDash: '#F3F5F4',
  roadName: '#66777A', roadHalo: '#F3F5F4', place: '#0D2226', placeMinor: '#3F5053', placeHalo: '#FFFFFF', waterName: '#0E6E73', boundary: '#B9C4C2',
};
const DARK = {
  background: '#0A1416', residential: '#0C181A', park: '#0E221F', wood: '#0E221F', water: '#0B2B31',
  building: '#0D1B1E', buildingEdge: '#14282C',
  minor: '#182A2D', major: '#213639', casing: '#0A1416', path: '#14262A', rail: '#1B2E31', railDash: '#0A1416',
  roadName: '#7F9698', roadHalo: '#0A1416', place: '#C9D8D9', placeMinor: '#93A9AB', placeHalo: 'rgba(5,14,16,.8)', waterName: '#5FB3B7', boundary: '#2B4447',
};

// Which colour each layer takes, by what the layer is.
function recolour(layer, c) {
  const id = layer.id, p = layer.paint || (layer.paint = {}), src = layer['source-layer'];
  if (layer.type === 'background') p['background-color'] = c.background;
  else if (layer.type === 'fill') {
    if (src === 'water') p['fill-color'] = c.water;
    else if (src === 'park' || /park/.test(id)) p['fill-color'] = c.park;
    else if (/wood/.test(id)) p['fill-color'] = c.wood;
    else if (/residential/.test(id)) p['fill-color'] = c.residential;
    else if (src === 'building') { p['fill-color'] = c.building; p['fill-outline-color'] = c.buildingEdge; }
    else if (src === 'aeroway') p['fill-color'] = c.residential;
    else if (/pier/.test(id)) p['fill-color'] = c.background;
    else if (/ice|glacier/.test(id)) p['fill-color'] = c.background;
  } else if (layer.type === 'line') {
    if (src === 'waterway') p['line-color'] = c.water;
    else if (src === 'boundary') p['line-color'] = c.boundary;
    else if (src === 'aeroway') p['line-color'] = /casing/.test(id) ? c.casing : c.minor;
    else if (/dashline/.test(id)) p['line-color'] = c.railDash;
    else if (/railway/.test(id)) p['line-color'] = c.rail;
    else if (/pier/.test(id)) p['line-color'] = c.background;
    else if (/casing/.test(id)) p['line-color'] = c.casing;
    else if (/path/.test(id)) p['line-color'] = c.path;
    else if (/minor/.test(id)) p['line-color'] = c.minor;
    else if (/subtle/.test(id)) p['line-color'] = c.casing;
    else if (/motorway|major/.test(id)) p['line-color'] = c.major;
  } else if (layer.type === 'symbol') {
    if (src === 'water_name' || src === 'waterway') { p['text-color'] = c.waterName; p['text-halo-color'] = c.placeHalo; }
    else if (src === 'transportation_name') { if ('text-color' in p || layer.layout && layer.layout['text-field']) { p['text-color'] = c.roadName; p['text-halo-color'] = c.roadHalo; p['text-halo-width'] = 1.2; } }
    else if (src === 'place') {
      const big = /city|town|capital/.test(id);
      p['text-color'] = big ? c.place : c.placeMinor; p['text-halo-color'] = c.placeHalo; p['text-halo-width'] = 1.4;
    } else if (src === 'aerodrome_label') { p['text-color'] = c.placeMinor; p['text-halo-color'] = c.placeHalo; }
  }
  return layer;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, base, c] of [['flytte-light', 'positron', LIGHT], ['flytte-dark', 'dark', DARK]]) {
    const r = await fetch(`https://tiles.openfreemap.org/styles/${base}`);
    if (!r.ok) throw new Error(`OpenFreeMap ${base}: ${r.status}`);
    const style = await r.json();
    style.name = name === 'flytte-light' ? 'Flytte' : 'Flytte Dark';
    // No shaded-relief raster (it muddies the flat colours), no highway shields, no one-way arrows.
    delete style.sources.ne2_shaded;
    style.layers = style.layers
      .filter((l) => l.source !== 'ne2_shaded' && !/shield|oneway/.test(l.id))
      .map((l) => recolour(l, c));
    style.metadata = { ...(style.metadata || {}), 'flytte:base': `OpenFreeMap ${base}`, 'flytte:generated-by': 'tools/map-style.js' };
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(style));
    console.log('wrote', `public/map/${name}.json`, style.layers.length, 'layers');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
