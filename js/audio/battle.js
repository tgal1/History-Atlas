// Sounds that follow a scene as it plays. Every frame the scene player reports
// how hard each kind of unit is moving on screen and how much fighting there
// is (opposing units in contact, units losing strength); these levels drive
//
//   hooves    cavalry and elephants on the move: galloping hoof beats
//   feet      infantry and marchers: the tramp of many feet, kit rattling
//   oars      ships: rhythmic oar strokes;  paddles: canoes, quicker and lighter
//   engines   tanks: diesel rumble and track squeal;  aircraft: a droning pass
//   melee     the fight itself, by era: clashing blades and shouts; arquebuses
//             and cannon for the conquest; rifles, machine guns and shells
//
// plus a horn call (or conch) when a battle begins.

import { audioContext, buses, noise, filter, gain, osc, envelope, rand, panner } from './engine.js';

const LEVEL = { hooves: 0.9, feet: 0.8, oars: 0.7, paddles: 0.6, engines: 0.5, aircraft: 0.35, melee: 1 };

export function createBattleSounds() {
  let S = null;
  const want = { hooves: 0, feet: 0, oars: 0, paddles: 0, engines: 0, aircraft: 0, melee: 0 };

  function build(era) {
    const out = gain(1);
    out.connect(buses.ambience);
    out.connect(gain(0.35)).connect(buses.reverb);
    const S2 = { era, out, nodes: [], timer: null, level: { ...want } };
    // Continuous layers: tank engines and aircraft.
    const engine = gain(0);
    for (const f of [41, 62]) {
      const o = osc('sawtooth', f);
      o.connect(filter('lowpass', 220)).connect(engine);
      S2.nodes.push(o);
    }
    const squeal = gain(0);
    const sq = noise();
    sq.connect(filter('bandpass', 1800, 3)).connect(squeal);
    const am = osc('square', 9);
    const amDepth = gain(0.5);
    am.connect(amDepth).connect(squeal.gain);
    S2.nodes.push(sq, am);
    engine.connect(out);
    squeal.connect(out);
    const plane = gain(0);
    for (const f of [108, 111.5]) {
      const o = osc('sawtooth', f);
      o.connect(filter('lowpass', 520)).connect(plane);
      S2.nodes.push(o);
    }
    plane.connect(out);
    S2.engine = engine;
    S2.squeal = squeal;
    S2.plane = plane;
    S2.beat = { feet: 0, oars: 0, paddles: 0 };
    // Event-driven layers, scheduled a little ahead of the audio clock.
    S2.timer = setInterval(() => tick(S2), 100);
    return S2;
  }

  function tick(s) {
    const ctx = audioContext();
    const t = ctx.currentTime + 0.12;
    const L = s.level;
    // Ease towards the wanted levels so sounds swell and fade.
    for (const k of Object.keys(L)) L[k] += (want[k] - L[k]) * 0.25;
    s.engine.gain.setTargetAtTime(0.16 * L.engines * LEVEL.engines, ctx.currentTime, 0.3);
    s.squeal.gain.setTargetAtTime(0.03 * L.engines, ctx.currentTime, 0.3);
    s.plane.gain.setTargetAtTime(0.1 * L.aircraft * LEVEL.aircraft, ctx.currentTime, 0.5);

    if (L.hooves > 0.03) {
      for (let k = 0; k < Math.ceil(L.hooves * 5); k++) hoof(t + rand(0, 0.1), L.hooves * LEVEL.hooves, s.out);
    }
    if (L.feet > 0.03 && ctx.currentTime >= s.beat.feet) {
      s.beat.feet = ctx.currentTime + 0.5;
      for (let k = 0; k < Math.ceil(L.feet * 7); k++) step(t + rand(0, 0.12), L.feet * LEVEL.feet, s.era, s.out);
    }
    if (L.oars > 0.03 && ctx.currentTime >= s.beat.oars) {
      s.beat.oars = ctx.currentTime + 1.8;
      for (let k = 0; k < 4; k++) splash(t + rand(0, 0.15), 900, 0.5, L.oars * LEVEL.oars, s.out);
    }
    if (L.paddles > 0.03 && ctx.currentTime >= s.beat.paddles) {
      s.beat.paddles = ctx.currentTime + 0.85;
      for (let k = 0; k < 5; k++) splash(t + rand(0, 0.25), 1300, 0.3, L.paddles * LEVEL.paddles, s.out);
    }
    if (L.melee > 0.03) melee(s, t, L.melee * LEVEL.melee);
  }

  return {
    // action: { hooves, feet, ..., melee } in 0..1, or null when the scene is paused or closed.
    update(action, era) {
      if (!audioContext()) return;
      for (const k of Object.keys(want)) want[k] = action ? Math.min(1, action[k] ?? 0) : 0;
      if (action && (!S || S.era !== era)) { stop(); S = build(era); }
    },
    // A signal as the battle opens.
    start(era) {
      if (!audioContext()) return;
      const t = audioContext().currentTime + 0.2;
      if (era === 'ancient') { horn(t, 196, 1.4); horn(t + 1.5, 147, 2); }
      else if (era === 'musket') drumRoll(t, 2.2);
      else if (era === 'conquest') { conch(t); horn(t + 2.4, 392, 0.8, 'square'); }
    },
    stop,
  };

  function stop() {
    if (!S) return;
    const old = S;
    S = null;
    clearInterval(old.timer);
    old.out.gain.setTargetAtTime(0, audioContext().currentTime, 0.5);
    setTimeout(() => { old.nodes.forEach((n) => { try { n.stop(); } catch { /* stopped */ } }); old.out.disconnect(); }, 3000);
  }
}

// ---------- The fight ----------
function melee(s, t, I) {
  const chance = (perSecond) => Math.random() < perSecond * 0.1;
  if (s.era === 'modern') {
    if (chance(6 * I)) crack(t + rand(0, 0.1), 0.25 * I, s.out);
    if (chance(0.5 * I)) for (let k = 0; k < 8; k++) crack(t + k * 0.075, 0.12 * I, s.out);
    if (chance(0.35 * I)) boom(t + rand(0, 0.1), 0.5 * I, s.out);
    return;
  }
  if (s.era === 'civil') return;
  if (s.era === 'musket') {
    // Ragged volleys, cannon, the odd bayonet clash and shouting.
    if (chance(0.9 * I)) volley(t, 0.22 * I, s.out);
    if (chance(2 * I)) crack(t + rand(0, 0.1), 0.15 * I, s.out);
    if (chance(0.25 * I)) boom(t + rand(0, 0.1), 0.55 * I, s.out);
    if (chance(2 * I)) shout(t + rand(0, 0.1), 0.1 * I, s.out);
    if (chance(1.5 * I)) clang(t + rand(0, 0.1), 0.08 * I, s.out);
    return;
  }
  if (chance(8 * I)) clang(t + rand(0, 0.1), 0.18 * I, s.out);
  if (chance(4 * I)) shout(t + rand(0, 0.1), 0.12 * I, s.out);
  if (s.era === 'conquest') {
    if (chance(0.5 * I)) { crack(t, 0.3 * I, s.out); boom(t + 0.01, 0.15 * I, s.out); }
    if (chance(0.08 * I)) boom(t + rand(0, 0.1), 0.6 * I, s.out);
  }
}

// ---------- Voices ----------
function hoof(t, I, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, 0.22 * I, 0.003, 0.07);
  n.connect(filter('lowpass', 380)).connect(g).connect(panner(rand(-0.6, 0.6))).connect(out);
  n.stop(t + 0.12);
  const c = noise();
  const cg = gain(0);
  envelope(cg.gain, t, 0.05 * I, 0.001, 0.025);
  c.connect(filter('bandpass', 1600, 2)).connect(cg).connect(out);
  c.stop(t + 0.05);
}

function step(t, I, era, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, 0.12 * I, 0.004, 0.09);
  n.connect(filter('lowpass', 240)).connect(g).connect(panner(rand(-0.7, 0.7))).connect(out);
  n.stop(t + 0.14);
  if (era !== 'civil' && Math.random() < 0.4) {
    const j = noise();
    const jg = gain(0);
    envelope(jg.gain, t + 0.02, 0.025 * I, 0.002, 0.06);
    j.connect(filter('bandpass', 5200, 3)).connect(jg).connect(out);
    j.stop(t + 0.1);
  }
}

function splash(t, f, length, I, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, 0.09 * I, 0.08, length);
  n.connect(filter('bandpass', f * rand(0.8, 1.2), 1)).connect(g).connect(panner(rand(-0.6, 0.6))).connect(out);
  n.stop(t + length + 0.2);
}

// Metal on metal: inharmonic FM with a fast decay.
function clang(t, I, out) {
  const ctx = audioContext();
  const f = rand(700, 1800);
  const car = ctx.createOscillator();
  car.frequency.value = f;
  const mod = ctx.createOscillator();
  mod.frequency.value = f * 2.76;
  const idx = gain(0);
  idx.gain.setValueAtTime(f * 2.5, t);
  idx.gain.exponentialRampToValueAtTime(1, t + 0.4);
  mod.connect(idx).connect(car.frequency);
  const g = gain(0);
  envelope(g.gain, t, I, 0.002, rand(0.25, 0.6));
  car.connect(filter('lowpass', 4500)).connect(g).connect(panner(rand(-0.8, 0.8))).connect(out);
  car.start(t); mod.start(t);
  car.stop(t + 0.7); mod.stop(t + 0.7);
}

// A shout: a buzzy voice through a vowel formant, pitch sliding.
function shout(t, I, out) {
  const ctx = audioContext();
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f = rand(140, 260);
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * rand(0.85, 1.25), t + 0.4);
  const g = gain(0);
  envelope(g.gain, t, I, 0.05, rand(0.3, 0.6), 0.1);
  o.connect(filter('bandpass', rand(600, 1100), 4)).connect(g).connect(panner(rand(-0.8, 0.8))).connect(out);
  o.start(t); o.stop(t + 0.9);
}

function crack(t, I, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, I, 0.001, 0.08);
  n.connect(filter('highpass', 900)).connect(g).connect(panner(rand(-0.8, 0.8))).connect(out);
  n.stop(t + 0.12);
}

function boom(t, I, out) {
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t, I, 0.01, 1.6);
  n.connect(filter('lowpass', 140)).connect(g).connect(out);
  n.stop(t + 1.8);
  const o = osc('sine', 52);
  o.frequency.exponentialRampToValueAtTime(30, t + 0.6);
  const og = gain(0);
  envelope(og.gain, t, I * 0.8, 0.005, 0.7);
  o.connect(og).connect(out);
  o.stop(t + 0.8);
}

// A line of muskets firing raggedly: many cracks within a third of a second, and smoke-thick thump.
function volley(t, I, out) {
  for (let k = 0; k < 10; k++) crack(t + rand(0, 0.35), I * rand(0.4, 1), out);
  boom(t + 0.05, I * 0.5, out);
}

// The drummers beat to arms: a snare roll swelling then a final stroke.
function drumRoll(t, length) {
  for (let x = 0; x < length; x += 0.055) {
    const n = noise();
    const g = gain(0);
    envelope(g.gain, t + x, 0.02 + 0.05 * (x / length), 0.002, 0.05);
    n.connect(filter('bandpass', 2400, 0.8)).connect(g).connect(buses.ambience);
    n.stop(t + x + 0.08);
  }
  const n = noise();
  const g = gain(0);
  envelope(g.gain, t + length, 0.1, 0.002, 0.3);
  n.connect(filter('bandpass', 2000, 0.8)).connect(g).connect(buses.ambience);
  n.stop(t + length + 0.35);
}

function horn(t, f, length, type = 'sawtooth') {
  const ctx = audioContext();
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f * 0.97, t);
  o.frequency.linearRampToValueAtTime(f, t + 0.15);
  const g = gain(0);
  envelope(g.gain, t, 0.07, 0.12, 0.5, length - 0.3);
  o.connect(filter('lowpass', 1400)).connect(g).connect(buses.ambience);
  g.connect(buses.reverb);
  o.start(t); o.stop(t + length + 0.6);
}

function conch(t) {
  const ctx = audioContext();
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(196, t);
  o.frequency.linearRampToValueAtTime(207, t + 1.2);
  o.frequency.linearRampToValueAtTime(190, t + 2.2);
  const g = gain(0);
  envelope(g.gain, t, 0.08, 0.4, 0.9, 1);
  o.connect(filter('bandpass', 600, 3)).connect(g).connect(buses.ambience);
  g.connect(buses.reverb);
  o.start(t); o.stop(t + 2.8);
}
