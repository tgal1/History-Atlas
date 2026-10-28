// Detailed city plans that take over when you zoom in: water, walls, roads,
// causeways and bridges, temples, palaces, markets, districts. Each feature
// has a "kind" that sets its look, optional from/to dates (the Colosseum
// appears in AD 80, Tenochtitlan's bridges vanish in 1520), and is clickable.
//
// Line widths are real-world metres ("widthM") converted to pixels at the
// current zoom, so a river looks like a river and a causeway like a causeway.

const KINDS = {
  // order: lower draws first
  sea:        { order: 0, type: 'area', fill: '#86b6dc', stroke: '#5b8fbf', fo: 0.95 },
  lake:       { order: 0, type: 'area', fill: '#8dbbe0', stroke: '#5b8fbf', fo: 0.95, label: 'Lake' },
  'lake-salt':{ order: 0, type: 'area', fill: '#a3b9cb', stroke: '#6f8ea6', fo: 0.95, label: 'Salt lake' },
  harbour:    { order: 3, type: 'area', fill: '#7fb0d8', stroke: '#4f7fae', fo: 1, label: 'Harbour' },
  river:      { order: 1, type: 'line', color: '#7fb0d8', widthM: 90, minPx: 4, label: 'River' },
  land:       { order: 2, type: 'area', fill: '#efe4cc', stroke: '#b8a47c', fo: 1, label: 'City' },
  island:     { order: 2, type: 'area', fill: '#e7dbbf', stroke: '#a8946c', fo: 1, label: 'Island' },
  town:       { order: 2, type: 'area', fill: '#e6dabd', stroke: '#a8946c', fo: 0.95, label: 'Town' },
  hill:       { order: 3, type: 'area', fill: '#c3cf92', stroke: '#9fae6e', fo: 0.35, weight: 0, label: 'Hill' },
  garden:     { order: 3, type: 'area', fill: '#b7d08f', stroke: '#86a35f', fo: 0.85, label: 'Gardens' },
  chinampa:   { order: 3, type: 'area', fill: '#a9cc86', stroke: '#79a056', fo: 0.9, dash: '2 3', label: 'Chinampa fields' },
  houses:     { order: 4, type: 'area', fill: '#e2cea4', stroke: '#b3956a', fo: 1, label: 'Houses and streets' },
  rubble:     { order: 4, type: 'area', fill: '#cfc5b3', stroke: '#9d907a', fo: 1, label: 'Ruined houses' },
  district:   { order: 4, type: 'area', fill: '#e8d9b5', stroke: '#b09a6a', fo: 0.35, dash: '6 4', label: 'District' },
  plaza:      { order: 5, type: 'area', fill: '#f6eedb', stroke: '#c4ae82', fo: 1, label: 'Plaza' },
  precinct:   { order: 5, type: 'area', fill: '#f3e6c6', stroke: '#8a5a3a', fo: 1, weight: 3, label: 'Sacred precinct' },
  ruins:      { order: 5, type: 'area', fill: '#cbbfa8', stroke: '#8a7a62', fo: 0.9, dash: '3 3', label: 'Ruins' },
  canal:      { order: 6, type: 'line', color: '#6fa6d6', widthM: 14, minPx: 2, label: 'Canal' },
  road:       { order: 7, type: 'line', color: '#ead9b0', casing: '#a68c5e', widthM: 14, minPx: 2, label: 'Road' },
  causeway:   { order: 7, type: 'line', color: '#e2cc98', casing: '#7d5f30', widthM: 18, minPx: 4, label: 'Causeway' },
  aqueduct:   { order: 8, type: 'line', color: '#4f8fcf', casing: '#c9b48a', widthM: 8, minPx: 3, dash: '6 4', label: 'Aqueduct' },
  'aqueduct-cut': { order: 8, type: 'line', color: '#b33a2a', widthM: 8, minPx: 3, dash: '3 6', label: 'Aqueduct (cut)' },
  dike:       { order: 8, type: 'line', color: '#8a6a3a', widthM: 12, minPx: 3, label: 'Dike' },
  wall:       { order: 9, type: 'line', color: '#5e4b36', widthM: 7, minPx: 2.5, label: 'Wall' },
  gap:        { order: 10, type: 'line', color: '#6fa6d6', widthM: 26, minPx: 6, label: 'Breach' },
  bridge:     { order: 11, type: 'line', color: '#7a4a1e', widthM: 7, minPx: 3, label: 'Bridge' },
  building:   { order: 12, type: 'area', fill: '#d9bf92', stroke: '#7a5a3a', fo: 1, label: 'Building' },
  palace:     { order: 12, type: 'area', fill: '#e0b468', stroke: '#7a5a2a', fo: 1, label: 'Palace' },
  temple:     { order: 13, type: 'area', fill: '#c8664a', stroke: '#6f2f1d', fo: 1, label: 'Temple' },
  market:     { order: 12, type: 'area', fill: '#ebcb73', stroke: '#9a7a2a', fo: 1, label: 'Market' },
  arena:      { order: 12, type: 'area', fill: '#d9b48a', stroke: '#6f4f2f', fo: 1, label: 'Arena' },
  baths:      { order: 12, type: 'area', fill: '#bcd3dc', stroke: '#5a7f8f', fo: 1, label: 'Baths' },
  fort:       { order: 12, type: 'area', fill: '#b9a68a', stroke: '#4f3f2a', fo: 1, label: 'Fort' },
  tomb:       { order: 12, type: 'area', fill: '#cfc4b0', stroke: '#6f6250', fo: 1, label: 'Tomb' },
  house:      { order: 12, type: 'area', fill: '#b9785a', stroke: '#6e3f2c', fo: 1, label: 'House' },
  church:     { order: 13, type: 'area', fill: '#c9b8a0', stroke: '#5e4b3a', fo: 1, weight: 1.5, label: 'Church' },
  wharf:      { order: 6, type: 'area', fill: '#a58a64', stroke: '#6b5233', fo: 1, label: 'Wharf' },
  redoubt:    { order: 12, type: 'area', fill: '#b8a57c', stroke: '#6b5a3a', fo: 0.9, weight: 2, label: 'Earthwork' },
  shipsheds:  { order: 12, type: 'spokes', color: '#7a5a34', label: 'Ship sheds' },
  label:      { order: 14, type: 'label', label: 'Area' },
};

// Default zoom at which each kind's name label appears.
const LABEL_ZOOM = { lake: 11, 'lake-salt': 11, town: 12, island: 13, hill: 14, district: 14, label: 13, river: 13, causeway: 14, wall: 15, aqueduct: 15, dike: 14, harbour: 15 };
const MIN_ZOOM = 12; // plans appear from here unless a feature says otherwise

export function kindInfo(kind) {
  return KINDS[kind] ?? KINDS.building;
}

// Natural shapes (shores, islands, rivers) get their corners rounded off.
const SMOOTH = new Set(['lake', 'lake-salt', 'sea', 'land', 'island', 'hill', 'river', 'town']);

export function createCityLayer(map, cities, { onSelect }) {
  map.createPane('city').style.zIndex = 380;
  map.createPane('city-labels').style.zIndex = 455;
  map.getPane('city-labels').style.pointerEvents = 'none';
  const renderer = L.canvas({ pane: 'city', tolerance: 6 });

  const items = [];
  for (const city of cities) {
    for (const feature of city.features) {
      const p = feature.properties;
      const kind = kindInfo(p.kind);
      if ((SMOOTH.has(p.kind) && p.smooth !== false) || p.smooth === true) smoothGeometry(feature.geometry);
      const item = { city, feature, p, kind, layers: [], label: null, shown: false, labelShown: false };

      if (p.fabric?.layout === 'blocks') {
        // Real blocks between historic streets: drawn as built-up blocks, as on a period town plan.
        item.layers.push(L.geoJSON(feature, {
          renderer,
          style: () => ({ color: kind.stroke, weight: 0.8, fillColor: p.fill ?? kind.fill, fillOpacity: 1 }),
        }));
      } else if (p.fabric) {
        // A generated texture: house blocks between streets, or chinampa strips
        // between canals. Drawn as one multipolygon for speed.
        const base = { renderer, stroke: false, fillColor: p.fabric.base ?? kind.fill, fillOpacity: p.fabric.base ? 1 : 0 };
        if (p.fabric.base) item.layers.push(L.geoJSON(feature, { style: () => base, renderer, interactive: false }));
        const blocks = generateFabric(feature, city.features, p.fabric);
        item.layers.push(L.polygon(blocks, {
          renderer, color: p.fabric.stroke ?? kind.stroke, weight: 0.6,
          fillColor: p.fabric.fill ?? kind.fill, fillOpacity: 1,
        }));
      } else if (kind.type === 'spokes') {
        // A ring of radiating lines: the ship sheds round a circular harbour.
        const spokes = radialSpokes(feature.geometry.coordinates, p.innerM ?? 60, p.radiusM ?? 150, p.count ?? 60, p.gapDeg ?? 0);
        item.layers.push(L.polyline(spokes, { renderer, color: kind.color, weight: 1.6, opacity: 0.9 }));
      } else if (kind.type === 'line') {
        const latlngs = lineLatLngs(feature.geometry);
        if (kind.casing) item.layers.push(L.polyline(latlngs, { renderer, color: kind.casing, opacity: 1, lineCap: 'round', interactive: false }));
        item.layers.push(L.polyline(latlngs, { renderer, color: kind.color, opacity: 1, lineCap: kind.dash ? 'butt' : 'round', dashArray: kind.dash ?? null }));
        item.widthM = p.widthM ?? kind.widthM;
      } else if (kind.type === 'area') {
        const style = {
          renderer, color: kind.stroke, weight: kind.weight ?? 1.2, fillColor: p.fill ?? kind.fill,
          fillOpacity: p.fillOpacity ?? kind.fo, dashArray: kind.dash ?? null,
        };
        if (feature.geometry.type === 'Point' && p.ellipse) {
          // [rx, ry, angle]: oval buildings like amphitheatres and circuses' ends.
          item.layers.push(L.polygon(ellipse(feature.geometry.coordinates, ...p.ellipse), style));
        } else if (feature.geometry.type === 'Point') {
          const [lng, lat] = feature.geometry.coordinates;
          item.layers.push(L.circle([lat, lng], { ...style, radius: p.radiusM ?? 40 }));
        } else {
          item.layers.push(L.geoJSON(feature, { style: () => style, renderer }));
        }
      }

      const main = item.layers.at(-1);
      if (main && p.name) {
        main.bindTooltip(`<strong>${p.name}</strong><span>${kind.label}${dateRange(p)}</span>`, { sticky: true, className: 'ev-tip' });
        main.on('click', () => onSelect(feature, city));
      }

      if (p.name && p.showLabel !== false) {
        item.labelZoom = p.labelZoom ?? LABEL_ZOOM[p.kind] ?? 15;
        item.label = L.marker(labelPoint(feature), {
          pane: 'city-labels', interactive: false, keyboard: false,
          icon: L.divIcon({ className: `city-label k-${p.kind}`, html: `<span>${p.name}</span>`, iconSize: null }),
        });
      }
      item.minZoom = p.minZoom ?? city.minZoom ?? MIN_ZOOM;
      item.maxZoom = p.maxZoom ?? 22;
      items.push(item);
    }
  }
  items.sort((a, b) => a.kind.order - b.kind.order);

  let lastKey = '';
  let lastZoom = null;

  function update(t, zoom) {
    const visible = items.map((it) => t >= it.p.t0 && t < it.p.t1 && zoom >= it.minZoom && zoom <= it.maxZoom);
    const key = visible.map((v) => (v ? 1 : 0)).join('');
    // Canvas draws in insertion order, so when anything appears or vanishes,
    // re-add everything visible in kind order (water under land under buildings).
    if (key !== lastKey) {
      items.forEach((it) => { if (it.shown) it.layers.forEach((l) => l.remove()); it.shown = false; });
      items.forEach((it, i) => {
        if (visible[i]) { it.layers.forEach((l) => l.addTo(map)); it.shown = true; }
      });
      lastKey = key;
      lastZoom = null;
    }
    if (zoom !== lastZoom) {
      lastZoom = zoom;
      for (const it of items) {
        if (it.shown && it.widthM) {
          const px = Math.max(it.kind.minPx ?? 2, it.widthM / metresPerPixel(map, zoom));
          if (it.layers.length === 2) it.layers[0].setStyle({ weight: px + 2.5 });
          it.layers.at(-1).setStyle({ weight: px });
        }
      }
    }
    items.forEach((it, i) => {
      const show = Boolean(visible[i] && it.label && zoom >= it.labelZoom);
      if (show !== it.labelShown) {
        show ? it.label.addTo(map) : it.label.remove();
        it.labelShown = show;
      }
    });
  }

  // Landmarks of a city that exist at time t, for the city guide.
  function landmarksAt(city, t) {
    return items
      .filter((it) => it.city === city && it.p.name && it.p.description && t >= it.p.t0 && t < it.p.t1)
      .map((it) => it.feature);
  }

  return { update, landmarksAt };
}

// ---------- Generated shapes ----------
function offset([lng, lat], dx, dy) {
  return [lat + dy / 111_320, lng + dx / (111_320 * Math.cos((lat * Math.PI) / 180))];
}

function ellipse(centre, rx, ry, angle = 0) {
  const rad = (angle * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    pts.push(offset(centre, x * Math.cos(rad) - y * Math.sin(rad), x * Math.sin(rad) + y * Math.cos(rad)));
  }
  return pts;
}

// count spokes between inner and outer radius; gapDeg leaves an opening (the harbour entrance).
function radialSpokes(centre, inner, outer, count, gapDeg) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const deg = gapDeg + (i / count) * (360 - 2 * gapDeg) - 90;
    const a = (deg * Math.PI) / 180;
    lines.push([offset(centre, inner * Math.cos(a), inner * Math.sin(a)), offset(centre, outer * Math.cos(a), outer * Math.sin(a))]);
  }
  return lines;
}

// ---------- Generated fabric ----------
// Fills a polygon with rectangles (w x h metres, gap metres apart, rotated by
// angle degrees), skipping any that would sit on a canal, road or causeway, or
// inside a plaza, temple, palace or other named area of the same city.
const KEEP_CLEAR_AREAS = new Set(['plaza', 'precinct', 'ruins', 'palace', 'temple', 'church', 'house', 'wharf', 'redoubt', 'market', 'building', 'arena', 'baths', 'fort', 'tomb', 'harbour', 'garden', 'chinampa', 'island']);
const KEEP_CLEAR_LINES = new Set(['canal', 'road', 'causeway', 'river', 'wall', 'aqueduct']);

function generateFabric(feature, siblings, { w = 60, h = 60, gap = 12, angle = 0, clearM = 4 }) {
  const ring = outerRing(feature.geometry);
  const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const lng0 = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const my = 111_320;
  const toXY = ([lng, lat]) => [(lng - lng0) * mx, (lat - lat0) * my];
  const toLatLng = ([x, y]) => [lat0 + y / my, lng0 + x / mx];
  const rad = (angle * Math.PI) / 180;
  const rot = ([x, y], s = 1) => [x * Math.cos(s * rad) - y * Math.sin(s * rad), x * Math.sin(s * rad) + y * Math.cos(s * rad)];

  const poly = ring.map(toXY);
  const areas = siblings
    .filter((f) => f !== feature && KEEP_CLEAR_AREAS.has(f.properties.kind))
    .map((f) => (f.geometry.type === 'Point'
      ? { circle: toXY(f.geometry.coordinates), r: (f.properties.radiusM ?? Math.max(...(f.properties.ellipse ?? [40]).slice(0, 2))) + gap }
      : { poly: outerRing(f.geometry).map(toXY) }));
  const lines = siblings
    .filter((f) => KEEP_CLEAR_LINES.has(f.properties.kind) && f.geometry.type === 'LineString')
    .map((f) => ({ pts: f.geometry.coordinates.map(toXY), r: (f.properties.widthM ?? kindInfo(f.properties.kind).widthM ?? 10) / 2 + clearM }));

  // Work in the rotated frame so the grid lines up with the city's streets.
  const rotated = poly.map((p) => rot(p, -1));
  const xs = rotated.map((p) => p[0]);
  const ys = rotated.map((p) => p[1]);
  const blocks = [];
  for (let x = Math.min(...xs); x < Math.max(...xs); x += w + gap) {
    for (let y = Math.min(...ys); y < Math.max(...ys); y += h + gap) {
      const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((c) => rot(c));
      const centre = rot([x + w / 2, y + h / 2]);
      if (!corners.every((c) => inPolygon(c, poly))) continue;
      if (areas.some((a) => (a.circle ? Math.hypot(centre[0] - a.circle[0], centre[1] - a.circle[1]) < a.r
        : corners.some((c) => inPolygon(c, a.poly)) || inPolygon(centre, a.poly)))) continue;
      const reach = Math.hypot(w, h) / 2;
      if (lines.some((l) => distToPolyline(centre, l.pts) < l.r + reach * 0.75)) continue;
      blocks.push(corners.map(toLatLng));
    }
  }
  return blocks;
}

function outerRing(g) {
  if (g.type === 'Polygon') return g.coordinates[0];
  if (g.type === 'MultiPolygon') return g.coordinates[0][0];
  return [g.coordinates];
}

function inPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
  }
  return best;
}

// ---------- Smoothing ----------
// Chaikin corner-cutting, two passes: turns a hand-drawn polygon into a soft shoreline.
function chaikin(points, closed) {
  let pts = points;
  for (let pass = 0; pass < 2; pass++) {
    const out = closed ? [] : [pts[0]];
    const n = closed ? pts.length - 1 : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    if (closed) out.push(out[0]);
    else out.push(pts.at(-1));
    pts = out;
  }
  return pts;
}

function smoothGeometry(g) {
  if (g.type === 'Polygon') g.coordinates = g.coordinates.map((r) => chaikin(r, true));
  else if (g.type === 'LineString') g.coordinates = chaikin(g.coordinates, false);
}

function lineLatLngs(geometry) {
  const flip = (c) => [c[1], c[0]];
  return geometry.type === 'MultiLineString' ? geometry.coordinates.map((l) => l.map(flip)) : geometry.coordinates.map(flip);
}

export function labelPoint(feature) {
  const at = feature.properties.labelAt; // [lng, lat] to place a label by hand
  if (at) return [at[1], at[0]];
  const g = feature.geometry;
  if (g.type === 'Point') return [g.coordinates[1], g.coordinates[0]];
  if (g.type === 'LineString') {
    const c = g.coordinates[Math.floor((g.coordinates.length - 1) / 2)];
    const d = g.coordinates[Math.ceil((g.coordinates.length - 1) / 2)];
    return [(c[1] + d[1]) / 2, (c[0] + d[0]) / 2];
  }
  return L.geoJSON(feature).getBounds().getCenter();
}

function metresPerPixel(map, zoom) {
  const lat = map.getCenter().lat;
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function dateRange(p) {
  if (p.builtLabel) return ` · ${p.builtLabel}`;
  return '';
}
