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
        pane: 'scene', interactive: false, icon: labelIcon('scene-unit', color, track.label),
      }).addTo(layer);
      return { track, trail, head };
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
      return { unit, trail, body, front, label };
    });

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
    const cam = cameraAt(st);
    if (cam !== cameraIndex) {
      cameraIndex = cam;
      if (cam >= 0) onCamera?.(scene.cameras[cam].bounds);
    }

    for (const { track, trail, head } of tracks) {
      const { pos, path } = samplePath(track.keyframes, st);
      trail.setLatLngs(path);
      head.setLatLng(pos);
    }

    for (const { unit, trail, body, front, label } of units) {
      const s = sampleUnit(unit.keyframes, st);
      const { corners, frontEdge } = block(s);
      const visible = s.strength > 0.02;
      body.setLatLngs(visible ? corners : []);
      body.setStyle({ fillOpacity: 0.15 + 0.6 * s.strength, opacity: 0.4 + 0.6 * s.strength });
      front.setLatLngs(visible ? frontEdge : []);
      front.setStyle({ opacity: 0.9 * s.strength });
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
    onFrame?.({ t: st, progress: st / scene.duration, caption: caption?.text ?? '' });
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

  function clear() {
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
  };
}

const lerp = (a, b, f) => a + (b - a) * f;
const lerpLatLng = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];

// Turn the short way round (350° -> 10° goes through north).
function lerpAngle(a, b, f) {
  const diff = ((((b - a) % 360) + 540) % 360) - 180;
  return a + diff * f;
}

// Position at scene time t, plus the trail travelled so far.
function samplePath(keyframes, t) {
  const path = [keyframes[0].at];
  if (t <= keyframes[0].t) return { pos: keyframes[0].at, path };
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (t < b.t) {
      const pos = lerpLatLng(a.at, b.at, (t - a.t) / (b.t - a.t));
      path.push(pos);
      return { pos, path };
    }
    path.push(b.at);
  }
  return { pos: keyframes[keyframes.length - 1].at, path };
}

function sampleUnit(keyframes, t) {
  if (t <= keyframes[0].t) return keyframes[0];
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (t < b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return {
        at: lerpLatLng(a.at, b.at, f),
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
