// Flytte's own map look: calm greys with soft teal water and parks, white roads, and the landmarks
// people navigate by (fuel stations, malls, markets, hospitals, banks, stages) in small muted labels,
// so the route, the pins and the vehicles stand out. Built from OpenFreeMap's Positron (light)
// and Dark styles by recolouring their layers; the map data and fonts still come from OpenFreeMap.
//   public/map/flytte-light.json   public/map/flytte-dark.json
// Run after changing the colours below:  node tools/map-style.js   (needs internet access)
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'map');

const LIGHT = {
  background: '#EDF0EF', residential: '#E8ECEA', park: '#CBE3D6', wood: '#C3DDCF', water: '#A6D2D8',
  building: '#DFE5E2', buildingEdge: '#D2DAD7',
  minor: '#FFFFFF', major: '#FFFFFF', casing: '#B9C6C3', path: '#DCE3E0', rail: '#CCD5D2', railDash: '#EDF0EF',
  roadName: '#5A6B6E', roadHalo: '#EDF0EF', poi: '#4A5D60', place: '#0D2226', placeMinor: '#3F5053', placeHalo: '#FFFFFF', waterName: '#0E6E73', boundary: '#B9C4C2',
};
const DARK = {
  background: '#0A1416', residential: '#0C181A', park: '#0E221F', wood: '#0E221F', water: '#0B2B31',
  building: '#0D1B1E', buildingEdge: '#14282C',
  minor: '#1B3033', major: '#2C484C', casing: '#0A1416', path: '#14262A', rail: '#1B2E31', railDash: '#0A1416',
  roadName: '#8AA1A3', roadHalo: '#0A1416', poi: '#93A9AB', place: '#C9D8D9', placeMinor: '#93A9AB', placeHalo: 'rgba(5,14,16,.8)', waterName: '#5FB3B7', boundary: '#2B4447',
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

// Landmarks people in Kampala navigate by: fuel stations, malls and supermarkets, markets,
// hospitals, banks, taxi and bus stages, hotels, places of worship, universities, police, stadiums.
// A small category icon with a muted name (never one without the other); the best-known ones
// from zoom 14, the rest from 15.5. Icons come from OpenFreeMap's sprite.
const LANDMARK = ['any',
  ['match', ['get', 'class'], ['fuel', 'bank', 'bus', 'lodging', 'place_of_worship', 'college', 'police', 'stadium', 'grocery'], true, false],
  ['match', ['get', 'subclass'], ['hospital', 'mall', 'supermarket', 'department_store', 'marketplace', 'bus_station', 'university'], true, false]];
const ICON = ['match', ['get', 'subclass'],
  'hospital', 'hospital', ['mall', 'department_store'], 'shop', ['supermarket', 'marketplace'], 'grocery', 'bus_station', 'bus', 'university', 'college',
  ['match', ['get', 'class'], ['fuel', 'bank', 'bus', 'lodging', 'place_of_worship', 'college', 'police', 'stadium', 'grocery'], ['get', 'class'], 'shop']];
const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
function landmarks(c) {
  const tier = (id, minzoom, rank) => ({
    id: `landmark_${id}`, type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom,
    filter: ['all', LANDMARK, ['has', 'name'], rank],
    layout: { 'icon-image': ICON, 'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 0.85],
      'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10.5, 18, 12.5],
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.9, 'text-justify': 'auto', 'text-max-width': 8, 'text-padding': 3 },
    paint: { 'text-color': c.poi, 'text-halo-color': c.placeHalo, 'text-halo-width': 1.3, 'icon-opacity': 0.9 },
  });
  return [tier('all', 15.5, ['>', ['get', 'rank'], 30]), tier('main', 14, ['<=', ['get', 'rank'], 30])];
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
    // Landmarks win over road names when space is tight, and lose to area and town names.
    const firstPlace = style.layers.findIndex((l) => l.type === 'symbol' && l['source-layer'] === 'place');
    style.layers.splice(firstPlace < 0 ? style.layers.length : firstPlace, 0, ...landmarks(c));
    style.metadata = { ...(style.metadata || {}), 'flytte:base': `OpenFreeMap ${base}`, 'flytte:generated-by': 'tools/map-style.js' };
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(style));
    console.log('wrote', `public/map/${name}.json`, style.layers.length, 'layers');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
