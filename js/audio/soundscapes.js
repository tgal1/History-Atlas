// Soundscapes: every sound is synthesised in the browser, nothing is
// downloaded. Each layer (wind, surf, insects, birds, crowds, clashing
// blades, artillery...) is a small generator; a preset mixes several of them.
// Switching preset crossfades the old mix out and the new one in.

import { audioContext, buses, noise, filter, gain, osc, panner, lfo, envelope, every, rand, pickOne } from './engine.js';

// ---------- Presets ----------
// [layer, level, options]
const PRESETS = {
  silence: [],
  countryside: [['wind', 0.15], ['birds', 0.55, { kind: 'temperate', every: [2, 6] }], ['crickets', 0.1]],
  // A calm Mediterranean shore: small waves on sand, the odd gull.
  mediterranean: [['shore', 0.85], ['birds', 0.22, { kind: 'gull', every: [10, 22] }]],
  highlands: [['wind', 0.25], ['birds', 0.3, { kind: 'temperate', every: [4, 10] }]],
  jungle: [['insects', 0.45], ['cicadas', 0.35], ['frogs', 0.35], ['birds', 0.7, { kind: 'jungle', every: [1, 3.5] }], ['howler', 0.5]],
  lake: [['lapping', 0.6], ['wind', 0.2], ['birds', 0.45, { kind: 'water', every: [3, 8] }]],
  sea: [['surf', 0.75], ['wind', 0.15], ['birds', 0.4, { kind: 'gull', every: [5, 12] }]],
  harbour: [['lapping', 0.45], ['birds', 0.5, { kind: 'gull', every: [4, 9] }], ['crowd', 0.3, { voices: 8 }], ['creak', 0.4]],
  city: [['crowd', 0.45, { voices: 10 }], ['birds', 0.2, { kind: 'temperate', every: [5, 12] }], ['clinks', 0.2]],
  'lake-city': [['crowd', 0.35, { voices: 9 }], ['lapping', 0.35], ['birds', 0.3, { kind: 'water', every: [4, 9] }]],
  market: [['crowd', 0.6, { voices: 14 }], ['clinks', 0.3]],
  battle: [['crowd', 0.55, { voices: 12, excited: true }], ['clangs', 0.5], ['drums', 0.35, { style: 'war', bpm: 84 }], ['horns', 0.35, { style: 'cornu' }]],
  // Backgrounds for animated battles: the units on screen add hooves, feet and the clash.
  battlefield: [['crowd', 0.22, { voices: 10, excited: true }], ['drums', 0.22, { style: 'war', bpm: 72 }]],
  'battlefield-aztec': [['crowd', 0.2, { voices: 10, excited: true }], ['drums', 0.28, { style: 'aztec', bpm: 92 }], ['lapping', 0.3]],
  'conquest-battle': [['crowd', 0.55, { voices: 12, excited: true }], ['clangs', 0.35], ['drums', 0.4, { style: 'aztec', bpm: 96 }], ['horns', 0.4, { style: 'conch' }], ['artillery', 0.25, { every: [8, 20] }]],
  naval: [['surf', 0.5], ['crowd', 0.4, { voices: 10, excited: true }], ['clangs', 0.35], ['creak', 0.45], ['drums', 0.3, { style: 'rowing', bpm: 30 }]],
  siege: [['fire', 0.45], ['crowd', 0.35, { voices: 10, excited: true }], ['drums', 0.25, { style: 'war', bpm: 70 }], ['clangs', 0.2]],
  march: [['wind', 0.12], ['marching', 0.45], ['horns', 0.2, { style: 'cornu' }], ['birds', 0.2, { kind: 'temperate', every: [6, 14] }]],
  war: [['artillery', 0.55], ['aircraft', 0.35], ['gunfire', 0.25], ['wind', 0.25]],
  'air-raid': [['siren', 0.45], ['aircraft', 0.55, { continuous: true }], ['artillery', 0.45, { every: [2, 6] }], ['fire', 0.2]],
  town: [['crowd', 0.3, { voices: 8 }], ['birds', 0.35, { kind: 'temperate', every: [3, 8] }], ['wind', 0.15]],
  quiet: [['room', 0.5], ['birds', 0.12, { kind: 'temperate', every: [6, 15] }]],
  sombre: [['wind', 0.18]],
  urban: [['traffic', 0.45], ['birds', 0.2, { kind: 'temperate', every: [4, 10] }], ['wind', 0.15]],
  'tense-urban': [['traffic', 0.3], ['helicopter', 0.5], ['ukSiren', 0.25], ['wind', 0.2]],
  protest: [['crowd', 0.55, { voices: 14, excited: true }], ['traffic', 0.2], ['helicopter', 0.3]],
};

export const PRESET_LABELS = {
  silence: 'Silence', countryside: 'Countryside', mediterranean: 'Mediterranean shore', highlands: 'Highlands', jungle: 'Jungle', lake: 'Lake',
  sea: 'Open sea', harbour: 'Harbour', city: 'City streets', 'lake-city': 'Island city', market: 'Market',
  battle: 'Battle', battlefield: 'Battlefield', 'battlefield-aztec': 'Battlefield', 'conquest-battle': 'Battle', naval: 'Sea battle', siege: 'Siege', march: 'On the march',
  war: 'Front line', 'air-raid': 'Air raid', town: 'Town', quiet: 'Indoors', sombre: 'Quiet',
  urban: 'City streets', 'tense-urban': 'Streets under patrol', protest: 'Crowd',
};

// Presets where music would be out of place.
export const NO_MUSIC = new Set(['sombre', 'silence']);

export function createSoundscapes() {
  let current = null;
  return {
    get name() { return current?.name ?? null; },
    set(name) {
      if (!audioContext() || current?.name === name) return;
      if (!PRESETS[name]) { console.warn(`[audio] unknown soundscape "${name}"`); name = 'silence'; }
      current?.stop();
      current = startGroup(name);
    },
    stop() { current?.stop(); current = null; },
  };
}

function startGroup(name) {
  const ctx = audioContext();
  const out = gain(0);
  out.connect(buses.ambience);
  const L = {
    dead: false,
    sources: [],
    cancels: [],
    add(node) { this.sources.push(node); return node; },
    every(min, max, fn) { this.cancels.push(every(min, max, fn, () => this.dead)); },
  };
  for (const [layer, level, opts = {}] of PRESETS[name]) {
    const dest = gain(level);
    dest.connect(out);
    LAYERS[layer](L, dest, opts);
  }
  out.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
  return {
    name,
    stop() {
      L.dead = true;
      L.cancels.forEach((c) => c());
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.7);
      setTimeout(() => {
        L.sources.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } });
        out.disconnect();
      }, 3500);
    },
  };
}

// ---------- Helpers ----------
// A pitched blip: frequency glides f0 -> f1 over dur, with a quick envelope.
function blip(t, type, f0, f1, dur, peak, dest, attack = 0.01) {
  const o = audioContext().createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = gain(0);
  envelope(g.gain, t, peak, attack, Math.max(0.02, dur - attack));
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  o.onended = () => g.disconnect();
  return o;
}

// A burst of filtered noise.
function hiss(t, type, freq, Q, a, d, peak, dest, hold = 0) {
  const n = audioContext().createBufferSource();
  n.buffer = noiseBufferFrom();
  const f = filter(type, freq, Q);
  const g = gain(0);
  envelope(g.gain, t, peak, a, d, hold);
  n.connect(f).connect(g).connect(dest);
  n.start(t, Math.random() * 3);
  n.stop(t + a + hold + d + 0.05);
  n.onended = () => g.disconnect();
  return { n, f, g };
}

let cachedNoise = null;
function noiseBufferFrom() {
  if (!cachedNoise) {
    const src = noise();
    cachedNoise = src.buffer;
    src.stop();
  }
  return cachedNoise;
}

const reverbSend = (node, amount) => node.connect(gain(amount)).connect(buses.reverb);
const panned = (dest, pan = rand(-0.8, 0.8)) => { const p = panner(pan); p.connect(dest); return p; };

// ---------- Layers ----------
const LAYERS = {
  // A soft breeze: low, dark air that rises and falls slowly, without the whistle.
  wind(L, out) {
    const f = filter('lowpass', 320, 0.3);
    const g = gain(0.35);
    L.add(noise()).connect(f).connect(g).connect(out);
    L.add(lfo(g.gain, rand(0.03, 0.06), 0.15));
    L.add(lfo(f.frequency, rand(0.02, 0.04), 80));
  },
  // Small waves on a beach: a slow swell rolls in, breaks softly and drains back over the sand.
  shore(L, out) {
    const body = gain(0.05);
    L.add(noise()).connect(filter('lowpass', 420, 0.4)).connect(body).connect(out);
    const wash = gain(0);
    L.add(noise()).connect(filter('bandpass', 1400, 0.5)).connect(filter('lowpass', 3000)).connect(wash).connect(out);
    L.every(6, 11, (t) => {
      const peak = rand(0.25, 0.45);
      body.gain.setTargetAtTime(peak, t, 1.4);
      wash.gain.setTargetAtTime(peak * 0.18, t + 2.6, 0.5);
      body.gain.setTargetAtTime(0.05, t + 3.2, 1.8);
      wash.gain.setTargetAtTime(0, t + 3.4, 1.6);
    });
  },

  surf(L, out) {
    const g = gain(0.15);
    L.add(noise()).connect(filter('lowpass', 650)).connect(g).connect(out);
    const spray = gain(0);
    L.add(noise()).connect(filter('highpass', 2600)).connect(spray).connect(out);
    L.every(5.5, 9.5, (t) => {
      const peak = rand(0.6, 1);
      g.gain.setTargetAtTime(peak, t, 0.9);
      g.gain.setTargetAtTime(0.12, t + 2.4, 1.4);
      spray.gain.setTargetAtTime(peak * 0.25, t + 1.8, 0.2);
      spray.gain.setTargetAtTime(0, t + 2.3, 0.8);
    });
  },

  lapping(L, out) {
    const g = gain(0);
    L.add(noise()).connect(filter('bandpass', 420, 1.2)).connect(g).connect(out);
    L.add(noise()).connect(filter('lowpass', 280)).connect(gain(0.12)).connect(out);
    L.every(0.35, 1.4, (t) => envelope(g.gain, t, rand(0.2, 0.7), 0.12, 0.45));
  },

  rain(L, out) {
    const g = gain(0.35);
    L.add(noise()).connect(filter('highpass', 1400)).connect(g).connect(out);
    L.add(noise()).connect(filter('lowpass', 500)).connect(gain(0.2)).connect(out);
    L.add(lfo(g.gain, 0.07, 0.1));
  },

  insects(L, out) {
    const g = gain(0.08);
    L.add(noise()).connect(filter('bandpass', 6500, 2)).connect(g).connect(out);
    L.add(lfo(g.gain, 0.2, 0.03));
  },

  cicadas(L, out) {
    for (let v = 0; v < 2; v++) {
      const f = rand(4200, 6400);
      const am = gain(0.5);
      const phrase = gain(0);
      L.add(osc('sawtooth', f)).connect(filter('bandpass', f, 8)).connect(am).connect(phrase).connect(panned(out));
      L.add(lfo(am.gain, rand(35, 60), 0.5, 'square'));
      L.every(4, 10, (t) => envelope(phrase.gain, t, rand(0.3, 0.6), 1.5, 2.5, rand(2, 5)));
    }
  },

  crickets(L, out) {
    for (let c = 0; c < 2; c++) {
      const f = rand(4400, 5200);
      const dest = panned(out);
      L.every(0.5, 1.1, (t) => { for (let i = 0; i < 3; i++) blip(t + i * 0.05, 'sine', f, f, 0.025, 0.25, dest, 0.004); });
    }
  },

  birds(L, out, { kind = 'temperate', every: [a, b] = [2, 6] }) {
    L.every(a, b, (t) => {
      const dest = panned(out);
      reverbSend(dest, 0.3);
      SONGS[kind](t, dest);
    });
  },

  frogs(L, out) {
    const dest = gain(1);
    dest.connect(filter('lowpass', 900)).connect(out);
    L.every(1.5, 4, (t) => {
      const n = Math.floor(rand(3, 8));
      for (let i = 0; i < n; i++) {
        const f = rand(170, 260);
        const t0 = t + rand(0, 1.2);
        const p = panned(dest);
        for (let k = 0; k < 2 + Math.floor(rand(0, 2)); k++) blip(t0 + k * 0.09, 'square', f, f * 0.92, 0.07, 0.25, p);
      }
    });
  },

  howler(L, out) {
    L.every(25, 50, (t) => {
      const dest = panned(out);
      reverbSend(dest, 0.8);
      const o = audioContext().createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(80, t);
      o.frequency.linearRampToValueAtTime(110, t + 1.5);
      o.frequency.linearRampToValueAtTime(90, t + 5);
      const g = gain(0);
      envelope(g.gain, t, 0.35, 1.5, 2.5, 2);
      o.connect(filter('lowpass', 600)).connect(g).connect(dest);
      o.start(t);
      o.stop(t + 6.2);
      hiss(t, 'bandpass', 380, 3, 1.5, 2.5, 0.4, dest, 2);
    });
  },

  // A murmuring crowd: each "voice" is noise through a vowel-like filter that
  // hops between formants in syllable-sized steps.
  crowd(L, out, { voices = 10, excited = false }) {
    const FORMANTS = [300, 420, 560, 700, 850, 1100, 1400, 1800, 2300];
    const mix = gain(excited ? 1.4 : 1);
    mix.connect(filter('lowpass', excited ? 3000 : 2200)).connect(out);
    for (let v = 0; v < voices; v++) {
      const scale = rand(0.8, 1.25);
      const f = filter('bandpass', 600, 6);
      const g = gain(0);
      L.add(noise()).connect(f).connect(g).connect(panned(mix));
      L.every(0.09, 0.26, (t) => {
        f.frequency.setTargetAtTime(pickOne(FORMANTS) * scale, t, 0.03);
        g.gain.setTargetAtTime(Math.random() < 0.3 ? 0 : rand(0.25, 0.9), t, 0.04);
      });
    }
    if (excited) {
      L.every(0.8, 2.6, (t) => {
        const o = audioContext().createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(rand(160, 320), t);
        const g = gain(0);
        const hold = rand(0.2, 0.6);
        envelope(g.gain, t, 0.35, 0.08, 0.4, hold);
        const vib = osc('sine', 5.5);
        const depth = gain(6);
        vib.connect(depth).connect(o.frequency);
        o.connect(filter('bandpass', pickOne([700, 900, 1100]), 3)).connect(g).connect(panned(mix));
        o.start(t);
        o.stop(t + hold + 0.6);
        vib.stop(t + hold + 0.6);
      });
    }
  },

  clinks(L, out) {
    L.every(1.5, 5, (t) => {
      const dest = panned(out);
      for (let i = 0; i < Math.floor(rand(1, 4)); i++) blip(t + i * rand(0.15, 0.35), 'sine', rand(1800, 3200), rand(1700, 3100), 0.25, 0.12, dest, 0.002);
    });
  },

  // Blades and shields: inharmonic FM hits that ring and decay.
  clangs(L, out) {
    const dest = gain(1);
    dest.connect(filter('highpass', 600)).connect(out);
    reverbSend(dest, 0.35);
    L.every(0.4, 2.2, (t) => {
      const p = panned(dest);
      for (let i = 0; i < Math.floor(rand(1, 5)); i++) {
        const t0 = t + i * rand(0.08, 0.3);
        const f = rand(900, 2200);
        const decay = rand(0.3, 0.9);
        const car = audioContext().createOscillator();
        const mod = audioContext().createOscillator();
        car.frequency.value = f;
        mod.frequency.value = f * 2.76;
        const index = gain(0);
        index.gain.setValueAtTime(f * 2, t0);
        index.gain.exponentialRampToValueAtTime(1, t0 + decay);
        mod.connect(index).connect(car.frequency);
        const g = gain(0);
        envelope(g.gain, t0, 0.4, 0.002, decay);
        car.connect(g).connect(p);
        car.start(t0); mod.start(t0);
        car.stop(t0 + decay + 0.1); mod.stop(t0 + decay + 0.1);
        hiss(t0, 'highpass', 3000, 0.7, 0.001, 0.03, 0.3, p);
      }
    });
  },

  drums(L, out, { style = 'war', bpm = 84 }) {
    const beat = 60 / bpm;
    const dest = gain(1);
    dest.connect(out);
    reverbSend(dest, 0.4);
    const thud = (t, f0, f1, peak) => {
      blip(t, 'sine', f0, f1, 0.45, peak, dest, 0.004);
      hiss(t, 'lowpass', 300, 0.7, 0.002, 0.08, peak * 0.4, dest);
    };
    const wood = (t, f) => blip(t, 'triangle', f, f * 0.98, 0.14, 0.35, dest, 0.002);
    const AZTEC = ['T', '', 't', 't', 'T', '', 'w', 'W'];
    let i = 0;
    L.every(beat, beat, (t) => {
      if (style === 'aztec') {
        const s = AZTEC[i % AZTEC.length];
        if (s === 'T') thud(t, 75, 40, 0.9);
        else if (s === 't') thud(t, 85, 50, 0.5);
        else if (s === 'w') wood(t, 320);
        else if (s === 'W') wood(t, 420);
      } else if (style === 'rowing') {
        thud(t, 70, 45, 0.8);
        hiss(t + 0.4, 'bandpass', 900, 0.8, 0.05, 0.5, 0.25, dest);
      } else if (i % 4 !== 3) {
        thud(t, i % 4 === 0 ? 90 : 80, 45, i % 4 === 0 ? 0.9 : 0.55);
      }
      i++;
    });
  },

  horns(L, out, { style = 'cornu' }) {
    L.every(12, 30, (t) => {
      const dest = panned(out, rand(-0.5, 0.5));
      reverbSend(dest, 0.6);
      const g = gain(0);
      if (style === 'conch') {
        envelope(g.gain, t, 0.35, 0.4, 0.8, 1.4);
        const o = audioContext().createOscillator();
        o.frequency.setValueAtTime(330, t);
        o.frequency.linearRampToValueAtTime(350, t + 1.6);
        o.connect(g);
        o.start(t); o.stop(t + 2.8);
        hiss(t, 'bandpass', 340, 10, 0.4, 0.8, 0.3, dest, 1.4);
      } else {
        envelope(g.gain, t, 0.3, 0.25, 1, 1);
        for (const f of [196, 293.7]) {
          const o = audioContext().createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          const vib = osc('sine', 5);
          const depth = gain(3);
          vib.connect(depth).connect(o.frequency);
          o.connect(g);
          o.start(t); o.stop(t + 2.4); vib.stop(t + 2.4);
        }
      }
      g.connect(filter('lowpass', 1400)).connect(dest);
    });
  },

  creak(L, out) {
    L.every(4, 10, (t) => {
      const o = audioContext().createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = rand(60, 110);
      const jitter = osc('sine', 18);
      const depth = gain(15);
      jitter.connect(depth).connect(o.frequency);
      const g = gain(0);
      envelope(g.gain, t, 0.3, 0.2, 0.5, 0.4);
      o.connect(filter('bandpass', 700, 4)).connect(g).connect(panned(out));
      o.start(t); o.stop(t + 1.2); jitter.stop(t + 1.2);
    });
  },

  fire(L, out) {
    const g = gain(0.35);
    L.add(noise()).connect(filter('lowpass', 400)).connect(g).connect(out);
    L.add(lfo(g.gain, 0.3, 0.12));
    L.every(0.1, 0.35, (t) => {
      for (let i = 0; i < Math.floor(rand(2, 6)); i++) hiss(t + rand(0, 0.25), 'bandpass', rand(1500, 4000), 2, 0.002, 0.03, rand(0.2, 0.5), out);
    });
  },

  marching(L, out) {
    let left = true;
    L.every(0.55, 0.55, (t) => {
      hiss(t, 'lowpass', 260, 0.7, 0.005, 0.09, 0.6, panned(out, left ? -0.2 : 0.2));
      if (Math.random() < 0.2) hiss(t + 0.05, 'highpass', 5000, 0.7, 0.002, 0.06, 0.15, out);
      left = !left;
    });
  },

  artillery(L, out, { every: [a, b] = [3, 11] }) {
    const dest = gain(1);
    dest.connect(out);
    reverbSend(dest, 0.5);
    const boom = (t) => {
      const p = panned(dest);
      hiss(t, 'lowpass', 140, 0.7, 0.01, 2.5, 1, p);
      blip(t, 'sine', 45, 28, 1.2, 0.7, p, 0.005);
    };
    L.every(a, b, (t) => {
      boom(t);
      if (Math.random() < 0.3) boom(t + rand(0.4, 1.5));
    });
  },

  aircraft(L, out, { continuous = false }) {
    const pass = (t) => {
      const p = audioContext().createStereoPanner ? audioContext().createStereoPanner() : null;
      const g = gain(0);
      envelope(g.gain, t, 0.5, 6, 7, 4);
      const lp = filter('lowpass', 380);
      lp.connect(g);
      if (p) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        p.pan.setValueAtTime(-0.8 * dir, t);
        p.pan.linearRampToValueAtTime(0.8 * dir, t + 17);
        g.connect(p).connect(out);
      } else g.connect(out);
      for (const f of [82, 84.5, 164]) {
        const o = audioContext().createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * rand(0.97, 1.03);
        o.connect(lp);
        o.start(t); o.stop(t + 17.5);
      }
    };
    L.every(continuous ? 9 : 25, continuous ? 14 : 50, pass);
  },

  siren(L, out) {
    L.every(30, 60, (t) => {
      const g = gain(0);
      envelope(g.gain, t, 0.3, 2, 3, 8);
      const dest = panned(out, rand(-0.4, 0.4));
      reverbSend(dest, 0.7);
      g.connect(filter('lowpass', 1500)).connect(dest);
      for (const k of [1, 1.5]) {
        const o = audioContext().createOscillator();
        o.frequency.setValueAtTime(280 * k, t);
        o.frequency.linearRampToValueAtTime(620 * k, t + 4);
        o.frequency.setValueAtTime(620 * k, t + 7);
        o.frequency.linearRampToValueAtTime(280 * k, t + 12);
        const og = gain(k === 1 ? 1 : 0.3);
        o.connect(og).connect(g);
        o.start(t); o.stop(t + 13.2);
      }
    });
  },

  gunfire(L, out) {
    const dest = gain(1);
    dest.connect(out);
    reverbSend(dest, 0.5);
    L.every(4, 12, (t) => {
      const p = panned(dest);
      const burst = Math.random() < 0.5;
      const shots = burst ? Math.floor(rand(5, 14)) : Math.floor(rand(1, 4));
      const gap = burst ? rand(0.07, 0.09) : rand(0.5, 0.9);
      for (let i = 0; i < shots; i++) {
        hiss(t + i * gap, 'bandpass', 1200, 0.8, 0.001, 0.08, 0.4, p);
        hiss(t + i * gap, 'lowpass', 200, 0.7, 0.001, 0.15, 0.3, p);
      }
    });
  },

  helicopter(L, out) {
    L.every(18, 35, (t) => {
      const g = gain(0);
      envelope(g.gain, t, 0.5, 4, 5, 3);
      const am = gain(0.5);
      const chop = audioContext().createOscillator();
      chop.type = 'square';
      chop.frequency.value = rand(12, 15);
      const depth = gain(0.5);
      chop.connect(depth).connect(am.gain);
      const p = panned(out, rand(-0.7, 0.7));
      am.connect(g).connect(p);
      const n = audioContext().createBufferSource();
      n.buffer = noiseBufferFrom();
      n.connect(filter('bandpass', 140, 1)).connect(am);
      n.start(t); n.stop(t + 12.2); chop.start(t); chop.stop(t + 12.2);
    });
  },

  traffic(L, out) {
    const bed = gain(0.25);
    L.add(noise()).connect(filter('lowpass', 220)).connect(bed).connect(out);
    L.add(lfo(bed.gain, 0.05, 0.08));
    L.every(3, 9, (t) => {
      const p = audioContext().createStereoPanner ? audioContext().createStereoPanner() : gain(1);
      if (p.pan) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        p.pan.setValueAtTime(-0.7 * dir, t);
        p.pan.linearRampToValueAtTime(0.7 * dir, t + 3.2);
      }
      p.connect(out);
      hiss(t, 'bandpass', 500, 0.7, 1.4, 1.8, 0.4, p);
      const o = audioContext().createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = rand(60, 90);
      const g = gain(0);
      envelope(g.gain, t, 0.15, 1.4, 1.8);
      o.connect(filter('lowpass', 200)).connect(g).connect(p);
      o.start(t); o.stop(t + 3.3);
    });
  },

  ukSiren(L, out) {
    L.every(40, 80, (t) => {
      const g = gain(0);
      envelope(g.gain, t, 0.15, 1, 2, 5);
      const dest = panned(out, rand(-0.6, 0.6));
      reverbSend(dest, 0.8);
      g.connect(filter('lowpass', 2000)).connect(dest);
      const o = audioContext().createOscillator();
      for (let k = 0; k < 3; k++) {
        o.frequency.setValueAtTime(600, t + k * 2.6);
        o.frequency.linearRampToValueAtTime(1300, t + k * 2.6 + 1.3);
        o.frequency.linearRampToValueAtTime(600, t + k * 2.6 + 2.6);
      }
      o.connect(g);
      o.start(t); o.stop(t + 8.2);
    });
  },

  room(L, out) {
    L.add(noise()).connect(filter('lowpass', 250)).connect(gain(0.12)).connect(out);
  },
};

// ---------- Bird songs ----------
const SONGS = {
  temperate(t, dest) {
    const pattern = Math.floor(rand(0, 3));
    if (pattern === 0) { // a few whistled notes
      let f = rand(2200, 3800);
      for (let i = 0; i < Math.floor(rand(2, 5)); i++) {
        const f1 = f * rand(0.8, 1.25);
        blip(t + i * 0.25, 'sine', f, f1, 0.18, 0.3, dest);
        f = f1;
      }
    } else if (pattern === 1) { // a trill
      const o = audioContext().createOscillator();
      o.frequency.value = rand(2600, 3600);
      const vib = osc('sine', rand(18, 26));
      const depth = gain(rand(300, 600));
      vib.connect(depth).connect(o.frequency);
      const g = gain(0);
      envelope(g.gain, t, 0.22, 0.05, 0.3, 0.3);
      o.connect(g).connect(dest);
      o.start(t); o.stop(t + 0.7); vib.stop(t + 0.7);
    } else { // chirps
      for (let i = 0; i < Math.floor(rand(4, 8)); i++) blip(t + i * 0.09, 'sine', rand(4000, 4600), rand(2400, 2800), 0.05, 0.2, dest, 0.004);
    }
  },
  water(t, dest) {
    if (Math.random() < 0.5) {
      for (let i = 0; i < Math.floor(rand(2, 4)); i++) {
        const o = blip(t + i * 0.2, 'sawtooth', 460, 380, 0.15, 0.12, dest);
        o.disconnect();
        const f = filter('bandpass', 1000, 2);
        const g = gain(0);
        envelope(g.gain, t + i * 0.2, 0.25, 0.01, 0.14);
        o.connect(f).connect(g).connect(dest);
      }
    } else SONGS.temperate(t, dest);
  },
  gull(t, dest) {
    for (let i = 0; i < Math.floor(rand(2, 5)); i++) {
      const t0 = t + i * rand(0.3, 0.45);
      const o = audioContext().createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(rand(1300, 1500), t0);
      o.frequency.exponentialRampToValueAtTime(rand(750, 850), t0 + 0.32);
      const g = gain(0);
      envelope(g.gain, t0, 0.25, 0.03, 0.3);
      o.connect(filter('bandpass', 1400, 1.5)).connect(g).connect(dest);
      o.start(t0); o.stop(t0 + 0.4);
    }
  },
  jungle(t, dest) {
    const pattern = Math.floor(rand(0, 4));
    if (pattern === 0) { // whoop
      blip(t, 'sine', 500, 1100, 0.35, 0.3, dest);
      blip(t + 0.35, 'sine', 1100, 700, 0.3, 0.3, dest);
    } else if (pattern === 1) { // parrot squawk
      for (let i = 0; i < 2; i++) {
        const o = audioContext().createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(rand(1300, 1500), t + i * 0.28);
        o.frequency.linearRampToValueAtTime(rand(1700, 1900), t + i * 0.28 + 0.2);
        const g = gain(0);
        envelope(g.gain, t + i * 0.28, 0.18, 0.01, 0.19);
        o.connect(filter('bandpass', 2000, 2)).connect(g).connect(dest);
        o.start(t + i * 0.28); o.stop(t + i * 0.28 + 0.25);
      }
    } else if (pattern === 2) { // bell-like ping
      for (let i = 0; i < 3; i++) blip(t + i * 0.4, 'sine', 2600, 2550, 0.3, 0.25, dest, 0.003);
    } else SONGS.temperate(t, dest);
  },
};

export function presetNames() {
  return Object.keys(PRESETS);
}
