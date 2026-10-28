// Generates the ordinary city between the landmarks. Each "houses" area with
// a "fabric" is cut into street blocks, either by recursive splits (wide
// streets first, alleys last, each cut slightly off-square, as in Rome) or on
// a regular grid (Roman Carthage, Tenochtitlan). Each block then becomes one
// of the house types of the city's style:
//
//   roman   insula (apartment block), taberna (shops), domus (town house)
//   punic   courtyard houses, tall houses near the citadel, workshops
//   mexica  calli (family compound round a patio), noble houses, reed huts
//   tehran  courtyard houses, flats, shops, office blocks; the domed bazaar
//
// plus gardens. Other fabrics: "chinampa" (raised fields between canals,
// lined with willows), "garden" (orchards and villas), "rubble" (a razed
// city), and "town" points (villages round a lake).
//
// Houses vanish when a dated landmark is built over them (the Colosseum over
// Nero's lake, Trajan's Forum over a hillside quarter).

import {
  rng, between, hashString, area, centroid, open, isConvex, inRing, clipHalf, obb, at, rectIn,
  scaleRing, distToSegments, circle,
} from './geom.js';
import { C, tree, trees, gable, part } from './models.js';
import { kindInfo } from '../map/cityLayer.js';

const CLIPPING_URL = 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';

const KEEP_CLEAR_AREAS = new Set(['plaza', 'precinct', 'ruins', 'palace', 'temple', 'church', 'market', 'building', 'house', 'wharf', 'arena', 'baths', 'fort', 'tomb', 'harbour', 'garden', 'chinampa', 'island', 'shipsheds']);
const KEEP_CLEAR_LINES = { river: 8, road: 1, canal: 2, causeway: 2, wall: 4, aqueduct: 2 };

const SLATE = ['#4f4a45', '#5a534c', '#625a50'];
const SHINGLE = ['#6b5d4f', '#5e5348', '#74675a'];
const ROMAN_ROOFS = ['#a9532f', '#b5603a', '#9e4b2b', '#ba6a43', '#a55a36', '#b2573a'];
const FLAT_ROOFS = ['#ddd3bf', '#d6cbb4', '#e2d9c6', '#d9cfba'];
const WHITE = ['#f0ebe0', '#ece4d4', '#e6dccb', '#f3eee4'];
const TEHRAN_BRICK = ['#c9a878', '#d2b388', '#bf9a6a', '#d8bf96', '#c4a27a'];
const TEHRAN_CONCRETE = ['#d6d0c2', '#c7c1b3', '#bdb8ac', '#cfc6b2', '#b4b0a6'];
const TEHRAN_ROOFS = ['#a7a299', '#b3ada2', '#9d988f', '#c2bba9'];

// House types: plot size (m2), height, colours, roof thickness, and an
// optional open courtyard (a hole in the roof) as a share of the plot.
const TYPES = {
  insula: { area: [450, 1000], h: (r, s) => Math.floor(between(r, s ? 2 : 3, s ? 4.6 : 6)) * 3.1 + 0.6, walls: ['#c99a6b', '#d1a77a', '#b98458', '#d8b48a', '#c4916a', '#bf8a62'], roofs: ROMAN_ROOFS, rt: 1.1, court: { min: 420, k: 0.36, p: 0.75 } },
  taberna: { area: [120, 260], h: (r) => between(r, 4.5, 7.5), walls: ['#cfa577', '#d9b98e', '#c79868', '#d4ae84'], roofs: ROMAN_ROOFS, rt: 1.1 },
  domus: { area: [600, 1300], h: (r) => between(r, 6, 8.5), walls: ['#ebdcc0', '#e5d3b3', '#f0e4cc', '#dfcaa5'], roofs: ROMAN_ROOFS, rt: 1.1, atrium: true },
  'punic-house': { area: [180, 420], h: (r) => Math.floor(between(r, 2, 4.6)) * 3.2 + 0.4, walls: WHITE, roofs: FLAT_ROOFS, rt: 0.5, court: { min: 160, k: 0.38, p: 0.85 } },
  'punic-tall': { area: [200, 450], h: (r) => Math.floor(between(r, 4, 6.9)) * 3.2 + 0.4, walls: WHITE, roofs: FLAT_ROOFS, rt: 0.5, court: { min: 180, k: 0.34, p: 0.6 } },
  workshop: { area: [90, 220], h: (r) => between(r, 3.5, 5.5), walls: ['#d9c3a0', '#cdb497', '#e0cfb0'], roofs: ['#cbb79a', '#d4c3a5'], rt: 0.4 },
  calli: { area: [160, 380], h: (r) => between(r, 3, 3.8), walls: ['#efe9dc', '#e8dfcc', '#ddd0b8', '#cdb497'], roofs: ['#e5dccb', '#d9cdb6', '#cdbb9c'], rt: 0.35, court: { min: 140, k: 0.42, p: 0.85 } },
  noble: { area: [500, 1000], h: (r) => between(r, 5.5, 7), walls: ['#f2eee5', '#ece5d6'], roofs: ['#e7dfcf', '#e0d7c4'], rt: 0.5, court: { min: 300, k: 0.46, p: 1, garden: true } },
  hut: { area: [60, 140], thatch: true },
  // Colonial America: brick Georgian houses, painted clapboard, harbour warehouses, all with pitched roofs.
  georgian: { area: [320, 700], h: (r) => Math.floor(between(r, 2, 3.7)) * 3 + 0.6, walls: ['#a8553d', '#9c4b36', '#b35f45', '#a35a42'], roofs: SLATE, rt: 0.05, pitched: true },
  clapboard: { area: [280, 620], h: (r) => between(r, 5.4, 6.8), walls: ['#e6dfd0', '#d8cdb8', '#c9b89a', '#b9c2c4', '#d9c7a1'], roofs: SHINGLE, rt: 0.05, pitched: true },
  warehouse: { area: [300, 700], h: (r) => Math.floor(between(r, 3, 4.7)) * 3 + 0.6, walls: ['#8f4a35', '#9a5a44', '#7d5a45'], roofs: SLATE, rt: 0.05, pitched: true },
  rubble: { area: [150, 500], rubble: true },
  // Tehran in the 1970s: flat-roofed houses of yellow brick round a garden court, concrete flats and
  // office blocks on the avenues, and the bazaar's lanes under rows of shallow brick domes.
  'tehran-house': { area: [600, 1300], h: (r, s) => Math.floor(between(r, 2, s ? 3.6 : 4.8)) * 3.2 + 0.8, walls: TEHRAN_BRICK, roofs: TEHRAN_ROOFS, rt: 0.5, court: { min: 500, k: 0.42, p: 0.7, garden: true } },
  'tehran-flats': { area: [800, 1500], h: (r) => Math.floor(between(r, 4, 6.9)) * 3.1 + 0.8, walls: TEHRAN_CONCRETE, roofs: TEHRAN_ROOFS, rt: 0.6 },
  'tehran-shops': { area: [450, 900], h: (r) => Math.floor(between(r, 2, 3.9)) * 3.4 + 0.6, walls: [...TEHRAN_BRICK, ...TEHRAN_CONCRETE], roofs: TEHRAN_ROOFS, rt: 0.5 },
  'tehran-office': { area: [1000, 2000], h: (r) => Math.floor(r() < 0.12 ? between(r, 11, 18) : between(r, 4, 9.9)) * 3.4 + 1, walls: TEHRAN_CONCRETE, roofs: ['#8f8c84', '#9a978e', '#a29d92'], rt: 0.8 },
  bazaar: { area: [550, 1100], build: bazaarRow },
};

// Share of each type by setting. A fabric can override with "mix".
const STYLES = {
  roman: {
    centre: { insula: 0.64, taberna: 0.18, domus: 0.12, garden: 0.06 },
    hill: { insula: 0.26, taberna: 0.08, domus: 0.5, garden: 0.16 },
    outer: { insula: 0.32, taberna: 0.18, domus: 0.22, garden: 0.28 },
  },
  punic: {
    centre: { 'punic-house': 0.62, 'punic-tall': 0.12, workshop: 0.18, garden: 0.08 },
    hill: { 'punic-house': 0.35, 'punic-tall': 0.52, workshop: 0.05, garden: 0.08 },
    outer: { 'punic-house': 0.45, workshop: 0.2, garden: 0.35 },
  },
  colonial: {
    centre: { georgian: 0.45, clapboard: 0.35, warehouse: 0.08, garden: 0.12 },
    hill: { clapboard: 0.45, georgian: 0.3, garden: 0.25 },
    outer: { clapboard: 0.5, georgian: 0.15, garden: 0.35 },
  },
  mexica: {
    centre: { calli: 0.74, noble: 0.12, garden: 0.08, hut: 0.06 },
    hill: { calli: 0.74, noble: 0.12, garden: 0.08, hut: 0.06 },
    outer: { calli: 0.55, hut: 0.22, garden: 0.23 },
  },
  tehran: {
    centre: { 'tehran-house': 0.68, 'tehran-flats': 0.14, 'tehran-shops': 0.12, garden: 0.06 },
    hill: { 'tehran-house': 0.6, 'tehran-flats': 0.2, garden: 0.2 },
    outer: { 'tehran-house': 0.7, 'tehran-flats': 0.08, 'tehran-shops': 0.08, garden: 0.14 },
  },
};

export const HOUSE_INFO = {
  insula: 'Insula: an apartment block. Shops at street level, flats above; the higher the floor, the poorer the tenant.',
  taberna: 'Tabernae: one- or two-storey shops and workshops, the family living above or behind.',
  domus: 'Domus: a private town house built round an open atrium and a garden peristyle.',
  'punic-house': 'A Punic courtyard house: rooms round an open court, plastered walls, a flat roof used as a terrace.',
  'punic-tall': 'Near the Byrsa, Appian says, houses rose six storeys; the Romans fought through them roof by roof in 146 BC.',
  workshop: 'Workshops: potters, metalworkers and purple-dye makers worked in low buildings like these.',
  calli: 'Calli: a family compound of whitewashed adobe rooms round a shared patio, with a flat roof.',
  noble: "A noble's house: two storeys on a stone platform, round a garden court.",
  rubble: 'Ruins: the city after its destruction.',
  georgian: 'A Georgian brick house: two or three storeys, sash windows, a slate or shingle roof. The merchant class built these.',
  clapboard: 'A timber-framed house clad in painted clapboard, the commonest home in a colonial town.',
  warehouse: 'A brick warehouse by the waterfront, where cargoes of rum, molasses, cloth and tea were stored.',
  'tehran-house': 'A Tehran family house: two to four storeys of yellow brick or concrete with a flat roof, built round a court with a pool and a tree.',
  'tehran-flats': 'A block of flats. Oil money and migration from the countryside doubled Tehran in the 1960s and 70s, and blocks like this went up fast.',
  'tehran-shops': 'Shops at street level with workshops or flats above.',
  'tehran-office': 'An office block of the oil boom: ministries, banks, airline offices and hotels lined the main avenues.',
  bazaar: 'The Grand Bazaar: lanes of shops under shallow brick domes. Its merchants funded the clergy, and their strikes in 1978 helped bring down the Shah.',
};
export const HOUSE_LABEL = {
  insula: 'Insula (apartment block)', taberna: 'Shops and workshops', domus: 'Domus (town house)',
  'punic-house': 'Courtyard house', 'punic-tall': 'Tall house', workshop: 'Workshops',
  calli: 'Calli (family compound)', noble: "Noble's house", rubble: 'Ruins',
  georgian: 'Georgian brick house', clapboard: 'Clapboard house', warehouse: 'Warehouse',
  'tehran-house': 'Courtyard house', 'tehran-flats': 'Block of flats', 'tehran-shops': 'Shops', 'tehran-office': 'Office block', bazaar: 'Bazaar',
};

export async function generateHouses(city, frame) {
  const clip = (await import(CLIPPING_URL)).default;
  const index = obstacleIndex(city, frame);
  const hills = city.features
    .filter((f) => f.properties.kind === 'hill' && f.geometry.type === 'Point')
    .map((f) => ({ c: frame.toXY(f.geometry.coordinates), r: f.properties.radiusM ?? 200 }));

  const houses = [];
  const extras = { parts: [], flats: [] };
  const dated = (out, life, fn) => {
    const g = { parts: [], flats: [] };
    fn(g);
    for (const q of [...g.parts, ...g.flats]) Object.assign(q, { t0: life[0], t1: life[1] });
    out.parts.push(...g.parts);
    out.flats.push(...g.flats);
  };

  for (const f of city.features) {
    const p = f.properties;
    const isTown = p.kind === 'town' && f.geometry.type === 'Point' && p.radiusM;
    if (!p.fabric && !isTown) continue;
    const fabric = p.fabric ?? {};
    const style = fabric.style ?? city.style3d ?? 'roman';
    const r = rng(hashString(p.id ?? p.name));
    const base = { t0: p.t0, t1: p.t1 };
    const outer = isTown || /outer/.test(p.id ?? '');
    const rings = isTown ? [circle(frame.toXY(f.geometry.coordinates), p.radiusM * 0.8, 20)] : outerRings(f.geometry).map((ll) => open(ll.map(frame.toXY)));

    for (const ring of rings.map(ccw)) {
      // Chinampas and orchards: a water or grass base with strips or plots on it.
      if (p.kind === 'chinampa' || p.kind === 'garden') {
        if (fabric.base) extras.flats.push({ rings: [ring], c: fabric.base, t0: base.t0, t1: base.t1 });
        for (const plot of gridBlocks(ring, fabric)) {
          const life = lifespan(plot, base, index, f);
          if (!life) continue;
          dated(extras, life, (g) => (p.kind === 'chinampa' ? chinampa(g, plot, fabric, r) : orchard(g, plot, r, style)));
          if (p.kind === 'garden' && r() < 0.12) {
            const lot = scaleRing(plot, 0.35);
            houses.push(house(lot, style === 'punic' ? 'punic-house' : 'domus', life, true, r, extras));
          }
        }
        continue;
      }

      const blocks = [];
      if (fabric.layout === 'grid') blocks.push(...gridBlocks(ring, fabric));
      // Real blocks between historic streets (tools/ohm_city.py); very large ones get alleys.
      else if (fabric.layout === 'blocks') {
        if (Math.abs(area(ring)) > 9000) split(ring, 3, r, blocks, clip, BLOCK_SPLIT);
        else blocks.push(ring);
      }
      else split(ring, 0, r, blocks, clip, isTown ? TOWN_SPLIT : BLOCK_SPLIT);

      for (const block of blocks) {
        const c = centroid(block);
        const onHill = hills.some((h) => Math.hypot(c[0] - h.c[0], c[1] - h.c[1]) < h.r * 0.9);
        const mix = fabric.mix ?? STYLES[style][onHill ? 'hill' : outer ? 'outer' : 'centre'];
        const type = p.kind === 'rubble' ? 'rubble' : pick(mix, r);
        if (type === 'garden') {
          const life = lifespan(block, base, index, f);
          if (!life) continue;
          dated(extras, life, (g) => {
            g.flats.push({ rings: [block], c: C.garden });
            trees(g, block, 14, r);
          });
          continue;
        }
        const [a0, a1] = TYPES[type].area;
        const lots = [];
        split(block, 0, r, lots, clip, { min: a0, max: a1, gap: () => 0.6, minArea: 30 });
        for (const lot of lots) {
          const life = lifespan(lot, base, index, f);
          if (!life) continue;
          const h = house(lot, type, life, onHill || outer, r, extras);
          if (h) houses.push(h);
        }
      }
    }
  }
  return { houses, extras };
}

const BLOCK_SPLIT = { min: 2600, max: 6500, gap: (depth) => (depth < 2 ? 9 : depth < 5 ? 6 : 3.5), minArea: 150 };
const TOWN_SPLIT = { min: 1500, max: 3500, gap: (depth) => (depth < 2 ? 7 : 4), minArea: 120 };

function house(lot, type, [t0, t1], suburb, r, extras) {
  const T = TYPES[type];
  if (T.build) return T.build(lot, [t0, t1], r, extras);
  const A = Math.abs(area(lot));
  if (T.rubble) {
    if (r() < 0.35 || !isConvex(lot)) return null;
    return { rings: [lot, scaleRing(lot, 0.82)], h: round1(between(r, 0.5, 2.4)), c: C.rubble, roof: C.rubble, rt: 0.2, type, t0, t1 };
  }
  if (T.thatch) {
    // A reed hut: low adobe walls and a steep thatched roof.
    const box = obb(lot);
    const g = { parts: [], flats: [] };
    const hl = Math.min(box.hl, 6);
    const hw = Math.min(box.hw, 4);
    part(g, rectIn(box, -hl, hl, -hw, hw), 0, 2.4, C.adobe);
    gable(g, box, -hl - 0.4, hl + 0.4, hw + 0.5, 2.4, 2.4, C.thatch, 4);
    g.parts.forEach((q) => Object.assign(q, { t0, t1 }));
    extras.parts.push(...g.parts);
    return null;
  }
  const h = T.h(r, suburb);
  if (T.pitched) {
    // The house stands at one end of its lot, the yard behind it; a steep
    // gable roof across the house, with a chimney.
    const lotBox = obb(lot);
    const end = r() < 0.5 ? 1 : -1;
    const depth = Math.min(lotBox.hl * 2, between(r, 9, 13));
    const s0 = end > 0 ? lotBox.hl - depth : -lotBox.hl;
    const body = rectIn(lotBox, s0, s0 + depth, -lotBox.hw + 0.3, lotBox.hw - 0.3);
    if (lotBox.hl * 2 - depth > 4) {
      const yard = rectIn(lotBox, end > 0 ? -lotBox.hl : s0 + depth + 0.4, end > 0 ? s0 - 0.4 : lotBox.hl, -lotBox.hw, lotBox.hw);
      extras.flats.push({ rings: [yard], c: C.garden, t0, t1 });
    }
    const box = { c: at(lotBox, s0 + depth / 2, 0), u: lotBox.v, v: [-lotBox.u[0], -lotBox.u[1]], hl: lotBox.hw - 0.3, hw: depth / 2 };
    const roof = T.roofs[Math.floor(r() * T.roofs.length)];
    const rise = Math.min(box.hw * 0.85, 6);
    const g = { parts: [], flats: [] };
    gable(g, box, -box.hl - 0.2, box.hl + 0.2, box.hw + 0.3, h, rise, roof, 6);
    if (r() < 0.75) part(g, rectIn(box, box.hl * 0.6 - 0.6, box.hl * 0.6 + 0.6, -0.6, 0.6), h, h + rise + 1.2, '#7a4a38');
    g.parts.forEach((q) => Object.assign(q, { t0, t1 }));
    extras.parts.push(...g.parts);
    return { rings: [body], h: round1(h), c: T.walls[Math.floor(r() * T.walls.length)], roof, rt: 0.05, type, t0, t1 };
  }
  const holes = [];
  if (T.court && A > T.court.min && isConvex(lot) && r() < T.court.p) {
    const hole = scaleRing(lot, T.court.k);
    holes.push(hole);
    if (T.court.garden) extras.flats.push({ rings: [hole], c: C.garden, t0, t1 });
  }
  if (T.atrium) {
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
    h: round1(h),
    c: T.walls[Math.floor(r() * T.walls.length)],
    roof: T.roofs[Math.floor(r() * T.roofs.length)],
    rt: T.rt,
    type, t0, t1,
  };
}

// A chinampa: a raised strip of field between canals, edged with willows,
// sometimes with the farmer's hut at one end.
function chinampa(g, plot, fabric, r) {
  g.flats.push({ rings: [plot], c: fabric.fill ?? C.garden });
  const box = obb(plot);
  const willows = Math.min(4, Math.floor(box.hl / 14));
  for (let i = 0; i < willows; i++) {
    const s = -box.hl + ((i + 0.5) * 2 * box.hl) / willows + between(r, -3, 3);
    const t = (i % 2 ? 1 : -1) * (box.hw - 1);
    part(g, circle(at(box, s, t), between(r, 1, 1.5), 6), 0, between(r, 7, 11), C.willow);
  }
  if (r() < 0.3) {
    const hut = { c: at(box, box.hl - 6, 0), u: box.u, v: box.v };
    part(g, rectIn(hut, -3, 3, -2.5, 2.5), 0, 2.2, C.adobe);
    gable(g, hut, -3.4, 3.4, 3, 2.2, 2.2, C.thatch, 4);
  }
}

// An orchard plot: rows of small round-crowned trees (olives, figs).
function orchard(g, plot, r) {
  g.flats.push({ rings: [plot], c: C.garden });
  const box = obb(plot);
  for (let s = -box.hl + 6; s < box.hl - 4; s += 13) {
    for (let t = -box.hw + 6; t < box.hw - 4; t += 11) {
      if (r() < 0.25) continue;
      const q = at(box, s + between(r, -1.5, 1.5), t + between(r, -1.5, 1.5));
      part(g, circle(q, between(r, 2, 2.8), 7), 0.8, between(r, 3.6, 4.8), '#7f915a');
    }
  }
}

// A stretch of the Tehran bazaar: shops under a flat roof either side of a
// lane roofed by a row of shallow brick domes. Now and then a timcheh, a
// covered hall under one larger dome.
function bazaarRow(lot, [t0, t1], r, extras) {
  const box = obb(lot);
  const H = round1(between(r, 5.5, 7));
  const brick = ['#c49a6c', '#b98f62', '#cba57a'];
  const g = { parts: [], flats: [] };
  const cupola = (c, R, base) => {
    const colour = brick[Math.floor(r() * brick.length)];
    [[1, 0, 0.36], [0.62, 0.36, 0.62]].forEach(([k, b, h]) => part(g, circle(c, R * k, 12), base + R * b, base + R * h, colour));
  };
  if (Math.abs(area(lot)) > 700 && box.hw > 10 && r() < 0.18) {
    const R = Math.min(box.hw, box.hl) * 0.62;
    part(g, circle(box.c, R * 1.04, 16), H, H + 2.2, brick[0]);
    cupola(box.c, R, H + 2.2);
  } else {
    const R = Math.min(box.hw * 0.62, 4.2);
    const n = Math.floor((box.hl * 2) / (R * 2.3));
    if (R > 1.5) for (let i = 0; i < n; i++) cupola(at(box, -box.hl + (box.hl * 2 * (i + 0.5)) / n, 0), R, H);
  }
  g.parts.forEach((q) => Object.assign(q, { t0, t1 }));
  extras.parts.push(...g.parts);
  return { rings: [lot], h: H, c: '#cdb08a', roof: '#c9ad85', rt: 0.4, type: 'bazaar', t0, t1 };
}

// ---------- Layouts ----------
// Regular grid of w x h blocks, gap apart, turned by angle: only whole blocks inside the area.
function gridBlocks(ring, { w = 60, h = 60, gap = 12, angle = 0 }) {
  const rad = (angle * Math.PI) / 180;
  const rot = ([x, y], s = 1) => [x * Math.cos(s * rad) - y * Math.sin(s * rad), x * Math.sin(s * rad) + y * Math.cos(s * rad)];
  const turned = ring.map((q) => rot(q, -1));
  const xs = turned.map((q) => q[0]);
  const ys = turned.map((q) => q[1]);
  const out = [];
  for (let x = Math.min(...xs); x < Math.max(...xs); x += w + gap) {
    for (let y = Math.min(...ys); y < Math.max(...ys); y += h + gap) {
      const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((q) => rot(q));
      if (corners.every((q) => inRing(q, ring))) out.push(corners);
    }
  }
  return out;
}

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
// Big lakes are left out: a whole island city sits inside its lake outline.
function obstacleIndex(city, frame) {
  const items = [];
  for (const f of city.features) {
    const p = f.properties;
    const g = f.geometry;
    const life = { t0: p.t0, t1: p.t1 };
    const smallLake = p.kind === 'lake' && g.type === 'Point';
    if (KEEP_CLEAR_AREAS.has(p.kind) || smallLake) {
      if (g.type === 'Point') {
        const rad = (p.radiusM ?? Math.max(...(p.ellipse ?? [40]).slice(0, 2))) + 4;
        const c = frame.toXY(g.coordinates);
        items.push({ ...life, src: f, circle: c, r: rad, box: [c[0] - rad, c[1] - rad, c[0] + rad, c[1] + rad] });
      } else {
        for (const ring of outerRings(g)) {
          const poly = open(ring.map(frame.toXY));
          items.push({ ...life, src: f, poly, box: bbox(poly) });
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
function lifespan(ring, base, index, self) {
  let { t0, t1 } = base;
  const c = centroid(ring);
  const rad = Math.sqrt(Math.abs(area(ring)) / Math.PI);
  for (const o of index.near(bbox(ring))) {
    if (o.src === self || o.t1 <= t0 || o.t0 >= t1) continue; // itself, or never coexists
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
  return Object.keys(mix)[0];
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
const round1 = (v) => Math.round(v * 10) / 10;
