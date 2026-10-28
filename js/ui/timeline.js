// The scrubbable timeline: era bands, a deaths-per-year intensity strip,
// one tick per event, year axis and a draggable playhead.
// Everything is positioned in percentages so it reflows on resize for free.

import { clamp, formatDate, formatEventDate, parseDate, yearLabel } from '../core/time.js';

export function createTimeline(el, { story, events, onScrub, onSelect }) {
  const { t0, t1 } = story.range;
  const pct = (t) => ((t - t0) / (t1 - t0)) * 100;

  el.innerHTML = `
    <div class="tl-eras"></div>
    <svg class="tl-intensity" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"></svg>
    <div class="tl-ticks"></div>
    <div class="tl-axis"></div>
    <div class="tl-playhead"><div class="tl-handle"></div></div>
    <div class="tl-hover" hidden></div>`;
  const $ = (s) => el.querySelector(s);

  // Era bands
  $('.tl-eras').innerHTML = (story.eras ?? []).map((era, i) => `
    <div class="tl-era ${i % 2 ? 'alt' : ''}" style="left:${pct(era.t0)}%;width:${pct(era.t1) - pct(era.t0)}%">
      <span>${era.title}</span>
    </div>`).join('');

  // Intensity strip (e.g. deaths per year)
  const values = story.intensity?.values ?? {};
  const max = Math.max(1, ...Object.values(values));
  $('.tl-intensity').innerHTML = Object.entries(values).map(([year, v]) => {
    const x = pct(Number(year)) * 10;
    const w = (pct(Number(year) + 1) - pct(Number(year))) * 10;
    const h = (v / max) * 100;
    return `<rect x="${x + 0.6}" y="${100 - h}" width="${Math.max(0.5, w - 1.2)}" height="${h}"><title>${year}: ~${v}</title></rect>`;
  }).join('');

  // Event ticks
  const ticks = $('.tl-ticks');
  for (const ev of events) {
    const tick = document.createElement('button');
    tick.className = 'tl-tick';
    tick.style.left = `${pct(ev.t)}%`;
    tick.style.setProperty('--c', story.categories[ev.category]?.color ?? '#ccc');
    tick.style.setProperty('--h', ev.deaths ? `${Math.min(100, 45 + Math.sqrt(ev.deaths) * 9)}%` : '45%');
    tick.dataset.id = ev.id;
    tick.setAttribute('aria-label', `${formatEventDate(ev)}: ${ev.title}`);
    tick.addEventListener('pointerdown', (e) => e.stopPropagation());
    tick.addEventListener('click', () => onSelect(ev.id));
    tick.addEventListener('pointerenter', () => showHover(ev.t, `<strong>${ev.title}</strong>${formatEventDate(ev)}`));
    tick.addEventListener('pointerleave', hideHover);
    ticks.appendChild(tick);
  }

  // Year axis: label spacing adapts to the track width.
  function drawAxis() {
    const span = t1 - t0;
    // Short stories (a few years) get month labels, with the year on January.
    if (span <= 4) {
      const maxLabels = Math.max(3, Math.floor(el.clientWidth / 44));
      const step = [1, 2, 3, 6].find((s) => (span * 12) / s <= maxLabels) ?? 12;
      const axis = [];
      for (let y = Math.floor(t0); y <= t1; y++) {
        for (let m = 0; m < 12; m += step) {
          const t = parseDate(`${y}-${String(m + 1).padStart(2, '0')}-01`) - 0.5 / 365;
          if (t < t0 || t > t1) continue;
          const label = m === 0 ? yearLabel(y) : formatDate(t + 1 / 365, 'month').split(' ')[0];
          axis.push(`<span class="${m === 0 ? 'year' : ''}" style="left:${pct(t)}%">${label}</span>`);
        }
      }
      $('.tl-axis').innerHTML = axis.join('');
      return;
    }
    const labelWidth = t0 < 0 ? 78 : 56; // "255 BC" needs more room than "1972"
    const maxLabels = Math.max(3, Math.floor(el.clientWidth / labelWidth));
    const step = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].find((s) => span / s <= maxLabels) ?? 1000;
    const axis = [];
    // Round numbers as people say them: 260 BC is astronomical year -259.
    for (let y = Math.ceil(t0); y <= t1; y++) {
      const spoken = y <= 0 ? 1 - y : y;
      if (spoken % step === 0) axis.push(`<span style="left:${pct(y)}%">${yearLabel(y)}</span>`);
    }
    $('.tl-axis').innerHTML = axis.join('');
  }
  drawAxis();
  new ResizeObserver(drawAxis).observe(el);

  // Hover readout
  const hover = $('.tl-hover');
  function showHover(t, html) {
    hover.innerHTML = html;
    hover.style.left = `${clamp(pct(t), 6, 94)}%`;
    hover.hidden = false;
  }
  function hideHover() { hover.hidden = true; }

  // Dragging the playhead / clicking the track
  const timeAt = (clientX) => {
    const r = el.getBoundingClientRect();
    return t0 + clamp((clientX - r.left) / r.width, 0, 1) * (t1 - t0);
  };
  let dragging = false;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    onScrub(timeAt(e.clientX));
  });
  el.addEventListener('pointermove', (e) => {
    if (dragging) onScrub(timeAt(e.clientX));
    else if (e.target === el || e.target.closest('.tl-eras, .tl-intensity, .tl-axis')) {
      const t = timeAt(e.clientX);
      const v = values[Math.floor(t)];
      showHover(t, `${formatDate(t, story.clockPrecision ?? 'month')}${v != null ? `<em>~${v} ${story.intensity.unit ?? 'deaths'} that year</em>` : ''}`);
    }
  });
  const stop = () => { dragging = false; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('pointerleave', () => { if (!dragging) hideHover(); });

  const playhead = $('.tl-playhead');
  let activeTick = null;

  return {
    setTime(t) { playhead.style.left = `${pct(t)}%`; },
    setActive(id) {
      activeTick?.classList.remove('active');
      activeTick = id ? ticks.querySelector(`[data-id="${CSS.escape(id)}"]`) : null;
      activeTick?.classList.add('active');
    },
  };
}
