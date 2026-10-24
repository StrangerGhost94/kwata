// MapLibre 6 only ships as an ES module. The Leaflet plugin and our pages expect the old
// `maplibregl` global, so this module sets it. Pages load it with type="module" and load
// everything after it with `defer`, which runs in page order, so the global exists in time.
import * as maplibregl from '/vendor/maplibre/maplibre-gl.mjs';
window.maplibregl = maplibregl;
