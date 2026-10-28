// Little side-on figures for scene units: soldiers, riders, elephants,
// canoes, ships, tanks. Each is drawn facing right in a 32 x 32 box, filled
// with the faction colour (currentColor) and outlined in dark ink; the scene
// player mirrors them when a unit heads west.
//
// A unit picks its figure with "type"; otherwise the scene's "figures"
// ({ side: type }) or a guess from its label is used.

const INK = 'stroke="#1d1a16" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"';
const SKIN = '#e8c39e';
const DARK = '#3a2f25';

const head = (x, y, r = 2.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${SKIN}" ${INK}/>`;
const legs = (x, top = 21, spread = 2.5) => `<path d="M${x - 1} ${top}L${x - spread} 29M${x + 1} ${top}L${x + spread} 29" fill="none" ${INK}/>`;
const tunic = (x) => `<path d="M${x - 3.5} 10.5h7l1.2 11h-9.4z" fill="currentColor" ${INK}/>`;

const FIGURES = {
  // Hoplite-style spearman: round shield, long spear (Carthaginian and African infantry).
  spear: `${legs(15)}<path d="M9 27L24 2" fill="none" ${INK}/>${tunic(15)}${head(15, 7)}
    <path d="M12.3 6.5a3 3 0 0 1 5.4-1.2" fill="none" stroke="${DARK}" stroke-width="2"/>
    <circle cx="20" cy="15" r="5.4" fill="currentColor" ${INK}/><circle cx="20" cy="15" r="1.4" fill="#f4e3b0"/>`,
  // Roman legionary: tall curved shield, javelin, crested helmet.
  legionary: `${legs(14)}<path d="M8 25L26 5" fill="none" ${INK}/>${tunic(14)}${head(14, 7)}
    <path d="M11.4 6.2a2.8 2.8 0 0 1 5.2 0" fill="none" stroke="#b7b7b7" stroke-width="2.2"/>
    <path d="M12 3.8h4" stroke="#b33a2a" stroke-width="2"/>
    <rect x="17.5" y="9" width="7" height="13.5" rx="2" fill="currentColor" ${INK}/><path d="M21 10v11" stroke="#f4e3b0" stroke-width="1.2"/>`,
  // Gaul or Spaniard: long oval shield, sword, bare head.
  gaul: `${legs(14)}<path d="M8 18L4 9" fill="none" stroke="#9aa0a6" stroke-width="2"/>${tunic(14)}${head(14, 7)}
    <path d="M11.4 6a3 3 0 0 1 5-2.4l1 2" fill="none" stroke="#b58a3c" stroke-width="2"/>
    <ellipse cx="20.5" cy="16" rx="4" ry="7.5" fill="currentColor" ${INK}/>`,
  // Heavy cavalry: horse, armoured rider with lance.
  cavalry: `<path d="M8 22l-1.5 7M11 23l0.5 6M19 23l-1 6M22 22l2 7" fill="none" ${INK}/>
    <path d="M5 17c0-3 3-5 8-5h7l4-5 4 2-2 3-3 2c0 4-2 8-7 8h-6c-3 0-5-2-5-5z" fill="#8b6a4a" ${INK}/>
    <path d="M5 17l-3 5" fill="none" ${INK}/>
    <path d="M12 12l1-5h5l1 5z" fill="currentColor" ${INK}/>${head(15.5, 4.2, 2.4)}
    <path d="M6 9L31 2" fill="none" ${INK}/>`,
  // Light cavalry (Numidians): small horse, no saddle, javelins.
  'light-cavalry': `<path d="M9 22l-1 7M12 23v6M19 23l-1 6M22 22l1.5 7" fill="none" ${INK}/>
    <path d="M6 18c0-3 3-5 7-5h6l4-5 3.5 2-2 3-2.5 2c0 3.5-2 7-6 7h-5c-3 0-5-1.5-5-4z" fill="#a0784f" ${INK}/>
    <path d="M13 13l0.5-5h4l0.5 5z" fill="currentColor" ${INK}/>${head(15.5, 5.2, 2.3)}
    <path d="M18 9L28 4M17 10L27 6" fill="none" ${INK}/>`,
  // War elephant with a driver.
  elephant: `<path d="M8 21v8M12 22v7M20 22v7M24 21v8" fill="none" stroke="#6f6a63" stroke-width="3"/>
    <path d="M4 17c0-6 5-9 12-9 5 0 8 1 10 4l3 5c1 2 1 5 0 8l-2-1c0-2 0-4-1-5l-2 2H7c-2 0-3-2-3-4z" fill="#8c867d" ${INK}/>
    <path d="M22 11c-2 0-3 2-3 4s1 3 3 3" fill="#7d776e" ${INK}/>
    <path d="M14 8l1-4h4l1 4z" fill="currentColor" ${INK}/>${head(17, 3, 2)}`,
  // Mexica warrior: feathered headdress, round chimalli shield, obsidian-edged club.
  mexica: `${legs(14)}
    <path d="M7 22L5 12" fill="none" stroke="#5b3b22" stroke-width="2.4"/><path d="M4 13h2M4 16h2M4.5 19h2" stroke="#222" stroke-width="1"/>
    ${tunic(14)}${head(14, 7)}
    <path d="M12 4.5l-2-4M14 4l0-4M16 4.5l2-4" fill="none" stroke="#2f8f5b" stroke-width="1.6"/>
    <circle cx="20" cy="15" r="5.2" fill="currentColor" ${INK}/><path d="M16.5 13h7M16.5 17h7" stroke="#f4e3b0" stroke-width="1.2"/>`,
  // Conquistador: morion helmet, breastplate, pike.
  conquistador: `${legs(14)}<path d="M7 27L27 1" fill="none" ${INK}/>
    <path d="M10.5 10.5h7l1.2 11h-9.4z" fill="currentColor" ${INK}/><path d="M11.5 11h5v5h-5z" fill="#c9ccd1" ${INK}/>
    ${head(14, 7.2)}<path d="M9.5 6.2c1-3.5 8-3.5 9 0z" fill="#c9ccd1" ${INK}/><path d="M14 2.7v-1.5" stroke="#1d1a16" stroke-width="1.6"/>`,
  // Dugout canoe with three paddlers.
  canoe: `<path d="M2 19h28l-3 5H6z" fill="#8a5a33" ${INK}/>
    ${[9, 16, 23].map((x) => `<path d="M${x - 2} 19l0.5-6h3l0.5 6z" fill="currentColor" ${INK}/>${head(x, 11, 2)}<path d="M${x + 2} 12l-4 12" fill="none" stroke="#5b3b22" stroke-width="1.4"/>`).join('')}`,
  // Sailing ship (brigantine, galley, landing fleet).
  ship: `<path d="M3 20h26l-4 6H8z" fill="#7a5233" ${INK}/>
    <path d="M16 20V3" fill="none" ${INK}/><path d="M9 5h14l-1.5 12h-11z" fill="currentColor" ${INK}/>
    <path d="M6 26l-1.5 3M10 26l-1 3M14 26l-0.5 3M18 26v3M22 26l0.5 3" fill="none" stroke="#5b3b22" stroke-width="1"/>`,
  // Modern infantry: helmet and rifle.
  soldier: `${legs(15)}<path d="M9 15L27 12" fill="none" stroke="#2b2b2b" stroke-width="2"/>
    <path d="M11.5 10.5h7l1.2 11h-9.4z" fill="currentColor" ${INK}/>${head(15, 7.5)}
    <path d="M11 7c0-4 8-4 8 0z" fill="currentColor" ${INK}/>`,
  tank: `<rect x="3" y="20" width="26" height="7" rx="3.5" fill="#3d3a35" ${INK}/>
    ${[7, 12, 17, 22, 26].map((x) => `<circle cx="${x}" cy="23.5" r="1.6" fill="#77716a"/>`).join('')}
    <path d="M5 20l2-5h18l2 5z" fill="currentColor" ${INK}/><path d="M11 15l1-5h8l2 5z" fill="currentColor" ${INK}/>
    <path d="M21 12h10" stroke="#1d1a16" stroke-width="2"/>`,
  para: `<path d="M4 12C4 3 28 3 28 12z" fill="#e9e4d6" ${INK}/><path d="M4 12l11 9M28 12l-11 9M16 12v8" fill="none" stroke="#555" stroke-width="0.8"/>
    <path d="M13.5 19h5l0.6 6h-6.2z" fill="currentColor" ${INK}/>${head(16, 17.5, 2)}<path d="M15 25l-1 4M17 25l1 4" fill="none" ${INK}/>`,
  // Civil rights marcher with a banner.
  marcher: `${legs(14)}<path d="M19 28V3" fill="none" stroke="#5b3b22" stroke-width="1.4"/>
    <path d="M19 3h10v7H19z" fill="#f4f1e8" ${INK}/>
    <path d="M10.5 10.5h7l1.2 11h-9.4z" fill="currentColor" ${INK}/>${head(14, 7)}`,
  // 18th-century line infantry: tricorne, long coat with crossbelts, musket and bayonet.
  'line-infantry': `${legs(14)}<path d="M10.3 10.5h7.4l1.6 12.5H8.7z" fill="currentColor" ${INK}/>
    <path d="M11 11.2l6 8M17 11.2l-6 8" stroke="#f4f1e8" stroke-width="1.1"/>${head(14, 7.2)}
    <path d="M9.2 6.6c1.6-0.8 3-3.8 4.8-3.8s3.2 3 4.8 3.8c-1.7 0.7-7.9 0.7-9.6 0z" fill="#22201c" ${INK}/>
    <path d="M9 23L25 6" fill="none" stroke="#6b4a2b" stroke-width="2.2"/><path d="M25 6l4-4" stroke="#c9ccd1" stroke-width="1.2"/>`,
  // Rifleman or militia: hunting shirt, round hat, long rifle levelled to fire.
  rifleman: `${legs(13)}<path d="M9.5 10.5h7l1.2 11h-9.4z" fill="currentColor" ${INK}/>
    <path d="M9.6 15.5h7.4M9.3 18.5h7.9" stroke="#f4e3b0" stroke-width="0.9" stroke-dasharray="1 1"/>${head(13, 7.2)}
    <ellipse cx="13" cy="5.2" rx="4.8" ry="1.2" fill="${DARK}"/><path d="M10.6 5.2a2.4 2.6 0 0 1 4.8 0z" fill="${DARK}"/>
    <path d="M8 14L31 11.2" fill="none" stroke="#6b4a2b" stroke-width="1.8"/>`,
  // Dragoon: horse, crested helmet, raised sabre.
  dragoon: `<path d="M8 22l-1.5 7M11 23l0.5 6M19 23l-1 6M22 22l2 7" fill="none" ${INK}/>
    <path d="M5 17c0-3 3-5 8-5h7l4-5 4 2-2 3-3 2c0 4-2 8-7 8h-6c-3 0-5-2-5-5z" fill="#6e4f36" ${INK}/>
    <path d="M5 17l-3 5" fill="none" ${INK}/>
    <path d="M12 12l1-5h5l1 5z" fill="currentColor" ${INK}/>${head(15.5, 4.4, 2.4)}
    <path d="M13.2 3.6a2.4 2.4 0 0 1 4.6 0z" fill="#22201c"/><path d="M13.5 2.2c1.5-1 3-1 4 0" fill="none" stroke="#22201c" stroke-width="1.4"/>
    <path d="M18 9l9-7" stroke="#c9ccd1" stroke-width="1.6" stroke-linecap="round"/>`,
  // Field gun with a gunner holding the rammer.
  cannon: `<path d="M3 27L15 20" stroke="#6b4a2b" stroke-width="3" stroke-linecap="round"/>
    <path d="M12 17.5l17-4.5 0.8 3.6-17 3.6z" fill="#3d3a35" ${INK}/>
    <circle cx="15" cy="23" r="5.5" fill="none" stroke="#5b3b22" stroke-width="2"/>
    <path d="M15 17.5v11M9.5 23h11M11.1 19.1l7.8 7.8M18.9 19.1l-7.8 7.8" stroke="#5b3b22" stroke-width="0.9"/>
    <path d="M4.5 22l-0.8 7M6.5 22l0.8 7" fill="none" ${INK}/><path d="M2.8 13h5l0.8 9H2z" fill="currentColor" ${INK}/>${head(5.4, 10.4, 2.2)}
    <path d="M9 7L4 25" stroke="#5b3b22" stroke-width="1.2"/>`,
  // First World War. British infantryman: Brodie helmet, rifle and bayonet.
  tommy: `${legs(15)}<path d="M8 16L28 12.5" stroke="#6b4a2b" stroke-width="1.8"/><path d="M28 12.5l3.5-0.7" stroke="#c9ccd1" stroke-width="1.1"/>
    ${tunic(15)}${head(15, 7.6)}
    <ellipse cx="15" cy="5.6" rx="6.2" ry="1.1" fill="#6f6c4e" ${INK}/><path d="M11.6 5.4c0-3.4 6.8-3.4 6.8 0z" fill="#6f6c4e" ${INK}/>`,
  // German infantryman: spiked Pickelhaube, rifle and bayonet.
  pickelhaube: `${legs(15)}<path d="M8 16L28 12.5" stroke="#6b4a2b" stroke-width="1.8"/><path d="M28 12.5l3.5-0.7" stroke="#c9ccd1" stroke-width="1.1"/>
    ${tunic(15)}${head(15, 7.6)}
    <path d="M11.2 6.6c0-4.2 7.6-4.2 7.6 0z" fill="#22201c" ${INK}/><path d="M18.4 6.6h2.2" stroke="#22201c" stroke-width="1.2"/>
    <path d="M15 2.6V0.4" stroke="#c9a74a" stroke-width="1.8" stroke-linecap="round"/>`,
  // French infantryman of 1914: kepi, long coat, red trousers.
  poilu: `<path d="M13.5 21l-2.5 8M16.5 21l2.5 8" stroke="#b33a2a" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M8 16L28 12.5" stroke="#6b4a2b" stroke-width="1.8"/><path d="M28 12.5l3.5-0.7" stroke="#c9ccd1" stroke-width="1.1"/>
    <path d="M11.3 10.5h7.4l1.6 12H9.7z" fill="currentColor" ${INK}/>${head(15, 7.6)}
    <path d="M12.3 6.4l0.5-4h4.6l0.4 4z" fill="#b33a2a" ${INK}/><path d="M12.4 5.3h5.1" stroke="#2c3e72" stroke-width="1.6"/><path d="M17.6 6.4h2.2" stroke="#22201c" stroke-width="1.1"/>`,
  // Cavalry of 1914: trooper in a peaked cap with a pennoned lance.
  'cavalry-1914': `<path d="M8 22l-1.5 7M11 23l0.5 6M19 23l-1 6M22 22l2 7" fill="none" ${INK}/>
    <path d="M5 17c0-3 3-5 8-5h7l4-5 4 2-2 3-3 2c0 4-2 8-7 8h-6c-3 0-5-2-5-5z" fill="#7a5a3c" ${INK}/>
    <path d="M5 17l-3 5" fill="none" ${INK}/>
    <path d="M12 12l1-5h5l1 5z" fill="currentColor" ${INK}/>${head(15.5, 4.6, 2.4)}
    <path d="M13 3.8a2.5 2.3 0 0 1 5 0z" fill="#3d3a35"/><path d="M17.4 3.8h2.1" stroke="#22201c" stroke-width="1.1"/>
    <path d="M7 12L31 1.5" stroke="#6b4a2b" stroke-width="1.2"/><path d="M26.5 3.4l3.4-1.4-0.4 2.9z" fill="#f4f1e8" ${INK}/>`,
  // Quick-firing field gun with a steel shield and a gunner.
  'field-gun': `<path d="M4 27L14 21" stroke="#4a4a40" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M13 16.6l16-2.6 0.4 2.4-16 2.7z" fill="#3d3a35" ${INK}/>
    <path d="M12.6 11.6l4.6-0.8 0.8 9-4.6 0.8z" fill="#5d6150" ${INK}/>
    <circle cx="15" cy="23" r="5.2" fill="none" stroke="#3d3a35" stroke-width="2"/>
    <path d="M15 17.8v10.4M9.8 23h10.4M11.3 19.3l7.4 7.4M18.7 19.3l-7.4 7.4" stroke="#3d3a35" stroke-width="0.9"/>
    <path d="M4.5 22l-0.8 7M6.5 22l0.8 7" fill="none" ${INK}/><path d="M2.8 13h5l0.8 9H2z" fill="currentColor" ${INK}/>${head(5.4, 10.4, 2.2)}
    <path d="M3.2 9.4a2.2 2 0 0 1 4.4 0z" fill="#3d3a35"/>`,
  // Early rhomboid tank (British Mark IV): tracks run right round the hull, gun in a side sponson.
  'ww1-tank': `<path d="M2 21L7.5 10.5h17L30.5 20l-3.5 6.5H5z" fill="currentColor" stroke="#3d3a35" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M18.5 10.5V8h4.5v2.5" fill="currentColor" ${INK}/>
    ${[8, 12.5, 17, 21.5, 25.5].map((x) => `<circle cx="${x}" cy="24" r="1.1" fill="#3d3a35"/>`).join('')}
    <path d="M10.5 15h7.5v5.5h-7.5z" fill="currentColor" ${INK}/><path d="M18 16.8h6" stroke="#1d1a16" stroke-width="1.8"/>`,
  // A fortified camp: tents behind a palisade.
  camp: `<path d="M4 20l6-9 6 9zM14 20l6-9 6 9z" fill="#e9e1cc" ${INK}/>
    <path d="M2 22h28v4H2z" fill="currentColor" ${INK}/>${[5, 10, 15, 20, 25].map((x) => `<path d="M${x} 22v-3" stroke="#5b3b22" stroke-width="1.4"/>`).join('')}`,
};

export function figureSvg(type, size) {
  const body = FIGURES[type] ?? FIGURES.spear;
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

// What a unit looks like: its own type, the scene's choice for its side, or a guess from its label.
export function figureFor(item, scene) {
  if (item.type && FIGURES[item.type]) return item.type;
  const l = (item.label ?? '').toLowerCase();
  if (/canoe/.test(l)) return 'canoe';
  if (/brigantine|fleet|ships?\b|galley|navy/.test(l)) return 'ship';
  if (/panzer|armou?r|tank/.test(l)) return 'tank';
  if (/airborne|parachut/.test(l)) return 'para';
  if (/elephant/.test(l)) return 'elephant';
  if (/numidian|light horse/.test(l)) return 'light-cavalry';
  if (/cavalry|horse/.test(l)) return 'cavalry';
  if (/\bcamp\b/.test(l)) return 'camp';
  if (/gaul|spaniard|celt/.test(l)) return 'gaul';
  return scene.figures?.[item.side] ?? scene.figures?.default ?? 'spear';
}

// A marching column for track heads: several figures of the kind.
export function columnSvg(type, size) {
  if (type === 'ship' || type === 'canoe') return figureSvg(type, size * 1.3);
  if (type === 'army-elephants') return `${figureSvg('elephant', size * 1.15)}${figureSvg('spear', size)}${figureSvg('cavalry', size)}`;
  if (type === 'army') return `${figureSvg('cavalry', size)}${figureSvg('legionary', size)}${figureSvg('legionary', size)}`;
  if (type === 'conquistadors') return `${figureSvg('cavalry', size)}${figureSvg('conquistador', size)}${figureSvg('mexica', size)}`;
  if (type === 'army-musket') return `${figureSvg('dragoon', size)}${figureSvg('line-infantry', size)}${figureSvg('cannon', size)}`;
  return `${figureSvg(type, size)}${figureSvg(type, size)}${figureSvg(type, size)}`;
}

export const FIGURE_TYPES = Object.keys(FIGURES);
