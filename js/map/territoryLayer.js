// Shaded areas showing who controls the ground. Each feature carries
// from/to dates and a faction; it is drawn only while active.
// For wars this is where front lines and empires will live.

// A faction may override the default look with "style" (e.g. solid blue lakes,
// thick causeway lines); a single feature may override "fillOpacity".
// Features with "layer": "top" go in a pane above the rest, so lakes and
// cities stay on top however often the land around them changes hands.
// defaultMaxZoom hides shading when zoomed into a city plan.
export function createTerritoryLayer(map, geojson, factions, { defaultMaxZoom = null } = {}) {
  map.createPane('territory-top').style.zIndex = 360;

  const items = geojson.features.map((feature) => {
    const p = feature.properties;
    const faction = factions[p.faction] ?? {};
    const color = faction.color ?? '#888888';
    const style = { color, weight: 1.5, dashArray: '4 4', fillColor: color, fillOpacity: 0.16, ...faction.style };
    if (p.fillOpacity != null) style.fillOpacity = p.fillOpacity;
    const layer = L.geoJSON(feature, { pane: p.layer === 'top' ? 'territory-top' : 'territory', style });
    // Period features (see loader) read "Gaul: Gallic Empire" unless they say otherwise.
    const tip = p.label ?? (p.region ? `${p.region}: ${factions[p.faction]?.label ?? p.faction}` : null);
    if (tip) layer.bindTooltip(tip, { sticky: true, className: 'ev-tip' });
    return { p, layer, shown: false };
  });

  function update(t, zoom) {
    const active = [];
    for (const item of items) {
      const { p } = item;
      const inTime = t >= p.t0 && t < p.t1;
      const maxZoom = p.maxZoom ?? defaultMaxZoom;
      const inZoom = (p.minZoom == null || zoom >= p.minZoom) && (maxZoom == null || zoom <= maxZoom);
      const visible = inTime && inZoom;
      if (visible !== item.shown) {
        visible ? item.layer.addTo(map) : item.layer.remove();
        item.shown = visible;
      }
      if (inTime) active.push(p.faction);
    }
    return [...new Set(active)];
  }

  return { update };
}
