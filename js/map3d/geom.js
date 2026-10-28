// Small geometry kit for the 3D city: a flat metres frame around the city
// centre, oriented boxes, rings, and seeded randomness so the generated city
// is the same on every visit.

export function createFrame([lat0, lng0]) {
  const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const my = 111_320;
  return {
    toXY: ([lng, lat]) => [(lng - lng0) * mx, (lat - lat0) * my],
    toLngLat: ([x, y]) => [round6(lng0 + x / mx), round6(lat0 + y / my)],
  };
}
const round6 = (v) => Math.round(v * 1e6) / 1e6;

// ---------- Randomness ----------
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export const between = (r, a, b) => a + (b - a) * r();
export function hashString(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------- Rings (arrays of [x, y], open: first point not repeated) ----------
export function area(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2; // positive = anticlockwise
}

export function centroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function open(ring) {
  const r = ring.slice();
  const [a, b] = [r[0], r[r.length - 1]];
  if (r.length > 1 && a[0] === b[0] && a[1] === b[1]) r.pop();
  return r;
}

export function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isConvex(ring) {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const [a, b, c] = [ring[i], ring[(i + 1) % ring.length], ring[(i + 2) % ring.length]];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

export function scaleRing(ring, k, about = centroid(ring)) {
  return ring.map(([x, y]) => [about[0] + (x - about[0]) * k, about[1] + (y - about[1]) * k]);
}

export function distToSegments(p, pts) {
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

// Clip a convex ring to the half-plane on the left of the line through p
// with direction d, i.e. points where cross(d, q - p) >= 0 (Sutherland-Hodgman).
export function clipHalf(ring, p, d) {
  const side = (q) => d[0] * (q[1] - p[1]) - d[1] * (q[0] - p[0]);
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? out : null;
}

// ---------- Oriented boxes ----------
// The smallest rectangle around a shape, as centre c, unit axes u (long) and
// v (short), and half sizes hl, hw. Most Roman buildings are rectangles, so
// this turns a ragged ruin outline into a clean plan to build on.
export function obb(points) {
  const hull = convexHull(points);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const v = [-u[1], u[0]];
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const q of hull) {
      const s = q[0] * u[0] + q[1] * u[1];
      const t = q[0] * v[0] + q[1] * v[1];
      s0 = Math.min(s0, s); s1 = Math.max(s1, s);
      t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    const a2 = (s1 - s0) * (t1 - t0);
    if (!best || a2 < best.area) {
      const sc = (s0 + s1) / 2;
      const tc = (t0 + t1) / 2;
      best = { area: a2, c: [u[0] * sc + v[0] * tc, u[1] * sc + v[1] * tc], u, v, hl: (s1 - s0) / 2, hw: (t1 - t0) / 2 };
    }
  }
  if (best.hw > best.hl) {
    [best.hl, best.hw] = [best.hw, best.hl];
    best.u = [best.v[0], best.v[1]];
    best.v = [-best.u[1], best.u[0]];
  }
  return best;
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// A point in a box's own frame: s along the long axis, t across it.
export const at = (box, s, t) => [box.c[0] + box.u[0] * s + box.v[0] * t, box.c[1] + box.u[1] * s + box.v[1] * t];

// Rectangle in a box's frame from s0..s1 along, t0..t1 across.
export const rectIn = (box, s0, s1, t0, t1) => [at(box, s0, t0), at(box, s1, t0), at(box, s1, t1), at(box, s0, t1)];

export function circle([cx, cy], r, n = 24, a0 = 0, a1 = Math.PI * 2) {
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-9;
  const count = full ? n : n + 1;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export function ellipse([cx, cy], rx, ry, u = [1, 0], n = 64) {
  const v = [-u[1], u[0]];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = rx * Math.cos(a);
    const t = ry * Math.sin(a);
    pts.push([cx + u[0] * s + v[0] * t, cy + u[1] * s + v[1] * t]);
  }
  return pts;
}

// Small rectangles of size along x depth, spaced every `step` metres along a
// path, each turned to follow it: piers of an arcade, towers on a wall.
export function alongPath(path, step, along, depth, { closed = false, offset = step / 2 } = {}) {
  const pts = closed ? [...path, path[0]] : path;
  const out = [];
  let carry = offset;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const u = [(bx - ax) / len, (by - ay) / len];
    const v = [-u[1], u[0]];
    let d = carry;
    while (d <= len) {
      const c = [ax + u[0] * d, ay + u[1] * d];
      const box = { c, u, v };
      out.push(rectIn(box, -along / 2, along / 2, -depth / 2, depth / 2));
      d += step;
    }
    carry = d - len;
  }
  return out;
}

// A strip of the given width along a path, one quad per segment.
export function strips(path, width) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) continue;
    const n = [(-(by - ay) / len) * (width / 2), ((bx - ax) / len) * (width / 2)];
    out.push([[ax + n[0], ay + n[1]], [bx + n[0], by + n[1]], [bx - n[0], by - n[1]], [ax - n[0], ay - n[1]]]);
  }
  return out;
}

export function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

// Compass bearing (0 = north, 90 = east) to a unit vector in the metres frame.
export const bearingVec = (deg) => [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
