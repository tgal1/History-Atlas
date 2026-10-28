// Large, story-specific place labels ("Northern Ireland", "Free Derry"),
// each optionally limited to a date range and zoom range.

export function createLabelLayer(map, labels = []) {
  const items = labels.map((label) => ({
    label,
    shown: false,
    marker: L.marker(label.at, {
      pane: 'labels',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: 'map-label', html: `<span>${label.text}</span>`, iconSize: null }),
    }),
  }));

  function update(t, zoom) {
    for (const item of items) {
      const { label } = item;
      const visible = t >= label.t0 && t < label.t1
        && (label.minZoom == null || zoom >= label.minZoom)
        && (label.maxZoom == null || zoom <= label.maxZoom);
      if (visible !== item.shown) {
        visible ? item.marker.addTo(map) : item.marker.remove();
        item.shown = visible;
      }
    }
  }

  return { update };
}
