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
};

const DEFAULT_MODEL = {
  temple: 'temple', building: 'hall', palace: 'palace', market: 'market', arena: 'amphitheatre',
  baths: 'baths', fort: 'fort', tomb: 'drum-tomb', plaza: 'plaza', precinct: 'plaza',
  wall: 'wall', aqueduct: 'aqueduct', bridge: 'bridge', garden: 'garden',
};

// ctx: { toXY, plazas: [[x, y]] centres of open squares, for temples to face }
export function buildModel(feature, ctx) {
  const p = feature.properties;
  const m = { ...(p.model ?? {}) };
  m.type ??= DEFAULT_MODEL[p.kind];
  if (m.type === 'temple' && feature.geometry.type === 'Point') m.type = 'tholos';
  const recipe = RECIPES[m.type];
  if (!recipe) return null;
  const shape = readShape(feature, ctx);
  if (!shape) return null;
  const out = { parts: [], flats: [] };
  const r = rng(hashString(p.id ?? p.name ?? m.type));
  recipe(shape, m, out, { ...ctx, r, p });
  return out;
}

// Footprint in metres: polygons (outer + holes), all outer points, and for
// point features a centre and radius.
function readShape(feature, { toXY }) {
  const g = feature.geometry;
  const p = feature.properties;
  if (g.type === 'Point') {
    const c = toXY(g.coordinates);
    const rad = p.radiusM ?? Math.max(...(p.ellipse ?? [40]).slice(0, 2));
    return { centre: c, radius: rad, polys: [[circle(c, rad, 32)]], points: circle(c, rad, 32) };
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
const part = (out, rings, b, h, c) => { if (h > b) out.parts.push({ rings: Array.isArray(rings[0][0]) ? rings : [rings], b, h, c }); };
const flat = (out, rings, c) => out.flats.push({ rings: Array.isArray(rings[0][0]) ? rings : [rings], c });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A pitched roof as stacked slabs, each narrower than the last, ridge along u.
function gable(out, box, s0, s1, halfW, base, rise, c, layers = 5) {
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
    part(out, rectIn(box, -box.hl, box.hl, -box.hw, box.hw), 0, H * 0.78, C.brick);
    gable(out, box, -box.hl - 0.3, box.hl + 0.3, box.hw + 0.4, H * 0.78, H * 0.22, C.roof, 4);
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

  palace(shape, m, out) {
    const H = m.h ?? 20;
    for (const poly of shape.polys) {
      const ring = poly[0];
      if (Math.abs(area(ring)) < 30) continue;
      const hole = Math.abs(area(ring)) > 1500 && isConvexish(ring) ? scaleRing(ring, 0.5) : null;
      const rings = hole ? [ring, hole.reverse()] : [ring];
      part(out, rings, 0, H * 0.8, C.stucco);
      part(out, rings, H * 0.8, H * 0.8 + 1, C.roof);
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
    const colour = (ctx.p.t0 ?? 0) > 100 ? C.brick : C.tufa;
    for (const line of shape.lines) {
      for (const q of strips(line, m.w ?? 4)) part(out, q, 0, H, colour);
      if (m.towers) for (const q of alongPath(line, m.towers, 7.5, 7.5)) part(out, q, 0, H + 4.5, colour);
    }
  },

  aqueduct(shape, m, out) {
    const H = m.h ?? 20;
    for (const line of shape.lines) {
      for (const q of alongPath(line, 6.5, 2.6, 2.8)) part(out, q, 0, H - 2.5, C.tufa);
      for (const q of strips(line, 2.8)) part(out, q, H - 2.5, H, C.tufa);
    }
  },

  bridge(shape, m, out, ctx) {
    const w = ctx.p.widthM ?? 8;
    for (const line of shape.lines) {
      for (const q of strips(line, w)) part(out, q, 5.5, 7.5, C.stone);
      for (const q of alongPath(line, 22, 5, w + 1)) part(out, q, 0, 5.5, C.stone);
    }
  },
};

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
