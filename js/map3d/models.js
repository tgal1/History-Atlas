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
  isConvex, bearingVec, pathLength, rng, between, hashString, inRing,
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
  tehran: { wall: '#d2b98f', hall: '#cdbf9f', roof: '#a9a398', flatRoof: true },
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
