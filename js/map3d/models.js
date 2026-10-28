// 3D recipes for landmark buildings. Each recipe turns a footprint (usually
// the real outline from OpenStreetMap) into stacked extruded parts: podiums,
// columns, cellas, stepped gable roofs, arcades, domes. A feature picks its
// recipe with "model": { "type": "temple", "h": 24 }, or falls back to one
// chosen by its kind.
//
// Parts are { rings, b, h, c }: rings in the city's metres frame (outer
// first, holes after), base and top height in metres, and a colour.
// Flats are { rings, c }: ground surfaces draped on the terrain.

import {
  obb, at, rectIn, circle, ellipse, alongPath, strips, centroid, area, open, scaleRing,
  isConvex, bearingVec, pathLength, rng, between, hashString, inRing, clipHalf,
} from './geom.js';

export const C = {
  marble: '#f2ede2', marbleShade: '#e4dccb', stone: '#e0d3b8', travertine: '#ddcfb0', tufa: '#c9b98f',
  brick: '#c48a5e', brickDark: '#ad744c', stucco: '#ead9b8', roof: '#b0603a', lead: '#9d9b93',
  green: '#7d975a', pine: '#5d7b45', cypress: '#4a6638', trunk: '#7a5a3c', bronze: '#8b6b3c',
  sand: '#e7d19c', paving: '#efe6d3', water: '#7fb0d8', ground: '#dccdae', garden: '#b4c98c',
  whitewash: '#f0ebe0', whitewashShade: '#e3dccd', flatRoof: '#ddd3bf', adobe: '#cdb497', thatch: '#b89c66',
  wood: '#8a6a44', rubble: '#bdb29c', earth: '#a8906a', red: '#b5452f', blue: '#4f7fb3', willow: '#6f8f4a',
};

// Building colours that differ between Roman, Punic and Mexica cities.
const STYLE = {
  roman: { wall: C.stucco, hall: C.brick, roof: C.roof, flatRoof: false },
  punic: { wall: C.whitewash, hall: C.whitewashShade, roof: C.flatRoof, flatRoof: true },
  mexica: { wall: C.whitewash, hall: C.whitewashShade, roof: C.flatRoof, flatRoof: true },
  colonial: { wall: '#b9785a', hall: '#a8553d', roof: '#4f4a45', flatRoof: false },
  levantine: { wall: '#e6dcc4', hall: '#ddd0b4', roof: '#d6cab0', flatRoof: true },
  tehran: { wall: '#d2b98f', hall: '#cdbf9f', roof: '#a9a398', flatRoof: true },
  berlin: { wall: '#d6ccb8', hall: '#cfc7b5', roof: '#6d6861', flatRoof: true },
  moscow: { wall: '#e4cf9f', hall: '#ddc596', roof: '#6f7d6c', flatRoof: true },
};

const DEFAULT_MODEL = {
  temple: 'temple', building: 'hall', palace: 'palace', market: 'market', arena: 'amphitheatre',
  baths: 'baths', fort: 'fort', tomb: 'drum-tomb', plaza: 'plaza', precinct: 'precinct',
  wall: 'wall', aqueduct: 'aqueduct', 'aqueduct-cut': 'aqueduct', bridge: 'bridge', garden: 'garden',
  causeway: 'causeway', dike: 'dike', shipsheds: 'shipsheds', ruins: 'ruins',
  church: 'church', house: 'house', wharf: 'wharf', redoubt: 'redoubt',
};

// ctx: { toXY, plazas: [[x, y]] centres of open squares, for temples to face,
//        style: 'roman' | 'punic' | 'mexica', cuts: openings in causeways }
export function buildModel(feature, ctx) {
  const p = feature.properties;
  const m = { ...(p.model ?? {}) };
  m.type ??= DEFAULT_MODEL[p.kind];
  if (m.type === 'temple' && feature.geometry.type === 'Point' && !m.size) m.type = 'tholos';
  const recipe = RECIPES[m.type];
  if (!recipe) return null;
  const shape = readShape(feature, ctx, m);
  if (!shape) return null;
  const out = { parts: [], flats: [] };
  const r = rng(hashString(p.id ?? p.name ?? m.type));
  recipe(shape, m, out, { ...ctx, r, p, S: STYLE[ctx.style] ?? STYLE.roman });
  return out;
}

// Footprint in metres: polygons (outer + holes), all outer points, and for
// point features a centre and radius. A point can also stand for an oval
// ("ellipse") or, with model.size [length, width], a rectangle.
function readShape(feature, { toXY }, m) {
  const g = feature.geometry;
  const p = feature.properties;
  if (g.type === 'Point') {
    const c = toXY(g.coordinates);
    if (m.size) {
      const a = ((m.angle ?? 0) * Math.PI) / 180;
      const box = { c, u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)] };
      const ring = rectIn(box, -m.size[0] / 2, m.size[0] / 2, -m.size[1] / 2, m.size[1] / 2);
      return { centre: c, radius: Math.max(...m.size) / 2, polys: [[ring]], points: ring, main: [ring] };
    }
    if (p.ellipse) {
      const [rx, ry, angle = 0] = p.ellipse;
      const a = (angle * Math.PI) / 180;
      const ring = ellipse(c, rx, ry, [Math.cos(a), Math.sin(a)], 48);
      return { centre: c, radius: Math.max(rx, ry), polys: [[ring]], points: ring, main: [ring] };
    }
    const rad = p.radiusM ?? 40;
    const ring = circle(c, rad, 32);
    return { centre: c, radius: rad, polys: [[ring]], points: ring, main: [ring] };
  }
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const raw = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const polys = raw.map((poly) => poly.map((ring) => open(ring.map(toXY))));
    const points = polys.flatMap((poly) => poly[0]);
    const main = polys.reduce((a, b) => (Math.abs(area(b[0])) > Math.abs(area(a[0])) ? b : a));
    const c = centroid(main[0]);
    const radius = Math.sqrt(Math.abs(area(main[0])) / Math.PI);
    return { centre: c, radius, polys, points, main };
  }
  if (g.type === 'LineString' || g.type === 'MultiLineString') {
    const lines = (g.type === 'LineString' ? [g.coordinates] : g.coordinates).map((l) => l.map(toXY));
    return { lines, points: lines.flat() };
  }
  return null;
}

// ---------- Building blocks ----------
export const part = (out, rings, b, h, c) => { if (h > b) out.parts.push({ rings: Array.isArray(rings[0][0]) ? rings : [rings], b, h, c }); };
const flat = (out, rings, c) => out.flats.push({ rings: Array.isArray(rings[0][0]) ? rings : [rings], c });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A pitched roof as stacked slabs, each narrower than the last, ridge along u.
export function gable(out, box, s0, s1, halfW, base, rise, c, layers = 5) {
  for (let i = 0; i < layers; i++) {
    const w = halfW * (1 - i / layers);
    part(out, rectIn(box, s0, s1, -w, w), base + (rise * i) / layers, base + (rise * (i + 1)) / layers, c);
  }
}

// A hemispherical dome as stacked discs.
function dome(out, centre, radius, base, rise, c, layers = 7) {
  for (let i = 0; i < layers; i++) {
    const a0 = (i / layers) * (Math.PI / 2);
    const a1 = ((i + 1) / layers) * (Math.PI / 2);
    part(out, circle(centre, radius * Math.cos((a0 + a1) / 2), 32), base + rise * Math.sin(a0), base + rise * Math.sin(a1), c);
  }
}

// Storeys of arches round a closed path: piers with a solid band above each.
function arcade(out, path, outer, inner, tiers, count, depth, c) {
  const step = pathLength([...path, path[0]]) / count;
  const pier = step * 0.4;
  for (const { b, top, band } of tiers) {
    for (const q of alongPath(path, step, pier, depth, { closed: true })) part(out, q, b, top, c);
    part(out, [outer, [...inner].reverse()], top, top + band, c);
  }
}

// Turn a box so that +u points to the building's front.
function face(box, shape, m, ctx) {
  let target = null;
  if (m.facing != null) {
    const f = bearingVec(m.facing);
    const du = f[0] * box.u[0] + f[1] * box.u[1];
    const dv = f[0] * box.v[0] + f[1] * box.v[1];
    if (Math.abs(dv) > Math.abs(du) * 1.2) {
      // Front on a long side: swap axes.
      [box.hl, box.hw] = [box.hw, box.hl];
      box.u = dv > 0 ? box.v : [-box.v[0], -box.v[1]];
    } else if (du < 0) box.u = [-box.u[0], -box.u[1]];
    box.v = [-box.u[1], box.u[0]];
    return box;
  }
  // Otherwise face the nearest open square, as most temples faced a forum.
  let best = Infinity;
  for (const q of ctx.plazas) {
    const d = Math.hypot(q[0] - box.c[0], q[1] - box.c[1]);
    if (d < best && d > 1) { best = d; target = q; }
  }
  if (target && best < 400 && (target[0] - box.c[0]) * box.u[0] + (target[1] - box.c[1]) * box.u[1] < 0) {
    box.u = [-box.u[0], -box.u[1]];
    box.v = [-box.v[0], -box.v[1]];
  }
  return box;
}

function columnsBetween(out, box, s0, t0, s1, t1, n, r, b, h, c) {
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    part(out, circle(at(box, s0 + (s1 - s0) * k, t0 + (t1 - t0) * k), r, 8), b, h, c);
  }
}

// ---------- Recipes ----------
const RECIPES = {
  temple(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 20;
    const k = m.inset ?? 0.03;
    const L = box.hl * (1 - k);
    const W = box.hw * (1 - k);
    let pb = 0;
    if (k > 0.1) { // a temple on a raised precinct
      pb = 2.5;
      part(out, rectIn(box, -box.hl, box.hl, -box.hw, box.hw), 0, pb, C.stone);
    }
    const ph = m.podium ?? clamp(H * 0.16, 1.5, 6);
    const ch = H * 0.55;
    const e = ph + ch + H * 0.08;
    const r = clamp(W * 0.05, 0.45, 1.0);
    const ci = r * 1.8;
    const nF = m.columns ?? (W * 2 > 26 ? 8 : 6);
    const sp = (2 * W - 2 * ci) / (nF - 1);
    const peripteral = m.peripteral || m.twoFronts;
    const cb = pb + ph;
    part(out, rectIn(box, -L, L, -W, W), pb, cb, C.stone);

    if (peripteral) {
      const nS = Math.max(3, Math.round((2 * L - 2 * ci) / sp) + 1);
      columnsBetween(out, box, L - ci, -(W - ci), L - ci, W - ci, nF, r, cb, cb + ch, C.marble);
      columnsBetween(out, box, -(L - ci), -(W - ci), -(L - ci), W - ci, nF, r, cb, cb + ch, C.marble);
      columnsBetween(out, box, -(L - ci), W - ci, L - ci, W - ci, nS, r, cb, cb + ch, C.marble);
      columnsBetween(out, box, -(L - ci), -(W - ci), L - ci, -(W - ci), nS, r, cb, cb + ch, C.marble);
      const front = L - ci - sp * 1.6;
      const back = m.twoFronts ? -front : -(L - ci - sp * 0.9);
      part(out, rectIn(box, back, front, -(W - ci - sp * 0.9), W - ci - sp * 0.9), cb, cb + ch, C.marbleShade);
    } else {
      // Roman style: a deep porch of columns at the front, the cella behind.
      const rows = W * 2 > 18 ? 3 : 2;
      for (let j = 0; j < rows; j++) {
        const s = L - ci - j * sp;
        if (j === 0) columnsBetween(out, box, s, -(W - ci), s, W - ci, nF, r, cb, cb + ch, C.marble);
        else {
          columnsBetween(out, box, s, -(W - ci), s, -(W - ci), 1, r, cb, cb + ch, C.marble);
          columnsBetween(out, box, s, W - ci, s, W - ci, 1, r, cb, cb + ch, C.marble);
        }
      }
      const porch = L - ci - (rows - 0.4) * sp;
      part(out, rectIn(box, -L + 0.3, porch, -(W - ci + r), W - ci + r), cb, cb + ch, C.marbleShade);
    }
    const eo = ci - r * 1.4;
    part(out, rectIn(box, -L + eo, L - eo, -(W - eo), W - eo), cb + ch, pb + e, C.marble);
    gable(out, box, -L + eo, L - eo, W - eo, pb + e, Math.max(1.5, H - e), C.roof);
  },

  tholos(shape, m, out) {
    const c = shape.centre;
    const R = m.r ?? shape.radius;
    const H = m.h ?? 14;
    const ph = clamp(H * 0.15, 1, 3);
    const ch = H * 0.55;
    const r = clamp(R * 0.07, 0.35, 0.8);
    part(out, circle(c, R, 32), 0, ph, C.stone);
    const n = m.columns ?? 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      part(out, circle([c[0] + (R - r * 1.8) * Math.cos(a), c[1] + (R - r * 1.8) * Math.sin(a)], r, 8), ph, ph + ch, C.marble);
    }
    part(out, circle(c, R * 0.62, 24), ph, ph + ch, C.marbleShade);
    part(out, circle(c, R - r * 0.6, 32), ph + ch, ph + ch + H * 0.07, C.marble);
    const top = ph + ch + H * 0.07;
    for (let i = 0; i < 4; i++) part(out, circle(c, (R - r) * (1 - i / 4.4), 24), top + ((H - top) * i) / 4, top + ((H - top) * (i + 1)) / 4, C.roof);
  },

  pantheon(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 43;
    const Rr = Math.min(box.hw, 29);
    const rc = at(box, -box.hl + Rr, 0);
    part(out, circle(rc, Rr, 40), 0, H * 0.5, C.stucco);
    part(out, circle(rc, Rr * 0.97, 40), H * 0.5, H * 0.52, C.stone);
    dome(out, rc, Rr * 0.94, H * 0.52, H * 0.48, C.lead);
    // The block linking the drum to the porch, then the porch itself.
    const ps = box.hl - 16;
    part(out, rectIn(box, -box.hl + 2 * Rr - 8, ps, -16, 16), 0, H * 0.62, C.stucco);
    part(out, rectIn(box, ps, box.hl, -17, 17), 0, 1.5, C.stone);
    for (let j = 0; j < 3; j++) columnsBetween(out, box, box.hl - 1.6 - j * 4.6, -15, box.hl - 1.6 - j * 4.6, 15, j === 0 ? 8 : 4, 0.75, 1.5, 15.5, j === 0 ? C.marble : C.marbleShade);
    part(out, rectIn(box, ps - 1, box.hl - 0.4, -16.4, 16.4), 15.5, 18, C.marble);
    gable(out, box, ps - 1, box.hl - 0.4, 16.4, 18, 7, C.lead);
  },

  amphitheatre(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 48;
    const ring = (k) => ellipse(box.c, box.hl * k, box.hw * k, box.u, 72);
    if (H >= 30) {
      const tierH = H * 0.22;
      const tiers = [0, 1, 2].map((i) => ({ b: i * (tierH + H * 0.025), top: i * (tierH + H * 0.025) + tierH, band: H * 0.025 }));
      arcade(out, ring(0.985), ring(1), ring(0.955), tiers, 80, box.hw * 0.035, C.travertine);
      part(out, [ring(1), [...ring(0.955)].reverse()], tiers[2].top + H * 0.025, H, C.travertine);
    } else {
      part(out, [ring(1), [...ring(0.9)].reverse()], 0, H, C.travertine);
    }
    const steps = [[0.955, 0.86, 0.72], [0.86, 0.76, 0.55], [0.76, 0.66, 0.38], [0.66, 0.57, 0.22], [0.57, 0.53, 0.1]];
    steps.forEach(([a, b, f], i) => part(out, [ring(a), [...ring(b)].reverse()], 0, H * f, i % 2 ? C.stone : C.marbleShade));
    flat(out, ring(0.53), C.sand);
  },

  circus(shape, m, out) {
    const box = obb(shape.points);
    if (box.u[0] < 0) { box.u = [-box.u[0], -box.u[1]]; box.v = [-box.v[0], -box.v[1]]; } // curved end to the east
    const H = m.h ?? 28;
    const L = box.hl;
    const W = box.hw;
    const track = (d) => {
      const pts = [at(box, -L + d, -W + d), at(box, L - W, -W + d)];
      for (let i = 1; i < 16; i++) {
        const a = -Math.PI / 2 + (i / 16) * Math.PI;
        pts.push(at(box, L - W + (W - d) * Math.cos(a), (W - d) * Math.sin(a)));
      }
      pts.push(at(box, L - W, W - d), at(box, -L + d, W - d));
      return pts;
    };
    const band = (d0, d1) => [track(d0), [...track(d1)].reverse()];
    const scale = Math.min(1, W / 60);
    const lower = { b: 0, top: H * 0.38, band: H * 0.05 };
    for (const q of alongPath(track(2.5 * scale), 7, 3, 5 * scale, { closed: true })) part(out, q, lower.b, lower.top, C.travertine);
    part(out, band(0, 5 * scale), lower.top, H, C.travertine);
    const rows = [[5, 14, 0.8], [14, 24, 0.55], [24, 34, 0.3], [34, 38, 0.12]];
    rows.forEach(([a, b, f], i) => part(out, band(a * scale, b * scale), 0, H * f, i % 2 ? C.stone : C.marbleShade));
    const d = 38 * scale;
    flat(out, track(d), C.sand);
    // Starting gates at the straight end, the central barrier and its obelisk.
    part(out, rectIn(box, -L + d, -L + d + 10 * scale, -W + d, W - d), 0, 8, C.stone);
    part(out, rectIn(box, -L * 0.55, L * 0.45, -4 * scale, 4 * scale), 0, 1.6, C.marble);
    part(out, rectIn(box, -0.9, 0.9, -0.9, 0.9), 1.6, Math.max(8, H * 0.85), C.tufa);
    for (const s of [-L * 0.55, L * 0.45]) for (const t of [-2.2, 0, 2.2]) part(out, circle(at(box, s, t * scale), 1.1 * scale, 10), 1.6, 7, C.bronze);
  },

  stadium(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 12;
    part(out, [rectIn(box, -box.hl, box.hl, -box.hw, box.hw), rectIn(box, -box.hl + 7, box.hl - 7, -box.hw + 7, box.hw - 7).reverse()], 0, H, C.stucco);
    flat(out, rectIn(box, -box.hl + 7, box.hl - 7, -box.hw + 7, box.hw - 7), C.garden);
    const inner = rectIn(box, -box.hl + 9, box.hl - 9, -box.hw + 9, box.hw - 9);
    for (const q of alongPath(inner, 4.5, 1, 1, { closed: true })) part(out, q, 0, H * 0.45, C.marble);
  },

  theatre(shape, m, out) {
    const c = shape.centre;
    const R = shape.radius;
    const H = m.h ?? 32;
    const f = bearingVec(m.facing ?? 180);
    const phi = Math.atan2(f[1], f[0]);
    const a0 = phi + Math.PI / 2;
    const a1 = phi + Math.PI * 1.5;
    const arc = (k) => circle(c, R * k, 36, a0, a1);
    const sector = (k0, k1) => [[...arc(k0), ...arc(k1).reverse()]];
    // Outer wall: three storeys of arches on the curve.
    const tierH = H * 0.26;
    for (let i = 0; i < 3; i++) {
      const b = i * (tierH + H * 0.04);
      for (const q of alongPath(arc(0.96), (R * Math.PI) / 41, (R * Math.PI) / 41 * 0.42, R * 0.06)) part(out, q, b, b + tierH, C.travertine);
      part(out, sector(1, 0.92), b + tierH, b + tierH + H * 0.04, C.travertine);
    }
    const steps = [[0.92, 0.8, 0.75], [0.8, 0.66, 0.55], [0.66, 0.52, 0.35], [0.52, 0.42, 0.15]];
    steps.forEach(([k0, k1, h], i) => part(out, sector(k0, k1), 0, H * h, i % 2 ? C.stone : C.marbleShade));
    flat(out, arc(0.42), C.paving);
    // Stage building across the open side.
    const box = { c, u: [-f[1], f[0]], v: f };
    part(out, rectIn(box, -R * 0.62, R * 0.62, 0, R * 0.06), 0, 1.6, C.stone);
    part(out, rectIn(box, -R * 0.78, R * 0.78, R * 0.06, R * 0.2), 0, H * 0.75, C.stucco);
  },

  'drum-tomb'(shape, m, out) {
    const c = shape.centre;
    const R = Math.max(...shape.points.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))) * 0.98;
    const H = m.h ?? 40;
    if (m.squareBase) {
      const box = { c, u: [1, 0], v: [0, 1] };
      part(out, rectIn(box, -R * 1.25, R * 1.25, -R * 1.25, R * 1.25), 0, H * 0.25, C.travertine);
      part(out, circle(c, R, 40), H * 0.25, H * 0.62, C.travertine);
      part(out, circle(c, R * 0.72, 32), H * 0.62, H * 0.7, C.green);
      part(out, circle(c, R * 0.3, 24), H * 0.7, H * 0.9, C.marble);
      part(out, circle(c, R * 0.1, 12), H * 0.9, H, C.bronze);
      return;
    }
    part(out, circle(c, R, 40), 0, H * 0.3, C.travertine);
    [[0.84, 0.3, 0.46], [0.62, 0.46, 0.62], [0.4, 0.62, 0.78]].forEach(([k, b, h]) => part(out, circle(c, R * k, 32), H * b, H * h, C.green));
    part(out, circle(c, R * 0.15, 16), H * 0.6, H * 0.94, C.marble);
    part(out, circle(c, R * 0.05, 8), H * 0.94, H, C.bronze);
  },

  baths(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 35;
    const { hl, hw } = box;
    part(out, [rectIn(box, -hl, hl, -hw, hw), rectIn(box, -hl + 7, hl - 7, -hw + 7, hw - 7).reverse()], 0, 9, C.brick);
    flat(out, rectIn(box, -hl + 7, hl - 7, -hw + 7, hw - 7), C.garden);
    const bl = hl * 0.62;
    const bw = hw * 0.4;
    part(out, rectIn(box, -bl, bl, -bw, bw), 0, H * 0.6, C.brick);
    part(out, rectIn(box, -bl, bl, -bw, bw), H * 0.6, H * 0.62, C.roof);
    part(out, rectIn(box, -hl * 0.24, hl * 0.24, -bw * 0.45, bw * 0.45), 0, H * 0.82, C.brickDark);
    gable(out, box, -hl * 0.24, hl * 0.24, bw * 0.45, H * 0.82, H * 0.14, C.roof, 4);
    const cc = at(box, 0, -bw);
    part(out, circle(cc, bw * 0.42, 32), 0, H * 0.72, C.brickDark);
    dome(out, cc, bw * 0.42, H * 0.72, H * 0.26, C.lead, 5);
  },

  basilica(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 25;
    const { hl, hw } = box;
    const aisleH = H * 0.6;
    const ring = (d) => rectIn(box, -hl + d, hl - d, -hw + d, hw - d);
    if (!m.apse) {
      // Open arcades round the outside, the law courts within.
      for (const [b, top] of [[0, aisleH * 0.45], [aisleH * 0.5, aisleH * 0.92]]) {
        for (const q of alongPath(ring(1.5), 4.8, 1.8, 2.4, { closed: true })) part(out, q, b, top, C.marble);
        part(out, [ring(0), ring(3).reverse()], top, top + aisleH * 0.05, C.marble);
      }
      part(out, ring(5), 0, aisleH, C.stucco);
      part(out, ring(0), aisleH, aisleH + 0.8, C.roof);
    } else {
      part(out, ring(0), 0, aisleH, C.stucco);
      part(out, ring(0), aisleH, aisleH + 0.8, C.roof);
      part(out, circle(at(box, -hl, 0), hw * 0.36, 24, Math.atan2(box.v[1], box.v[0]), Math.atan2(box.v[1], box.v[0]) + Math.PI), 0, H * 0.7, C.stucco);
    }
    const nw = hw * 0.4;
    part(out, rectIn(box, -hl + 4, hl - 4, -nw, nw), 0, H * 0.86, C.stucco);
    gable(out, box, -hl + 4, hl - 4, nw + 0.6, H * 0.86, H * 0.14, C.roof, 4);
  },

  hall(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 15;
    const { S } = ctx;
    if (S.flatRoof) {
      part(out, rectIn(box, -box.hl, box.hl, -box.hw, box.hw), 0, H - 0.6, S.hall);
      part(out, rectIn(box, -box.hl, box.hl, -box.hw, box.hw), H - 0.6, H, S.roof);
      return;
    }
    part(out, rectIn(box, -box.hl, box.hl, -box.hw, box.hw), 0, H * 0.78, S.hall);
    gable(out, box, -box.hl - 0.3, box.hl + 0.3, box.hw + 0.4, H * 0.78, H * 0.22, S.roof, 4);
  },

  market(shape, m, out) {
    const ring = shape.main[0];
    const H = m.h ?? 25;
    [[1, 0, 0.42], [0.74, 0.42, 0.72], [0.48, 0.72, 1]].forEach(([k, b, h]) => {
      const r = scaleRing(ring, k);
      part(out, r, H * b, H * h - 0.8, C.brick);
      part(out, r, H * h - 0.8, H * h, C.roof);
    });
  },

  palace(shape, m, out, ctx) {
    const H = m.h ?? 20;
    const { S } = ctx;
    for (const poly of shape.polys) {
      const ring = poly[0];
      if (Math.abs(area(ring)) < 30) continue;
      if (m.courts > 1) {
        // Several courtyards in a row: the Mexica palaces were vast complexes.
        const box = obb(ring);
        const n = m.courts;
        const cl = (box.hl * 2) / n;
        const courts = [];
        for (let i = 0; i < n; i++) {
          const s0 = -box.hl + i * cl + cl * 0.18;
          courts.push(rectIn(box, s0, s0 + cl * 0.64, -box.hw * 0.6, box.hw * 0.6));
        }
        const rings = [rectIn(box, -box.hl, box.hl, -box.hw, box.hw), ...courts.map((q) => q.slice().reverse())];
        part(out, rings, 0, H * 0.9, S.wall);
        part(out, rings, H * 0.9, H, S.roof);
        courts.forEach((q, i) => flat(out, q, i % 2 ? C.garden : C.paving));
        continue;
      }
      const hole = Math.abs(area(ring)) > 1500 && isConvexish(ring) ? scaleRing(ring, 0.5) : null;
      const rings = hole ? [ring, hole.reverse()] : [ring];
      part(out, rings, 0, H * 0.8, S.wall);
      part(out, rings, H * 0.8, H * 0.8 + 1, S.roof);
      if (hole) {
        flat(out, hole, C.garden);
        for (const q of alongPath(scaleRing(ring, 0.47), 4, 0.9, 0.9, { closed: true })) part(out, q, 0, H * 0.32, C.marble);
      }
    }
  },

  forum(shape, m, out) {
    const wallH = m.wallH ?? 12;
    for (const poly of shape.polys) {
      const ring = poly[0];
      const a = Math.abs(area(ring));
      if (a < 200) continue;
      const R = Math.sqrt(a / Math.PI);
      flat(out, ring, C.paving);
      const k = (d) => scaleRing(ring, Math.max(0.2, 1 - d / R));
      part(out, [ring, k(1.5).reverse()], 0, wallH, C.stone);
      for (const q of alongPath(k(8), 4.4, 1.1, 1.1, { closed: true })) part(out, q, 0, 8.5, C.marble);
      part(out, [k(1.5), k(9).reverse()], 8.5, 10, C.roof);
    }
  },

  plaza(shape, m, out) {
    for (const poly of shape.polys) flat(out, poly, C.paving);
  },

  garden(shape, m, out, ctx) {
    for (const poly of shape.polys) {
      flat(out, poly, C.garden);
      trees(out, poly[0], 16, ctx.r);
    }
  },

  fort(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 10;
    const { hl, hw } = box;
    const outer = rectIn(box, -hl, hl, -hw, hw);
    part(out, [outer, rectIn(box, -hl + 3, hl - 3, -hw + 3, hw - 3).reverse()], 0, H, C.brick);
    for (const q of alongPath(outer, 32, 7, 7, { closed: true })) part(out, q, 0, H + 4, C.brick);
    for (let s = -hl + 16; s < hl - 24; s += 15) {
      part(out, rectIn(box, s, s + 8, -hw + 16, -6), 0, 6, C.stucco);
      part(out, rectIn(box, s, s + 8, 6, hw - 16), 0, 6, C.stucco);
    }
  },

  arch(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 18;
    const { hl, hw } = box;
    const bays = m.bays ?? (hl * 2 > 20 ? 3 : 1);
    const piers = bays === 3 ? [[-1, -0.66], [-0.38, -0.27], [0.27, 0.38], [0.66, 1]] : [[-1, -0.36], [0.36, 1]];
    for (const [a, b] of piers) part(out, rectIn(box, a * hl, b * hl, -hw, hw), 0, H * 0.62, C.marble);
    part(out, rectIn(box, -hl, hl, -hw, hw), H * 0.62, H, C.marble);
  },

  column(shape, m, out) {
    const c = shape.centre;
    const H = m.h ?? 38;
    const box = { c, u: [1, 0], v: [0, 1] };
    part(out, rectIn(box, -3, 3, -3, 3), 0, 5.5, C.marble);
    part(out, circle(c, 1.9, 16), 5.5, H - 3, C.marble);
    part(out, circle(c, 0.7, 10), H - 3, H, C.bronze);
  },

  altar(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 7;
    const { hl, hw } = box;
    part(out, [rectIn(box, -hl, hl, -hw, hw), rectIn(box, -hl + 0.8, hl - 0.8, -hw + 0.8, hw - 0.8).reverse()], 0, H, C.marble);
    part(out, rectIn(box, -hl * 0.35, hl * 0.35, -hw * 0.3, hw * 0.3), 0, H * 0.45, C.marble);
  },

  wall(shape, m, out, ctx) {
    const H = m.h ?? 8;
    const colour = m.colour ?? (ctx.style !== 'roman' ? C.stone : (ctx.p.t0 ?? 0) > 100 ? C.brick : C.tufa);
    for (const line of shape.lines) {
      for (const q of strips(line, m.w ?? 4)) part(out, q, 0, H, colour);
      if (m.towers) for (const q of alongPath(line, m.towers, 7.5, 7.5)) part(out, q, 0, H + 4.5, colour);
    }
  },

  aqueduct(shape, m, out) {
    const H = m.h ?? 20;
    const colour = m.colour ?? C.tufa;
    for (const line of shape.lines) {
      if (m.arcade === false) { // a channel on a low embankment
        for (const q of strips(line, m.w ?? 3)) part(out, q, 0, H, colour);
        continue;
      }
      for (const q of alongPath(line, 6.5, 2.6, 2.8)) part(out, q, 0, H - 2.5, colour);
      for (const q of strips(line, 2.8)) part(out, q, H - 2.5, H, colour);
    }
  },

  bridge(shape, m, out, ctx) {
    const w = m.w ?? ctx.p.widthM ?? 8;
    for (const line of shape.lines) {
      if (m.wood) {
        // A removable timber bridge over an opening in a causeway. The line is
        // drawn across the causeway, so the deck runs at right angles to it.
        const d = m.deck ?? 1.4;
        const [a, b] = [line[0], line.at(-1)];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const across = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const box = { c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u: [-across[1], across[0]], v: across };
        const span = (m.span ?? 26) / 2 + 2;
        part(out, rectIn(box, -span, span, -w / 2, w / 2), d, d + 0.45, C.wood);
        for (const s of [-span + 1, -span / 3, span / 3, span - 1]) for (const t of [-w / 2 + 0.5, w / 2 - 0.5]) part(out, circle(at(box, s, t), 0.3, 6), 0, d, C.wood);
        for (const t of [-w / 2, w / 2 - 0.25]) part(out, rectIn(box, -span, span, t, t + 0.25), d + 0.45, d + 1.4, C.wood);
        continue;
      }
      for (const q of strips(line, w)) part(out, q, 5.5, 7.5, C.stone);
      for (const q of alongPath(line, 22, 5, w + 1)) part(out, q, 0, 5.5, C.stone);
    }
  },

  // ---------- Mesoamerica ----------
  // Stepped pyramid with a stair (or twin stairs) on the front and shrines on top.
  pyramid(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 25;
    const n = m.tiers ?? 4;
    const { hl, hw } = box;
    // The base leaves room in front for the stairs, which project forward.
    const run = hl * 0.3;
    const L = hl - run / 2;
    const c0 = -run / 2;
    const ds = L * 0.09;
    const dt = hw * 0.09;
    for (let i = 0; i < n; i++) {
      part(out, rectIn(box, c0 - L + i * ds, c0 + L - i * ds, -hw + i * dt, hw - i * dt), (H * i) / n, (H * (i + 1)) / n, i % 2 ? C.whitewashShade : C.whitewash);
    }
    const topL0 = c0 - L + n * ds;
    const topL1 = c0 + L - n * ds;
    const topW = hw - n * dt;
    // Stairs: stacked slabs climbing from the front edge to the top platform,
    // with sloping balustrades on either side.
    const stairs = m.twin ? [[-hw * 0.46, -hw * 0.06], [hw * 0.06, hw * 0.46]] : [[-hw * 0.22, hw * 0.22]];
    const steps = 18;
    const front = hl;
    for (const [t0, t1] of stairs) {
      for (let k = 0; k < steps; k++) {
        const s1 = front - ((front - topL1) * k) / steps;
        part(out, rectIn(box, topL1 - 1, s1, t0, t1), (H * k) / steps, (H * (k + 1)) / steps, C.stone);
        if (k % 3 === 0) {
          const s2 = front - ((front - topL1) * (k + 3)) / steps;
          for (const [b0, b1] of [[t0 - 1.2, t0], [t1, t1 + 1.2]]) part(out, rectIn(box, topL1 - 1, Math.max(s2, topL1), b0, b1), 0, (H * Math.min(steps, k + 3.5)) / steps, C.whitewashShade);
        }
      }
    }
    // Shrines: Huitzilopochtli (red) on the south half, Tlaloc (blue) on the north.
    const sh = m.shrine ?? Math.max(8, H * 0.42);
    const shrines = m.twin
      ? [[-topW * 0.92, -topW * 0.08, m.colours?.[0] ?? C.blue], [topW * 0.08, topW * 0.92, m.colours?.[1] ?? C.red]]
      : [[-topW * 0.6, topW * 0.6, m.colours?.[0] ?? C.red]];
    const sl0 = topL0 + (topL1 - topL0) * 0.1;
    const sl1 = topL0 + (topL1 - topL0) * 0.62;
    for (const [t0, t1, colour] of shrines) {
      part(out, rectIn(box, sl0, sl1, t0, t1), H, H + sh * 0.55, C.whitewash);
      const mid = (t0 + t1) / 2;
      const half = (t1 - t0) / 2;
      for (let k = 0; k < 4; k++) {
        const f = 1 - k * 0.2;
        part(out, rectIn(box, sl0 + (sl1 - sl0) * (1 - f) / 2, sl1 - (sl1 - sl0) * (1 - f) / 2, mid - half * f, mid + half * f), H + sh * (0.55 + k * 0.11), H + sh * (0.66 + k * 0.11), colour);
      }
    }
  },

  // Round temple of the wind god: circular tiers, a stair, a drum shrine with a conical thatched roof.
  'round-pyramid'(shape, m, out) {
    const c = shape.centre;
    const R = shape.radius;
    const H = m.h ?? 12;
    for (let i = 0; i < 3; i++) part(out, circle(c, R * (1 - i * 0.16), 32), (H * i) / 3, (H * (i + 1)) / 3, i % 2 ? C.whitewashShade : C.whitewash);
    const f = bearingVec(m.facing ?? 90);
    const box = { c, u: f, v: [-f[1], f[0]] };
    for (let k = 0; k < 10; k++) part(out, rectIn(box, R * 0.4, R + 3 - ((R + 3 - R * 0.6) * k) / 10, -R * 0.22, R * 0.22), (H * k) / 10, (H * (k + 1)) / 10, C.stone);
    part(out, circle(c, R * 0.36, 24), H, H + 4, C.whitewash);
    for (let k = 0; k < 5; k++) part(out, circle(c, R * 0.42 * (1 - k / 5.5), 16), H + 4 + k * 1.2, H + 5.2 + k * 1.2, C.thatch);
  },

  ballcourt(shape, m, out) {
    const box = obb(shape.points);
    const { hl, hw } = box;
    flat(out, rectIn(box, -hl, hl, -hw * 0.3, hw * 0.3), C.paving);
    for (const sgn of [-1, 1]) {
      const t0 = sgn * hw * 0.3;
      const t1 = sgn * hw;
      part(out, rectIn(box, -hl * 0.72, hl * 0.72, Math.min(t0 + sgn * 2.5, t1), Math.max(t0 + sgn * 2.5, t1)), 0, 5.5, C.whitewash);
      part(out, rectIn(box, -hl * 0.72, hl * 0.72, Math.min(t0, t0 + sgn * 2.5), Math.max(t0, t0 + sgn * 2.5)), 0, 2.2, C.whitewashShade);
      part(out, circle(at(box, 0, t0 + sgn * 2.5), 0.9, 10), 4, 5.2, C.stone); // stone ring
    }
  },

  tzompantli(shape, m, out) {
    const box = obb(shape.points);
    const { hl, hw } = box;
    part(out, rectIn(box, -hl, hl, -hw, hw), 0, 2.2, C.whitewash);
    for (const t of [-0.6, -0.2, 0.2, 0.6]) {
      for (let s = -hl * 0.92; s <= hl * 0.92; s += 1.6) part(out, circle(at(box, s, t * hw), 0.18, 4), 2.2, 6.5, C.wood);
      for (const z of [3.4, 4.6, 5.8]) part(out, rectIn(box, -hl * 0.92, hl * 0.92, t * hw - 0.12, t * hw + 0.12), z, z + 0.25, C.whitewashShade);
    }
  },

  // A walled sacred precinct: paved, ringed by a low wall.
  precinct(shape, m, out, ctx) {
    for (const poly of shape.polys) {
      const ring = poly[0];
      const R = Math.sqrt(Math.abs(area(ring)) / Math.PI);
      flat(out, ring, C.paving);
      part(out, [ring, scaleRing(ring, 1 - 2 / R).reverse()], 0, m.wallH ?? 3, C.whitewash);
      if (!m.minor) continue;
      // Lesser temples round the edge, each facing the middle, clear of the named buildings.
      const c = centroid(ring);
      const path = scaleRing(ring, 1 - 22 / R);
      const step = pathLength([...path, path[0]]) / m.minor;
      for (const q of alongPath(path, step, 1, 1, { closed: true })) {
        const at0 = centroid(q);
        const size = between(ctx.r, 26, 38); // across the corners
        if (ctx.isFree && !ctx.isFree(at0, size * 0.6)) continue;
        const facing = (Math.atan2(c[0] - at0[0], c[1] - at0[1]) * 180) / Math.PI;
        const pts = circle(at0, size / 2, 4, Math.PI / 4);
        RECIPES.pyramid({ points: pts }, { h: between(ctx.r, 8, 14), tiers: 3, facing, colours: [ctx.r() < 0.5 ? C.red : C.whitewashShade] }, out, ctx);
      }
    }
  },

  // A market square full of awnings, ringed by a colonnade.
  stalls(shape, m, out, ctx) {
    const box = obb(shape.points);
    const { hl, hw } = box;
    const r = ctx.r;
    flat(out, rectIn(box, -hl, hl, -hw, hw), C.paving);
    const outer = rectIn(box, -hl, hl, -hw, hw);
    const inner = rectIn(box, -hl + 7, hl - 7, -hw + 7, hw - 7);
    part(out, [outer, inner.slice().reverse()], 4, 4.8, C.flatRoof);
    for (const q of alongPath(rectIn(box, -hl + 6, hl - 6, -hw + 6, hw - 6), 4, 0.6, 0.6, { closed: true })) part(out, q, 0, 4, C.whitewash);
    const cloths = ['#d8b56a', '#c9a061', '#e3cfa0', '#b98c55', '#cf8f5a'];
    for (let s = -hl + 12; s < hl - 12; s += 6.5) {
      for (let t = -hw + 12; t < hw - 12; t += 6) {
        if (r() < 0.12) continue;
        part(out, rectIn(box, s, s + 4, t, t + 3.6), 2.1, 2.45, cloths[Math.floor(r() * cloths.length)]);
      }
    }
  },

  // Earth causeway across the lake, with openings where the bridges stand.
  causeway(shape, m, out, ctx) {
    const w = m.w ?? ctx.p.widthM ?? 12;
    const H = m.h ?? 1.6;
    const colour = m.colour ?? '#d4c29a';
    for (const line of shape.lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1];
        const b = line[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.5) continue;
        const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        const drops = [];
        for (const cut of ctx.cuts ?? []) {
          const s = (cut.c[0] - a[0]) * u[0] + (cut.c[1] - a[1]) * u[1];
          const off = Math.abs((cut.c[0] - a[0]) * -u[1] + (cut.c[1] - a[1]) * u[0]);
          if (s > -cut.half && s < len + cut.half && off < 40) drops.push([s - cut.half, s + cut.half]);
        }
        drops.sort((x, y) => x[0] - y[0]);
        let s0 = 0;
        for (const [d0, d1] of [...drops, [len, len]]) {
          // Short pieces, so the causeway follows the ground without steps.
          for (let x = s0; x < Math.min(d0, len) - 0.5; x += 25) {
            const x1 = Math.min(x + 25.5, d0, len);
            const p0 = [a[0] + u[0] * x, a[1] + u[1] * x];
            const p1 = [a[0] + u[0] * x1, a[1] + u[1] * x1];
            for (const q of strips([p0, p1], w)) part(out, q, 0, H, colour);
          }
          s0 = Math.max(s0, d1);
        }
        if (i > 1 && !drops.some(([d0]) => d0 <= 0)) part(out, circle(a, w / 2, 12), 0, H, colour); // fill the joint
      }
    }
  },

  dike(shape, m, out) {
    for (const line of shape.lines) {
      for (const q of strips(line, m.w ?? 7)) part(out, q, 0, m.h ?? 2.5, m.colour ?? C.earth);
      for (const q of alongPath(line, 2.5, 0.35, 0.35)) part(out, q, 0, (m.h ?? 2.5) + 0.8, C.wood);
    }
  },

  // ---------- Colonial America ----------
  // A meeting house or church: a gabled nave, a square tower at the front,
  // a belfry, and a spire rising in tapering stages.
  church(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 50;
    const wall = m.colour ?? ctx.S.hall;
    const roof = m.roof ?? ctx.S.roof;
    const { hl, hw } = box;
    const ts = clamp(hw * 1.1, 4.5, 9);
    const wallH = m.wallH ?? Math.min(12, H * 0.3);
    part(out, rectIn(box, -hl, hl - ts, -hw, hw), 0, wallH, wall);
    gable(out, box, -hl - 0.3, hl - ts, hw + 0.3, wallH, hw * 0.6, roof, 4);
    if (m.tower === false) return;
    const tb = { c: at(box, hl - ts / 2, 0), u: box.u, v: box.v };
    part(out, rectIn(tb, -ts / 2, ts / 2, -ts / 2, ts / 2), 0, H * 0.42, wall);
    part(out, rectIn(tb, -ts * 0.38, ts * 0.38, -ts * 0.38, ts * 0.38), H * 0.42, H * 0.55, m.belfry ?? C.whitewash);
    part(out, circle(tb.c, ts * 0.3, 8), H * 0.55, H * 0.64, m.belfry ?? C.whitewash);
    for (let k = 0; k < 6; k++) part(out, circle(tb.c, ts * 0.27 * (1 - k / 6.5), 8), H * (0.64 + k * 0.06), H * (0.7 + k * 0.06), m.spire ?? '#5f6466');
  },

  // A building recorded on a historic map: its own outline, a gable roof.
  house(shape, m, out, ctx) {
    const ring = shape.main[0];
    const box = obb(ring);
    const H = ctx.p.heightM ?? m.h ?? 8 + ctx.r() * 4;
    part(out, ring, 0, H, m.colour ?? ctx.S.wall);
    gable(out, box, -box.hl, box.hl, box.hw + 0.3, H, Math.min(box.hw * 0.8, 6), m.roof ?? ctx.S.roof, 4);
  },

  wharf(shape, m, out) {
    for (const poly of shape.polys) part(out, poly, 0, m.h ?? 1.4, m.colour ?? '#8a6a44');
  },

  // An earthwork: a raised bank of earth round a ditch (Breed's Hill, Yorktown).
  redoubt(shape, m, out) {
    for (const poly of shape.polys) {
      const ring = poly[0];
      part(out, [ring, scaleRing(ring, 0.78).reverse()], 0, m.h ?? 2.8, m.colour ?? '#8f7a55');
      flat(out, scaleRing(ring, 0.78), '#b8a57c');
    }
  },

  // ---------- Carthage ----------
  // Ship sheds round a circular harbour: open fronts between columns, a roof ring above.
  shipsheds(shape, m, out, ctx) {
    const c = shape.centre;
    const p = ctx.p;
    const inner = p.innerM ?? shape.radius * 0.7;
    const outer = p.radiusM ?? shape.radius;
    const count = p.count ?? 60;
    const gap = ((p.gapDeg ?? 0) * Math.PI) / 180;
    const a0 = gap - Math.PI / 2;
    const a1 = Math.PI * 1.5 - gap;
    const H = m.h ?? 8;
    const arc = (r) => circle(c, r, 72, a0, a1);
    const ring = gap > 0 ? [[...arc(outer), ...arc(inner).reverse()]] : [circle(c, outer, 72), circle(c, inner, 72).reverse()];
    part(out, ring, H, H + 1, C.flatRoof);
    const back = gap > 0 ? [[...arc(outer), ...arc(outer - 1.2).reverse()]] : [circle(c, outer, 72), circle(c, outer - 1.2, 72).reverse()];
    part(out, back, 0, H, C.whitewashShade);
    for (let i = 0; i <= count; i++) {
      if (gap === 0 && i === count) break;
      const a = a0 + ((a1 - a0) * i) / count;
      const u = [Math.cos(a), Math.sin(a)];
      const box = { c, u, v: [-u[1], u[0]] };
      part(out, rectIn(box, inner + 1, outer - 1.2, -0.3, 0.3), 0, H, C.whitewash);
      part(out, circle(at(box, inner + 0.6, 0), 0.45, 8), 0, H, C.marble);
    }
  },

  // The admiral's island: a round platform with a lookout pavilion at its centre.
  admiral(shape, m, out) {
    const c = shape.centre;
    const R = shape.radius;
    part(out, circle(c, R, 40), 0, 1.4, C.stone);
    part(out, circle(c, R * 0.2, 20), 1.4, (m.h ?? 16) - 3, C.whitewash);
    for (let k = 0; k < 3; k++) part(out, circle(c, R * 0.22 * (1 - k / 3.5), 20), (m.h ?? 16) - 3 + k, (m.h ?? 16) - 2 + k, C.flatRoof);
  },

  // The Tophet: an enclosure crowded with small stone stelae.
  tophet(shape, m, out, ctx) {
    const ring = shape.main[0];
    const box = obb(ring);
    const r = ctx.r;
    flat(out, ring, '#d6c9a8');
    part(out, [ring, scaleRing(ring, 0.985).reverse()], 0, 2.4, C.stone);
    for (let s = -box.hl + 3; s < box.hl - 3; s += 3) {
      for (let t = -box.hw + 3; t < box.hw - 3; t += 2.4) {
        const q = at(box, s + between(r, -0.6, 0.6), t + between(r, -0.5, 0.5));
        if (!inRing(q, ring) || r() < 0.25) continue;
        const sb = { c: q, u: box.u, v: box.v };
        part(out, rectIn(sb, -0.1, 0.1, -0.25, 0.25), 0, between(r, 0.7, 1.8), r() < 0.5 ? '#cfc3a6' : '#bfb294');
      }
    }
  },

  // Long vaulted water cisterns side by side.
  cisterns(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 7;
    const n = m.n ?? Math.max(4, Math.round((box.hw * 2) / 9));
    const cw = (box.hw * 2) / n;
    for (let i = 0; i < n; i++) {
      const t0 = -box.hw + i * cw;
      part(out, rectIn(box, -box.hl, box.hl, t0 + 0.6, t0 + cw - 0.6), 0, H * 0.7, C.stone);
      for (let k = 0; k < 3; k++) {
        const f = 1 - (k + 1) * 0.25;
        part(out, rectIn(box, -box.hl, box.hl, t0 + cw / 2 - (cw / 2 - 0.6) * f, t0 + cw / 2 + (cw / 2 - 0.6) * f), H * (0.7 + k * 0.1), H * (0.8 + k * 0.1), C.stone);
      }
    }
  },

  // Ruins: scattered low walls and heaps of stone.
  ruins(shape, m, out, ctx) {
    const r = ctx.r;
    for (const poly of shape.polys) {
      const ring = poly[0];
      flat(out, ring, '#d2c7b0');
      const box = obb(ring);
      const n = Math.min(400, Math.round(Math.abs(area(ring)) / 300));
      for (let i = 0; i < n; i++) {
        const q = at(box, between(r, -box.hl, box.hl), between(r, -box.hw, box.hw));
        if (!inRing(q, ring)) continue;
        const sb = { c: q, u: box.u, v: box.v };
        const l = between(r, 2, 9);
        part(out, rectIn(sb, -l / 2, l / 2, -0.6, 0.6), 0, between(r, 0.4, 2.6), C.rubble);
      }
    }
  },

  // ---------- The Levant (Jerusalem) ----------
  // A great raised platform over sloping ground (the Temple Mount): flat on
  // top, its retaining walls showing where the hill falls away. MapLibre sets
  // each solid on the ground under its middle, so the platform is cut into
  // small cells and each is raised to the same level (see raiseToTerrace).
  terrace(shape, m, out, ctx) {
    const step = m.cell ?? 16;
    for (const poly of shape.polys) {
      const ring = poly[0];
      const box = obb(ring);
      for (let s = -box.hl; s < box.hl; s += step) {
        for (let t = -box.hw; t < box.hw; t += step) {
          const cell = rectIn(box, s, Math.min(s + step, box.hl), t, Math.min(t + step, box.hw));
          let piece = ring;
          for (let i = 0; i < 4 && piece; i++) {
            const a = cell[i];
            const b = cell[(i + 1) % 4];
            piece = clipHalf(piece, a, [b[0] - a[0], b[1] - a[1]]);
          }
          if (piece && Math.abs(area(piece)) > 4) part(out, piece, 0, 0.05, m.colour ?? '#ddd0b2');
        }
      }
    }
    raiseToTerrace(out, m.terrace, ctx.toXY);
  },

  // The Dome of the Rock: an octagon faced with marble below and mosaic above,
  // a drum, and the gilded dome, on its raised upper court.
  'dome-rock'(shape, m, out, ctx) {
    const ring = shape.main[0];
    const c = centroid(ring);
    const R = Math.max(...ring.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
    const upper = m.upper ?? '#6b8f7d';
    let pb = 0;
    if (m.court) {
      // [north-south, east-west] in metres
      pb = 3;
      part(out, rectIn({ c, u: [1, 0], v: [0, 1] }, -m.court[1] / 2, m.court[1] / 2, -m.court[0] / 2, m.court[0] / 2), 0, pb, '#ddd0b2');
    }
    part(out, ring, pb, pb + 5.5, C.marble);
    part(out, ring, pb + 5.5, pb + 10.5, upper);
    part(out, scaleRing(ring, 0.97), pb + 10.5, pb + 11.6, C.marbleShade);
    const rd = R * 0.45;
    part(out, circle(c, rd, 32), pb + 11.6, pb + 20, upper);
    part(out, circle(c, rd * 1.03, 32), pb + 20, pb + 20.8, C.marble);
    // Slightly pointed, so taller than a hemisphere.
    dome(out, c, rd * 0.96, pb + 20.8, rd * 1.15, m.dome ?? '#d4a73a', 9);
    finial(out, c, pb + 20.8 + rd * 1.15, m.finial);
    raiseToTerrace(out, m.terrace, ctx.toXY);
  },

  // Al-Aqsa as the Fatimids rebuilt it: a wide hall of aisles, a raised
  // central nave, and a dome before the mihrab at the south end.
  aqsa(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, { facing: m.facing ?? 0 }, ctx); // +u = north, the entrance
    const { hl, hw } = box;
    part(out, rectIn(box, -hl, hl, -hw, hw), 0, 9, C.stone);
    part(out, rectIn(box, -hl, hl, -hw, hw), 9, 9.6, C.lead);
    const nw = Math.min(hw * 0.2, 7);
    const ds = hw * 0.72; // the square bay under the dome
    part(out, rectIn(box, -hl + ds, hl, -nw, nw), 0, 13.5, C.stone);
    gable(out, box, -hl + ds, hl + 0.3, nw + 0.4, 13.5, 2.6, C.lead, 3);
    const dc = at(box, -hl + ds / 2, 0);
    const dr = Math.min(ds / 2 - 1, 8);
    part(out, rectIn(box, -hl, -hl + ds, -ds / 2, ds / 2), 0, 15, C.stone);
    part(out, circle(dc, dr, 28), 15, 18, C.stone);
    dome(out, dc, dr * 0.97, 18, dr * 0.95, m.dome ?? C.lead, 7);
    finial(out, dc, 18 + dr * 0.95, m.finial);
    raiseToTerrace(out, m.terrace, ctx.toXY);
  },

  // The Church of the Holy Sepulchre: the rotunda over the tomb at the west
  // end under its open conical roof, and east of it either the court and
  // chapels of the 1040s or ("crusader": true) the Romanesque church of 1149,
  // with its crossing dome, apse and bell tower.
  sepulchre(shape, m, out) {
    const box = obb(shape.points);
    if (box.u[0] < 0) { box.u = [-box.u[0], -box.u[1]]; box.v = [-box.v[0], -box.v[1]]; } // +u east, +v north
    const { hl, hw } = box;
    const R = Math.min(hw, m.r ?? 18);
    const rc = at(box, -hl + R, 0);
    part(out, circle(rc, R, 40), 0, 15, C.stone);
    for (let k = 0; k < 5; k++) {
      part(out, [circle(rc, R * (1.02 - k * 0.13), 40), circle(rc, R * 0.2, 20)], 15 + k * 2.4, 17.4 + k * 2.4, C.lead);
    }
    const e0 = -hl + 2 * R;
    if (!m.crusader) {
      flat(out, rectIn(box, e0, hl - 6, -hw * 0.75, hw * 0.75), C.paving);
      part(out, rectIn(box, e0, e0 + 14, -hw, -hw * 0.5), 0, 10, C.stone); // Calvary
      part(out, rectIn(box, e0, hl, hw * 0.75, hw), 0, 8, C.stone);
      part(out, rectIn(box, hl - 6, hl, -hw * 0.75, hw * 0.75), 0, 8, C.stone);
      return;
    }
    const cw = Math.min(hw * 0.62, 14);
    const ar = cw * 0.85;
    const s1 = hl - ar;
    part(out, rectIn(box, e0 - 2, s1, -cw, cw), 0, 16, C.stone);
    part(out, rectIn(box, e0 - 2, s1, -cw, cw), 16, 17, C.lead);
    // Transept and crossing dome.
    const xs = e0 + 9;
    part(out, rectIn(box, xs - 7, xs + 7, -Math.min(hw, cw + 9), Math.min(hw, cw + 9)), 0, 16, C.stone);
    const xc = at(box, xs, 0);
    part(out, circle(xc, 6.5, 24), 16, 21, C.stone);
    dome(out, xc, 6.3, 21, 6, C.lead, 6);
    // Apse with its ambulatory of chapels.
    const a = Math.atan2(box.v[1], box.v[0]);
    part(out, circle(at(box, s1, 0), ar, 24, a - Math.PI, a), 0, 12, C.stone);
    part(out, circle(at(box, s1, 0), ar * 0.7, 20, a - Math.PI, a), 12, 15, C.stone);
    if (m.tower !== false) {
      const tc = { c: at(box, -hl + R * 1.6, -(R * 0.95)), u: box.u, v: box.v };
      part(out, rectIn(tc, -4.5, 4.5, -4.5, 4.5), 0, 30, C.stone);
      part(out, rectIn(tc, -3.6, 3.6, -3.6, 3.6), 30, 33, C.stone);
      for (let k = 0; k < 3; k++) part(out, rectIn(tc, -3 + k, 3 - k, -3 + k, 3 - k), 33 + k, 34 + k, C.lead);
    }
  },

  // A citadel: a curtain wall round a court, towers along it, and a great keep
  // at the north-east corner (the Tower of David stands on Herod's tower).
  // "ruined": true leaves stumps.
  citadel(shape, m, out) {
    const ring = shape.main[0];
    const R = Math.sqrt(Math.abs(area(ring)) / Math.PI);
    const H = m.ruined ? 3 : m.h ?? 13;
    const colour = m.ruined ? C.rubble : C.stone;
    const inner = scaleRing(ring, Math.max(0.5, 1 - 5 / R));
    part(out, [ring, inner], 0, H, colour);
    flat(out, inner, C.paving);
    for (const q of alongPath(ring, m.towers ?? 30, 8, 8, { closed: true })) part(out, q, 0, m.ruined ? 4 : H + 3, colour);
    const box = obb(ring);
    const ne = ring.reduce((p, q) => (q[0] + q[1] > p[0] + p[1] ? q : p));
    const c = centroid(ring);
    const d = Math.hypot(c[0] - ne[0], c[1] - ne[1]) || 1;
    const keep = { c: [ne[0] + ((c[0] - ne[0]) / d) * 11, ne[1] + ((c[1] - ne[1]) / d) * 11], u: box.u, v: box.v };
    part(out, rectIn(keep, -9, 9, -8, 8), 0, m.ruined ? 10 : 24, colour);
    if (!m.ruined) part(out, rectIn(keep, -7.5, 7.5, -6.5, 6.5), 24, 27, colour);
  },

  // A city gate: two towers astride the road and the gatehouse over the
  // arch. "angle" is the bearing of the wall. "sealed" makes a walled-up
  // double gate with two domes (the Golden Gate).
  gate(shape, m, out, ctx) {
    const u = bearingVec(m.angle ?? 90);
    const box = { c: shape.centre, u, v: [-u[1], u[0]] };
    const H = m.h ?? 14;
    if (m.sealed) {
      part(out, rectIn(box, -11, 11, -8, 8), 0, H - 2, C.stone);
      for (const s of [-5.5, 5.5]) dome(out, at(box, s, 0), 4, H - 2, 3.5, C.stone, 5);
    } else {
      part(out, rectIn(box, -9.6, -2.6, -4.5, 4.5), 0, H, C.stone);
      part(out, rectIn(box, 2.6, 9.6, -4.5, 4.5), 0, H, C.stone);
      part(out, rectIn(box, -2.6, 2.6, -3.8, 3.8), 6.5, H - 1.5, C.stone);
    }
    raiseToTerrace(out, m.terrace, ctx.toXY);
  },

  // A crusader church: aisles and a taller nave under flat stone roofs, an
  // apse at the east end, and a dome over the crossing on some.
  // "apse": false and "dome": true make a small domed mosque.
  chapel(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, { facing: m.facing ?? 90 }, ctx); // +u = east
    const H = m.h ?? 16;
    const { hl, hw } = box;
    const ar = m.apse === false ? 0 : hw * 0.45;
    const s1 = hl - ar;
    part(out, rectIn(box, -hl, s1, -hw, hw), 0, H * 0.62, C.stone);
    part(out, rectIn(box, -hl, s1, -hw * 0.4, hw * 0.4), 0, H * 0.8, C.stone);
    part(out, rectIn(box, -hl, s1, -hw * 0.4, hw * 0.4), H * 0.8, H * 0.84, ctx.S.roof);
    if (ar) {
      const a = Math.atan2(box.v[1], box.v[0]);
      part(out, circle(at(box, s1, 0), ar, 20, a - Math.PI, a), 0, H * 0.7, C.stone);
    }
    if (m.dome) {
      const dc = at(box, ar ? s1 - hw * 0.45 : 0, 0);
      const dr = Math.min(hw * 0.38, 7);
      part(out, circle(dc, dr, 24), H * 0.8, H, C.stone);
      dome(out, dc, dr * 0.96, H, dr * 0.9, m.domeColour ?? C.lead, 6);
      finial(out, dc, H + dr * 0.9, m.finial);
    }
  },

  // A siege camp: tents scattered round a pavilion and banner, or round a
  // siege tower ("tower": true).
  camp(shape, m, out, ctx) {
    const c = shape.centre;
    const R = shape.radius;
    const r = ctx.r;
    const cloths = m.colours ?? ['#efe6d2', '#e2d3b0', '#d8c49b', '#c9b48a'];
    const n = Math.round((R * R) / 45);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(between(r, 0.12, 1)) * R * 0.92;
      const q = [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d];
      const t = r() * Math.PI;
      const box = { c: q, u: [Math.cos(t), Math.sin(t)], v: [-Math.sin(t), Math.cos(t)] };
      const cloth = cloths[Math.floor(r() * cloths.length)];
      part(out, rectIn(box, -2, 2, -1.5, 1.5), 0, 1.1, cloth);
      gable(out, box, -2, 2, 1.6, 1.1, 1.4, cloth, 3);
    }
    if (m.tower) {
      // A siege tower of timber, hides hung on the upper storeys.
      const u = bearingVec(m.facing ?? 180);
      const box = { c, u, v: [-u[1], u[0]] };
      const H = m.h ?? 18;
      for (let k = 0; k < 6; k++) {
        const w = 4 - k * 0.2;
        part(out, rectIn(box, -w, w, -w, w), (H * k) / 6, (H * (k + 1)) / 6, k > 3 ? '#8a5a3a' : C.wood);
      }
      part(out, rectIn(box, 3.4, 8, -1.5, 1.5), H * 0.82, H * 0.82 + 0.4, C.wood);
      return;
    }
    part(out, circle(c, 3.5, 12), 0, 2.6, cloths[0]);
    for (let k = 0; k < 3; k++) part(out, circle(c, 3.8 * (1 - k / 3.2), 12), 2.6 + k * 0.9, 3.5 + k * 0.9, cloths[0]);
    part(out, circle([c[0] + 4.5, c[1]], 0.15, 5), 0, 9, C.wood);
    part(out, rectIn({ c: [c[0] + 5.6, c[1]], u: [1, 0], v: [0, 1] }, -1.1, 1.1, -0.05, 0.05), 7.4, 8.9, m.flag ?? C.red);
  },
  // ---------- Tehran, 1970s ----------
  // The Shahyad (now Azadi) Tower, 1971: white marble legs that curve up into
  // one crown, a tall pointed arch through the long faces and a lower one
  // through the short faces. Long pools run out from it along the avenue axis.
  'azadi-tower'(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 45;
    const crown = H * 0.8;
    const { hl, hw } = box;
    const marble = '#ece6d8';
    const taper = (base, top, z) => top + (base - top) * (1 - z / crown) ** 1.7;
    const arch = (half, apex, z) => (z < apex ? half * (1 - (z / apex) ** 1.6) ** 0.65 : 0);
    const spans = (outer, gap) => (gap > 0.4 ? [[-outer, -gap], [gap, outer]] : [[-outer, outer]]);
    const dz = 1;
    for (let z = 0; z < crown - 0.01; z += dz) {
      const zm = z + dz / 2;
      const L = taper(hl, hl * 0.34, zm);
      const W = taper(hw, hw * 0.48, zm);
      for (const [s0, s1] of spans(L, arch(hl * 0.4, H * 0.52, zm))) {
        for (const [t0, t1] of spans(W, arch(hw * 0.3, H * 0.27, zm))) part(out, rectIn(box, s0, s1, t0, t1), z, z + dz, marble);
      }
    }
    // Turquoise tiles in the top of the great arch.
    const gap = arch(hl * 0.4, H * 0.52, H * 0.47);
    part(out, rectIn(box, -gap, gap, -hw * 0.55, hw * 0.55), H * 0.46, H * 0.52, '#3e9e9a');
    // The crown, stepped in to a lozenge on top.
    const L = hl * 0.34;
    const W = hw * 0.48;
    part(out, rectIn(box, -L, L, -W, W), crown, H * 0.9, marble);
    part(out, rectIn(box, -L * 0.85, L * 0.85, -W * 0.85, W * 0.85), H * 0.9, H * 0.94, '#e0d9c9');
    for (let k = 0; k < 3; k++) {
      const f = 0.62 - k * 0.2;
      part(out, rectIn(box, -L * f, L * f, -W * f, W * f), H * (0.94 + k * 0.02), H * (0.96 + k * 0.02), marble);
    }
    if (m.pools === false) return;
    for (const sgn of [-1, 1]) flat(out, rectIn(box, -hl * 0.3, hl * 0.3, sgn * (hw + 18), sgn * (hw + 95)), C.water);
  },

  // Golestan Palace: Qajar halls round a walled garden of plane trees and a
  // long pool. The first outline is the garden wall, the rest are halls;
  // model.tower is the index of the Shams-ol-Emareh, the tall pavilion.
  golestan(shape, m, out) {
    const [garden, ...halls] = shape.polys.map((poly) => poly[0]);
    flat(out, garden, C.garden);
    for (const q of strips([...garden, garden[0]], 1.4)) part(out, q, 0, m.wallH ?? 7, '#d9c7a4');
    const box = obb(garden);
    flat(out, rectIn(box, -box.hl * 0.5, box.hl * 0.5, -3, 3), C.water);
    const clear = halls.map((h) => scaleRing(h, 1.25));
    grove(out, garden, 24, (q) => !clear.some((h) => inRing(q, h)) && Math.abs((q[0] - box.c[0]) * box.v[0] + (q[1] - box.c[1]) * box.v[1]) > 6);
    halls.forEach((ring, i) => {
      if (i + 1 === m.tower) {
        shams(out, ring, m.towerH ?? 35);
        return;
      }
      const h = m.hallH ?? 13;
      part(out, ring, 0, h - 2.2, '#eadcbc');
      part(out, ring, h - 2.2, h - 0.6, '#5b9aa8');
      part(out, ring, h - 0.6, h, '#eadcbc');
    });
  },

  // A four-iwan mosque: arcades round a court with a pool, a tall iwan and two
  // minarets on the qibla side (model.facing), and the dome behind them.
  mosque(shape, m, out, ctx) {
    const box = face(obb(shape.main[0]), shape, m, ctx);
    const { hl, hw } = box;
    const brick = m.colour ?? '#c9a77c';
    const tile = m.tile ?? '#4f9aa3';
    const H = m.h ?? 9;
    const court = rectIn(box, -hl * 0.62, hl * 0.3, -hw * 0.6, hw * 0.6);
    part(out, [shape.main[0], court.slice().reverse()], 0, H, brick);
    part(out, [shape.main[0], court.slice().reverse()], H, H + 0.6, '#b8ab94');
    flat(out, court, C.paving);
    flat(out, rectIn(box, -hl * 0.3, hl * 0.02, -hw * 0.12, hw * 0.12), C.water);
    // Iwans: the main one on the qibla side, lesser ones on the other three.
    const iwan = (s0, s1, t0, t1, h) => {
      part(out, rectIn(box, s0, s1, t0, t1), 0, h, brick);
      part(out, rectIn(box, s0, s1, t0, t1), h, h + 0.5, tile);
    };
    const mw = Math.min(hw * 0.28, 14);
    iwan(hl * 0.22, hl * 0.46, -mw, mw, m.iwanH ?? 22);
    part(out, rectIn(box, hl * 0.2, hl * 0.22, -mw * 0.7, mw * 0.7), 3, (m.iwanH ?? 22) - 2, tile);
    iwan(-hl * 0.7, -hl * 0.54, -mw * 0.6, mw * 0.6, 14);
    for (const sgn of [-1, 1]) iwan(-hl * 0.26, hl * 0.02, sgn * hw * 0.58, sgn * hw * 0.74, 14);
    for (const sgn of [-1, 1]) {
      const c = at(box, hl * 0.26, sgn * (mw + 1.8));
      part(out, circle(c, 1.9, 12), 0, m.minaretH ?? 32, brick);
      part(out, circle(c, 2.5, 12), (m.minaretH ?? 32) - 5, (m.minaretH ?? 32) - 3.8, '#e6d6b0');
      part(out, circle(c, 1.4, 10), m.minaretH ?? 32, (m.minaretH ?? 32) + 2, tile);
      part(out, circle(c, 0.5, 6), (m.minaretH ?? 32) + 2, (m.minaretH ?? 32) + 4, tile);
    }
    const dc = at(box, hl * 0.7, 0);
    const R = Math.min(hw * 0.26, hl * 0.25, 13);
    part(out, circle(dc, R, 32), 0, H + 7, brick);
    dome(out, dc, R * 0.96, H + 7, R * 0.95, tile);
    part(out, circle(dc, 0.5, 6), H + 7 + R * 0.95, H + 10 + R * 0.95, C.bronze);
  },

  // A university campus: lawns and plane trees inside railings, with faculty
  // buildings on their real outlines (every outline after the first).
  campus(shape, m, out, ctx) {
    const [ground, ...blocks] = shape.polys.map((poly) => poly[0]);
    flat(out, ground, C.garden);
    for (const q of strips([...ground, ground[0]], 0.6)) part(out, q, 0, 2.2, '#77736a');
    for (const b of blocks) {
      const h = (m.h ?? 12) + Math.round(between(ctx.r, -1, 1)) * 3.5;
      part(out, b, 0, h, m.colour ?? '#d8cbb0');
      part(out, b, h, h + 0.5, '#a9a398');
    }
    const clear = blocks.map((b) => scaleRing(b, 1.3));
    grove(out, ground, 26, (q) => !clear.some((b) => inRing(q, b)));
  },

  // The university gate (1966): two tall concrete leaves either side of the
  // way in, leaning together and flaring out as they rise.
  'uni-gate'(shape, m, out) {
    const f = bearingVec(m.facing ?? 180);
    const box = { c: shape.centre, u: [f[1], -f[0]], v: f };
    const H = m.h ?? 17;
    const concrete = '#ddd7ca';
    const n = 12;
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      const inner = 3.2 - 1.6 * k;
      const outer = 5 + 6 * k ** 1.6;
      for (const sgn of [-1, 1]) part(out, rectIn(box, sgn > 0 ? inner : -outer, sgn > 0 ? outer : -inner, -1.2, 1.2), (H * i) / n, (H * (i + 1)) / n, concrete);
    }
    for (const sgn of [-1, 1]) part(out, rectIn(box, sgn > 0 ? 12 : -70, sgn > 0 ? 70 : -12, -0.3, 0.3), 0, 2, '#77736a');
  },

  // A walled compound of lawns and trees (the US embassy).
  compound(shape, m, out, ctx) {
    for (const poly of shape.polys) {
      const ring = poly[0];
      flat(out, ring, C.garden);
      for (const q of strips([...ring, ring[0]], 0.8)) part(out, q, 0, m.wallH ?? 3, m.colour ?? '#c2a27a');
      grove(out, ring, m.spacing ?? 24, (q) => !ctx.isFree || ctx.isFree(q, 4));
    }
  },

  // A flat-roofed modern building on its own outline.
  'modern-block'(shape, m, out, ctx) {
    const H = m.h ?? 12;
    for (const poly of shape.polys) {
      part(out, poly, 0, H, m.colour ?? ctx.S.wall);
      part(out, poly[0], H, H + 0.5, m.roof ?? ctx.S.roof);
    }
  },

  // ---------- Berlin, 1945 to 1990 ----------
  // The Wall along a line. gen 1: the first wall of 1961, breeze blocks and
  // slabs topped with barbed wire. gen 75: the 3.6 m concrete segments of the
  // "Grenzmauer 75", some painted on the western face; "broken" for the
  // months after November 1989, chipped and with gaps. "hinterland": the
  // lower wall on the East Berlin side of the death strip.
  'border-wall'(shape, m, out, ctx) {
    const r = ctx.r;
    for (const line of shape.lines) {
      if (m.gen === 1) {
        for (const q of strips(line, 0.8)) part(out, q, 0, 2.4, '#a9a59c');
        for (const q of alongPath(line, 4, 0.15, 1.3)) part(out, q, 2.4, 3, '#5d5853');
      } else if (m.gen === 'hinterland') {
        for (const q of strips(line, 0.5)) part(out, q, 0, 2.9, '#d3cec2');
      } else {
        for (const q of alongPath(line, 12, 12, 1.2)) {
          if (m.broken && r() < 0.12) continue;
          const top = m.broken ? between(r, 2.4, 3.4) : 3.4;
          part(out, q, 0, top, r() < (m.broken ? 0.55 : 0.3) ? GRAFFITI[Math.floor(r() * GRAFFITI.length)] : '#e2e0d8');
          part(out, q, top, top + 0.3, '#cfcdc5');
        }
      }
    }
  },

  // Raked sand between the walls, so footprints show.
  'death-strip'(shape, m, out) {
    for (const poly of shape.polys) flat(out, poly, m.colour ?? '#f3eddc');
  },

  // Floodlights every 30 m beside the patrol road.
  'strip-lamps'(shape, m, out, ctx) {
    const off = (ctx.p.widthM ?? 3.5) / 2 + 1;
    for (const line of shape.lines) {
      for (const { c, u, v } of stations(line, m.step ?? 30)) {
        const box = { c: [c[0] + v[0] * off, c[1] + v[1] * off], u, v };
        part(out, rectIn(box, -0.15, 0.15, -0.15, 0.15), 0, 8.4, '#5b5e60');
        part(out, rectIn(box, -0.1, 0.1, -1.8, 0), 8.1, 8.4, '#5b5e60');
        part(out, rectIn(box, -0.35, 0.35, -2.1, -1.4), 7.8, 8.2, '#ece6c4');
      }
    }
  },

  // One watchtower at each point of the line: the slender BT-11 with an
  // eight-sided cab, or the squat square BT-9.
  watchtowers(shape, m, out, ctx) {
    const r = ctx.r;
    for (const c of shape.points) {
      const box = { c, u: [1, 0], v: [0, 1] };
      const tall = r() < 0.6;
      const [half, shaft, cab] = tall ? [1.1, 9.4, 2] : [2.1, 7.6, 2.4];
      part(out, rectIn(box, -half, half, -half, half), 0, shaft, '#d9d7cf');
      const ring = tall ? circle(c, cab, 8, Math.PI / 8) : rectIn(box, -cab, cab, -cab, cab);
      part(out, ring, shaft, shaft + 0.5, '#d9d7cf');
      part(out, ring, shaft + 0.5, shaft + 1.7, '#3f474c');
      part(out, tall ? circle(c, cab + 0.2, 8, Math.PI / 8) : rectIn(box, -cab - 0.2, cab + 0.2, -cab - 0.2, cab + 0.2), shaft + 1.7, shaft + 2.1, '#cfcdc5');
      part(out, circle(c, 0.4, 8), shaft + 2.1, shaft + 2.7, '#5b5e60');
    }
  },

  // The Brandenburg Gate: six pairs of Doric columns on wall piers, an
  // entablature and attic, the Quadriga on top, and lower wings either side.
  gate(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 26;
    const k = H / 26;
    const { hl, hw } = box;
    const L = Math.min(hl, 20.5);
    const stone = '#e2d6bb';
    for (let i = 0; i < 6; i++) {
      const s = -L + 1.2 + (i * (2 * L - 2.4)) / 5;
      part(out, rectIn(box, s - 1.1, s + 1.1, -hw + 1.8, hw - 1.8), 0, 13.5 * k, stone);
      for (const t of [-hw + 0.9, hw - 0.9]) part(out, circle(at(box, s, t), 0.85, 12), 0, 13.5 * k, C.marble);
    }
    part(out, rectIn(box, -L, L, -hw, hw), 13.5 * k, 17 * k, stone);
    part(out, rectIn(box, -L * 0.78, L * 0.78, -hw + 1, hw - 1), 17 * k, 20 * k, stone);
    part(out, rectIn(box, -4.5, 4.5, -3.2, 3.2), 20 * k, 21.4 * k, stone);
    part(out, rectIn(box, -3.6, 3.6, -2.2, 2.2), 21.4 * k, 24.2 * k, '#6f8f7c');
    part(out, rectIn(box, -0.6, 0.6, -0.6, 0.6), 24.2 * k, H, '#6f8f7c');
    if (hl > L + 4) {
      for (const sgn of [-1, 1]) {
        const [s0, s1] = [sgn * (L + 0.5), sgn * hl].sort((a, b) => a - b);
        part(out, rectIn(box, s0, s1, -hw * 0.75, hw * 0.75), 0, 11 * k, stone);
        part(out, rectIn(box, s0, s1, -hw * 0.75, hw * 0.75), 11 * k, 12 * k, '#cfc3a6');
      }
    }
  },

  // The Reichstag: a sandstone block with four corner towers and a west
  // portico. "ruin": the burnt-out shell of 1945 to 1961, walls broken off
  // and no roof. Otherwise the plain rebuilding of 1961 to 1973, no dome.
  reichstag(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const r = ctx.r;
    const { hl, hw } = box;
    const wall = m.ruin ? '#a79b84' : '#d7cdb6';
    const front = hl - 9;
    const main = rectIn(box, -hl, front, -hw, hw);
    if (m.ruin) {
      part(out, [main, rectIn(box, -hl + 3, front - 3, -hw + 3, hw - 3).reverse()], 0, 14, wall);
      for (const q of alongPath(rectIn(box, -hl + 1.5, front - 1.5, -hw + 1.5, hw - 1.5), 7, 6.6, 3, { closed: true })) {
        if (r() > 0.1) part(out, q, 14, between(r, 16, 22), wall);
      }
      part(out, [rectIn(box, -22, 18, -20, 20), rectIn(box, -20, 16, -18, 18).reverse()], 0, between(r, 15, 19), wall);
    } else {
      part(out, main, 0, 22, wall);
      part(out, main, 22, 23, '#8e8a83');
    }
    for (const s of [-hl + 10, front - 10]) {
      for (const t of [-hw + 10, hw - 10]) part(out, rectIn(box, s - 10, s + 10, t - 10, t + 10), 0, m.ruin ? between(r, 25, 31) : 28, wall);
    }
    // Portico: a stair, six columns and a pediment.
    part(out, rectIn(box, front, hl, -22, 22), 0, 4, wall);
    columnsBetween(out, box, hl - 2.5, -18, hl - 2.5, 18, 6, 1.1, 4, 20, m.ruin ? '#b3a78f' : C.stone);
    part(out, rectIn(box, front - 2, hl - 1, -20, 20), 20, 22.5, wall);
    if (!m.ruin) gable(out, { c: at(box, hl - 5.5, 0), u: box.v, v: [-box.v[1], box.v[0]] }, -20, 20, 4.5, 22.5, 4, wall, 3);
  },

  // The iron frame of the Reichstag dome, left standing after the 1945
  // fighting until it was blown up in 1954.
  'dome-frame'(shape, m, out) {
    const c = shape.centre;
    const box = { c, u: [1, 0], v: [0, 1] };
    const col = '#4a4440';
    part(out, [rectIn(box, -17, 17, -17, 17), rectIn(box, -15, 15, -15, 15).reverse()], 22, 32, '#a79b84');
    const ribs = 12;
    const steps = 7;
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2;
      for (let k = 0; k < steps; k++) {
        const th = ((k + 0.5) / steps) * (Math.PI / 2);
        const q = [c[0] + 15 * Math.cos(th) * Math.cos(a), c[1] + 15 * Math.cos(th) * Math.sin(a)];
        part(out, circle(q, 0.35, 4), 32 + 22 * Math.sin((k / steps) * (Math.PI / 2)), 32 + 22 * Math.sin(((k + 1) / steps) * (Math.PI / 2)), col);
      }
    }
    for (const k of [2, 4]) {
      const th = (k / steps) * (Math.PI / 2);
      const R = 15 * Math.cos(th);
      const z = 32 + 22 * Math.sin(th);
      part(out, [circle(c, R + 0.25, 36), circle(c, R - 0.25, 36).reverse()], z - 0.3, z + 0.3, col);
    }
  },

  // A burnt-out palace: the lower storeys stand, the upper walls broken off.
  shell(shape, m, out, ctx) {
    const H = m.h ?? 28;
    const r = ctx.r;
    const wall = m.colour ?? '#a49883';
    for (const poly of shape.polys) {
      part(out, poly, 0, H * 0.5, wall);
      for (const ring of poly) {
        for (const q of alongPath(ring, 6, 5.8, 1.6, { closed: true })) if (r() > 0.15) part(out, q, H * 0.5, between(r, H * 0.62, H), wall);
      }
    }
  },

  // The Fernsehturm: a tapering concrete shaft, the steel sphere at 200 m,
  // the red and white antenna to 368 m, and the pavilion round its foot.
  'tv-tower'(shape, m, out) {
    const c = shape.centre;
    const k = (m.h ?? 368) / 368;
    const concrete = '#dddbd5';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const box = { c, u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)] };
      part(out, rectIn(box, 14, 44, -9, 9), 0, 9, '#ebe8e1');
      part(out, rectIn(box, 14, 44, -9, 9), 9, 10, '#a8a39b');
    }
    const n = 12;
    for (let i = 0; i < n; i++) part(out, circle(c, 16 - (11.4 * i) / n, 24), (248 * k * i) / n, (248 * k * (i + 1)) / n, concrete);
    const R = 16 * k;
    const z0 = 213 * k;
    const layers = 12;
    for (let i = 0; i < layers; i++) {
      const za = -R + (2 * R * i) / layers;
      const zb = za + (2 * R) / layers;
      const zm = (za + zb) / 2;
      part(out, circle(c, Math.sqrt(R * R - zm * zm), 28), z0 + za, z0 + zb, zm > -3 * k && zm < 4 * k ? '#3a434a' : '#aab2b7');
    }
    part(out, circle(c, 3.2 * k, 16), 248 * k, 280 * k, concrete);
    for (let i = 0; i < 8; i++) {
      const b = 280 + i * 11;
      part(out, circle(c, (1.6 - i * 0.1) * k, 10), b * k, (b + 11) * k, i % 2 ? '#f1efe9' : '#c6402f');
    }
  },

  // The Palast der Republik: bronze mirrored glass between white stone ends.
  palast(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 32;
    const { hl, hw } = box;
    const white = '#ecebe5';
    part(out, rectIn(box, -hl, hl, -hw, hw), 0, 4, white);
    part(out, rectIn(box, -hl + 14, hl - 14, -hw, hw), 4, H - 3, '#8a6b3f');
    for (const s of [-hl, hl - 14]) part(out, rectIn(box, s, s + 14, -hw, hw), 4, H - 3, white);
    part(out, rectIn(box, -hl, hl, -hw, hw), H - 3, H, white);
    part(out, rectIn(box, -hl + 1, hl - 1, -hw + 1, hw - 1), H, H + 0.6, '#cfccc4');
  },

  // Checkpoint Charlie: the Allied guard hut in the middle of Friedrichstrasse,
  // the sign facing the border, a flagpole.
  checkpoint(shape, m, out) {
    const c = shape.centre;
    const a = ((m.angle ?? 0) * Math.PI) / 180;
    const box = { c, u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)] };
    part(out, rectIn(box, -2, 2, -1.4, 1.4), 0, 2.6, '#f2f0ea');
    part(out, rectIn(box, -2.3, 2.3, -1.7, 1.7), 2.6, 2.9, '#c9c6bd');
    for (const s of [-2.6, 2.6]) part(out, rectIn(box, s - 0.1, s + 0.1, 5.9, 6.1), 0, 4, '#6b6e70');
    part(out, rectIn(box, -3, 3, 5.95, 6.05), 4, 6.2, '#f6f4ee');
    part(out, circle(at(box, 3.2, -2.2), 0.12, 6), 0, 8, '#9a9a96');
    part(out, rectIn({ c: at(box, 3.2, -2.2), u: box.v, v: box.u }, 0, 1.6, -0.03, 0.03), 7, 8, '#b5452f');
  },

  // A domed church on its own outline: the Berliner Dom, with a central dome
  // on a drum and four corner towers; with "towers": false, a church under
  // one dome (St Hedwig's) or a domed tower (the Gendarmenmarkt towers).
  cathedral(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 98;
    const stone = m.colour ?? '#cfc3a8';
    const copper = '#6f8f7c';
    const base = H * (m.drum ?? 0.33);
    for (const poly of shape.polys) part(out, poly, 0, base, stone);
    const R = Math.min(box.hw, box.hl) * (m.towers === false ? 0.85 : 0.42);
    part(out, circle(box.c, R, 32), base, H * 0.6, stone);
    dome(out, box.c, R, H * 0.6, H * 0.27, copper, 7);
    part(out, circle(box.c, R * 0.16, 12), H * 0.87, H * 0.96, stone);
    part(out, circle(box.c, R * 0.07, 8), H * 0.96, H, '#c9a94a');
    if (m.towers === false) return;
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) {
        const c = at(box, s * (box.hl - 7), t * (box.hw - 7));
        part(out, rectIn({ c, u: box.u, v: box.v }, -6, 6, -6, 6), base, H * 0.55, stone);
        dome(out, c, 5.5, H * 0.55, H * 0.1, copper, 4);
      }
    }
  },

  // A wooden memorial cross.
  cross(shape, m, out) {
    const box = { c: shape.centre, u: [1, 0], v: [0, 1] };
    part(out, rectIn(box, -0.13, 0.13, -0.13, 0.13), 0, m.h ?? 3.2, C.wood);
    part(out, rectIn(box, -0.9, 0.9, -0.12, 0.12), 2.2, 2.45, C.wood);
  },

  // The Soviet War Memorial in the Tiergarten: a curved colonnade, a soldier
  // on a tall pillar at its centre, and two tanks on plinths in front.
  'soviet-memorial'(shape, m, out) {
    const c = shape.centre;
    const f = bearingVec(m.facing ?? 0);
    const phi = Math.atan2(f[1], f[0]);
    const arc = circle(c, 24, 16, phi + Math.PI * 0.6, phi + Math.PI * 1.4);
    const stone = '#b7ab98';
    for (const q of alongPath(arc, 5.5, 2.2, 2.2)) part(out, q, 0, 7, stone);
    for (const q of strips(arc, 2.6)) part(out, q, 7, 8.2, stone);
    const back = [c[0] - f[0] * 24, c[1] - f[1] * 24];
    const box = { c: back, u: f, v: [-f[1], f[0]] };
    part(out, rectIn(box, -1.6, 1.6, -1.6, 1.6), 0, 13, '#a89c88');
    part(out, circle(back, 1.1, 10), 13, 21, '#5b5a4c');
    for (const t of [-14, 14]) {
      const tb = { c: [c[0] + f[0] * 26 + f[1] * t, c[1] + f[1] * 26 - f[0] * t], u: f, v: [-f[1], f[0]] };
      part(out, rectIn(tb, -3.5, 3.5, -2, 2), 0, 3, stone);
      part(out, rectIn(tb, -3.2, 3.2, -1.6, 1.6), 3, 5, '#4c5a40');
      part(out, rectIn(tb, -1.4, 1.2, -1.1, 1.1), 5, 6.1, '#4c5a40');
      part(out, rectIn(tb, 1.2, 5, -0.15, 0.15), 5.4, 5.7, '#4c5a40');
    }
  },
  // ---------- Moscow ----------
  // The Kremlin wall: brick, with swallowtail merlons along the top.
  'kremlin-wall'(shape, m, out) {
    const H = m.h ?? 12;
    const colour = m.colour ?? MOSCOW.brick;
    for (const line of shape.lines) {
      for (const q of strips(line, m.w ?? 4.5)) part(out, q, 0, H, colour);
      for (const q of alongPath(line, 3, 1.6, m.w ?? 4.5)) part(out, q, H, H + 2.2, colour);
    }
  },

  // A Kremlin tower: a square brick shaft, a narrower stage, an open white
  // octagon and a tall green tented roof. The five gate towers have carried
  // ruby stars since 1937. "low": a short tower with the tent straight on the shaft.
  'kremlin-tower'(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 40;
    const brick = m.colour ?? MOSCOW.brick;
    const s = Math.min(box.hl, box.hw);
    const c = box.c;
    const shaft = m.low ? 0.55 : 0.42;
    part(out, rectIn(box, -box.hl, box.hl, -box.hw, box.hw), 0, H * shaft, brick);
    part(out, rectIn(box, -box.hl - 0.5, box.hl + 0.5, -box.hw - 0.5, box.hw + 0.5), H * shaft, H * shaft + 1.2, brick);
    let t0 = H * shaft + 1.2;
    let r0 = s * 1.05;
    if (!m.low) {
      part(out, rectIn(box, -s * 0.72, s * 0.72, -s * 0.72, s * 0.72), t0, H * 0.56, brick);
      part(out, circle(c, s * 0.6, 8, Math.PI / 8), H * 0.56, H * 0.64, MOSCOW.trim);
      t0 = H * 0.64;
      r0 = s * 0.62;
    }
    const top = m.star ? H - 4.5 : H - 1;
    tent(out, c, r0, t0, top, m.roof ?? MOSCOW.tent);
    part(out, circle(c, 0.25, 6), top, H - (m.star ? 3.6 : 0), MOSCOW.gold);
    if (m.star) starBead(out, c, H - 3.6, 3.6, MOSCOW.ruby);
  },

  // An Orthodox cathedral: a whitewashed cube, a central drum and onion
  // dome, and four (or eight) smaller domes round it. "colours" sets the
  // side domes, "dome" the central one.
  'onion-church'(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 40;
    const wall = m.colour ?? C.whitewash;
    const { hl, hw } = box;
    const wallH = m.wallH ?? H * 0.42;
    part(out, rectIn(box, -hl, hl, -hw, hw), 0, wallH, wall);
    part(out, rectIn(box, -hl + 0.4, hl - 0.4, -hw + 0.4, hw - 0.4), wallH, wallH + 1.2, m.roof ?? MOSCOW.metal);
    if (m.apses !== false) {
      // Apses on the east end.
      for (const t of [-hw * 0.55, 0, hw * 0.55]) part(out, circle(at(box, -hl, t), hw * 0.22, 12), 0, wallH * 0.8, wall);
    }
    const n = m.domes ?? 5;
    const R = Math.min(hl, hw) * (n === 1 ? 0.4 : 0.22);
    const b = wallH + 1.2;
    const gold = m.dome ?? MOSCOW.gold;
    const side = m.colours ?? [gold];
    onionDome(out, at(box, m.offset ?? 0, 0), R, b, H - b, gold, wall);
    const spots = n >= 5 ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [];
    if (n >= 9) spots.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    spots.forEach(([i, j], k) => onionDome(out, at(box, i * hl * 0.52, j * hw * 0.52), R * 0.78, b, (H - b) * 0.72, side[k % side.length], wall));
  },

  // The Ivan the Great Bell Tower: whitewashed octagons in three tiers of
  // open belfries, a drum and a gilded dome, 81 m high.
  'bell-tower'(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 81;
    const c = box.c;
    const R = Math.min(box.hl, box.hw);
    const wall = m.colour ?? C.whitewash;
    [[1, 0, 0.3], [0.86, 0.3, 0.48], [0.72, 0.48, 0.62], [0.58, 0.62, 0.72]].forEach(([k, b, h]) => {
      part(out, circle(c, R * k, 8, Math.PI / 8), H * b, H * h - 0.8, wall);
      part(out, circle(c, R * k + 0.4, 8, Math.PI / 8), H * h - 0.8, H * h, MOSCOW.trim);
    });
    onionDome(out, c, R * 0.42, H * 0.72, H * 0.28, m.dome ?? MOSCOW.gold, wall);
  },

  // St Basil's Cathedral: a central tented church ringed by eight chapels,
  // each under its own patterned onion dome, on a brick gallery.
  'st-basil'(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 47;
    const c = box.c;
    const R = Math.min(box.hl, box.hw);
    const brick = m.colour ?? '#b0503a';
    part(out, circle(c, R * 0.92, 16), 0, 7, brick);
    const domes = ['#3f8a5a', '#d8b23a', '#b63a2e', '#3b6aa0', '#e3a033', '#4f8f4f', '#c4483c', '#2f7fb0'];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const big = i % 2 === 0;
      const q = [c[0] + R * (big ? 0.6 : 0.62) * Math.cos(a), c[1] + R * (big ? 0.6 : 0.62) * Math.sin(a)];
      const r = R * (big ? 0.2 : 0.14);
      const top = H * (big ? 0.72 : 0.56);
      part(out, circle(q, r, 8, Math.PI / 8), 7, top * 0.55, brick);
      onionDome(out, q, r * 0.9, top * 0.55, top * 0.45, domes[i], MOSCOW.trim);
    }
    part(out, circle(c, R * 0.26, 8, Math.PI / 8), 7, H * 0.5, brick);
    part(out, circle(c, R * 0.22, 8, Math.PI / 8), H * 0.5, H * 0.56, MOSCOW.trim);
    tent(out, c, R * 0.22, H * 0.56, H * 0.88, '#d9c27a');
    onionDome(out, c, R * 0.07, H * 0.88, H * 0.12, MOSCOW.gold, MOSCOW.gold);
  },

  // Lenin's Mausoleum: stepped red and black granite with a colonnaded
  // pavilion on top. Soviet leaders reviewed parades from its tribune.
  'lenin-mausoleum'(shape, m, out) {
    const box = obb(shape.points);
    const H = m.h ?? 12;
    const { hl, hw } = box;
    const red = '#7a2e2a';
    const dark = '#2e2a2c';
    [[1, 1, 0, 0.38, red], [0.86, 0.8, 0.38, 0.5, dark], [0.72, 0.64, 0.5, 0.62, red], [0.58, 0.5, 0.62, 0.72, dark], [0.46, 0.4, 0.72, 0.8, red]]
      .forEach(([a, b, h0, h1, col]) => part(out, rectIn(box, -hl * a, hl * a, -hw * b, hw * b), H * h0, H * h1, col));
    const top = rectIn(box, -hl * 0.36, hl * 0.36, -hw * 0.3, hw * 0.3);
    for (const q of alongPath(top, 2.2, 0.6, 0.6, { closed: true })) part(out, q, H * 0.8, H * 0.94, red);
    part(out, rectIn(box, -hl * 0.38, hl * 0.38, -hw * 0.32, hw * 0.32), H * 0.94, H, red);
  },

  // A Stalin skyscraper (the Seven Sisters, 1947-57): wings stepping up to a
  // central tower in setbacks, an octagonal lantern and a spire with a star.
  // h is the height to the tip of the star; "spire" its share of that.
  'stalin-tower'(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 170;
    const stone = m.colour ?? '#ddd2bd';
    const trim = '#c9bba0';
    const { hl, hw } = box;
    const body = H * (1 - (m.spire ?? 0.2));
    const wing = body * (m.wings ?? 0.32);
    const s = m.core ?? Math.min(hl, hw);
    part(out, rectIn(box, -hl, hl, -hw * 0.45, hw * 0.45), 0, wing * 0.72, stone);
    part(out, rectIn(box, -hl * 0.55, hl * 0.55, -hw, hw), 0, wing, stone);
    if (m.turrets) {
      // Corner towers at the ends of the wings, each with its own small spire.
      for (const sg of [-1, 1]) {
        const q = at(box, sg * hl * 0.86, 0);
        const tb = { c: q, u: box.u, v: box.v };
        const r = hw * 0.32;
        part(out, rectIn(tb, -r, r, -r, r), 0, wing * 1.15, stone);
        part(out, circle(q, r * 0.55, 8, Math.PI / 8), wing * 1.15, wing * 1.3, trim);
        tent(out, q, r * 0.4, wing * 1.3, wing * 1.6, MOSCOW.spire);
      }
    }
    const tiers = [[0.62, wing, 0.66], [0.5, 0.66, 0.8], [0.4, 0.8, 0.9], [0.3, 0.9, 0.97]];
    tiers.forEach(([k, b, h], i) => {
      const lo = i === 0 ? b : body * b;
      part(out, rectIn(box, -s * k, s * k, -s * k, s * k), lo, body * h - 1, stone);
      part(out, rectIn(box, -s * k - 0.6, s * k + 0.6, -s * k - 0.6, s * k + 0.6), body * h - 1, body * h, trim);
    });
    part(out, circle(box.c, s * 0.22, 8, Math.PI / 8), body * 0.97, body, stone);
    tent(out, box.c, s * 0.16, body, H - 7, MOSCOW.spire, 9);
    starBead(out, box.c, H - 7, 7, MOSCOW.gold);
  },

  // The House of Soviets of the RSFSR (1981), the White House: a broad
  // podium, a long white slab and a central tower under a clock.
  'white-house'(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const H = m.h ?? 102;
    const white = m.colour ?? '#f1f0ea';
    const { hl, hw } = box;
    part(out, rectIn(box, -hl, hl, -hw, hw), 0, H * 0.1, '#e2dfd5');
    part(out, rectIn(box, -hl * 0.9, hl * 0.9, -hw * 0.28, hw * 0.28), H * 0.1, H * 0.42, white);
    part(out, rectIn(box, -hl * 0.3, hl * 0.3, -hw * 0.26, hw * 0.26), H * 0.42, H * 0.84, white);
    part(out, rectIn(box, -hl * 0.2, hl * 0.2, -hw * 0.17, hw * 0.17), H * 0.84, H * 0.95, white);
    part(out, rectIn(box, -hl * 0.12, hl * 0.12, -hw * 0.12, hw * 0.12), H * 0.95, H * 0.97, '#c9a64a');
    part(out, circle(box.c, 0.3, 6), H * 0.97, H + 10, '#cfcfcf');
    if (m.flag) part(out, rectIn({ c: at(box, 0, 2.4), u: box.u, v: box.v }, -0.15, 0.15, -2, 2), H + 6.5, H + 10, m.flag);
  },

  // A tank, as in Moscow in August 1991: hull, turret and gun, pointing
  // along "facing" (compass degrees).
  'soviet-tank'(shape, m, out) {
    const f = bearingVec(m.facing ?? 0);
    const box = { c: shape.centre, u: f, v: [-f[1], f[0]] };
    const green = m.colour ?? '#4b5232';
    part(out, rectIn(box, -3.5, 3.5, -1.8, 1.8), 0.3, 1.8, green);
    part(out, circle(at(box, -0.4, 0), 1.35, 10), 1.8, 2.6, green);
    part(out, rectIn(box, 0.8, 5.6, -0.12, 0.12), 2.1, 2.35, '#3a3f28');
  },

  // A statue on a tall pedestal (Iron Felix on Lubyanka Square).
  'pedestal-statue'(shape, m, out) {
    const c = shape.centre;
    const H = m.h ?? 15;
    const base = m.pedestal ?? H * 0.4;
    part(out, circle(c, 3.2, 8, Math.PI / 8), 0, 0.8, '#5d5752');
    part(out, circle(c, 2.4, 8, Math.PI / 8), 0.8, base, '#6a625b');
    if (m.empty) return;
    part(out, circle(c, 1.1, 10), base, H - 1.4, m.colour ?? '#3e3d38');
    part(out, circle(c, 0.5, 8), H - 1.4, H, m.colour ?? '#3e3d38');
  },

  // A shopping arcade (GUM): three storeys round the block, with glass
  // roofs over the passages that run its length.
  'arcade-store'(shape, m, out) {
    const H = m.h ?? 18;
    const wall = m.colour ?? '#e2d8c6';
    for (const poly of shape.polys) part(out, poly, 0, H, wall);
    const box = obb(shape.main[0]);
    const n = m.passages ?? 3;
    const w = (box.hw * 2) / n;
    for (let i = 0; i < n; i++) {
      const t = -box.hw + (i + 0.5) * w;
      gable(out, { c: at(box, 0, t), u: box.u, v: box.v }, -box.hl * 0.94, box.hl * 0.94, w * 0.2, H, 3.5, '#a9bcc0', 4);
    }
    if (m.towers) for (const sg of [-1, 1]) for (const tt of [-1, 1]) tent(out, at(box, sg * box.hl * 0.98, tt * box.hw * 0.2), 2.5, H, H + 9, MOSCOW.metal);
  },

  // Any building by its own outline (courtyards and all): walls of one colour
  // under a flat or low roof. For the big blocks of the Soviet centre.
  extrude(shape, m, out, ctx) {
    const H = ctx.p.heightM ?? m.h ?? 20;
    const wall = m.colour ?? ctx.S.wall;
    const roof = m.roof ?? ctx.S.roof;
    for (const poly of shape.polys) {
      if (Math.abs(area(poly[0])) < 20) continue;
      part(out, poly, 0, H - 0.8, wall);
      part(out, poly, H - 0.8, H, roof);
    }
    if (m.dome) onionDome(out, shape.centre, m.dome, H, m.dome * 2.6, m.domeColour ?? MOSCOW.tent, wall);
  },

  // A drum and green dome with a flagpole on top: the Kremlin Senate, where
  // the red flag flew until 25 December 1991. "flagOnly" draws just the pole
  // and flag, so the flag can change with the date; "flag" is a colour or
  // a list of stripes from the top.
  'flag-dome'(shape, m, out) {
    const c = shape.centre;
    const R = m.r ?? 12;
    const H = m.h ?? 34;
    if (!m.flagOnly) {
      part(out, circle(c, R, 24), 0, H * 0.62, '#e5cd87');
      dome(out, c, R * 0.95, H * 0.62, R * 0.8, MOSCOW.tent, 6);
      return;
    }
    const top = H * 0.62 + R * 0.8;
    part(out, circle(c, 0.25, 6), top, top + 12, '#d8d4c8');
    const stripes = Array.isArray(m.flag) ? m.flag : [m.flag ?? MOSCOW.ruby];
    const fb = { c, u: [1, 0], v: [0, 1] };
    const fh = 3;
    stripes.forEach((col, i) => part(out, rectIn(fb, 0.3, 6.3, -0.12, 0.12), top + 11.6 - ((i + 1) * fh) / stripes.length, top + 11.6 - (i * fh) / stripes.length, col));
  },

  // An open-air pool in a round basin (the Moskva Pool, 1960-94).
  'open-pool'(shape, m, out) {
    const c = shape.centre;
    const R = shape.radius;
    part(out, [circle(c, R, 48), circle(c, R * 0.9, 48).reverse()], 0, 1.2, C.stone);
    flat(out, circle(c, R * 0.9, 48), '#6fb2cf');
    part(out, rectIn({ c: [c[0], c[1] - R * 1.05], u: [1, 0], v: [0, 1] }, -R * 0.5, R * 0.5, -6, 6), 0, 7, C.whitewash);
  },
};

// The Shams-ol-Emareh, Golestan's "edifice of the sun" (1867): a five-storey
// pavilion rising from the palace range, two small towers on top.
function shams(out, ring, H) {
  const box = obb(ring);
  const { hl, hw } = box;
  const wall = '#efe2c4';
  const tile = '#5b9aa8';
  part(out, ring, 0, H * 0.32, wall);
  part(out, rectIn(box, -hl * 0.32, hl * 0.32, -hw, hw), H * 0.32, H * 0.7, wall);
  part(out, rectIn(box, -hl * 0.32, hl * 0.32, -hw, hw), H * 0.7, H * 0.72, tile);
  part(out, rectIn(box, -hl * 0.24, hl * 0.24, -hw * 0.8, hw * 0.8), H * 0.72, H * 0.86, wall);
  for (const sgn of [-1, 1]) {
    const c = at(box, sgn * hl * 0.14, 0);
    const r = Math.min(hw * 0.4, 3.2);
    part(out, circle(c, r, 8), H * 0.86, H * 0.95, wall);
    for (let k = 0; k < 3; k++) part(out, circle(c, r * (1 - k * 0.3), 8), H * (0.95 + k * 0.017), H * (0.967 + k * 0.017), tile);
  }
}

// Plane trees on a grid, kept where ok(point) allows.
function grove(out, ring, spacing, ok) {
  const box = obb(ring);
  const r = rng(hashString(`${box.c[0].toFixed(1)},${box.c[1].toFixed(1)}`));
  for (let s = -box.hl; s < box.hl; s += spacing) {
    for (let t = -box.hw; t < box.hw; t += spacing) {
      const q = at(box, s + between(r, 0, spacing * 0.6), t + between(r, 0, spacing * 0.6));
      if (r() < 0.3 || !inRing(q, ring) || !ok(q)) continue;
      const h = between(r, 6, 9);
      part(out, circle(q, 0.4, 5), 0, h, C.trunk);
      part(out, circle(q, between(r, 3.5, 5), 9), h, h + between(r, 4, 6), '#6f8f4f');
    }
  }
}

const GRAFFITI = ['#c9b28a', '#9fb3c4', '#c79a8c', '#a9bf9a', '#d8c27a', '#b7a0c0'];

// Points every `step` metres along a path, with the direction there.
function stations(path, step, offset = step / 2) {
  const out = [];
  let carry = offset;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const u = [(bx - ax) / len, (by - ay) / len];
    let d = carry;
    for (; d <= len; d += step) out.push({ c: [ax + u[0] * d, ay + u[1] * d], u, v: [-u[1], u[0]] });
    carry = d - len;
  }
  return out;
}

function isConvexish(ring) {
  return isConvex(ring) || Math.abs(area(ring)) / (obb(ring).hl * obb(ring).hw * 4) > 0.8;
}

// Umbrella pines and cypresses scattered through a garden.
export function trees(out, ring, spacing, r) {
  const box = obb(ring);
  for (let s = -box.hl; s < box.hl; s += spacing) {
    for (let t = -box.hw; t < box.hw; t += spacing) {
      const q = at(box, s + between(r, 0, spacing * 0.8), t + between(r, 0, spacing * 0.8));
      if (!inRing(q, ring) || r() < 0.35) continue;
      tree(out, q, r);
    }
  }
}

export function tree(out, q, r) {
  if (r() < 0.6) {
    const h = between(r, 6, 9);
    part(out, circle(q, 0.35, 5), 0, h, C.trunk);
    part(out, circle(q, between(r, 3.5, 5.5), 9), h, h + between(r, 2.5, 3.5), C.pine);
  } else {
    part(out, circle(q, between(r, 1.1, 1.6), 7), 0, between(r, 10, 15), C.cypress);
  }
}

// A cross (a church) or a crescent (a mosque) on top of a dome.
function finial(out, c, top, kind) {
  if (!kind) return;
  const box = { c, u: [1, 0], v: [0, 1] };
  const gold = '#c9a13b';
  part(out, circle(c, 0.25, 6), top, top + (kind === 'cross' ? 4 : 2.6), gold);
  if (kind === 'cross') part(out, rectIn(box, -1.2, 1.2, -0.2, 0.2), top + 2.4, top + 2.9, gold);
  else part(out, circle(c, 0.9, 10), top + 2.6, top + 3.4, gold);
}

// MapLibre sets each solid on the ground under the average of its points,
// with the terrain exaggerated as in city3d.js. Parts standing on a terrace
// are raised so that they all share its level:
//   "terrace": { "top": 746, "h": 1, "dem": { "sw": [lng, lat], "ne": [lng, lat], "n": [cols, rows], "z": [...] } }
// "top" is the terrace level in metres above sea level, "h" its paving above
// that, and "dem" the ground sampled on a grid from the south-west corner,
// row by row (tools/terrace_dem.py fills it in).
const TERRAIN_EXAGGERATION = 1.3;
function raiseToTerrace(out, t, toXY) {
  if (!t?.dem) return;
  const { sw, ne, n: [nx, ny], z } = t.dem;
  const [x0, y0] = toXY(sw);
  const [x1, y1] = toXY(ne);
  const ground = ([x, y]) => {
    const fx = clamp(((x - x0) / (x1 - x0)) * (nx - 1), 0, nx - 1);
    const fy = clamp(((y - y0) / (y1 - y0)) * (ny - 1), 0, ny - 1);
    const i = Math.min(nx - 2, Math.floor(fx));
    const j = Math.min(ny - 2, Math.floor(fy));
    const a = fx - i;
    const b = fy - j;
    const Z = (ii, jj) => z[jj * nx + ii];
    return Z(i, j) * (1 - a) * (1 - b) + Z(i + 1, j) * a * (1 - b) + Z(i, j + 1) * (1 - a) * b + Z(i + 1, j + 1) * a * b;
  };
  const level = TERRAIN_EXAGGERATION * t.top + (t.h ?? 1);
  for (const q of out.parts) {
    const pts = q.rings.flat();
    const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const lift = level - TERRAIN_EXAGGERATION * ground(c);
    // Parts on the ground keep their footing and grow upwards; raised parts move up.
    if (q.b > 0) q.b = Math.max(0.01, q.b + lift);
    q.h = Math.max(q.b + 0.2, q.h + lift);
  }
}

// ---------- Paris ----------
// Pale limestone under grey slate and lead: mansard roofs, Gothic churches,
// domes, the medieval fortresses the Revolution pulled down, and the bridges
// that still carried houses.
STYLE.paris = { wall: '#e6dbc4', hall: '#ddd0b5', roof: '#676c73', flatRoof: false };
const PARIS = {
  stone: '#e6d9bd', stoneShade: '#cbbd9d', slate: '#676c73', lead: '#8e959a', gold: '#c9a54a',
  walls: ['#ece3cf', '#e4d8bf', '#efe7d6', '#dccfb3', '#e8dcc2'], roofs: ['#6a6f76', '#73777d', '#63686f', '#7b7f85'],
};

// Move each edge of a ring d metres to its left, mitring the corners: inwards
// on an anticlockwise outline, away from the hole on a clockwise courtyard.
export function offsetRing(ring, d) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const n1 = leftNormal(ring[(i + n - 1) % n], ring[i]);
    const n2 = leftNormal(ring[i], ring[(i + 1) % n]);
    const mx = n1[0] + n2[0];
    const my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { out.push([ring[i][0] + n2[0] * d, ring[i][1] + n2[1] * d]); continue; }
    const k = Math.min(d / Math.max((mx * n1[0] + my * n1[1]) / ml, 0.35), d * 2.5);
    out.push([ring[i][0] + (mx / ml) * k, ring[i][1] + (my / ml) * k]);
  }
  return out;
}
function leftNormal(a, b) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
}

// Drop points closer than 0.5 m and turn outlines anticlockwise, holes clockwise.
function tidyRings(rings) {
  return rings.map((ring, i) => {
    const q = ring.filter((p, j) => j === 0 || Math.hypot(p[0] - ring[j - 1][0], p[1] - ring[j - 1][1]) > 0.5);
    return (area(q) > 0) === (i === 0) ? q : q.slice().reverse();
  });
}

// A mansard: a steep slate slope set back in steps from the cornice, then a
// low top. Works on any outline, courtyards included; narrow wings get a
// smaller set-back so the roof never turns inside out.
export function mansard(out, rings, base, c, { rise = 4, inset = 2.6, steps = 3, top = 1.1 } = {}) {
  const tidy = tidyRings(rings);
  const perimeter = tidy.reduce((s, q) => s + pathLength([...q, q[0]]), 0);
  const net = tidy.reduce((s, q) => s + area(q), 0);
  const d = Math.min(inset, (0.6 * net) / perimeter);
  for (let k = 0; k < steps; k++) {
    part(out, tidy.map((q) => offsetRing(q, (d * k) / steps)), base + (rise * k) / steps, base + (rise * (k + 1)) / steps, c);
  }
  part(out, tidy.map((q) => offsetRing(q, d * 1.25)), base + rise, base + rise + top, c);
}

// Half a disc on the far side of a line through c, facing direction f.
const halfDisc = (c, r, f, n = 14) => {
  const a = Math.atan2(f[1], f[0]);
  return circle(c, r, n, a - Math.PI / 2, a + Math.PI / 2);
};

function spire(out, c, r, base, h, colour, n = 6) {
  for (let k = 0; k < n; k++) part(out, circle(c, r * (1 - k / (n + 0.5)), 8), base + (h * k) / n, base + (h * (k + 1)) / n, colour);
}

Object.assign(RECIPES, {
  // A Gothic or classical church: nave and choir under a steep roof, lower
  // aisles, a transept, a rounded east end, and twin or single west towers.
  // Options: towers (0, 1, 2), towerH, towerTop ('flat', 'spire', 'dome'),
  // aisles, transept, apse (false to leave out), crossing (0..1 along the
  // nave, from the east), spire (height above the ridge at the crossing).
  cathedral(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx); // +u points to the west front
    const { hl, hw } = box;
    const H = m.h ?? 30;
    const wall = m.colour ?? PARIS.stone;
    const roof = m.roof ?? PARIS.lead;
    const aisles = m.aisles !== false;
    const nw = aisles ? Math.min(hw * 0.4, 9) : hw * 0.95;
    const aw = aisles ? hw * 0.9 : nw;
    const td = m.towers ? Math.min(hl * 0.2, 16) : 0;
    const apse = m.apse === false ? 0 : Math.min(aw, hl * 0.25);
    const s0 = -hl + apse;
    const s1 = hl - td;
    const east = [-box.u[0], -box.u[1]];
    const rise = Math.min(nw * 1.25, 12);
    if (aisles) {
      part(out, rectIn(box, s0, s1, -aw, aw), 0, H * 0.42, wall);
      part(out, rectIn(box, s0, s1, -aw, aw), H * 0.42, H * 0.47, roof);
      if (apse) {
        part(out, halfDisc(at(box, s0, 0), aw, east), 0, H * 0.42, wall);
        part(out, halfDisc(at(box, s0, 0), aw, east), H * 0.42, H * 0.47, roof);
      }
    }
    part(out, rectIn(box, s0, s1, -nw, nw), 0, H, wall);
    gable(out, box, s0, s1, nw + 0.4, H, rise, roof, 6);
    if (apse) {
      part(out, halfDisc(at(box, s0, 0), nw, east), 0, H, wall);
      for (let k = 0; k < 6; k++) part(out, halfDisc(at(box, s0, 0), (nw + 0.4) * (1 - k / 6), east), H + (rise * k) / 6, H + (rise * (k + 1)) / 6, roof);
    }
    const cs = s0 + (s1 - s0) * (m.crossing ?? 0.4);
    if (m.transept !== false && aisles) {
      const tb = { c: at(box, cs, 0), u: box.v, v: [-box.u[0], -box.u[1]] };
      part(out, rectIn(tb, -hw, hw, -nw, nw), 0, H, wall);
      gable(out, tb, -hw - 0.3, hw + 0.3, nw + 0.4, H, rise, roof, 6);
    }
    if (m.spire) spire(out, at(box, cs, 0), 2.6, H + rise * 0.8, m.spire + rise * 0.2, roof, 8);
    if (!m.towers) return;
    const TH = m.towerH ?? H * 2;
    const fh = Math.min(TH * 0.66, H * 1.45);
    part(out, rectIn(box, s1, hl, -aw, aw), 0, fh, wall);
    const towers = m.towers === 2 ? [[-aw, -aw * 0.36], [aw * 0.36, aw]] : [[-aw * 0.38, aw * 0.38]];
    for (const [t0, t1] of towers) {
      part(out, rectIn(box, s1 + 0.6, hl - 0.6, t0 + 0.6, t1 - 0.6), fh, TH, wall);
      const c = at(box, (s1 + hl) / 2, (t0 + t1) / 2);
      const r = Math.min(hl - s1, t1 - t0) / 2 - 0.6;
      if (m.towerTop === 'spire') spire(out, c, r * 0.8, TH, TH * 0.5, roof);
      else if (m.towerTop === 'dome') { part(out, circle(c, r * 0.8, 16), TH, TH + 4, wall); dome(out, c, r * 0.8, TH + 4, r * 0.6, roof, 4); }
      else part(out, rectIn(box, s1 + 0.3, hl - 0.3, t0 + 0.3, t1 - 0.3), TH, TH + 0.8, wall);
    }
  },

  // A domed church: a block or Greek cross, an optional columned portico,
  // and a drum ringed with columns under a dome and lantern (the Pantheon,
  // the Invalides, the Val-de-Grace). Options: cross, portico, drumR,
  // drumH, domeRise, lantern, centre (-1..1 along the axis), gold.
  'dome-church'(shape, m, out, ctx) {
    const box = face(obb(shape.points), shape, m, ctx);
    const { hl, hw } = box;
    const H = m.h ?? 24;
    const wall = m.colour ?? PARIS.stone;
    const pd = m.portico ? Math.min(13, hl * 0.16) : 0;
    const L = hl - pd;
    const cs = m.centre != null ? m.centre * hl : (-hl + L) / 2;
    if (m.cross) {
      const arm = hw * 0.46;
      for (const ring of [rectIn(box, -hl, L, -arm, arm), rectIn(box, cs - hw * 0.52, cs + hw * 0.52, -hw, hw)]) {
        part(out, ring, 0, H, wall);
        part(out, ring, H, H + 1.2, PARIS.stoneShade);
        mansard(out, [ring], H + 1.2, PARIS.lead, { rise: 1.6, steps: 1, top: 0.6 });
      }
    } else {
      const ring = rectIn(box, -hl, L, -hw, hw);
      part(out, ring, 0, H, wall);
      mansard(out, [ring], H, PARIS.lead, { rise: 2, steps: 2, top: 0.6 });
    }
    if (pd) {
      const pw = Math.min(hw * 0.5, 22);
      part(out, rectIn(box, L, hl, -pw, pw), 0, 1.6, PARIS.stoneShade);
      for (let j = 0; j < 2; j++) columnsBetween(out, box, hl - 1.2 - j * 4.5, -pw + 1, hl - 1.2 - j * 4.5, pw - 1, j ? 4 : 6 + Math.round(pw / 6), 0.85, 1.6, H * 0.78, wall);
      part(out, rectIn(box, L - 1, hl, -pw, pw), H * 0.78, H * 0.88, wall);
      gable(out, box, L - 1, hl, pw, H * 0.88, Math.min(pw * 0.32, 7), PARIS.stoneShade, 4);
    }
    const c = at(box, cs, 0);
    const R = m.drumR ?? Math.min(hw * 0.32, 16);
    const dh = m.drumH ?? R * 1.3;
    const base = H + 1.2;
    part(out, circle(c, R * 1.18, 32), H, base, PARIS.stoneShade);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      part(out, circle([c[0] + R * 1.1 * Math.cos(a), c[1] + R * 1.1 * Math.sin(a)], Math.max(0.5, R * 0.045), 8), base, base + dh * 0.82, wall);
    }
    part(out, circle(c, R, 32), base, base + dh, wall);
    part(out, circle(c, R * 1.16, 32), base + dh * 0.82, base + dh, PARIS.stoneShade);
    const rise = m.domeRise ?? R;
    dome(out, c, R * 0.98, base + dh, rise, PARIS.lead, 8);
    if (m.gold) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const q = [c[0] + R * 0.6 * Math.cos(a), c[1] + R * 0.6 * Math.sin(a)];
        part(out, circle(q, R * 0.07, 6), base + dh + rise * 0.55, base + dh + rise * 0.8, PARIS.gold);
      }
    }
    const lt = base + dh + rise;
    const lh = m.lantern ?? R * 0.7;
    part(out, circle(c, R * 0.2, 12), lt - 0.5, lt + lh * 0.55, wall);
    spire(out, c, R * 0.16, lt + lh * 0.55, lh * 0.45, m.gold ? PARIS.gold : PARIS.lead, 4);
  },

  // A palace or public building on its real outline, courtyards and all:
  // stone walls, a cornice and a slate mansard.
  chateau(shape, m, out) {
    const H = m.h ?? 16;
    for (const poly of shape.polys) {
      if (Math.abs(area(poly[0])) < 40) continue;
      part(out, poly, 0, H, m.colour ?? PARIS.stone);
      part(out, poly, H, H + 0.7, PARIS.stoneShade);
      mansard(out, poly, H + 0.7, m.roof ?? PARIS.slate, { rise: m.roofH ?? 4.5, inset: 3 });
    }
  },

  // A medieval fortress: curtain walls round a court, round towers at the
  // corners and along the sides, a wet ditch (the Bastille, the Chatelet).
  // "keep": a square donjon with corner turrets instead (the Temple tower).
  // "ruined": broken down to stumps, as the Bastille was through 1789-90.
  fortress(shape, m, out, ctx) {
    const box = obb(shape.points);
    const { hl, hw } = box;
    const H = m.h ?? 24;
    const r = ctx.r;
    const wall = m.colour ?? '#cbbf9f';
    const cut = (h) => (m.ruined ? h * between(r, 0.15, 0.55) : h);
    if (m.keep) {
      const s = Math.min(hl, hw) * 0.62;
      part(out, rectIn(box, -s, s, -s, s), 0, H, wall);
      for (let k = 0; k < 5; k++) {
        const q = s * (1 - k / 5.5);
        part(out, rectIn(box, -q, q, -q, q), H + k * 2.4, H + (k + 1) * 2.4, PARIS.slate);
      }
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const c = at(box, sx * s, sy * s);
        part(out, circle(c, s * 0.32, 12), 0, H + 2, wall);
        spire(out, c, s * 0.36, H + 2, 7, PARIS.slate, 4);
      }
      return;
    }
    if (m.ditch !== false && !m.ruined) {
      flat(out, [rectIn(box, -hl - 11, hl + 11, -hw - 11, hw + 11), rectIn(box, -hl - 2, hl + 2, -hw - 2, hw + 2).reverse()], C.water);
    }
    const tr = Math.min(hw * 0.32, 7);
    const ring = rectIn(box, -hl + tr * 0.6, hl - tr * 0.6, -hw + tr * 0.6, hw - tr * 0.6);
    const inner = rectIn(box, -hl + tr * 1.6, hl - tr * 1.6, -hw + tr * 1.6, hw - tr * 1.6);
    if (m.ruined) {
      for (const q of alongPath(ring, 9, 8.5, tr, { closed: true })) part(out, q, 0, cut(H), wall);
      ruinedHeaps(out, box, r);
    } else {
      part(out, [ring, inner.slice().reverse()], 0, H, wall);
      flat(out, inner, C.paving);
    }
    const n = m.towers ?? 4; // towers per long side, corners included
    const spots = [];
    for (let i = 0; i < n; i++) for (const t of [-1, 1]) spots.push([-hl + tr + ((2 * hl - 2 * tr) * i) / (n - 1), t * (hw - tr)]);
    for (const [s, t] of spots) {
      const c = at(box, s, t);
      const th = cut(H + 1.5);
      part(out, circle(c, tr, 14), 0, th, wall);
      if (!m.ruined && m.roofs) spire(out, c, tr * 1.05, th, tr * 1.6, PARIS.slate, 4);
      else if (!m.ruined) part(out, circle(c, tr * 0.8, 14), th, th + 1.2, wall);
    }
  },

  // A round building: the grain hall's ring of vaults round a domed court,
  // or one of Ledoux's toll houses (a square base under a drum).
  rotunda(shape, m, out) {
    const c = shape.centre;
    const R = m.r ?? shape.radius;
    const H = m.h ?? 12;
    const wall = m.colour ?? PARIS.stone;
    if (m.ledoux) {
      const box = obb(shape.points);
      const s = Math.min(box.hl, box.hw) * 0.82;
      part(out, rectIn(box, -s, s, -s, s), 0, H * 0.5, wall);
      part(out, circle(box.c, s * 0.78, 28), H * 0.5, H, wall);
      part(out, circle(box.c, s * 0.82, 28), H, H + 0.8, PARIS.stoneShade);
      mansard(out, [circle(box.c, s * 0.7, 28)], H + 0.8, PARIS.lead, { rise: 1.4, steps: 2, top: 0.4 });
      return;
    }
    const hole = circle(c, R * 0.62, 36).reverse();
    part(out, [circle(c, R, 36), hole], 0, H, wall);
    mansard(out, [circle(c, R, 36), hole], H, PARIS.slate, { rise: 3, inset: 2, steps: 2, top: 0.5 });
    dome(out, c, R * 0.62, H, R * 0.42, m.domeColour ?? '#8b7a62', 7);
  },

  // Houses built on a bridge: tall narrow fronts on both sides of the
  // roadway, overhanging the parapets, as on the Pont Saint-Michel until 1808.
  'bridge-houses'(shape, m, out, ctx) {
    const r = ctx.r;
    const deck = m.deck ?? 7.5;
    const road = (m.road ?? 7) / 2;
    const depth = m.depth ?? 8;
    for (const line of shape.lines) {
      const [a, b] = [line[0], line.at(-1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      const box = { c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u, v: [-u[1], u[0]] };
      const end = len / 2 - (m.endGap ?? 6);
      for (const side of [-1, 1]) {
        for (let s = -end; s < end - 3;) {
          const w = Math.min(between(r, 4.5, 7.5), end - s);
          const h = deck + Math.floor(between(r, 3, 4.99)) * 3;
          const t0 = side * road;
          const t1 = side * (road + depth);
          part(out, rectIn(box, s + 0.2, s + w - 0.2, Math.min(t0, t1), Math.max(t0, t1)), 0, h, PARIS.walls[Math.floor(r() * PARIS.walls.length)]);
          const hb = { c: at(box, s + w / 2, side * (road + depth / 2)), u: box.v, v: [-box.u[0], -box.u[1]] };
          gable(out, hb, -depth / 2 - 0.3, depth / 2 + 0.3, w / 2, h, Math.min(w * 0.6, 4), PARIS.roofs[Math.floor(r() * PARIS.roofs.length)], 4);
          s += w;
        }
      }
    }
  },

  // A house recorded on a period plan (Lagrive's Cite, 1754): its own outline,
  // four to six storeys, a steep slate roof.
  maison(shape, m, out, ctx) {
    const ring = shape.main[0];
    const box = obb(ring);
    const r = ctx.r;
    const H = ctx.p.heightM ?? m.h ?? Math.floor(between(r, 3, 5.99)) * 3.1 + 0.8;
    part(out, ring, 0, H, m.colour ?? PARIS.walls[Math.floor(r() * PARIS.walls.length)]);
    gable(out, box, -box.hl, box.hl, box.hw + 0.2, H, Math.min(box.hw * 1.1, 6), m.roof ?? PARIS.roofs[Math.floor(r() * PARIS.roofs.length)], 4);
  },
});

function ruinedHeaps(out, box, r) {
  for (let i = 0; i < 26; i++) {
    const q = at(box, between(r, -box.hl, box.hl), between(r, -box.hw, box.hw));
    part(out, circle(q, between(r, 2, 5), 7), 0, between(r, 0.6, 2.6), C.rubble);
  }
}

// The set-back top of a mansard over a generated house (houses.js): one slab,
// d metres in from the cornice.
export function mansardTop(out, rings, base, rise, d, c) {
  part(out, tidyRings(rings).map((q) => offsetRing(q, d)), base, base + rise, c);
}

// ---------- Moscow helpers ----------
const MOSCOW = {
  brick: '#a5402d', trim: '#ece6d8', tent: '#4f7a5a', gold: '#d4a93c', ruby: '#c4142b',
  metal: '#6f7d6c', spire: '#cdb46e',
};

// An onion dome on its drum: the bulb swells wider than the drum, then
// draws in to a point under a cross. h runs from the foot of the drum to the cross.
function onionDome(out, c, r, base, h, colour, drum) {
  const dh = h * 0.38;
  part(out, circle(c, r, 12), base, base + dh, drum);
  const bulb = h * 0.5;
  const b = base + dh;
  const profile = [[0, 0.1, 1.05], [0.1, 0.22, 1.25], [0.22, 0.36, 1.32], [0.36, 0.48, 1.24], [0.48, 0.6, 1.02], [0.6, 0.7, 0.76], [0.7, 0.8, 0.5], [0.8, 0.9, 0.28], [0.9, 1, 0.12]];
  for (const [f0, f1, k] of profile) part(out, circle(c, r * k, 14), b + bulb * f0, b + bulb * f1, colour);
  part(out, circle(c, Math.max(0.12, r * 0.06), 6), b + bulb, base + h, MOSCOW.gold);
}

// A tented (pyramid) roof as stacked octagons.
function tent(out, c, r, b, top, colour, layers = 7) {
  for (let k = 0; k < layers; k++) part(out, circle(c, r * (1 - k / layers) + 0.15, 8, Math.PI / 8), b + ((top - b) * k) / layers, b + ((top - b) * (k + 1)) / layers, colour);
}

// A five-pointed star on a spire, built as star-shaped layers that swell and
// narrow, so it reads as a star from above and a jewel from the side.
function starBead(out, c, b, h, colour) {
  const star = (R) => Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? R * 0.42 : R;
    return [c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)];
  });
  [0.35, 0.75, 1, 0.75, 0.35].forEach((k, i) => part(out, star((h / 2) * k), b + (h * i) / 5, b + (h * (i + 1)) / 5, colour));
}
