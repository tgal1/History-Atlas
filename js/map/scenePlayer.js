// Plays a zoomed-in animation for one event. Scene time runs from 0 to
// scene.duration in the scene's own units (days for a march, stages for a battle).
//
//   tracks  – a moving point with a trail (an army on campaign)
//   units   – a block of troops: position, facing, frontage, depth and
//             strength all keyframed, so formations can wheel, compress and melt
//   markers – labels that pop up at a moment (an ambush, a commander)
//   lines   – static features drawn for the scene (a river)
//   cameras – optional [{ t, bounds }]: the camera moves when scene time reaches t
//
// All positions arrive as [lat, lng]; the loader converts local metres first.
// A keyframe's "via" is the path taken to reach it (roads, a coastline), so
// movement follows the land instead of cutting straight across it.
//
// Units are drawn as a faint footprint filled with little figures (soldiers,
// riders, canoes, tanks: see unitIcons.js) that thin out as strength falls.

import { figureSvg, figureFor, columnSvg } from './unitIcons.js';

const FIG = 22; // figure size in pixels

// What each kind of figure sounds like on the move (anything else marches on foot).
const SOUND_OF = { cavalry: 'hooves', 'light-cavalry': 'hooves', elephant: 'hooves', dragoon: 'hooves', 'cw-cavalry': 'hooves', cuirassier: 'hooves', hussar: 'hooves', cossack: 'hooves', canoe: 'paddles', ship: 'oars', tank: 'engines', para: 'aircraft', knight: 'hooves', 'horse-archer': 'hooves', 'cavalry-1914': 'hooves', 'ww1-tank': 'engines', aircraft: 'aircraft', helicopter: 'aircraft', truck: 'engines', apc: 'engines' };
const MIXED = { army: ['feet', 'hooves'], 'army-elephants': ['feet', 'hooves'], conquistadors: ['feet', 'hooves'], 'army-musket': ['feet', 'hooves'], 'army-cw': ['feet', 'hooves'], 'army-napoleonic': ['feet', 'hooves'], crusaders: ['feet', 'hooves'] };

export function createScenePlayer(map, { factions = {}, onFrame, onEnd, onCamera }) {
  let scene = null;
  let layer = null;
  let tracks = [];
  let units = [];
  let markers = [];
  let st = 0;
  let playing = false;
  let raf = null;
  let last = 0;
  let cameraIndex = -1;

  const cameraAt = (time) => (scene.cameras ?? []).findLastIndex((c) => c.t <= time + 1e-6);

  const colorOf = (item) => item.color ?? factions[item.side]?.color ?? '#ffffff';
  const labelIcon = (cls, color, label) => L.divIcon({
    className: cls,
    html: `<span class="dot" style="--c:${color}"></span>${label ? `<span class="name">${label}</span>` : ''}`,
    iconSize: null,
  });

  function load(sc) {
    clear();
    scene = sc;
    layer = L.layerGroup().addTo(map);

    for (const line of sc.lines) {
      L.polyline(line.points, {
        pane: 'scene', color: line.color ?? '#5aa9ff', weight: line.weight ?? 6, opacity: 0.8, interactive: false,
        dashArray: line.dash ?? null,
      }).addTo(layer);
      if (line.label) {
        L.marker(line.points[line.labelIndex ?? Math.floor(line.points.length / 2)], {
          pane: 'scene', interactive: false,
          icon: L.divIcon({ className: 'scene-line-label', html: `<span>${line.label}</span>`, iconSize: null }),
        }).addTo(layer);
      }
    }

    tracks = sc.tracks.map((track) => {
      const color = colorOf(track);
      const trail = L.polyline([], { pane: 'scene', color, weight: 4, opacity: 0.85, lineCap: 'round' }).addTo(layer);
      const head = L.marker(track.keyframes[0].at, {
        pane: 'scene', interactive: false, icon: L.divIcon({ className: 'scene-col', iconSize: null }),
      }).addTo(layer);
      return { track, trail, head, color, mode: null, west: false };
    });

    units = sc.units.map((unit) => {
      const color = colorOf(unit);
      const trail = unit.trail
        ? L.polyline([], { pane: 'scene', color, weight: 2, opacity: 0.6, dashArray: '6 6' }).addTo(layer)
        : null;
      const body = L.polygon([], {
        pane: 'scene', color, weight: 1, fillColor: color, fillOpacity: 0.6, interactive: false,
      }).addTo(layer);
      const front = L.polyline([], { pane: 'scene', color: '#fff', weight: 2.5, opacity: 0.9, interactive: false }).addTo(layer);
      const label = unit.label
        ? L.marker(unit.keyframes[0].at, {
          pane: 'scene', interactive: false,
          icon: L.divIcon({ className: 'scene-block-label', html: `<span>${unit.label}</span>`, iconSize: null }),
        }).addTo(layer)
        : null;
      const figs = L.marker(unit.keyframes[0].at, {
        pane: 'scene', interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'unit-figs', iconSize: null, html: '' }),
      }).addTo(layer);
      return { unit, trail, body, front, label, figs, type: figureFor(unit, sc), color, count: -1, west: unit.keyframes[0].angle > 180 };
    });
    map.on('zoomend', render);

    markers = sc.markers.map((m) => ({
      m,
      shown: false,
      marker: L.marker(m.at, {
        pane: 'scene', interactive: false,
        icon: labelIcon(`scene-marker${m.pulse ? ' pulse' : ''}`, m.color ?? '#fff', m.label),
      }),
    }));

    st = 0;
    cameraIndex = cameraAt(0); // the opening camera is the caller's job
    seek(0);
  }

  function render() {
    if (!scene) return;
    const cam = cameraAt(st);
    if (cam !== cameraIndex) {
      cameraIndex = cam;
      if (cam >= 0) onCamera?.(scene.cameras[cam].bounds);
    }

    for (const tr of tracks) {
      const { pos, path, leg: current } = samplePath(tr.track.keyframes, st);
      tr.trail.setLatLngs(path);
      tr.head.setLatLng(pos);
      // Ships on sea legs, the marching column on land, facing the way it's going.
      const mode = current?.route === 'sea' ? 'ship' : tr.track.type ?? figureFor(tr.track, scene);
      const p0 = map.latLngToLayerPoint(path.at(-2) ?? pos);
      const p1 = map.latLngToLayerPoint(pos);
      if (Math.abs(p1.x - p0.x) > 0.5) tr.west = p1.x < p0.x;
      if (mode !== tr.mode) {
        tr.mode = mode;
        const name = tr.track.label ? `<span class="name" style="--c:${tr.color}">${tr.track.label}</span>` : '';
        tr.head.setIcon(L.divIcon({
          className: 'scene-col', iconSize: null,
          html: `<div class="col-figs" style="color:${tr.color}">${columnSvg(mode, FIG)}</div>${name}`,
        }));
      }
      tr.head.getElement()?.classList.toggle('west', tr.west);
    }

    for (const u of units) {
      const { unit, trail, body, front, label } = u;
      const s = sampleUnit(unit.keyframes, st);
      const { corners, frontEdge } = block(s);
      const visible = s.strength > 0.02;
      body.setLatLngs(visible ? corners : []);
      body.setStyle({ fillOpacity: 0.06 + 0.2 * s.strength, opacity: 0.25 + 0.4 * s.strength });
      front.setLatLngs(visible ? frontEdge : []);
      front.setStyle({ opacity: 0.6 * s.strength });
      drawFigures(u, s, corners, visible);
      if (trail) trail.setLatLngs(samplePath(unit.keyframes, st).path);
      if (label) {
        label.setLatLng(s.at);
        const el = label.getElement();
        if (el) el.style.opacity = visible ? String(0.35 + 0.65 * s.strength) : '0';
      }
    }

    for (const item of markers) {
      const visible = st >= item.m.t && (item.m.until == null || st < item.m.until);
      if (visible !== item.shown) {
        visible ? item.marker.addTo(layer) : item.marker.remove();
        item.shown = visible;
      }
    }

    const caption = [...(scene.captions ?? [])].reverse().find((c) => c.t <= st + 1e-6);
    onFrame?.({ t: st, progress: st / scene.duration, caption: caption?.text ?? '', action: playing ? measure() : null });
  }

  // How much is happening, for the battle sounds: each kind of unit's speed on
  // screen, and fighting where opposing units touch or units are losing strength.
  function measure() {
    const action = { hooves: 0, feet: 0, oars: 0, paddles: 0, engines: 0, aircraft: 0, melee: 0 };
    const eps = scene.duration * 0.004;
    const realSeconds = eps * (scene.playSeconds / scene.duration);
    const t1 = Math.min(scene.duration, st + eps);
    const pxSpeed = (a, b) => map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b)) / realSeconds;
    const now = units.map((u) => ({ u, s: sampleUnit(u.unit.keyframes, st), s1: sampleUnit(u.unit.keyframes, t1) }));
    for (const { u, s, s1 } of now) {
      if (s.strength < 0.02) continue;
      const moving = Math.min(1, pxSpeed(s.at, s1.at) / 20) * s.strength;
      const kind = SOUND_OF[u.type] ?? 'feet';
      action[kind] += moving * (kind === 'feet' ? 0.9 : 0.5);
      action.melee += Math.max(0, (s.strength - s1.strength) / realSeconds) * 1.5;
    }
    for (let i = 0; i < now.length; i++) {
      for (let j = i + 1; j < now.length; j++) {
        const a = now[i];
        const b = now[j];
        if (a.u.unit.side === b.u.unit.side || a.s.strength < 0.1 || b.s.strength < 0.1) continue;
        const reach = (Math.hypot(a.s.w, a.s.d) + Math.hypot(b.s.w, b.s.d)) / 2;
        if (map.distance(a.s.at, b.s.at) < reach * 0.75) action.melee += Math.min(a.s.strength, b.s.strength) * 0.45;
      }
    }
    for (const tr of tracks) {
      const { pos } = samplePath(tr.track.keyframes, st);
      const { pos: pos1 } = samplePath(tr.track.keyframes, t1);
      const moving = Math.min(1, pxSpeed(pos, pos1) / 18);
      for (const kind of MIXED[tr.mode] ?? [SOUND_OF[tr.mode] ?? 'feet']) action[kind] += moving * 0.7;
    }
    return action;
  }

  // The kind of fighting, for the battle sounds.
  function era() {
    const types = new Set([...units.map((u) => u.type), ...tracks.map((tr) => tr.track.type ?? figureFor(tr.track, scene))]);
    if (['soldier', 'tank', 'para', 'tommy', 'pickelhaube', 'poilu', 'cavalry-1914', 'gun-1914', 'ww1-tank', 'aircraft', 'helicopter', 'truck', 'apc'].some((x) => types.has(x))) return 'modern';
    if (['line-infantry', 'rifleman', 'dragoon', 'cannon', 'army-musket', 'union', 'confederate', 'cw-cavalry', 'cw-gun', 'army-cw', 'fusilier', 'cuirassier', 'hussar', 'cossack', 'field-gun', 'army-napoleonic'].some((x) => types.has(x))) return 'musket';
    if (['conquistador', 'conquistadors', 'mexica', 'canoe'].some((x) => types.has(x))) return 'conquest';
    if (types.size && [...types].every((x) => x === 'marcher' || x === 'marchers')) return 'civil';
    return 'ancient';
  }

  function frame(now) {
    raf = null;
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    st += dt * (scene.duration / scene.playSeconds);
    if (st >= scene.duration) {
      st = scene.duration;
      playing = false;
      render();
      onEnd?.();
      return;
    }
    render();
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (!scene) return;
    if (st >= scene.duration) st = 0;
    playing = true;
    last = performance.now();
    if (raf == null) raf = requestAnimationFrame(frame);
  }

  function pause() { playing = false; }

  function seek(fraction) {
    if (!scene) return;
    st = Math.max(0, Math.min(1, fraction)) * scene.duration;
    render();
  }

  // Fill a unit's footprint with figures in rows, front rank first.
  function drawFigures(u, s, corners, visible) {
    u.figs.setLatLng(s.at);
    const el = u.figs.getElement();
    if (!el) return;
    if (!visible) { el.style.display = 'none'; return; }
    el.style.display = '';
    const c0 = map.latLngToLayerPoint(s.at);
    const [fl, fr, , bl] = corners.map((ll) => map.latLngToLayerPoint(ll).subtract(c0));
    const cols = Math.max(1, Math.min(10, Math.round(fl.distanceTo(fr) / (FIG * 0.8))));
    const rows = Math.max(1, Math.min(3, Math.round(fl.distanceTo(bl) / (FIG * 0.9))));
    const count = cols * rows;
    if (count !== u.count) {
      u.count = count;
      el.innerHTML = Array.from({ length: count }, () => `<div class="fig" style="color:${u.color}">${figureSvg(u.type, FIG)}</div>`).join('');
    }
    const east = Math.sin((s.angle * Math.PI) / 180);
    if (Math.abs(east) > 0.2) u.west = east < 0;
    const shown = Math.max(1, Math.ceil(count * s.strength));
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++, i++) {
        const fig = el.children[i];
        const a = (c + 0.5) / cols;
        const b = (r + 0.5) / rows;
        const x = fl.x + (fr.x - fl.x) * a + (bl.x - fl.x) * b;
        const y = fl.y + (fr.y - fl.y) * a + (bl.y - fl.y) * b;
        fig.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${u.west ? ' scaleX(-1)' : ''}`;
        fig.style.zIndex = String(Math.round(y + 500));
        fig.style.display = i < shown ? '' : 'none';
      }
    }
    el.style.opacity = String(0.4 + 0.6 * s.strength);
  }

  function clear() {
    map.off('zoomend', render);
    playing = false;
    layer?.remove();
    layer = null;
    scene = null;
    tracks = [];
    units = [];
    markers = [];
  }

  return {
    load, play, pause, seek, clear,
    get playing() { return playing; },
    get scene() { return scene; },
    get era() { return scene ? era() : null; },
  };
}

const lerp = (a, b, f) => a + (b - a) * f;
const lerpLatLng = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];

// Turn the short way round (350° -> 10° goes through north).
function lerpAngle(a, b, f) {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return a + diff * f;
}

// The points of the leg from keyframe a to b, and the distance along it at each.
function leg(a, b) {
  if (!b._leg || b._from !== a.at) {
    const pts = [a.at, ...(b.via ?? []), b.at];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const dy = pts[i][0] - pts[i - 1][0];
      const dx = (pts[i][1] - pts[i - 1][1]) * Math.cos((pts[i][0] * Math.PI) / 180);
      cum.push(cum[i - 1] + Math.hypot(dx, dy));
    }
    b._leg = { pts, cum };
    b._from = a.at;
  }
  return b._leg;
}

// The point a fraction f of the way along a leg (by distance), and the waypoints passed.
function along(a, b, f) {
  const { pts, cum } = leg(a, b);
  const total = cum.at(-1);
  if (total === 0 || pts.length === 2) return { pos: lerpLatLng(a.at, b.at, f), passed: [] };
  const d = f * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  return { pos: lerpLatLng(pts[i - 1], pts[i], (d - cum[i - 1]) / seg), passed: pts.slice(1, i) };
}

// Position at scene time t, the trail travelled so far, and the keyframe ending the current leg.
function samplePath(keyframes, t) {
  const path = [keyframes[0].at];
  if (t <= keyframes[0].t) return { pos: keyframes[0].at, path, leg: keyframes[1] };
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (t < b.t) {
      const { pos, passed } = along(a, b, (t - a.t) / (b.t - a.t));
      path.push(...passed, pos);
      return { pos, path, leg: b };
    }
    path.push(...leg(a, b).pts.slice(1));
  }
  return { pos: keyframes[keyframes.length - 1].at, path, leg: keyframes[keyframes.length - 1] };
}

function sampleUnit(keyframes, t) {
  if (t <= keyframes[0].t) return keyframes[0];
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (t < b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return {
        at: along(a, b, f).pos,
        angle: lerpAngle(a.angle, b.angle, f),
        w: lerp(a.w, b.w, f),
        d: lerp(a.d, b.d, f),
        strength: lerp(a.strength, b.strength, f),
      };
    }
  }
  return keyframes[keyframes.length - 1];
}

// Rectangle for a block of troops. angle = direction it faces, degrees
// clockwise from north; w = frontage, d = depth, both in metres.
function block({ at, angle, w, d }) {
  const rad = (angle * Math.PI) / 180;
  const f = [Math.sin(rad), Math.cos(rad)]; // facing, as [east, north]
  const r = [Math.cos(rad), -Math.sin(rad)]; // to the unit's right
  const mPerLng = 111_320 * Math.cos((at[0] * Math.PI) / 180);
  const pt = (side, fwd) => [
    at[0] + (r[1] * side + f[1] * fwd) / 111_320,
    at[1] + (r[0] * side + f[0] * fwd) / mPerLng,
  ];
  const hw = w / 2;
  const hd = d / 2;
  return {
    corners: [pt(-hw, hd), pt(hw, hd), pt(hw, -hd), pt(-hw, -hd)],
    frontEdge: [pt(-hw, hd), pt(hw, hd)],
  };
}
