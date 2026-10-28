// Narration with the browser's own text-to-speech voices. Which voices exist
// depends on the browser and system: Edge's "Natural" voices are the best,
// Chrome adds a few Google voices. Text is spoken a sentence at a time,
// because some browsers cut off long utterances.

import { duck } from './engine.js';

export function createNarrator() {
  const synth = window.speechSynthesis ?? null;
  let voices = [];
  let voice = null;
  let rate = 1;
  let run = 0; // bumps on every speak/cancel so stale callbacks are ignored
  const listeners = new Set();

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices()
      .filter((v) => v.lang?.toLowerCase().startsWith('en'))
      .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
    if (voice && !voices.includes(voice)) voice = voices.find((v) => v.name === voice.name) ?? null;
    listeners.forEach((fn) => fn(voices));
  }
  if (synth) {
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
  }

  // Prefer neural voices, then online ones, and British or American English.
  function rank(v) {
    let s = 0;
    if (/natural/i.test(v.name)) s += 40;
    if (/online/i.test(v.name)) s += 20;
    if (/google/i.test(v.name)) s += 10;
    if (/en-gb/i.test(v.lang)) s += 6;
    else if (/en-us/i.test(v.lang)) s += 5;
    else if (/en-(ie|au)/i.test(v.lang)) s += 3;
    return s;
  }

  function speak(text) {
    cancel();
    if (!synth || !text) return Promise.resolve();
    const id = ++run;
    const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text];
    duck(true);
    return new Promise((resolve) => {
      let left = sentences.length;
      const done = () => {
        if (--left > 0 && id === run) return;
        if (id === run) duck(false);
        resolve();
      };
      for (const s of sentences) {
        const u = new SpeechSynthesisUtterance(s.trim());
        if (voice) u.voice = voice;
        u.lang = voice?.lang ?? 'en-GB';
        u.rate = rate;
        u.onend = done;
        u.onerror = () => { left = 1; done(); };
        synth.speak(u);
      }
      // A cancel elsewhere never fires onend in some browsers.
      const watch = setInterval(() => {
        if (id !== run || (!synth.speaking && !synth.pending)) {
          clearInterval(watch);
          if (left > 0) { left = 1; done(); }
        }
      }, 400);
    });
  }

  function cancel() {
    run++;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    duck(false);
  }

  return {
    supported: Boolean(synth),
    get voices() { return voices; },
    get voice() { return voice; },
    setVoice(name) { voice = voices.find((v) => v.name === name) ?? null; },
    setRate(r) { rate = r; },
    onVoices(fn) { listeners.add(fn); fn(voices); },
    speak,
    cancel,
    get speaking() { return Boolean(synth?.speaking); },
  };
}
