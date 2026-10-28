// Advances the clock while playing. In tour mode it stops at each event,
// hands control to onEventReached (fly in, show card, maybe play a scene),
// and resumes when that promise settles.

// rate() returns years of story time per second of real time.
export function createPlayer({ store, events, range, rate, onEventReached }) {
  let raf = null;
  let last = 0;
  let holding = false;
  let lastStop = -1; // index of the last event the tour stopped at

  // Events at or before t count as seen, so pressing play while standing
  // on an event moves on to the next one.
  function syncLastStop(t) {
    lastStop = -1;
    events.forEach((e, i) => { if (e.t <= t + 1e-6) lastStop = i; });
  }

  function frame(now) {
    raf = null;
    const s = store.get();
    if (!s.playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    if (!holding) {
      let t = s.t + dt * rate();
      const next = s.tourMode ? events[lastStop + 1] : null;
      if (next && next.t <= t) {
        lastStop += 1;
        holding = true;
        store.set({ t: next.t });
        Promise.resolve(onEventReached(next)).finally(() => {
          holding = false;
          last = performance.now();
          if (store.get().playing) schedule();
        });
        return;
      }
      if (t >= range.t1) {
        store.set({ t: range.t1, playing: false });
        return;
      }
      store.set({ t });
    }
    schedule();
  }

  function schedule() {
    if (raf == null) raf = requestAnimationFrame(frame);
  }

  return {
    play() {
      const s = store.get();
      if (s.t >= range.t1) { store.set({ t: range.t0 }); syncLastStop(range.t0); }
      else syncLastStop(s.t);
      store.set({ playing: true });
      last = performance.now();
      schedule();
    },
    pause() {
      store.set({ playing: false });
    },
    // Call after any manual jump in time so the tour picks up from there.
    resync(t) { syncLastStop(t); },
    get holding() { return holding; },
  };
}

// A sleep that ends early when the signal aborts (user paused or jumped).
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const id = setTimeout(() => resolve(true), ms);
    signal?.addEventListener('abort', () => { clearTimeout(id); resolve(false); }, { once: true });
  });
}
