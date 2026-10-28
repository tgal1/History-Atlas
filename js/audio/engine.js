// Shared Web Audio plumbing: one AudioContext (created on the first click,
// as browsers require), a master bus, separate buses for ambience and music
// that duck while the narrator speaks, a generated reverb, and small helpers
// for noise, envelopes and timed events.

let ctx = null;
const bus = {};
let noiseBuffer = null;

export function audioContext() {
  return ctx;
}

// Call from a click or key press. Safe to call often.
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    bus.master = ctx.createGain();
    bus.master.connect(ctx.destination);
    bus.ambience = ctx.createGain();
    bus.music = ctx.createGain();
    bus.duck = ctx.createGain(); // ambience and music both pass through this
    bus.ambience.connect(bus.duck);
    bus.music.connect(bus.duck);
    bus.duck.connect(bus.master);
    bus.reverb = ctx.createConvolver();
    bus.reverb.buffer = impulse(3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    bus.reverb.connect(wet).connect(bus.duck);
    noiseBuffer = makeNoise(4);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const buses = bus;

export function setLevel(name, value, seconds = 0.4) {
  if (!ctx || !bus[name]) return;
  bus[name].gain.setTargetAtTime(value, ctx.currentTime, seconds / 3);
}

// Narration pulls the background down so the voice is clear.
export function duck(on) {
  setLevel('duck', on ? 0.38 : 1, on ? 0.3 : 1.2);
}

// ---------- Sources ----------
export function noise() {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.start(ctx.currentTime, Math.random() * 3.5);
  return src;
}

export function filter(type, frequency, Q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}

export function gain(value = 1) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function osc(type, frequency) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = frequency;
  o.start();
  return o;
}

export function panner(pan) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (p.pan) p.pan.value = pan;
  return p;
}

// Slow wobble on a parameter: lfo(rate, depth) -> param.
export function lfo(param, rate, depth, type = 'sine') {
  const o = osc(type, rate);
  const g = gain(depth);
  o.connect(g).connect(param);
  return o;
}

// A one-shot envelope on a gain param: up in a, hold, down in d.
export function envelope(param, t, peak, a, d, hold = 0) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setValueAtTime(peak, t + a + hold);
  param.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
}

// Calls fn(time) at random intervals until stopped.
export function every(minS, maxS, fn, stopped) {
  let timer = null;
  const tick = () => {
    if (stopped()) return;
    try { fn(ctx.currentTime + 0.05); } catch (err) { console.warn('[audio]', err); }
    timer = setTimeout(tick, (minS + Math.random() * (maxS - minS)) * 1000);
  };
  timer = setTimeout(tick, Math.random() * maxS * 600);
  return () => clearTimeout(timer);
}

export const rand = (a, b) => a + Math.random() * (b - a);
export const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

function makeNoise(seconds) {
  const buf = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}
