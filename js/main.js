// Boots a story and wires every module to the shared store.
// Flow: store.t changes -> map layers, timeline and HUD re-render.
// The tour (player) moves store.t and calls tourStop() at each event.

import { createStore } from './core/store.js';
import { createPlayer, sleep } from './core/player.js';
import { configureCalendar, formatDate, formatEventDate, parseDate } from './core/time.js';
import { loadCatalog, loadStory } from './data/loader.js';
import { createMapView } from './map/mapView.js';
import { createEventLayer } from './map/eventLayer.js';
import { createTerritoryLayer } from './map/territoryLayer.js';
import { createLabelLayer } from './map/labelLayer.js';
import { createScenePlayer } from './map/scenePlayer.js';
import { createCityLayer, labelPoint } from './map/cityLayer.js';
import { createCity3D } from './map3d/city3d.js';
import { createTimeline } from './ui/timeline.js';
import { createEventPanel } from './ui/eventPanel.js';
import { createSceneBar } from './ui/sceneBar.js';
import { createLegend } from './ui/legend.js';
import { createMenu } from './ui/menu.js';

const $ = (s) => document.querySelector(s);

// Tour pacing. dwell scales how long the tour lingers on each card.
const SPEEDS = {
  relaxed: { yearsPerSec: 0.35, dwell: 1.4 },
  normal: { yearsPerSec: 0.6, dwell: 1 },
  fast: { yearsPerSec: 1.2, dwell: 0.55 },
};

async function boot() {
  const catalog = await loadCatalog();
  const params = new URLSearchParams(location.search);
  const storyId = params.get('story') ?? catalog.default;
  const menu = createMenu($('#menu'), { catalog, currentStory: storyId });
  $('#btn-menu').addEventListener('click', () => menu.open());
  // First visit: offer the menu instead of dropping straight into a story.
  if (!params.has('story') && !location.hash) menu.open();
  const { story, events, territories, scenes, cities } = await loadStory(storyId);
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const byId = new Map(events.map((e) => [e.id, e]));
  configureCalendar(story.calendar);

  document.title = `${story.title} · History Atlas`;
  $('#story-title').textContent = story.title;
  $('#story-subtitle').textContent = story.subtitle;

  const store = createStore({ t: story.range.t0, playing: false, speed: 'normal', tourMode: true, activeId: null });

  // ---------- Map ----------
  const view = createMapView($('#map'), story, {
    overlayPadding: () => {
      const mapBox = $('#map').getBoundingClientRect();
      if (mapBox.width < 760) return { topLeft: [10, $('.hud').getBoundingClientRect().bottom - mapBox.top + 10] };
      const left = Math.max($('.hud').getBoundingClientRect().right, $('#legend').getBoundingClientRect().right);
      return { topLeft: [left - mapBox.left + 10, 20], bottomRight: [20, 20] };
    },
  });
  const eventLayer = createEventLayer(view.map, events, story.categories, { onSelect: (id) => userSelect(id) });
  // With city plans, territory shading steps aside once you zoom into a city.
  const territory = createTerritoryLayer(view.map, territories, story.factions ?? {}, {
    defaultMaxZoom: cities.length ? 11.75 : null,
  });
  const cityLayer = createCityLayer(view.map, cities, { onSelect: (feature, city) => showPlace(feature, city) });
  const city3d = createCity3D($('#city3d'), { onSelect: (feature, city) => showPlace(feature, city) });
  const labels = createLabelLayer(view.map, story.mapLabels);
  const legend = createLegend($('#legend'), story);

  // ---------- Timeline & controls ----------
  const timeline = createTimeline($('#tl-track'), {
    story, events,
    onScrub: (t) => { stopTour(); closeScene(); store.set({ t, activeId: null }); player.resync(t); },
    onSelect: (id) => userSelect(id),
  });

  // ---------- Panels ----------
  const panel = createEventPanel($('#panel-event'), {
    story,
    cities,
    onExploreCity: (id) => openCity(cityById.get(id)),
    onPrev: () => step(-1),
    onNext: () => step(1),
    onPlayScene: () => { const ev = byId.get(store.get().activeId); if (ev?.scene) { stopTour(); runScene(ev); } },
    onStartTour: () => { close3D(); closeScene(); store.set({ t: story.range.t0, activeId: null }); player.play(); },
  });

  // ---------- Scenes ----------
  let sceneDone = null;
  const scenePlayer = createScenePlayer(view.map, {
    factions: story.factions,
    onCamera: (bounds) => view.flyToBounds(bounds, { duration: 1.5, padding: overlayPadding() }),
    onFrame: (f) => sceneBar.update(f),
    onEnd: () => { sceneBar.setPlaying(false); sceneDone?.(); },
  });
  const sceneBar = createSceneBar($('#scene-bar'), {
    onToggle: () => {
      scenePlayer.playing ? scenePlayer.pause() : scenePlayer.play();
      sceneBar.setPlaying(scenePlayer.playing);
    },
    onSeek: (f) => { scenePlayer.pause(); sceneBar.setPlaying(false); scenePlayer.seek(f); },
    onClose: () => {
      const wasTour = store.get().playing;
      closeScene();
      sceneDone?.();
      const ev = byId.get(store.get().activeId);
      if (ev && !wasTour) view.flyToEvent(ev, 1.4);
    },
  });

  async function runScene(ev, signal) {
    const scene = scenes[ev.scene];
    scenePlayer.load(scene);
    sceneBar.show(scene);
    sceneBar.setPlaying(true);
    document.body.classList.add('in-scene');
    document.body.classList.toggle('scene-dim', Boolean(scene.dimMap));
    await view.flyToBounds(scene.cameras?.[0]?.bounds ?? scene.view.bounds, { padding: overlayPadding() });
    if (signal?.aborted) return;
    scenePlayer.play();
    await new Promise((resolve) => {
      sceneDone = resolve;
      signal?.addEventListener('abort', resolve, { once: true });
    });
    sceneDone = null;
  }

  // Keep scene action clear of the HUD (top-left) and scene bar (bottom).
  function overlayPadding() {
    const mapBox = $('#map').getBoundingClientRect();
    const hud = $('.hud').getBoundingClientRect();
    const bar = $('#scene-bar').getBoundingClientRect();
    const narrow = mapBox.width < 760;
    return {
      topLeft: narrow ? [20, hud.bottom - mapBox.top + 10] : [hud.right - mapBox.left + 20, 30],
      bottomRight: [30, mapBox.bottom - bar.top + 20],
    };
  }

  function closeScene() {
    scenePlayer.clear();
    sceneBar.hide();
    document.body.classList.remove('in-scene', 'scene-dim');
  }

  // ---------- Tour ----------
  let tour = null; // AbortController for the current stop

  const player = createPlayer({
    store, events, range: story.range,
    rate: () => SPEEDS[store.get().speed].yearsPerSec,
    onEventReached: tourStop,
  });

  async function tourStop(ev) {
    tour = new AbortController();
    const { signal } = tour;
    select(ev);
    await view.flyToEvent(ev);
    if (signal.aborted) return;
    if (ev.scene && scenes[ev.scene]) {
      await runScene(ev, signal);
      if (signal.aborted) return;
    }
    const pace = SPEEDS[store.get().speed];
    const readMs = 3500 + (ev.summary.length + (ev.significance?.length ?? 0) * 0.6) * 22;
    await sleep(readMs * pace.dwell, signal);
    if (signal.aborted) return;
    closeScene();
    // Skip the zoom-out when the next stop is just down the road.
    const next = events[events.indexOf(ev) + 1];
    const near = next && view.map.distance(ev.coords, next.coords) < 40_000;
    if (!near) await view.flyOverview();
  }

  function stopTour() {
    tour?.abort();
    if (store.get().playing) player.pause();
  }

  // ---------- Selection ----------
  function select(ev) {
    store.set({ activeId: ev.id, t: ev.t });
    player.resync(ev.t);
    const i = events.indexOf(ev);
    panel.renderEvent(ev, { prev: events[i - 1], next: events[i + 1], scene: ev.scene ? scenes[ev.scene] : null });
    showPanel();
    history.replaceState(null, '', `${location.search}#${ev.id}`);
  }

  function userSelect(id) {
    const ev = byId.get(id);
    if (!ev) return;
    stopTour();
    closeScene();
    close3D();
    select(ev);
    view.flyToEvent(ev);
  }

  function step(dir) {
    const s = store.get();
    // During the tour, "next" just skips the wait.
    if (dir > 0 && s.playing && tour && !tour.signal.aborted) { tour.abort(); closeScene(); return; }
    const current = s.activeId ? events.indexOf(byId.get(s.activeId)) : -1;
    let i;
    if (current >= 0) i = current + dir;
    else if (dir > 0) i = events.findIndex((e) => e.t > s.t);
    else i = events.findLastIndex((e) => e.t < s.t);
    if (events[i]) userSelect(events[i].id);
  }

  // ---------- Rendering ----------
  function eraAt(t) {
    return story.eras?.find((e) => t >= e.t0 && t < e.t1) ?? story.eras?.at(-1);
  }

  let shownEra = null;
  function render(s) {
    const zoom = view.map.getZoom();
    eventLayer.update(s.t, s.activeId);
    legend.setFactions(territory.update(s.t, zoom));
    labels.update(s.t, zoom);
    cityLayer.update(s.t, zoom);
    if (city3d.isOpen) city3d.update(s.t);
    updateCityChip(s.t, zoom);
    timeline.setTime(s.t);
    timeline.setActive(s.activeId);
    // On an event, show its date as precisely as the data knows it;
    // otherwise the story's clock precision (ancient stories count in years).
    const active = byId.get(s.activeId);
    $('#tl-date').textContent = active && Math.abs(active.t - s.t) < 1e-6
      ? formatEventDate(active)
      : formatDate(s.t, story.clockPrecision ?? (s.playing && !player.holding ? 'month' : 'day'));
    const era = eraAt(s.t);
    if (era && era !== shownEra) {
      shownEra = era;
      $('#era-title').textContent = era.title;
      $('#era-text').textContent = era.text;
    }
  }

  store.subscribe((s, prev) => {
    render(s);
    if (s.playing !== prev.playing) {
      $('#btn-play').innerHTML = s.playing ? '&#10074;&#10074;' : '&#9654;';
      $('#btn-play').setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      document.body.classList.toggle('playing', s.playing);
    }
  });
  view.map.on('zoomend', () => render(store.get()));
  view.map.on('moveend', () => updateCityChip(store.get().t, view.map.getZoom()));

  // ---------- City plans ----------
  // Zoomed into a city: fade the base map so the plan reads like a drawn map,
  // and offer a guide to whichever city is on screen.
  let chipCity = null;
  function updateCityChip(t, zoom) {
    if (city3d.isOpen) return;
    const inCity = cities.length > 0 && zoom >= 12.5;
    $('#map').classList.toggle('city-zoom', inCity);
    $('#then-now').hidden = !inCity;
    if (!inCity) setThenNow(0);
    const centre = view.map.getCenter();
    chipCity = zoom >= 11 ? cities.find((c) => t >= c.t0 && t < c.t1
      && view.map.distance(centre, c.center) < c.radiusKm * 1000 * 1.5) ?? null : null;
    const chip = $('#city-chip');
    chip.hidden = !chipCity;
    if (chipCity) chip.innerHTML = `Explore <strong>${chipCity.name}</strong> &rarr;`;
    $('#btn-3d').hidden = !chipCity?.view3d;
  }
  $('#city-chip').addEventListener('click', () => chipCity && openCity(chipCity));
  $('#btn-3d').addEventListener('click', () => (city3d.isOpen ? close3D() : chipCity && open3D(chipCity)));

  // ---------- 3D city ----------
  function open3D(city) {
    stopTour();
    closeScene();
    const here = view.map.getCenter();
    const near = view.map.distance(here, city.center) < city.radiusKm * 1000;
    document.body.classList.add('view-3d');
    $('#btn-3d').hidden = false;
    $('#btn-3d').innerHTML = '&larr; Back to the flat map';
    $('#then-now').hidden = false;
    city3d.setImagery(Number($('#then-now input').value) / 100);
    city3d.open(city, {
      center: near ? [here.lat, here.lng] : city.center,
      zoom: Math.max(near ? view.map.getZoom() : city.zoom, 14.5),
      t: store.get().t,
    }).catch((err) => {
      console.error(err);
      close3D();
    });
  }

  function close3D() {
    if (!city3d.isOpen) return;
    city3d.close();
    document.body.classList.remove('view-3d');
    $('#btn-3d').textContent = 'View in 3D';
    setThenNow(Number($('#then-now input').value) / 100);
    updateCityChip(store.get().t, view.map.getZoom());
  }

  // Then ⟷ Today: fade the drawn plan over modern satellite imagery.
  function setThenNow(v) {
    const slider = $('#then-now input');
    if (Number(slider.value) !== v * 100) slider.value = v * 100;
    view.setImagery(v > 0);
    view.map.getPane('city').style.opacity = String(1 - v);
    view.map.getPane('city-labels').style.opacity = String(1 - v * 0.7);
    $('#map').classList.toggle('imagery-on', v > 0);
  }
  $('#then-now input').addEventListener('input', (e) => {
    const v = Number(e.target.value) / 100;
    if (city3d.isOpen) city3d.setImagery(v);
    else setThenNow(v);
  });

  let lastCityFromEvent = null;
  function openCity(city, { fly = true } = {}) {
    if (!city) return;
    stopTour();
    closeScene();
    const fromEvent = byId.get(store.get().activeId);
    if (fromEvent) lastCityFromEvent = fromEvent;
    panel.renderCity(city, cityLayer.landmarksAt(city, store.get().t), {
      t: store.get().t,
      onLandmark: (feature) => showPlace(feature, city),
      onBack: lastCityFromEvent ? () => userSelect(lastCityFromEvent.id) : null,
      on3D: city.view3d && !city3d.isOpen ? () => open3D(city) : null,
    });
    showPanel();
    if (fly && !city3d.isOpen) view.map.flyTo(city.center, city.zoom, { duration: 1.6 });
  }

  function showPlace(feature, city) {
    stopTour();
    panel.renderPlace(feature, city, { onBack: () => openCity(city, { fly: false }) });
    showPanel();
    if (city3d.isOpen) { city3d.flyTo(feature); return; }
    const zoom = Math.max(view.map.getZoom(), feature.properties.zoom ?? 15);
    view.map.flyTo(labelPoint(feature), zoom, { duration: 1.2 });
  }

  // ---------- Controls ----------
  $('#btn-play').addEventListener('click', () => {
    if (store.get().playing) stopTour();
    else { close3D(); closeScene(); player.play(); }
  });
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  $('#tour-mode').addEventListener('change', (e) => store.set({ tourMode: e.target.checked }));
  $('#speed').addEventListener('change', (e) => store.set({ speed: e.target.value }));

  // ---------- Panel ----------
  function showPanel() {
    document.body.classList.remove('panel-closed');
  }
  $('#panel-close').addEventListener('click', () => document.body.classList.toggle('panel-closed'));
  // The map resizes when the panel opens or closes; let Leaflet catch up.
  $('#map').addEventListener('transitionend', () => view.map.invalidateSize({ pan: false }));
  $('#btn-intro').addEventListener('click', () => { stopTour(); panel.renderIntro(); showPanel(); });

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || menu.isOpen) return;
    if (e.key === ' ') { e.preventDefault(); $('#btn-play').click(); }
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Escape') {
      if (city3d.isOpen) { close3D(); return; }
      stopTour();
      closeScene();
      store.set({ activeId: null });
      view.flyOverview();
    }
  });

  // Handy from the browser console when authoring a story.
  window.atlas = { story, events, scenes, store, map: view.map, scenePlayer, city3d };

  // ---------- Start ----------
  const startId = decodeURIComponent(location.hash.slice(1));
  const startCity = cityById.get(params.get('city'));
  if (startCity) {
    // Opened from the Cities menu: ?story=rome&city=rome&t=150[&view=3d]
    const t = params.get('t') ? parseDate(params.get('t')) : store.get().t;
    store.set({ t });
    player.resync(t);
    view.map.setView(startCity.center, startCity.zoom, { animate: false });
    openCity(startCity, { fly: false });
    if (params.get('view') === '3d' && startCity.view3d) open3D(startCity);
  } else if (byId.has(startId)) {
    const ev = byId.get(startId);
    select(ev);
    view.map.setView(ev.coords, ev.zoom ?? 13);
  } else {
    panel.renderIntro();
    render(store.get());
  }
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    `<div class="fatal"><h2>Couldn't load the story</h2><p>${err.message}</p>
     <p>Run it through a local web server (see README), not by double-clicking index.html.</p></div>`);
});
