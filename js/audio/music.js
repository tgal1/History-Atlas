// Background music from the period, where any survives. Each story picks a
// mood in story.json ("music": "roman").
//
//   roman, carthage  the Seikilos epitaph (1st century AD) and the First
//                    Delphic Hymn (128 BC), the oldest notated music of the
//                    Graeco-Roman world, played on a plucked kithara and an
//                    aulos (double reed pipe) over a pipe drone
//   celtic           the Londonderry Air on tin whistle and harp
//   colonial         Yankee Doodle on fifes and snare drum (1770s)
//   ww2              Chopin's 'Military' Polonaise (played on Polish Radio
//                    during the 1939 siege of Warsaw) and Op. 40 No. 2, as
//                    streamed recordings
//   aztec            no Mexica music survives, so clay flute phrases, the
//                    huehuetl and teponaztli drums, rattles and the conch
//
// Scores are note lists in data/music/ (made with tools/midi_to_json.py);
// the instruments are synthesised here.

import { audioContext, buses, noise, filter, gain, envelope, every, rand, pickOne } from './engine.js';

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';
const MOODS = {
  roman: { pieces: ['seikilos', 'delphic-hymn'], leads: ['aulos', 'kithara'], drone: true, perc: 'frame' },
  carthage: { pieces: ['delphic-hymn', 'seikilos'], leads: ['aulos', 'aulos', 'kithara'], drone: true, perc: 'tambourine' },
  celtic: { pieces: ['londonderry-air'], leads: ['whistle'], accompany: 'harp' },
  // Fife and drum, as both armies marched to in the 1770s: the top two parts on fifes.
  colonial: { pieces: ['yankee-doodle'], leads: ['fife'], accompany: 'fife', parts: 2, perc: 'snare' },
  ww2: {
    recordings: [
      { url: `${COMMONS}9/9a/Polonaise_militaire_in_A_major-Brunswick_15098-Josef_Hofmann.mp3`, title: "Chopin, 'Military' Polonaise (Josef Hofmann)", credit: 'Public domain recording, Wikimedia Commons' },
      { url: `${COMMONS}3/38/Polonaise_no.5_-_Op.40_no.2_C-minor.mp3`, title: 'Chopin, Polonaise in C minor, Op. 40 No. 2', credit: 'CC0, Wikimedia Commons' },
    ],
  },
  aztec: { generative: 'aztec' },
};

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const scores = new Map();
function loadScore(name) {
  if (!scores.has(name)) scores.set(name, fetch(`data/music/${name}.json`).then((r) => r.json()));
  return scores.get(name);
}

export function createMusic() {
  let current = null;
  return {
    get mood() { return current?.mood ?? null; },
    get nowPlaying() { return current?.now ?? null; },
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
  out.connect(gain(0.45)).connect(buses.reverb);
  const S = { mood, now: null, dead: false, timers: [], sources: [] };
  if (M.recordings) playRecordings(M.recordings, S);
  else if (M.generative) aztec(S, out);
  else playPieces(M, S, out);
  out.gain.setTargetAtTime(1, ctx.currentTime, 2);
  S.stop = () => {
    S.dead = true;
    S.timers.forEach((c) => c());
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setTargetAtTime(0, ctx.currentTime, 1);
    S.fadeRecording?.();
    setTimeout(() => {
      S.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
      out.disconnect();
    }, 5000);
  };
  return S;
}

// ---------- Scores ----------
// Plays the pieces in turn with a pause between, swapping the lead instrument
// each time round, with a soft drone on the final note and a light drum.
function playPieces(M, S, out) {
  const ctx = audioContext();
  let round = 0;
  const next = async (at) => {
    if (S.dead) return;
    const name = M.pieces[round % M.pieces.length];
    const lead = M.leads[round % M.leads.length];
    round++;
    let score;
    try { score = await loadScore(name); } catch { return; }
    if (S.dead) return;
    S.now = { title: score.title, credit: score.credit };
    const t0 = Math.max(at, ctx.currentTime + 0.3);
    const parts = melodyFirst(score.notes).slice(0, M.parts ?? Infinity);
    const tonic = parts[0].at(-1)?.[2] ?? 57;
    if (M.drone) S.sources.push(drone(t0, hz(tonic - 12), score.duration + 1.5, out));
    schedule(S, t0, parts[0], (t, n, i) => {
      INSTRUMENTS[lead](t, n[2], n[1], n[3] / 127, out);
      const every = M.perc === 'snare' ? 1 : 4;
      if (M.perc && i % every === 0) percussion(M.perc, t, i % 8 === 0 ? 1 : 0.6, out);
    });
    for (const part of parts.slice(1)) schedule(S, t0, part, (t, n) => INSTRUMENTS[M.accompany ?? 'kithara'](t, n[2], n[1], (n[3] / 127) * 0.55, out));
    const gap = rand(5, 9);
    S.timers.push(after(t0 + score.duration + gap - ctx.currentTime, () => next(ctx.currentTime + 0.2)));
  };
  next(ctx.currentTime + 1);
}

// Split notes by part, the highest-pitched part (the tune) first.
function melodyFirst(notes) {
  const parts = new Map();
  for (const n of notes) {
    if (!parts.has(n[4])) parts.set(n[4], []);
    parts.get(n[4]).push(n);
  }
  const mean = (p) => p.reduce((s, n) => s + n[2], 0) / p.length;
  return [...parts.values()].sort((a, b) => mean(b) - mean(a));
}

// Feed notes to the audio clock a second ahead, so timing stays tight.
function schedule(S, t0, notes, play) {
  const ctx = audioContext();
  let i = 0;
  const tick = () => {
    if (S.dead) return;
    const horizon = ctx.currentTime + 1;
    while (i < notes.length && t0 + notes[i][0] < horizon) {
      play(t0 + notes[i][0], notes[i], i);
      i++;
    }
    if (i < notes.length) timer = setTimeout(tick, 250);
  };
  let timer = setTimeout(tick, 0);
  S.timers.push(() => clearTimeout(timer));
}

function after(seconds, fn) {
  const id = setTimeout(fn, Math.max(0, seconds * 1000));
  return () => clearTimeout(id);
}

// ---------- Recordings ----------
function playRecordings(list, S) {
  const ctx = audioContext();
  let i = 0;
  let el = null;
  let level = null;
  const next = () => {
    if (S.dead) return;
    const track = list[i++ % list.length];
    el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = track.url;
    level = gain(0);
    ctx.createMediaElementSource(el).connect(level).connect(buses.music);
    level.gain.setTargetAtTime(0.6, ctx.currentTime, 1.5);
    el.addEventListener('ended', () => setTimeout(next, 4000), { once: true });
    el.play().catch(() => {});
    S.now = { title: track.title, credit: track.credit };
  };
  S.fadeRecording = () => {
    if (!el) return;
    level.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
    const old = el;
    setTimeout(() => old.pause(), 4000);
  };
  next();
}

// ---------- Mexica ----------
// Clay flute phrases in a five-note scale over a drum pattern, with rattles
// and an occasional conch call.
function aztec(S, out) {
  const ctx = audioContext();
  S.now = { title: 'Clay flute, huehuetl and teponaztli', credit: 'Generated: no Mexica music survives in notation' };
  const scale = [64, 67, 69, 71, 74, 76, 79];
  let deg = 2;
  S.timers.push(every(3, 7, (t) => {
    let at = t;
    for (let k = 0; k < Math.floor(rand(3, 7)); k++) {
      deg = Math.max(0, Math.min(scale.length - 1, deg + pickOne([-2, -1, -1, 1, 1, 2])));
      const len = pickOne([0.3, 0.45, 0.45, 0.9]);
      INSTRUMENTS.flute(at, scale[deg], len, 0.8, out);
      at += len;
    }
  }, () => S.dead));
  const beat = 60 / 84;
  let i = 0;
  S.timers.push(every(beat, beat, (t) => {
    const step = i++ % 8;
    if (step === 0) drum(t, 68, 0.22, out);
    else if (step === 3) drum(t, 76, 0.12, out);
    else if (step === 4) drum(t, 68, 0.16, out);
    if (step === 6) wood(t, 330, out);
    else if (step === 7) wood(t, 440, out);
    if (step % 2 === 1) rattle(t, out);
  }, () => S.dead));
  S.timers.push(every(40, 80, (t) => conch(t, out), () => S.dead));
  void ctx;
}

// ---------- Instruments ----------
const INSTRUMENTS = {
  // Double reed pipe: two slightly detuned reedy tones, a scoop into each note, a little vibrato.
  aulos(t, midi, len, vel, out) {
    const ctx = audioContext();
    const f = hz(midi);
    const g = gain(0);
    envelope(g.gain, t, 0.05 * (0.6 + vel * 0.6), 0.05, 0.18, Math.max(0, len - 0.12));
    const tone = filter('bandpass', f * 2.5, 0.7);
    tone.connect(filter('lowpass', 2600)).connect(g).connect(out);
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.985, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.06);
      o.detune.value = det;
      const vib = ctx.createOscillator();
      vib.frequency.value = 5;
      const depth = gain(0);
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.4, len));
      vib.connect(depth).connect(o.frequency);
      o.connect(tone);
      o.start(t); vib.start(t);
      o.stop(t + len + 0.3); vib.stop(t + len + 0.3);
    }
    breath(t, f * 2, len, 0.012, out);
  },
  // Plucked string (kithara, lyre): Karplus-Strong.
  kithara(t, midi, len, vel, out) {
    pluck(t, midi, 0.16 * (0.5 + vel * 0.6), 2.4, 3200, out);
  },
  harp(t, midi, len, vel, out) {
    pluck(t, midi, 0.12 * (0.5 + vel * 0.6), 3, 2400, out);
  },
  whistle(t, midi, len, vel, out) {
    const ctx = audioContext();
    const f = hz(midi + (midi < 70 ? 12 : 0)); // up into the whistle's range
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const depth = gain(0);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.01, t + Math.min(0.35, len));
    vib.connect(depth).connect(o.frequency);
    const g = gain(0);
    envelope(g.gain, t, 0.07 * (0.6 + vel * 0.5), 0.04, 0.22, Math.max(0, len - 0.15));
    o.connect(g).connect(out);
    o.start(t); vib.start(t);
    o.stop(t + len + 0.4); vib.stop(t + len + 0.4);
    breath(t, f, len, 0.015, out);
  },
  // Fife: a shrill little flute an octave above the written part.
  fife(t, midi, len, vel, out) {
    INSTRUMENTS.whistle(t, midi + (midi < 74 ? 12 : 0), len, vel * 0.8, out);
  },
  flute(t, midi, len, vel, out) {
    const ctx = audioContext();
    const f = hz(midi);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.08);
    const g = gain(0);
    envelope(g.gain, t, 0.07 * vel, 0.08, 0.3, Math.max(0, len - 0.25));
    o.connect(g).connect(out);
    o.start(t); o.stop(t + len + 0.4);
    breath(t, f, len, 0.045, out);
  },
};

const plucks = new Map();
function pluck(t, midi, peak, seconds, tone, out) {
  const ctx = audioContext();
  const key = `${midi}:${seconds}`;
  if (!plucks.has(key)) {
    const sr = ctx.sampleRate;
    const period = Math.max(2, Math.round(sr / hz(midi)));
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const ring = new Float32Array(period);
    let prev = 0;
    for (let i = 0; i < period; i++) { prev = 0.5 * prev + 0.5 * (Math.random() * 2 - 1); ring[i] = prev; }
    const damp = 0.4985 + Math.min(0.0012, midi / 120000);
    for (let i = 0, j = 0; i < len; i++, j = (j + 1) % period) {
      const v = ring[j];
      ring[j] = damp * (v + ring[(j + 1) % period]);
      data[i] = v * Math.min(1, (len - i) / (sr * 0.2));
    }
    plucks.set(key, buf);
  }
  const src = ctx.createBufferSource();
  src.buffer = plucks.get(key);
  const g = gain(peak);
  src.connect(filter('lowpass', tone)).connect(g).connect(out);
  src.start(t);
}

function drone(t, f, length, out) {
  const ctx = audioContext();
  const g = gain(0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.022, t + 2);
  g.gain.setValueAtTime(0.022, t + length - 2);
  g.gain.linearRampToValueAtTime(0, t + length + 1);
  const tone = filter('bandpass', f * 3, 0.6);
  tone.connect(filter('lowpass', 1400)).connect(g).connect(out);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = f;
  o.connect(tone);
  o.start(t); o.stop(t + length + 1.2);
  return o;
}

function percussion(kind, t, accent, out) {
  if (kind === 'frame') drum(t, 120, 0.1 * accent, out);
  else if (kind === 'tambourine') { drum(t, 140, 0.08 * accent, out); jingle(t, out); }
  else if (kind === 'snare') snare(t, 0.05 * accent, out);
}

function snare(t, peak, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, peak, 0.002, 0.11);
  n.connect(filter('bandpass', 2400, 0.8)).connect(g).connect(out);
  n.stop(t + 0.15);
  drum(t, 190, peak * 1.2, out);
}

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

function jingle(t, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, 0.03, 0.002, 0.18);
  n.connect(filter('bandpass', 7000, 2)).connect(g).connect(out);
  n.stop(t + 0.25);
}

function rattle(t, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, 0.025, 0.004, 0.09);
  n.connect(filter('highpass', 4500)).connect(g).connect(out);
  n.stop(t + 0.15);
}

function conch(t, out) {
  const ctx = audioContext();
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(196, t);
  o.frequency.linearRampToValueAtTime(207, t + 1.2);
  o.frequency.linearRampToValueAtTime(190, t + 2.6);
  const g = gain(0);
  envelope(g.gain, t, 0.035, 0.5, 1.2, 1.2);
  o.connect(filter('bandpass', 600, 3)).connect(g).connect(out);
  o.start(t); o.stop(t + 3.2);
}
