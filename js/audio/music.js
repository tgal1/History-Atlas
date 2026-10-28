// Background music, generated as it plays: a slow pad or drone, a sparse
// melody wandering through the story's scale, and light percussion. Each
// story picks a mood in story.json ("music": "celtic").

import { audioContext, buses, noise, filter, gain, osc, lfo, envelope, every, rand, pickOne } from './engine.js';

const MOODS = {
  // D mixolydian drone and a tin-whistle melody.
  celtic: { root: 62, scale: [0, 2, 4, 5, 7, 9, 10], drone: [38, 45], lead: 'whistle', leadEvery: [3, 7] },
  // A dorian pad, lyre plucks, a frame drum.
  roman: { root: 57, scale: [0, 2, 3, 5, 7, 9, 10], chords: [[0, 2, 4], [3, 5, 0], [4, 6, 1], [0, 2, 4]], pad: 'soft', lead: 'lyre', leadEvery: [2.5, 6], perc: 'frame' },
  // The same instruments in a Phoenician-flavoured mode.
  carthage: { root: 57, scale: [0, 1, 4, 5, 7, 8, 10], chords: [[0, 2, 4], [1, 3, 5], [0, 2, 4], [6, 1, 3]], pad: 'soft', lead: 'lyre', leadEvery: [2.5, 6], perc: 'frame' },
  // Minor pentatonic clay flute over a low drone, slit drum and huehuetl.
  aztec: { root: 64, scale: [0, 3, 5, 7, 10], drone: [40, 47], lead: 'flute', leadEvery: [3, 8], perc: 'aztec' },
  // Low strings in D minor and a few piano notes.
  ww2: { root: 50, scale: [0, 2, 3, 5, 7, 8, 10], chords: [[0, 2, 4], [5, 0, 2], [2, 4, 6], [6, 1, 3]], pad: 'strings', lead: 'piano', leadEvery: [4, 9] },
};

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export function createMusic() {
  let current = null;
  return {
    get mood() { return current?.mood ?? null; },
    set(mood) {
      if (!audioContext() || (current?.mood ?? null) === (mood ?? null)) return;
      current?.stop();
      current = mood && MOODS[mood] ? start(mood) : null;
    },
    stop() { current?.stop(); current = null; },
  };
}

function start(mood) {
  const ctx = audioContext();
  const M = MOODS[mood];
  const out = gain(0);
  out.connect(buses.music);
  out.connect(gain(0.6)).connect(buses.reverb);
  const L = { dead: false, sources: [], cancels: [] };
  const repeat = (a, b, fn) => L.cancels.push(every(a, b, fn, () => L.dead));
  const note = (degree, octave = 0) => {
    const n = M.scale.length;
    const d = ((degree % n) + n) % n;
    return M.root + M.scale[d] + 12 * (octave + Math.floor(degree / n));
  };

  if (M.drone) {
    for (const m of M.drone) {
      const g = gain(0.05);
      for (const det of [-3, 3]) {
        const o = osc('sawtooth', hz(m));
        o.detune.value = det;
        o.connect(filter('lowpass', 500)).connect(g);
        L.sources.push(o);
      }
      g.connect(out);
      L.sources.push(lfo(g.gain, rand(0.04, 0.08), 0.02));
    }
  }

  if (M.chords) {
    const bar = 8;
    let i = 0;
    repeat(bar, bar, (t) => {
      const chord = M.chords[i++ % M.chords.length];
      for (const deg of chord) pad(t, hz(note(deg, -1)), bar, M.pad, out);
    });
  }

  // Melody: short phrases that wander a step or two at a time.
  let deg = 0;
  repeat(M.leadEvery[0], M.leadEvery[1], (t) => {
    let at = t;
    for (let k = 0; k < Math.floor(rand(2, 6)); k++) {
      deg = Math.max(-2, Math.min(9, deg + pickOne([-2, -1, -1, 1, 1, 2, 0])));
      const len = pickOne([0.35, 0.5, 0.5, 0.8, 1.2]);
      const midi = note(deg, M.lead === 'lyre' ? -1 : 0);
      INSTRUMENTS[M.lead](at, hz(midi), len, out);
      at += len;
    }
  });

  if (M.perc === 'frame') {
    const beat = 60 / 72;
    let i = 0;
    repeat(beat, beat, (t) => {
      const step = i++ % 8;
      if (step === 0 || step === 5) drum(t, 110, 0.18, out);
      else if (step === 3 && Math.random() < 0.5) drum(t, 160, 0.08, out);
    });
  } else if (M.perc === 'aztec') {
    const beat = 60 / 80;
    let i = 0;
    repeat(beat, beat, (t) => {
      const step = i++ % 8;
      if (step === 0) drum(t, 70, 0.2, out);
      else if (step === 4) drum(t, 80, 0.12, out);
      else if (step === 6) wood(t, 330, out);
      else if (step === 7) wood(t, 440, out);
    });
  }

  out.gain.setTargetAtTime(1, ctx.currentTime, 2);
  return {
    mood,
    stop() {
      L.dead = true;
      L.cancels.forEach((c) => c());
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0, ctx.currentTime, 1);
      setTimeout(() => { L.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } }); out.disconnect(); }, 5000);
    },
  };
}

// ---------- Voices ----------
function pad(t, f, length, kind, out) {
  const g = gain(0);
  const peak = kind === 'strings' ? 0.05 : 0.035;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 2.5);
  g.gain.setValueAtTime(peak, t + length - 1);
  g.gain.linearRampToValueAtTime(0, t + length + 2.5);
  const lp = filter('lowpass', kind === 'strings' ? 900 : 1200);
  lp.connect(g).connect(out);
  for (const det of [-6, 6]) {
    const o = audioContext().createOscillator();
    o.type = kind === 'strings' ? 'sawtooth' : 'triangle';
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(lp);
    o.start(t); o.stop(t + length + 2.6);
  }
}

const INSTRUMENTS = {
  whistle(t, f, len, out) {
    const o = audioContext().createOscillator();
    o.frequency.value = f;
    const vib = audioContext().createOscillator();
    vib.frequency.value = 5.5;
    const depth = gain(0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.012, t + 0.3);
    vib.connect(depth).connect(o.frequency);
    const g = gain(0);
    envelope(g.gain, t, 0.09, 0.04, 0.25, Math.max(0, len - 0.2));
    o.connect(g).connect(out);
    o.start(t); vib.start(t);
    o.stop(t + len + 0.4); vib.stop(t + len + 0.4);
    breath(t, f, len, 0.02, out);
  },
  flute(t, f, len, out) {
    const o = audioContext().createOscillator();
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.08);
    const g = gain(0);
    envelope(g.gain, t, 0.08, 0.08, 0.3, Math.max(0, len - 0.25));
    o.connect(g).connect(out);
    o.start(t); o.stop(t + len + 0.4);
    breath(t, f, len, 0.05, out);
  },
  lyre(t, f, len, out) {
    // A plucked string: a few harmonics, the higher ones dying away faster.
    [[1, 0.09, 2.2], [2, 0.04, 1.2], [3, 0.02, 0.6]].forEach(([k, peak, decay]) => {
      const o = audioContext().createOscillator();
      o.type = k === 1 ? 'triangle' : 'sine';
      o.frequency.value = f * k;
      const g = gain(0);
      envelope(g.gain, t, peak, 0.003, decay);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + decay + 0.1);
    });
  },
  piano(t, f, len, out) {
    if (Math.random() < 0.35) return; // leave space
    [[1, 0.08, 2.8, 'sine'], [2, 0.025, 1.4, 'triangle']].forEach(([k, peak, decay, type]) => {
      const o = audioContext().createOscillator();
      o.type = type;
      o.frequency.value = f * k;
      const g = gain(0);
      envelope(g.gain, t, peak, 0.005, decay);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + decay + 0.1);
    });
  },
};

function breath(t, f, len, level, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, level, 0.05, 0.2, Math.max(0, len - 0.15));
  n.connect(filter('bandpass', f, 6)).connect(g).connect(out);
  n.stop(t + len + 0.3);
}

function drum(t, f, peak, out) {
  const o = audioContext().createOscillator();
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.2);
  const g = gain(0);
  envelope(g.gain, t, peak, 0.004, 0.4);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + 0.5);
}

function wood(t, f, out) {
  const o = audioContext().createOscillator();
  o.type = 'triangle';
  o.frequency.value = f;
  const g = gain(0);
  envelope(g.gain, t, 0.08, 0.002, 0.12);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + 0.2);
}
