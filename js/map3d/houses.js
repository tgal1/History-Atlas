// Generates the ordinary city between the landmarks. Each "houses" area with
// a "fabric" is cut into street blocks, either by recursive splits (wide
// streets first, alleys last, each cut slightly off-square, as in Rome) or on
// a regular grid (Roman Carthage, Tenochtitlan). Each block then becomes one
// of the house types of the city's style:
//
//   roman   insula (apartment block), taberna (shops), domus (town house)
//   punic   courtyard houses, tall houses near the citadel, workshops
//   mexica  calli (family compound round a patio), noble houses, reed huts
//   levantine  stone courtyard houses, domed houses, covered markets
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
import { mansardTop } from './models.js';
import { kindInfo } from '../map/cityLayer.js';

const CLIPPING_URL = 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';

const KEEP_CLEAR_AREAS = new Set(['plaza', 'precinct', 'ruins', 'palace', 'temple', 'church', 'market', 'building', 'house', 'wharf', 'arena', 'baths', 'fort', 'tomb', 'harbour', 'garden', 'chinampa', 'island', 'shipsheds']);
const KEEP_CLEAR_LINES = { river: 8, road: 1, canal: 2, causeway: 2, wall: 4, aqueduct: 2 };

const SLATE = ['#4f4a45', '#5a534c', '#625a50'];
const SHINGLE = ['#6b5d4f', '#5e5348', '#74675a'];
const ROMAN_ROOFS = ['#a9532f', '#b5603a', '#9e4b2b', '#ba6a43', '#a55a36', '#b2573a'];
const FLAT_ROOFS = ['#ddd3bf', '#d6cbb4', '#e2d9c6', '#d9cfba'];
const WHITE = ['#f0ebe0', '#ece4d4', '#e6dccb', '#f3eee4'];
const LIMESTONE = ['#ebe2cd', '#e4d9c1', '#efe8d7', '#ddd1b6', '#e8dec8', '#d9ccb0'];
const STONE_ROOFS = ['#e2d8c3', '#dbd0b8', '#e7dfcc', '#d5c9ae'];
const TEHRAN_BRICK = ['#c9a878', '#d2b388', '#bf9a6a', '#d8bf96', '#c4a27a'];
const TEHRAN_CONCRETE = ['#d6d0c2', '#c7c1b3', '#bdb8ac', '#cfc6b2', '#b4b0a6'];
const TEHRAN_ROOFS = ['#a7a299', '#b3ada2', '#9d988f', '#c2bba9'];
const BERLIN_PLASTER = ['#cfc4ae', '#c3b8a4', '#d8ccb4', '#bbb1a1', '#ccbfa5', '#ddd2bb'];
const BERLIN_ROOFS = ['#8e877d', '#827c73', '#989086'];

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
  // The Levant (Jerusalem): pale limestone houses with flat roofs round small courts; a low dome over a vaulted room on some.
  'levant-house': { area: [140, 360], h: (r, s) => Math.floor(between(r, 1, s ? 2.5 : 2.9)) * 3.4 + 0.5, walls: LIMESTONE, roofs: STONE_ROOFS, rt: 0.4, court: { min: 150, k: 0.34, p: 0.7 }, domes: 0.25 },
  'levant-domed': { area: [90, 220], h: (r) => Math.floor(between(r, 1, 2.6)) * 3.4 + 0.5, walls: LIMESTONE, roofs: STONE_ROOFS, rt: 0.4, domes: 1 },
  suq: { area: [110, 260], h: (r) => between(r, 5, 6.5), walls: ['#d8cbae', '#d1c3a4', '#dccfb3'], roofs: ['#cfc2a6', '#d6caae'], rt: 0.6 },
  // Tehran in the 1970s: flat-roofed houses of yellow brick round a garden court, concrete flats and
  // office blocks on the avenues, and the bazaar's lanes under rows of shallow brick domes.
  'tehran-house': { area: [600, 1300], h: (r, s) => Math.floor(between(r, 2, s ? 3.6 : 4.8)) * 3.2 + 0.8, walls: TEHRAN_BRICK, roofs: TEHRAN_ROOFS, rt: 0.5, court: { min: 500, k: 0.42, p: 0.7, garden: true } },
  'tehran-flats': { area: [800, 1500], h: (r) => Math.floor(between(r, 4, 6.9)) * 3.1 + 0.8, walls: TEHRAN_CONCRETE, roofs: TEHRAN_ROOFS, rt: 0.6 },
  'tehran-shops': { area: [450, 900], h: (r) => Math.floor(between(r, 2, 3.9)) * 3.4 + 0.6, walls: [...TEHRAN_BRICK, ...TEHRAN_CONCRETE], roofs: TEHRAN_ROOFS, rt: 0.5 },
  'tehran-office': { area: [1000, 2000], h: (r) => Math.floor(r() < 0.12 ? between(r, 11, 18) : between(r, 4, 9.9)) * 3.4 + 1, walls: TEHRAN_CONCRETE, roofs: ['#8f8c84', '#9a978e', '#a29d92'], rt: 0.8 },
  bazaar: { area: [550, 1100], build: bazaarRow },
  // Berlin, 1945 to 1990: soot-grey tenements round courtyards, East Berlin's
  // concrete panel blocks, plain post-war buildings and bomb sites.
  altbau: { area: [900, 2600], h: (r) => Math.floor(between(r, 4, 6.4)) * 3.2, walls: BERLIN_PLASTER, roofs: BERLIN_ROOFS, rt: 1.6 },
  mietskaserne: { area: [1400, 3200], h: (r) => Math.floor(between(r, 4, 6.4)) * 3.2, walls: BERLIN_PLASTER, roofs: BERLIN_ROOFS, rt: 1.6, court: { min: 900, k: 0.5, p: 0.9 } },
  plattenbau: { area: [900, 2400], h: (r) => (r() < 0.75 ? 6 : 11) * 3.2, walls: ['#e2dfd6', '#d8d5cb', '#ebe7dc', '#d2cfc4', '#dfd8c9'], roofs: ['#a9a59d', '#b3afa6'], rt: 0.6 },
  postwar: { area: [600, 1600], h: (r) => Math.floor(between(r, 3, 7)) * 3.2, walls: ['#ece8de', '#e2ddd0', '#d8d1c2', '#e8dfcb'], roofs: ['#9a958c', '#a29d93'], rt: 0.6 },
  gap: { area: [250, 900], rubble: true },
  // Moscow: stucco blocks of the old city, Stalin-era avenues, Khrushchev-era slabs.
  stucco: { area: [700, 1800], h: (r) => Math.floor(between(r, 4, 6.9)) * 3.6 + 0.8, walls: ['#e3c98f', '#dfb98a', '#e8d3a8', '#d9a98f', '#c9cfb0', '#e6d9b8', '#d7c3a0', '#bcc7c4'], roofs: ['#6f7d6c', '#7d6a5a', '#8a8f8c', '#5f6e64'], rt: 1.2, court: { min: 900, k: 0.45, p: 0.7 } },
  stalinist: { area: [2000, 4500], h: (r) => Math.floor(between(r, 8, 10.9)) * 3.4 + 1.5, walls: ['#d8c7a6', '#cbb89a', '#e0d2b6', '#c9a98a'], roofs: ['#8a8a84', '#7c7d78'], rt: 1.5, court: { min: 1800, k: 0.55, p: 0.85 } },
  khrushchyovka: { area: [1800, 4000], h: () => 5 * 2.8 + 0.6, walls: ['#d9d6cf', '#cfcbc2', '#c9b9a3', '#e2ded4'], roofs: ['#7a7a76', '#85857f'], rt: 0.4, slab: true },
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
  levantine: {
    centre: { 'levant-house': 0.58, 'levant-domed': 0.2, suq: 0.14, garden: 0.08 },
    hill: { 'levant-house': 0.6, 'levant-domed': 0.25, garden: 0.15 },
    outer: { 'levant-house': 0.5, 'levant-domed': 0.15, garden: 0.35 },
  },
  tehran: {
    centre: { 'tehran-house': 0.68, 'tehran-flats': 0.14, 'tehran-shops': 0.12, garden: 0.06 },
    hill: { 'tehran-house': 0.6, 'tehran-flats': 0.2, garden: 0.2 },
    outer: { 'tehran-house': 0.7, 'tehran-flats': 0.08, 'tehran-shops': 0.08, garden: 0.14 },
  },
  berlin: {
    centre: { mietskaserne: 0.72, postwar: 0.1, gap: 0.1, garden: 0.08 },
    hill: { mietskaserne: 0.72, postwar: 0.1, gap: 0.1, garden: 0.08 },
    outer: { mietskaserne: 0.5, postwar: 0.2, gap: 0.1, garden: 0.2 },
  },
  moscow: {
    centre: { stucco: 0.78, stalinist: 0.1, garden: 0.12 },
    hill: { stucco: 0.78, stalinist: 0.1, garden: 0.12 },
    outer: { khrushchyovka: 0.55, stalinist: 0.15, stucco: 0.15, garden: 0.15 },
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
  'levant-house': 'A stone courtyard house: rooms of local limestone round a small open court, and a flat roof used for drying, sleeping and catching rain for the cistern below.',
  'levant-domed': 'A house roofed with stone vaults. In a land short of timber, a low dome over the main room was the usual roof.',
  suq: 'Vaulted market streets. The three parallel covered markets in the middle of the city date from crusader times; one, the Malquisinat, sold cooked food to pilgrims.',
  'tehran-house': 'A Tehran family house: two to four storeys of yellow brick or concrete with a flat roof, built round a court with a pool and a tree.',
  'tehran-flats': 'A block of flats. Oil money and migration from the countryside doubled Tehran in the 1960s and 70s, and blocks like this went up fast.',
  'tehran-shops': 'Shops at street level with workshops or flats above.',
  'tehran-office': 'An office block of the oil boom: ministries, banks, airline offices and hotels lined the main avenues.',
  bazaar: 'The Grand Bazaar: lanes of shops under shallow brick domes. Its merchants funded the clergy, and their strikes in 1978 helped bring down the Shah.',
  altbau: 'A building from before the war, most often a tenement of five storeys round its courtyards, with shops at street level. Many still bore bullet and shell scars from 1945.',
  mietskaserne: 'A Mietskaserne ("rental barracks"): a five-storey tenement of the late 1800s, its flats packed round a chain of narrow back courtyards.',
  plattenbau: 'A Plattenbau: flats assembled from factory-made concrete panels. East Berlin rebuilt its bombed centre with them from the 1960s, up to the 25-storey towers of Leipziger Strasse.',
  postwar: 'A building of the 1950s to 1980s, put up on a plot cleared after the war.',
  gap: 'A bomb site. In the 1950s and 60s many plots in central Berlin were still rubble or cleared ground.',
  stucco: 'A stuccoed apartment block of the late 1800s, four to six storeys round a courtyard. After 1917 most were split into communal flats, a family to a room.',
  stalinist: 'A Stalin-era apartment block of the 1930s to 1950s: eight to ten storeys of stone-faced walls, high ceilings and big flats for the Soviet elite, lining the main avenues.',
  khrushchyovka: 'A Khrushchyovka: a five-storey slab of concrete panels or brick, built in their thousands from the late 1950s to rehouse families from communal flats.',
};
export const HOUSE_LABEL = {
  insula: 'Insula (apartment block)', taberna: 'Shops and workshops', domus: 'Domus (town house)',
  'punic-house': 'Courtyard house', 'punic-tall': 'Tall house', workshop: 'Workshops',
  calli: 'Calli (family compound)', noble: "Noble's house", rubble: 'Ruins',
  georgian: 'Georgian brick house', clapboard: 'Clapboard house', warehouse: 'Warehouse',
  'levant-house': 'Courtyard house', 'levant-domed': 'Domed house', suq: 'Covered market',
  'tehran-house': 'Courtyard house', 'tehran-flats': 'Block of flats', 'tehran-shops': 'Shops', 'tehran-office': 'Office block', bazaar: 'Bazaar',
  altbau: 'Pre-war building', mietskaserne: 'Mietskaserne (tenement)', plattenbau: 'Plattenbau (panel block)',
  postwar: 'Post-war building', gap: 'Bomb site',
  stucco: 'Pre-revolutionary apartment block', stalinist: 'Stalin-era apartment block', khrushchyovka: 'Khrushchyovka (five-storey slab)',
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
    if (fabric.footprints) { footprintHouses(f, frame, index, houses, extras); continue; }
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
  if (T.mansard) return mansardHouse(lot, type, [t0, t1], suburb, r, extras);
  if (T.slab) return slab(lot, type, [t0, t1], r, extras);
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
  if (T.domes && r() < T.domes) roofDome(lot, holes, h + T.rt, r, extras, t0, t1);
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

// A low dome over one vaulted room of a Levantine house, at one end of the
// roof and clear of the courtyard.
function roofDome(lot, holes, base, r, extras, t0, t1) {
  const box = obb(lot);
  const rad = Math.min(box.hw * 0.7, between(r, 2.2, 3.4));
  if (rad < 1.6) return;
  const end = box.hl - rad - 0.6;
  for (const s of r() < 0.5 ? [end, -end] : [-end, end]) {
    const c = at(box, s, between(r, -0.3, 0.3) * Math.max(0, box.hw - rad));
    if (!inRing(c, lot) || holes.some((q) => inRing(c, q))) continue;
    const g = { parts: [], flats: [] };
    const rise = rad * 0.8;
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * (Math.PI / 2);
      const a1 = ((i + 1) / 4) * (Math.PI / 2);
      part(g, circle(c, rad * Math.cos((a0 + a1) / 2), 14), base + rise * Math.sin(a0), base + rise * Math.sin(a1), '#e9e1cf');
    }
    g.parts.forEach((q) => Object.assign(q, { t0, t1 }));
    extras.parts.push(...g.parts);
    return;
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

// Real building outlines (Berlin, from OpenStreetMap): each polygon of the
// area is one building of the fabric's "footprints" type, raised to its own
// height from "h" (one per polygon, in metres). A dated area with "gapFrom"
// (a decimal year) stands on a bomb site until it is built: rubble until
// 1955, then cleared ground. Landmarks still clear the ground they stand on;
// streets and the Wall don't, since these outlines are where buildings stood.
function footprintHouses(f, frame, index, houses, extras) {
  const p = f.properties;
  const { footprints: type, h: heights = [], gapFrom } = p.fabric;
  const T = TYPES[type];
  const r = rng(hashString(p.id));
  const areas = { near: (b) => index.near(b).filter((o) => !o.line) };
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  polys.forEach((poly, i) => {
    const rings = poly.map((ring) => open(ring.map(frame.toXY)));
    const outer = ccw(rings[0]);
    const life = lifespan(outer, { t0: p.t0, t1: p.t1 }, areas, f);
    if (life) {
      houses.push({
        rings: [outer, ...rings.slice(1)], h: round1(heights[i] ?? T.h(r)),
        c: T.walls[Math.floor(r() * T.walls.length)], roof: T.roofs[Math.floor(r() * T.roofs.length)], rt: T.rt, type, t0: life[0], t1: life[1],
      });
    }
    if (gapFrom == null || !(p.t0 > gapFrom)) return;
    const ruins = Math.min(p.t0, 1955.5);
    extras.flats.push({ rings: [outer], c: '#c8bda6', t0: gapFrom, t1: ruins });
    if (p.t0 > ruins) extras.flats.push({ rings: [outer], c: '#cbc7a6', t0: ruins, t1: p.t0 });
    const box = obb(outer);
    for (let k = Math.min(6, Math.floor(Math.abs(area(outer)) / 160)); k > 0; k--) {
      const q = at(box, between(r, -box.hl, box.hl), between(r, -box.hw, box.hw));
      if (!inRing(q, outer)) continue;
      const l = between(r, 2, 6);
      extras.parts.push({ rings: [rectIn({ c: q, u: box.u, v: box.v }, -l, l, -l * 0.6, l * 0.6)], b: 0, h: between(r, 0.6, 2.2), c: C.rubble, t0: gapFrom, t1: ruins });
    }
  });
}

// A Khrushchyovka: one five-storey slab set back in its lot, the rest a
// yard of grass and trees.
function slab(lot, type, [t0, t1], r, extras) {
  const T = TYPES[type];
  const box = obb(lot);
  if (box.hl < 14 || box.hw < 8) return null;
  const hl = Math.min(box.hl - 3, 48);
  const hw = Math.min(box.hw - 2, 6);
  extras.flats.push({ rings: [lot], c: C.garden, t0, t1 });
  if (box.hw > 18) {
    const g = { parts: [], flats: [] };
    for (const s of [-0.6, 0, 0.6]) if (r() < 0.6) tree(g, at(box, s * hl, (r() < 0.5 ? -1 : 1) * (hw + (box.hw - hw) / 2)), r);
    g.parts.forEach((q) => Object.assign(q, { t0, t1 }));
    extras.parts.push(...g.parts);
  }
  return {
    rings: [rectIn(box, -hl, hl, -hw, hw)],
    h: round1(T.h(r)),
    c: T.walls[Math.floor(r() * T.walls.length)],
    roof: T.roofs[Math.floor(r() * T.roofs.length)],
    rt: T.rt,
    type, t0, t1,
  };
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

// ---------- Paris ----------
// Tall stone apartment houses in the old centre, nobles' town houses round a
// court with a garden behind in the Faubourg Saint-Germain, lower plastered
// houses and workshops out in the faubourgs.
const PARIS_WALLS = ['#ece3cf', '#e4d8bf', '#efe7d6', '#dccfb3', '#e8dcc2', '#d8cbb0'];
const PARIS_SLATE = ['#6a6f76', '#73777d', '#63686f', '#7b7f85'];
const PARIS_TILE = ['#9b6a4f', '#8f5f47', '#a67658'];

Object.assign(TYPES, {
  immeuble: { area: [260, 620], h: (r, s) => Math.floor(between(r, s ? 3 : 4, s ? 4.9 : 6.9)) * 3.1 + 0.8, walls: PARIS_WALLS, roofs: PARIS_SLATE, mansard: true },
  hotel: { area: [900, 2200], h: (r) => between(r, 10.5, 13), walls: ['#efe8d8', '#e9e0cb', '#f2ece0'], roofs: PARIS_SLATE, mansard: true, court: { min: 800, k: 0.5, p: 0.9, garden: true } },
  faubourg: { area: [300, 750], h: (r) => Math.floor(between(r, 2, 3.9)) * 3 + 0.6, walls: ['#e3d6bb', '#d9c9a6', '#e8dfcb', '#cfbf9e'], roofs: [...PARIS_TILE, ...PARIS_SLATE], mansard: true },
});

Object.assign(STYLES, {
  paris: {
    centre: { immeuble: 0.84, hotel: 0.05, faubourg: 0.05, garden: 0.06 },
    hill: { faubourg: 0.5, immeuble: 0.15, garden: 0.35 },
    outer: { faubourg: 0.55, immeuble: 0.15, hotel: 0.05, garden: 0.25 },
  },
});

Object.assign(HOUSE_INFO, {
  immeuble: 'A Paris apartment house of four to six storeys: shops at street level, the richest tenants on the first floor, the poorest under the roof.',
  hotel: "An hôtel particulier: a noble's town house between a front court and a garden. Many were seized and sold after their owners emigrated.",
  faubourg: 'A lower house of the faubourgs, often with a workshop: cabinet-makers in Saint-Antoine, tanners and dyers by the Bièvre in Saint-Marcel.',
});
Object.assign(HOUSE_LABEL, { immeuble: 'Apartment house', hotel: 'Hôtel particulier (town house)', faubourg: 'Faubourg house' });

// Walls to the cornice, then a slate or tile roof: a steep band flush with the
// front and a set-back top, the outline of a Paris mansard.
function mansardHouse(lot, type, [t0, t1], suburb, r, extras) {
  const T = TYPES[type];
  const h = T.h(r, suburb);
  const outline = area(lot) > 0 ? lot : lot.slice().reverse();
  const rings = [outline];
  if (T.court && Math.abs(area(lot)) > T.court.min && isConvex(lot) && r() < T.court.p) {
    const hole = scaleRing(outline, T.court.k);
    rings.push(hole.slice().reverse());
    if (T.court.garden) extras.flats.push({ rings: [hole], c: C.garden, t0, t1 });
  }
  const roof = T.roofs[Math.floor(r() * T.roofs.length)];
  const band = round1(between(r, 1.2, 1.9));
  const g = { parts: [], flats: [] };
  mansardTop(g, rings, h + band, between(r, 1.3, 2.3), Math.min(1.7, Math.sqrt(Math.abs(area(lot))) * 0.16), roof);
  g.parts.forEach((q) => Object.assign(q, { t0, t1 }));
  extras.parts.push(...g.parts);
  return { rings, h: round1(h), c: T.walls[Math.floor(r() * T.walls.length)], roof, rt: band, type, t0, t1 };
}
