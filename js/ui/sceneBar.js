// Controls for a playing scene: title, play/pause, scrubber, caption, close.

export function createSceneBar(el, { onToggle, onSeek, onClose }) {
  el.innerHTML = `
    <div class="sb-head">
      <button class="icon-btn" data-act="toggle" aria-label="Play or pause scene">&#10074;&#10074;</button>
      <div class="sb-title"><strong></strong><span class="sb-clock"></span></div>
      <button class="icon-btn" data-act="close" aria-label="Close scene">&times;</button>
    </div>
    <input class="sb-range" type="range" min="0" max="1000" value="0" aria-label="Scene position">
    <p class="sb-caption"></p>
    <p class="sb-note"></p>`;
  el.hidden = true;

  const $ = (s) => el.querySelector(s);
  const range = $('.sb-range');
  let scene = null;
  let scrubbing = false;

  $('[data-act="toggle"]').addEventListener('click', onToggle);
  $('[data-act="close"]').addEventListener('click', onClose);
  range.addEventListener('input', () => { scrubbing = true; onSeek(range.value / 1000); });
  range.addEventListener('change', () => { scrubbing = false; });

  return {
    show(sc) {
      scene = sc;
      $('.sb-title strong').textContent = sc.title;
      $('.sb-note').textContent = sc.note ?? '';
      el.hidden = false;
    },
    hide() { el.hidden = true; scene = null; },
    update({ t, progress, caption }) {
      if (!scene) return;
      if (!scrubbing) range.value = Math.round(progress * 1000);
      $('.sb-clock').textContent = `${scene.unitLabel ?? 'T'} ${Math.min(Math.floor(t) + 1, Math.ceil(scene.duration))}`;
      const cap = $('.sb-caption');
      if (cap.textContent !== caption) {
        cap.textContent = caption;
        cap.classList.remove('flash');
        void cap.offsetWidth;
        cap.classList.add('flash');
      }
    },
    setPlaying(playing) {
      $('[data-act="toggle"]').innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
    },
  };
}
