// On phones the story panel is a bottom sheet with three stops: "peek" (the
// tabs and a headline), "half" and "full". Drag the grip or the tab row to
// move it, and a flick carries it on to the next stop; a tap on the grip
// steps through them. On wider screens it does nothing and the panel stays a
// side column. The sheet's visible height is published as --sheet-h so the
// key and the scene bar can sit just above it.

const PHONE = matchMedia('(max-width: 820px)');
const PEEK = 128; // px: grip, tabs and the first line of the card

export function createSheet(panel, { onChange } = {}) {
  let state = 'half';
  let userCollapsed = false; // the reader pushed it down: don't pop it back up on every event

  const visible = (s) => {
    const H = panel.offsetHeight;
    return s === 'peek' ? Math.min(PEEK, H) : s === 'half' ? Math.round(H * 0.5) : H;
  };

  function place(v, animate) {
    panel.classList.toggle('dragging', !animate);
    panel.style.transform = `translateY(${panel.offsetHeight - v}px)`;
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(v)}px`);
  }

  function apply(animate = true) {
    if (!PHONE.matches) {
      panel.style.transform = '';
      panel.classList.remove('dragging');
      document.documentElement.style.removeProperty('--sheet-h');
      delete document.body.dataset.sheet;
      return;
    }
    place(visible(state), animate);
    document.body.dataset.sheet = state;
    onChange?.(state);
  }

  function set(next, byUser = false) {
    if (byUser) userCollapsed = next === 'peek';
    state = next;
    apply();
  }

  // ---------- Dragging ----------
  let drag = null;
  function down(e) {
    if (!PHONE.matches || e.button > 0 || e.target.closest('button:not(.sheet-grip), a, select')) return;
    drag = { y: e.clientY, v: visible(state), t: performance.now(), lastY: e.clientY, lastT: performance.now(), moved: false, grip: !!e.target.closest('.sheet-grip') };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    const v = Math.max(visible('peek'), Math.min(visible('full'), drag.v - dy));
    drag.vel = (e.clientY - drag.lastY) / Math.max(1, performance.now() - drag.lastT); // px per ms, + is down
    drag.lastY = e.clientY;
    drag.lastT = performance.now();
    place(v, false);
  }
  function up(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      // A tap on the grip steps up through the stops, and from full back to peek.
      if (d.grip) set(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'peek', true);
      return;
    }
    // Where the sheet would come to rest after the flick, then the nearest stop to that.
    const now = panel.offsetHeight - new DOMMatrix(getComputedStyle(panel).transform).m42;
    const rest = now - (d.vel ?? 0) * 220;
    const stops = ['peek', 'half', 'full'];
    const best = stops.reduce((a, b) => (Math.abs(visible(a) - rest) <= Math.abs(visible(b) - rest) ? a : b));
    set(best, true);
    e.preventDefault();
  }
  for (const el of [panel.querySelector('.sheet-grip'), panel.querySelector('.panel-tabs')]) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  PHONE.addEventListener('change', () => apply(false));
  addEventListener('resize', () => apply(false));
  apply(false);

  return {
    get state() { return state; },
    isPhone: () => PHONE.matches,
    // An event or the intro was opened: show it, unless the reader pushed the sheet down.
    open() { if (state === 'peek' && !userCollapsed) set('half'); },
    // The chevron: up to half, or back down to peek.
    toggle() { set(state === 'peek' ? 'half' : 'peek', true); },
    expand() { set('half', true); },
  };
}
