// Event dots. Each appears when the clock reaches its date and fades as
// time moves on, so the map builds up a memory of what has happened.
// Dot size scales with deaths where known.

import { formatEventDate } from '../core/time.js';

const FADE_YEARS = 3;

export function createEventLayer(map, events, categories, { onSelect }) {
  const group = L.layerGroup().addTo(map);
  const markers = new Map();

  for (const ev of events) {
    const color = categories[ev.category]?.color ?? '#cccccc';
    const radius = ev.deaths ? Math.min(18, 6 + Math.sqrt(ev.deaths) * 1.8) : 6;
    const marker = L.circleMarker(ev.coords, {
      radius, color, weight: 1.5, fillColor: color, fillOpacity: 0.6,
    });
    marker.bindTooltip(
      `<strong>${ev.title}</strong><span>${formatEventDate(ev)} · ${ev.place}</span>`,
      { direction: 'top', className: 'ev-tip', offset: [0, -radius] },
    );
    marker.on('click', () => onSelect(ev.id));
    markers.set(ev.id, { marker, ev, shown: false, styleKey: '' });
  }

  const pulse = L.marker([0, 0], {
    icon: L.divIcon({ className: 'ev-pulse', html: '<span></span><span></span>', iconSize: [80, 80] }),
    interactive: false,
    keyboard: false,
  });

  function update(t, activeId) {
    for (const item of markers.values()) {
      const visible = item.ev.t <= t + 1e-6;
      if (visible !== item.shown) {
        visible ? group.addLayer(item.marker) : group.removeLayer(item.marker);
        item.shown = visible;
      }
      if (!visible) continue;
      // Fade in 20 steps and only restyle when the step changes: this runs every frame.
      const fresh = Math.round(Math.max(0, 1 - (t - item.ev.t) / FADE_YEARS) * 20) / 20;
      const active = item.ev.id === activeId;
      const key = `${fresh}|${active}`;
      if (key === item.styleKey) continue;
      item.styleKey = key;
      item.marker.setStyle({
        fillOpacity: active ? 0.95 : 0.12 + 0.6 * fresh,
        opacity: active ? 1 : 0.3 + 0.6 * fresh,
        weight: active ? 3 : 1.5,
      });
      if (active) item.marker.bringToFront();
    }

    const active = activeId && markers.get(activeId);
    if (active && active.shown) {
      pulse.setLatLng(active.ev.coords);
      pulse.getElement()?.style.setProperty('--c', categories[active.ev.category]?.color ?? '#fff');
      if (!map.hasLayer(pulse)) {
        pulse.addTo(map);
        pulse.getElement()?.style.setProperty('--c', categories[active.ev.category]?.color ?? '#fff');
      }
    } else if (map.hasLayer(pulse)) {
      pulse.remove();
    }
  }

  return { update };
}
