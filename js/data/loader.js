// Loads a story bundle from data/stories/<id>/ and normalises it:
// every date becomes a decimal year (t, t0, t1), events are sorted,
// territories are clipped to the coast when asked, and scenes drawn in
// local metres are converted to lat/lng.

import { datePrecision, parseDate } from '../core/time.js';
import { clipToLand } from '../map/landMask.js';

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

export function loadCatalog() {
  return getJSON('data/catalog.json');
}

export async function loadStory(id) {
  const base = `data/stories/${id}/`;
  const story = await getJSON(`${base}story.json`);
  const files = story.files ?? {};

  const [events, territories, scenes, cities] = await Promise.all([
    getJSON(base + (files.events ?? 'events.json')),
    files.territories ? getJSON(base + files.territories) : { type: 'FeatureCollection', features: [] },
    files.scenes ? getJSON(base + files.scenes) : {},
    // City plans live in a shared library so one city can serve several stories.
    Promise.all((story.cities ?? []).map((id) => getJSON(`data/cities/${id}.geojson`))),
  ]);

  story.range.t0 = parseDate(story.range.start);
  story.range.t1 = parseDate(story.range.end);
  for (const era of story.eras ?? []) {
    era.t0 = parseDate(era.start);
    era.t1 = parseDate(era.end);
  }
  for (const label of story.mapLabels ?? []) {
    label.t0 = label.from ? parseDate(label.from) : -Infinity;
    label.t1 = label.to ? parseDate(label.to) : Infinity;
  }
  // Clip once per shape, before a region's periods fan out into many features.
  if (story.landMask) {
    try {
      await clipToLand(territories.features, story.landMask.bbox);
    } catch (err) {
      console.warn('[data] coastline clipping failed; showing raw outlines', err);
    }
  }
  territories.features = territories.features.flatMap(expandPeriods);
  for (const f of territories.features) {
    const p = f.properties;
    p.t0 = p.from ? parseDate(p.from) : -Infinity;
    p.t1 = p.to ? parseDate(p.to) : Infinity;
  }

  for (const scene of Object.values(scenes)) normaliseScene(scene);

  const cityList = cities.map(normaliseCity);

  for (const ev of events) {
    ev.t = parseDate(ev.date);
    ev.precision = datePrecision(ev.date);
    // Events inside a city's radius get an "Explore the city" button.
    ev.city ??= cityList.find((c) => ev.t >= c.t0 && ev.t < c.t1 && distanceKm(ev.coords, c.center) <= c.radiusKm)?.id;
    validateEvent(ev, story, scenes);
  }
  events.sort((a, b) => a.t - b.t);

  return { story, events, territories, scenes, cities: cityList };
}

// A city file is a GeoJSON FeatureCollection with a "city" member for its metadata.
function normaliseCity(fc) {
  const city = { ...fc.city, features: fc.features };
  city.t0 = city.from ? parseDate(city.from) : -Infinity;
  city.t1 = city.to ? parseDate(city.to) : Infinity;
  city.radiusKm ??= 4;
  for (const f of city.features) {
    const p = f.properties;
    p.t0 = p.from ? parseDate(p.from) : -Infinity;
    p.t1 = p.to ? parseDate(p.to) : Infinity;
  }
  return city;
}

// Chaikin corner-cutting, two passes, keeping the end points.
function roundCorners(points) {
  let pts = points;
  for (let pass = 0; pass < 2; pass++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(pts.at(-1));
    pts = out;
  }
  return pts;
}

function distanceKm([lat1, lng1], [lat2, lng2]) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLng = (lng2 - lng1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}

// A region drawn once can change hands many times:
// "periods": [{ "faction": "rome", "from": "-120", "to": "260" }, ...]
// becomes one feature per period, all sharing the region's shape.
function expandPeriods(feature) {
  const { periods, ...base } = feature.properties;
  if (!periods) return [feature];
  return periods.map((period, i) => ({
    type: 'Feature',
    geometry: feature.geometry,
    properties: { ...base, ...period, id: `${base.id}-${i}`, region: base.label, label: period.label ?? null },
  }));
}

function validateEvent(ev, story, scenes) {
  const problems = [];
  if (!ev.id) problems.push('missing id');
  if (!Array.isArray(ev.coords) || ev.coords.length !== 2) problems.push('coords must be [lat, lng]');
  if (!story.categories?.[ev.category]) problems.push(`unknown category "${ev.category}"`);
  if (ev.scene && !scenes[ev.scene]) problems.push(`unknown scene "${ev.scene}"`);
  if (ev.victor && !story.factions?.[ev.victor]) problems.push(`unknown victor "${ev.victor}"`);
  if (problems.length) console.warn(`[data] event ${ev.id ?? '(no id)'}: ${problems.join('; ')}`);
}

// Scenes may be authored in metres from an origin ("xy": [east, north]),
// which is far easier for battle layouts. Convert all of it to "at": [lat, lng]
// and work out a camera box if the scene didn't give one.
function normaliseScene(scene) {
  const origin = scene.frame?.origin;
  const toLatLng = ([x, y]) => [
    origin[0] + y / 111_320,
    origin[1] + x / (111_320 * Math.cos((origin[0] * Math.PI) / 180)),
  ];
  const fix = (obj) => { if (obj.xy && origin) obj.at = toLatLng(obj.xy); };

  scene.tracks ??= [];
  scene.units ??= [];
  scene.markers ??= [];
  scene.lines ??= [];
  scene.tracks.forEach((tr) => tr.keyframes.forEach(fix));
  scene.units.forEach((u) => u.keyframes.forEach(fix));
  // "via": the path taken to reach a keyframe. Sea legs are hand-placed, so round their corners.
  for (const item of [...scene.tracks, ...scene.units]) {
    item.keyframes.forEach((k, i) => {
      if (origin && k.viaXy) k.via = k.viaXy.map(toLatLng);
      const prev = item.keyframes[i - 1];
      if (k.via?.length && prev?.at && k.at && k.route === 'sea') k.via = roundCorners([prev.at, ...k.via, k.at]).slice(1, -1);
    });
  }
  scene.markers.forEach(fix);
  scene.lines.forEach((ln) => { if (origin && ln.xy) ln.points = ln.xy.map(toLatLng); });

  // A unit keyframe only lists what changes; carry everything else forward.
  for (const unit of scene.units) {
    let prev = { angle: 0, strength: 1, w: unit.w, d: unit.d, at: null };
    unit.keyframes.sort((a, b) => a.t - b.t);
    for (const k of unit.keyframes) {
      for (const key of ['at', 'angle', 'w', 'd', 'strength']) k[key] ??= prev[key];
      prev = k;
    }
  }

  if (origin && scene.view?.xy) scene.view.bounds = scene.view.xy.map(toLatLng);
  for (const cam of scene.cameras ?? []) if (origin && cam.xy) cam.bounds = cam.xy.map(toLatLng);
  if (!scene.view?.bounds) {
    const pts = [
      ...scene.tracks.flatMap((tr) => tr.keyframes.map((k) => k.at)),
      ...scene.units.flatMap((u) => u.keyframes.map((k) => k.at)),
      ...scene.markers.map((m) => m.at),
    ];
    const lats = pts.map((p) => p[0]);
    const lngs = pts.map((p) => p[1]);
    scene.view = { ...scene.view, bounds: [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]] };
  }
}
