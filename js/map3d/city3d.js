// The 3D city: a MapLibre GL map laid over the Leaflet map while you explore
// a city. Real terrain (so Rome's hills rise), the landmark models from
// models.js, the generated houses from houses.js, and the same timeline:
// scrub the years and buildings rise and fall.
//
// MapLibre is loaded from the CDN the first time someone opens a city in 3D.

import { createFrame, area, circle, centroid } from './geom.js';
import { buildModel, C } from './models.js';
import { generateHouses, HOUSE_INFO, HOUSE_LABEL } from './houses.js';
import { kindInfo, labelPoint } from '../map/cityLayer.js';

const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl';
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const IMAGERY_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const FOREVER = 1e7; // layer filters need numbers, so +-Infinity become +-1e7
const EMPTY = { type: 'FeatureCollection', features: [] };

const WATER = new Set(['lake', 'lake-salt', 'sea', 'harbour']);
const LINE_COLOURS = { river: C.water, canal: C.water, gap: C.water, road: '#d3c3a1' };
// Label zooms are one lower than on the flat map (MapLibre counts 512px tiles).
const LABEL_ZOOM = { hill: 12.5, label: 13, district: 13, river: 12.5, wall: 14, aqueduct: 14, lake: 12 };

let loading = null;
function loadMapLibre() {
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${MAPLIBRE}.css`;
    document.head.append(css);
    const js = document.createElement('script');
    js.src = `${MAPLIBRE}.js`;
    js.onload = () => resolve(window.maplibregl);
    js.onerror = () => reject(new Error('Could not load MapLibre GL'));
    document.head.append(js);
  });
  return loading;
}

export function createCity3D(container, { onSelect }) {
  let map = null;
  let ml = null;
  let city = null;
  let data = null;
  let t = 0;
  let imagery = 0;
  let isOpen = false;
  const cache = new Map();
  const status = container.querySelector('.status3d');

  async function open(c, { center, zoom, t: t0 }) {
    isOpen = true;
    t = t0;
    container.hidden = false;
    status.textContent = `Building ${c.name}…`;
    status.hidden = false;
    ml ??= await loadMapLibre();
    if (!cache.has(c.id)) cache.set(c.id, await buildData(c));
    if (!isOpen) return;
    const startAt = { center: [center[1], center[0]], zoom: zoom - 1, pitch: 0, bearing: 0 };
    if (!map) {
      map = new ml.Map({ container: container.querySelector('.map3d'), style: baseStyle(c), ...startAt, maxPitch: 78, maxZoom: 19.5, attributionControl: { compact: true } });
      map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
      wireEvents();
      await new Promise((resolve) => map.once('load', resolve));
      // On a phone the credits start folded behind their (i) button, off the small map.
      if (matchMedia('(max-width: 820px)').matches) container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    } else {
      map.resize();
      map.jumpTo(startAt);
    }
    if (city !== c) showCity(c);
    status.hidden = true;
    applyTime();
    setImagery(imagery);
    map.easeTo({ pitch: 62, bearing: -20, zoom: zoom - 0.4, duration: 2200 });
  }

  function close() {
    isOpen = false;
    container.hidden = true;
  }

  function showCity(c) {
    city = c;
    data = cache.get(c.id);
    for (const key of ['flats', 'lines', 'solids', 'houses']) map.getSource(key).setData(data[key]);
    data.labels.forEach((l) => l.marker.addTo(map));
    cache.forEach((d, id) => { if (id !== c.id) d.labels.forEach((l) => l.marker.remove()); });
  }

  function update(t1) {
    t = t1;
    if (map && isOpen && city) applyTime();
  }

  function applyTime() {
    const filter = ['all', ['<=', ['get', 't0'], t], ['>', ['get', 't1'], t]];
    for (const id of ['flats', 'lines', 'solids', 'houses', 'roofs']) map.setFilter(id, filter);
    updateLabels();
  }

  function updateLabels() {
    const z = map.getZoom();
    for (const l of data.labels) {
      const show = t >= l.t0 && t < l.t1 && z >= l.zoom;
      if (show !== l.shown) { l.marker.getElement().style.display = show ? '' : 'none'; l.shown = show; }
    }
  }

  // Then and Today: fade the reconstruction over modern satellite imagery.
  function setImagery(v) {
    imagery = v;
    if (!map?.isStyleLoaded()) return;
    map.setPaintProperty('imagery', 'raster-opacity', v);
    map.setPaintProperty('shade', 'hillshade-exaggeration', 0.45 * (1 - v));
    map.setPaintProperty('flats', 'fill-opacity', 1 - v);
    map.setPaintProperty('lines', 'line-opacity', 1 - v);
    for (const id of ['houses', 'roofs', 'solids']) map.setPaintProperty(id, 'fill-extrusion-opacity', 1 - v * 0.85);
    container.classList.toggle('imagery-on', v > 0.5);
  }

  function flyTo(feature) {
    if (!map) return;
    const [lat, lng] = latLng(labelPoint(feature));
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16.2), pitch: Math.max(map.getPitch(), 55), duration: 1600 });
  }

  function wireEvents() {
    const tip = new ml.Popup({ closeButton: false, closeOnClick: false, className: 'tip3d', offset: 12 });
    const info = new ml.Popup({ className: 'info3d', maxWidth: '260px' });
    map.on('mousemove', (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ['solids', 'roofs', 'houses'] })[0];
      map.getCanvas().style.cursor = f ? 'pointer' : '';
      if (!f) { tip.remove(); return; }
      const p = f.properties;
      const text = p.n ?? (p.k ? `${HOUSE_LABEL[p.k] ?? p.k}${p.s > 1 ? ` · ${p.s} storeys` : ''}` : null);
      if (!text) { tip.remove(); return; }
      tip.setLngLat(e.lngLat).setText(text).addTo(map);
    });
    map.on('mouseout', () => tip.remove());
    map.on('click', (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ['solids', 'roofs', 'houses'] })[0];
      if (!f) return;
      const p = f.properties;
      if (p.fid != null && p.n) onSelect(city.features[p.fid], city);
      else if (p.k) info.setLngLat(e.lngLat).setText(HOUSE_INFO[p.k]).addTo(map);
    });
    map.on('zoom', () => data && updateLabels());
  }

  return { open, close, update, setImagery, flyTo, get isOpen() { return isOpen; }, get map() { return map; } };
}

function baseStyle(city) {
  const lat = city.center[0];
  const mpp = (z) => (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  const width = ['interpolate', ['exponential', 2], ['zoom'],
    8, ['max', 1, ['/', ['get', 'w'], mpp(8)]],
    22, ['/', ['get', 'w'], mpp(22)]];
  const dem = { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: 'Terrain: Mapzen, AWS' };
  return {
    version: 8,
    sources: {
      dem,
      shade: { ...dem },
      imagery: { type: 'raster', tiles: [IMAGERY_TILES], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      flats: { type: 'geojson', data: EMPTY },
      lines: { type: 'geojson', data: EMPTY },
      solids: { type: 'geojson', data: EMPTY, attribution: city.osmCredit ?? '' },
      houses: { type: 'geojson', data: EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#e6dbc0' } },
      { id: 'shade', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#6f5f45', 'hillshade-highlight-color': '#fbf4e2', 'hillshade-accent-color': '#8c7b5b' } },
      { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-opacity': 0 } },
      { id: 'flats', type: 'fill', source: 'flats', paint: { 'fill-color': ['get', 'c'] } },
      { id: 'lines', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': width } },
      { id: 'houses', type: 'fill-extrusion', source: 'houses', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0 } },
      { id: 'roofs', type: 'fill-extrusion', source: 'houses', paint: { 'fill-extrusion-color': ['get', 'r'], 'fill-extrusion-height': ['+', ['get', 'h'], ['get', 'rt']], 'fill-extrusion-base': ['get', 'h'] } },
      { id: 'solids', type: 'fill-extrusion', source: 'solids', paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'] } },
    ],
    terrain: { source: 'dem', exaggeration: 1.3 },
    sky: { 'sky-color': '#b9d0e4', 'horizon-color': '#efe5cf', 'fog-color': '#e8dec6', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.25 },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.42, position: [1.4, 215, 38] },
  };
}

// ---------- Turning the city file into map data ----------
async function buildData(city) {
  const frame = createFrame(city.center);
  const ll = (ring) => {
    const out = ring.map(frame.toLngLat);
    out.push(out[0]);
    return out;
  };
  const polygon = (rings, props) => ({
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'Polygon',
      // Outer ring anticlockwise, holes clockwise: MapLibre reads holes by winding.
      coordinates: rings.map((r, i) => ll((area(r) > 0) === (i === 0) ? r : r.slice().reverse())),
    },
  });
  const span = (p) => ({ t0: clampT(p.t0), t1: clampT(p.t1) });

  const plazas = city.features
    .filter((f) => ['plaza', 'precinct'].includes(f.properties.kind) && f.geometry.type !== 'Point')
    .map((f) => {
      const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]).map(frame.toXY);
      return ring.reduce((a, q) => [a[0] + q[0] / ring.length, a[1] + q[1] / ring.length], [0, 0]);
    });

  // Openings in causeways where bridges stand (and later, the breaches).
  // Bridges and breaches are drawn as short lines across the causeway; the
  // opening is as wide as a breach.
  const opening = kindInfo('gap').widthM;
  const cuts = city.features
    .filter((f) => ['bridge', 'gap'].includes(f.properties.kind) && f.geometry.type === 'LineString')
    .map((f) => {
      const [a, b] = [f.geometry.coordinates[0], f.geometry.coordinates.at(-1)].map(frame.toXY);
      return { c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], half: opening / 2 };
    });

  // Where the named buildings stand, so generated extras can keep clear.
  const BUILT = ['temple', 'building', 'palace', 'market', 'arena', 'baths', 'fort', 'tomb'];
  const footprints = city.features.filter((f) => BUILT.includes(f.properties.kind)).map((f) => {
    const g = f.geometry;
    if (g.type === 'Point') return { c: frame.toXY(g.coordinates), r: f.properties.radiusM ?? 30 };
    const ring = (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]).map(frame.toXY);
    const c = centroid(ring);
    return { c, r: Math.max(...ring.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))) };
  });
  const isFree = (q, r) => footprints.every((o) => Math.hypot(q[0] - o.c[0], q[1] - o.c[1]) > o.r + r);

  const flats = [];
  const lines = [];
  const solids = [];
  const labels = [];
  city.features.forEach((f, fid) => {
    const p = f.properties;
    const g = f.geometry;
    const life = span(p);
    const rings = polygonRings(g, p, frame);
    // Seas and lakes go under the land drawn on them; harbours and ponds sit on top.
    const under = (p.kind === 'sea' || p.kind.startsWith('lake')) && g.type !== 'Point';
    if (WATER.has(p.kind)) rings.forEach((r) => flats.push(polygon(r, { c: p.kind === 'lake-salt' ? '#9fb8c8' : C.water, o: under ? -1 : 3, ...life })));
    else if (['island', 'land', 'town'].includes(p.kind)) rings.forEach((r) => flats.push(polygon(r, { c: '#e2d5b4', o: 0, ...life })));
    else if (p.kind === 'houses') rings.forEach((r) => flats.push(polygon(r, { c: C.ground, o: 0, ...life })));
    else if (p.kind === 'rubble') rings.forEach((r) => flats.push(polygon(r, { c: '#d2c7b0', o: 0, ...life })));

    if (p.kind in LINE_COLOURS && (g.type === 'LineString' || g.type === 'MultiLineString')) {
      lines.push({ type: 'Feature', properties: { c: LINE_COLOURS[p.kind], w: p.widthM ?? kindInfo(p.kind).widthM ?? 10, ...life }, geometry: g });
    }

    const model = p.fabric && !p.model ? null : buildModel(f, { toXY: frame.toXY, plazas, style: city.style3d ?? 'roman', cuts, isFree });
    if (model) {
      for (const part of model.parts) solids.push(polygon(part.rings, { b: round1(part.b), h: round1(part.h), c: part.c, fid, n: p.name ?? null, ...life }));
      for (const fl of model.flats) flats.push(polygon(fl.rings, { c: fl.c, o: flatOrder(fl.c), ...life }));
    }

    if (p.name && p.showLabel !== false) {
      const el = document.createElement('div');
      el.className = `city-label k-${p.kind}`;
      el.innerHTML = '<span></span>';
      el.firstChild.textContent = p.name;
      const [lat, lng] = latLng(labelPoint(f));
      // Street names only up close in 3D, where they don't crowd the roofs.
      const zoom = p.kind === 'road' ? Math.max(17, p.labelZoom ?? 17) : (p.labelZoom ?? LABEL_ZOOM[p.kind] ?? 15.5) - 1;
      labels.push({ marker: new window.maplibregl.Marker({ element: el }).setLngLat([lng, lat]), zoom, t0: p.t0, t1: p.t1, shown: true });
    }
  });

  const { houses, extras } = await generateHouses(city, frame);
  const houseFeatures = houses.map((h) => polygon(h.rings, {
    h: h.h, c: h.c, r: h.roof, rt: h.rt, k: h.type, s: Math.max(1, Math.round(h.h / 3.2)), t0: clampT(h.t0), t1: clampT(h.t1),
  }));
  for (const part of extras.parts) solids.push(polygon(part.rings, { b: round1(part.b), h: round1(part.h), c: part.c, t0: clampT(part.t0), t1: clampT(part.t1) }));
  for (const fl of extras.flats) flats.push(polygon(fl.rings, { c: fl.c, o: 1, t0: clampT(fl.t0), t1: clampT(fl.t1) }));

  flats.sort((a, b) => a.properties.o - b.properties.o);
  console.info(`[3d] ${city.name}: ${houseFeatures.length} houses, ${solids.length} landmark parts`);
  return {
    flats: { type: 'FeatureCollection', features: flats },
    lines: { type: 'FeatureCollection', features: lines },
    solids: { type: 'FeatureCollection', features: solids },
    houses: { type: 'FeatureCollection', features: houseFeatures },
    labels,
  };
}

function polygonRings(g, p, frame) {
  if (g.type === 'Point') return p.radiusM ? [[circle(frame.toXY(g.coordinates), p.radiusM, 40)]] : [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.map((poly) => poly.map((ring) => ring.slice(0, -1).map(frame.toXY)));
}

// labelPoint gives [lat, lng] or a Leaflet LatLng.
const latLng = (pt) => (Array.isArray(pt) ? pt : [pt.lat, pt.lng]);
const flatOrder = (c) => ({ [C.ground]: 0, [C.garden]: 1, [C.paving]: 2, [C.water]: 3, [C.sand]: 4 }[c] ?? 2);
const clampT = (v) => Math.max(-FOREVER, Math.min(FOREVER, v));
const round1 = (v) => Math.round(v * 10) / 10;
