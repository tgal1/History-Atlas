// One place for everything audible: settings (remembered in this browser),
// the soundscape, the music and the narrator. Nothing plays until the first
// click or key press, as browsers require.

import { unlock, audioContext, setLevel } from './engine.js';
import { createSoundscapes, NO_MUSIC, PRESET_LABELS } from './soundscapes.js';
import { createMusic } from './music.js';
import { createNarrator } from './narrator.js';

const KEY = 'history-atlas.sound';
const DEFAULTS = { sound: true, narration: true, voice: null, rate: 1, ambience: 0.7, music: 0.35 };

export function createSoundtrack() {
  const settings = { ...DEFAULTS, ...load() };
  const scapes = createSoundscapes();
  const music = createMusic();
  const narrator = createNarrator();
  const listeners = new Set();
  let wantScene = null;
  let wantMood = null;

  narrator.setRate(settings.rate);
  narrator.onVoices(() => { if (settings.voice) narrator.setVoice(settings.voice); });

  function apply() {
    if (!audioContext()) return;
    setLevel('master', settings.sound ? 1 : 0, 0.3);
    // Make-up gain: the synthesised layers are mixed quietly so a busy scene never clips.
    setLevel('ambience', settings.ambience * 2.2);
    setLevel('music', settings.music * 1.4);
    scapes.set(wantScene ?? 'silence');
    music.set(wantScene && NO_MUSIC.has(wantScene) ? null : wantMood);
  }

  function emit() { listeners.forEach((fn) => fn()); }

  return {
    settings,
    narrator,
    // Call from any user gesture.
    unlock() {
      if (!settings.sound) return;
      const first = !audioContext();
      unlock();
      if (first) apply();
    },
    setScene(name) {
      if (name === wantScene) return;
      wantScene = name;
      apply();
      emit();
    },
    setMood(mood) {
      if (mood === wantMood) return;
      wantMood = mood;
      apply();
    },
    get sceneLabel() { return PRESET_LABELS[wantScene] ?? ''; },
    get nowPlaying() { return music.nowPlaying; },
    // True when events should be read aloud (and the tour should wait for the voice).
    get narrating() { return settings.sound && settings.narration && narrator.supported; },
    narrate(text) {
      if (!this.narrating) return Promise.resolve();
      return narrator.speak(text);
    },
    cancel() { narrator.cancel(); },
    update(changes) {
      Object.assign(settings, changes);
      if ('rate' in changes) narrator.setRate(settings.rate);
      if ('voice' in changes) narrator.setVoice(settings.voice);
      if (changes.sound === false || changes.narration === false) narrator.cancel();
      if (changes.sound) unlock();
      apply();
      save(settings);
      emit();
    },
    onChange(fn) { listeners.add(fn); },
  };
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function save(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}
