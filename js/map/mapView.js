// Leaflet map setup plus camera moves that return promises,
// so the tour can await "fly to Dublin" before showing the next thing.

import { BASEMAPS } from './basemaps.js';

// overlayPadding(): { topLeft, bottomRight } in pixels, so the overview
// isn't hidden behind the HUD and legend.
export function createMapView(el, story, { overlayPadding = () => ({}) } = {}) {
  const style = BASEMAPS[story.basemap] ?? BASEMAPS['esri-dark'];
  const map = L.map(el, {
    zoomControl: false,
    minZoom: story.minZoom ?? 3,
    maxZoom: style.maxZoom ?? 18,
    zoomSnap: 0.25,
    // Canvas draws dots, territories and scene blocks far faster than SVG,
    // especially coastline-clipped shapes with thousands of points.
    preferCanvas: true,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  el.classList.add(`map-${style.theme ?? 'dark'}`);
  if (style.background) el.style.background = style.background;

  // Don't fetch tiles mid-flight; keep extra tiles around so pans don't flash.
  const tileOptions = { updateWhenZooming: false, keepBuffer: 4 };

  // maxNativeZoom lets the camera go closer than the tiles exist (battle close-ups).
  L.tileLayer(style.base, {
    ...tileOptions,
    attribution: style.attribution,
    maxZoom: style.maxZoom ?? 18,
    maxNativeZoom: style.maxNativeZoom ?? style.maxZoom ?? 18,
    opacity: style.opacity ?? 1,
  }).addTo(map);
  if (style.detail) {
    L.tileLayer(style.detail.url, {
      ...tileOptions,
      minZoom: style.detail.minZoom,
      maxZoom: style.maxZoom ?? 18,
      maxNativeZoom: style.detail.maxNativeZoom,
      opacity: style.detail.opacity,
      className: 'detail-tiles',
    }).addTo(map);
  }

  // Panes stack: territories < markers < labels < scene units.
  map.createPane('territory').style.zIndex = 350;
  map.createPane('labels').style.zIndex = 450;
  map.getPane('labels').style.pointerEvents = 'none';
  map.createPane('scene').style.zIndex = 640;
  if (style.labels) {
    L.tileLayer(style.labels, { ...tileOptions, pane: 'labels', maxZoom: style.maxZoom ?? 18 }).addTo(map);
  }

  // overview.bounds fits any screen size; center + zoom is the fallback.
  const { center, zoom, bounds } = story.overview;
  const fitOptions = () => {
    const p = overlayPadding();
    return { paddingTopLeft: p.topLeft ?? [20, 20], paddingBottomRight: p.bottomRight ?? [20, 20] };
  };
  if (bounds) map.fitBounds(bounds, fitOptions());
  else map.setView(center, zoom);

  // Modern satellite imagery for "Then ⟷ Today" comparisons in city plans.
  map.createPane('imagery').style.zIndex = 250;
  let imagery = null;
  function setImagery(on) {
    if (on && !imagery) {
      imagery = L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, {
        pane: 'imagery', maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
      });
    }
    if (on && !map.hasLayer(imagery)) imagery.addTo(map);
    if (!on && imagery && map.hasLayer(imagery)) imagery.remove();
  }

  // Resolves on moveend, or shortly after the planned duration in case
  // Leaflet skips the animation (already in place, tab hidden, etc).
  function move(fn, duration) {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); map.off('moveend', done); resolve(); };
      const timer = setTimeout(done, duration * 1000 + 500);
      map.once('moveend', done);
      fn();
    });
  }

  return {
    map,
    setImagery,
    flyOverview: (duration = 1.6) =>
      move(() => (bounds
        ? map.flyToBounds(bounds, { duration, ...fitOptions() })
        : map.flyTo(center, zoom, { duration })), duration),
    flyToEvent: (ev, duration = 2.2) => move(() => map.flyTo(ev.coords, ev.zoom ?? 13, { duration }), duration),
    // padding: { topLeft: [x, y], bottomRight: [x, y] } keeps the area clear of overlays.
    flyToBounds: (bounds, { duration = 1.8, padding } = {}) =>
      move(() => map.flyToBounds(bounds, {
        duration,
        paddingTopLeft: padding?.topLeft ?? [40, 40],
        paddingBottomRight: padding?.bottomRight ?? [40, 40],
      }), duration),
  };
}
