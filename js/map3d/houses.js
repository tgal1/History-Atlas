// Generates the ordinary city between the landmarks. Each "houses" area with
// a "fabric" is cut into street blocks by recursive splits (wide streets
// first, alleys last, each cut slightly off-square so the plan is irregular),
// then each block becomes one of the city's house types:
//
//   insula   apartment block, 3-5 storeys, often round a light well
//   taberna  row of one- or two-storey shops and workshops
//   domus    low town house round an atrium and a garden peristyle
//   garden   walled garden with pines and cypresses
//
// Houses vanish when a dated landmark is built over them (the Colosseum over
// Nero's lake, Trajan's Forum over a hillside quarter).

import {
  rng, between, hashString, area, centroid, open, isConvex, inRing, clipHalf, obb, at, rectIn,
  scaleRing, distToSegments,
} from './geom.js';
import { C, tree, trees } from './models.js';
import { kindInfo } from '../map/cityLayer.js';

const CLIPPING_URL = 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';

const KEEP_CLEAR_AREAS = new Set(['plaza', 'precinct', 'ruins', 'palace', 'temple', 'market', 'building', 'arena', 'baths', 'fort', 'tomb', 'harbour', 'garden', 'chinampa', 'island', 'lake']);
const KEEP_CLEAR_LINES = { river: 8, road: 1, canal: 2, causeway: 2, wall: 4, aqueduct: 2 };

// Share of each house type by setting. A fabric can override with "mix".
const MIX = {
  centre: { insula: 0.64, taberna: 0.18, domus: 0.12, garden: 0.06 },
  hill: { insula: 0.26, taberna: 0.08, domus: 0.5, garden: 0.16 },
  outer: { insula: 0.32, taberna: 0.18, domus: 0.22, garden: 0.28 },
};

const LOT_AREA = { insula: [450, 1000], taberna: [120, 260], domus: [600, 1300] };
const WALLS = {
  insula: ['#c99a6b', '#d1a77a', '#b98458', '#d8b48a', '#c4916a', '#bf8a62'],
  taberna: ['#cfa577', '#d9b98e', '#c79868', '#d4ae84'],
  domus: ['#ebdcc0', '#e5d3b3', '#f0e4cc', '#dfcaa5'],
};
const ROOFS = ['#a9532f', '#b5603a', '#9e4b2b', '#ba6a43', '#a55a36', '#b2573a'];

export const HOUSE_INFO = {
  insula: 'Insula: an apartment block. Shops at street level, flats above; the higher the floor, the poorer the tenant.',
  taberna: 'Tabernae: one- or two-storey shops and workshops, the family living above or behind.',
  domus: 'Domus: a private town house built round an open atrium and a garden peristyle.',
};

export async function generateHouses(city, frame) {
  const clip = (await import(CLIPPING_URL)).default;
  const index = obstacleIndex(city, frame);
  const hills = city.features
    .filter((f) => f.properties.kind === 'hill' && f.geometry.type === 'Point')
    .map((f) => ({ c: frame.toXY(f.geometry.coordinates), r: f.properties.radiusM ?? 200 }));

  const houses = [];
  const extras = { parts: [], flats: [] };
  for (const f of city.features) {
    const p = f.properties;
    if (!p.fabric || p.kind !== 'houses') continue;
    const r = rng(hashString(p.id ?? p.name));
    const base = { t0: p.t0, t1: p.t1 };
    const outer = /outer/.test(p.id ?? '');
    for (const ringLL of outerRings(f.geometry)) {
      const blocks = [];
      split(ccw(open(ringLL.map(frame.toXY))), 0, r, blocks, clip, BLOCK_SPLIT);
      for (const block of blocks) {
        const c = centroid(block);
        const onHill = hills.some((h) => Math.hypot(c[0] - h.c[0], c[1] - h.c[1]) < h.r * 0.9);
        const mix = p.fabric.mix ?? MIX[onHill ? 'hill' : outer ? 'outer' : 'centre'];
        const type = pick(mix, r);
        if (type === 'garden') {
          const life = lifespan(block, base, index);
          if (!life) continue;
          const garden = { parts: [], flats: [] };
          garden.flats.push({ rings: [block], c: C.garden });
          trees(garden, block, 14, r);
          for (const part of [...garden.parts, ...garden.flats]) Object.assign(part, { t0: life[0], t1: life[1] });
          extras.parts.push(...garden.parts);
          extras.flats.push(...garden.flats);
          continue;
        }
        const [a0, a1] = LOT_AREA[type];
        const lots = [];
        split(block, 0, r, lots, clip, { min: a0, max: a1, gap: () => 0.6, minArea: 40 });
        for (const lot of lots) {
          const life = lifespan(lot, base, index);
          if (life) houses.push(house(lot, type, life, onHill || outer, r, extras));
        }
      }
    }
  }
  return { houses, extras };
}

const BLOCK_SPLIT = { min: 2600, max: 6500, gap: (depth) => (depth < 2 ? 9 : depth < 5 ? 6 : 3.5), minArea: 150 };

function house(lot, type, [t0, t1], suburb, r, extras) {
  const A = Math.abs(area(lot));
  let h;
  const holes = [];
  if (type === 'insula') {
    const storeys = Math.floor(between(r, suburb ? 2 : 3, suburb ? 4.6 : 6));
    h = storeys * 3.1 + 0.6;
    if (A > 420 && isConvex(lot) && r() < 0.75) holes.push(scaleRing(lot, 0.36));
  } else if (type === 'taberna') {
    h = between(r, 4.5, 7.5);
  } else {
    h = between(r, 6, 8.5);
    const box = obb(lot);
    if (box.hw > 6 && box.hl > 10) {
      const atrium = rectIn(box, box.hl * 0.18, box.hl * 0.44, -box.hw * 0.2, box.hw * 0.2);
      const peristyle = rectIn(box, -box.hl * 0.7, -box.hl * 0.06, -box.hw * 0.55, box.hw * 0.55);
      for (const hole of [atrium, peristyle]) if (hole.every((q) => inRing(q, lot))) holes.push(hole);
      if (holes.length === 2) {
        extras.flats.push({ rings: [peristyle], c: C.garden, t0, t1 });
        if (r() < 0.5) {
          const g = { parts: [], flats: [] };
          tree(g, at(box, -box.hl * 0.38, 0), r);
          g.parts.forEach((q) => Object.assign(q, { t0, t1 }));
          extras.parts.push(...g.parts);
        }
      }
    }
  }
  return {
    rings: [lot, ...holes],
    h: Math.round(h * 10) / 10,
    c: WALLS[type][Math.floor(r() * WALLS[type].length)],
    roof: ROOFS[Math.floor(r() * ROOFS.length)],
    type, t0, t1,
  };
}

// ---------- Splitting ----------
function split(ring, depth, r, out, clip, opts) {
  const A = Math.abs(area(ring));
  if (A < opts.minArea) return;
  if (A < between(r, opts.min, opts.max) || depth > 18) { out.push(ring); return; }
  const box = obb(ring);
  const ang = between(r, -0.12, 0.12);
  const d = [box.v[0] * Math.cos(ang) - box.v[1] * Math.sin(ang), box.v[0] * Math.sin(ang) + box.v[1] * Math.cos(ang)];
  const n = [-d[1], d[0]];
  const g = opts.gap(depth) / 2;
  const p = at(box, between(r, -0.2, 0.2) * box.hl, 0);
  const pa = [p[0] + n[0] * g, p[1] + n[1] * g];
  const pb = [p[0] - n[0] * g, p[1] - n[1] * g];
  const back = [-d[0], -d[1]];
  const pieces = isConvex(ring)
    ? [clipHalf(ring, pa, d), clipHalf(ring, pb, back)].filter(Boolean)
    : [...halfPlane(clip, ring, pa, d), ...halfPlane(clip, ring, pb, back)];
  for (const q of pieces) split(q, depth + 1, r, out, clip, opts);
}

// Concave shapes: intersect with a huge rectangle on the left of the line.
function halfPlane(clip, ring, p, d) {
  const B = 1e5;
  const n = [-d[1], d[0]];
  const hp = [
    [p[0] - d[0] * B, p[1] - d[1] * B], [p[0] + d[0] * B, p[1] + d[1] * B],
    [p[0] + d[0] * B + n[0] * B, p[1] + d[1] * B + n[1] * B], [p[0] - d[0] * B + n[0] * B, p[1] - d[1] * B + n[1] * B],
  ];
  return clip.intersection([[...ring, ring[0]]], [[...hp, hp[0]]]).map((poly) => ccw(open(poly[0])));
}

// ---------- Obstacles ----------
// Landmarks, squares, roads and rivers that houses keep clear of, with dates.
function obstacleIndex(city, frame) {
  const items = [];
  for (const f of city.features) {
    const p = f.properties;
    const g = f.geometry;
    const life = { t0: p.t0, t1: p.t1 };
    if (KEEP_CLEAR_AREAS.has(p.kind)) {
      if (g.type === 'Point') {
        const rad = (p.radiusM ?? Math.max(...(p.ellipse ?? [40]).slice(0, 2))) + 4;
        const c = frame.toXY(g.coordinates);
        items.push({ ...life, circle: c, r: rad, box: [c[0] - rad, c[1] - rad, c[0] + rad, c[1] + rad] });
      } else {
        for (const ring of outerRings(g)) {
          const poly = open(ring.map(frame.toXY));
          items.push({ ...life, poly, box: bbox(poly) });
        }
      }
    } else if (p.kind in KEEP_CLEAR_LINES) {
      const half = (p.widthM ?? kindInfo(p.kind).widthM ?? 10) / 2 + KEEP_CLEAR_LINES[p.kind];
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) {
        const pts = line.map(frame.toXY);
        const b = bbox(pts);
        items.push({ ...life, line: pts, half, box: [b[0] - half, b[1] - half, b[2] + half, b[3] + half] });
      }
    }
  }
  const CELL = 250;
  const grid = new Map();
  items.forEach((it, i) => {
    for (let x = Math.floor(it.box[0] / CELL); x <= Math.floor(it.box[2] / CELL); x++) {
      for (let y = Math.floor(it.box[1] / CELL); y <= Math.floor(it.box[3] / CELL); y++) {
        const k = `${x},${y}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
    }
  });
  return {
    near(b) {
      const seen = new Set();
      for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x++) {
        for (let y = Math.floor(b[1] / CELL); y <= Math.floor(b[3] / CELL); y++) {
          for (const i of grid.get(`${x},${y}`) ?? []) seen.add(i);
        }
      }
      return [...seen].map((i) => items[i]);
    },
  };
}

// The years a plot stays built: from the district's start until the first
// landmark built over it. Returns null if something always stands there.
function lifespan(ring, base, index) {
  let { t0, t1 } = base;
  const c = centroid(ring);
  const rad = Math.sqrt(Math.abs(area(ring)) / Math.PI);
  for (const o of index.near(bbox(ring))) {
    if (!overlaps(o, ring, c, rad)) continue;
    if (o.t0 <= t0) {
      if (o.t1 >= t1) return null;
      t0 = Math.max(t0, o.t1);
    } else t1 = Math.min(t1, o.t0);
  }
  return t0 < t1 ? [t0, t1] : null;
}

function overlaps(o, ring, c, rad) {
  if (o.circle) return Math.hypot(c[0] - o.circle[0], c[1] - o.circle[1]) < o.r + rad * 0.5;
  if (o.line) return distToSegments(c, o.line) < o.half + rad * 0.6;
  if (inRing(c, o.poly) || ring.some((q) => inRing(q, o.poly))) return true;
  return o.poly.some((q) => inRing(q, ring));
}

// ---------- Helpers ----------
function pick(mix, r) {
  let x = r() * Object.values(mix).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(mix)) if ((x -= v) <= 0) return k;
  return 'insula';
}

function outerRings(g) {
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((poly) => poly[0]);
  return [];
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

const ccw = (ring) => (area(ring) < 0 ? ring.slice().reverse() : ring);
