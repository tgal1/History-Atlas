// Narration. Two kinds of voice:
//
//   studio   recordings made with Kokoro (tools/render_narration.py), the
//            same natural voice in every browser. Each voice has a manifest
//            listing what has been recorded.
//   browser  the browser's own text-to-speech: Edge's "Natural" voices are
//            good, others vary. Used for anything not recorded yet.
//
// Browser speech is spoken a sentence at a time, because some browsers cut
// off long utterances.

import { duck } from './engine.js';

const STUDIO = [
  { name: 'studio:bm_george', label: 'George, British (studio)', lang: 'en-GB', id: 'bm_george' },
  { name: 'studio:af_heart', label: 'Heart, American (studio)', lang: 'en-US', id: 'af_heart' },
];

export function createNarrator() {
  const synth = window.speechSynthesis ?? null;
  let browserVoices = [];
  let studio = []; // studio voices whose recordings exist
  const manifests = new Map();
  let voice = null; // a browser voice or a studio entry
  let rate = 1;
  let run = 0; // bumps on every speak/cancel so stale callbacks are ignored
  let playing = null;
  const listeners = new Set();

  const all = () => [...studio, ...browserVoices];
  const emit = () => listeners.forEach((fn) => fn(all()));

  function loadVoices() {
    if (!synth) return;
    browserVoices = synth.getVoices()
      .filter((v) => v.lang?.toLowerCase().startsWith('en'))
      .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
    if (voice && !voice.id && !browserVoices.includes(voice)) voice = browserVoices.find((v) => v.name === voice.name) ?? null;
    emit();
  }
  if (synth) {
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
  }

  // Which studio voices have recordings on this site.
  Promise.all(STUDIO.map((s) => fetch(`audio/narration/${s.id}/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => { if (m) manifests.set(s.id, m); return m ? s : null; })
    .catch(() => null)))
    .then((found) => {
      studio = found.filter(Boolean);
      if (pendingName) setVoice(pendingName);
      emit();
    });
  let pendingName = null;

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

  function setVoice(name) {
    pendingName = name;
    voice = all().find((v) => v.name === name) ?? null;
  }

  // key: where the recording would be, e.g. "events/rome/founding".
  function speak(text, key) {
    cancel();
    if (!text) return Promise.resolve();
    const s = voice?.id ? voice : !voice ? studio[0] : null;
    if (s && key && manifests.get(s.id)?.[key]) return playRecording(`audio/narration/${s.id}/${key}.mp3`);
    return speakBrowser(text);
  }

  function playRecording(url) {
    const id = ++run;
    const el = new Audio(url);
    el.playbackRate = rate;
    el.preservesPitch = true;
    playing = el;
    duck(true);
    return new Promise((resolve) => {
      const done = () => {
        if (id === run) { duck(false); playing = null; }
        resolve();
      };
      el.addEventListener('ended', done, { once: true });
      el.addEventListener('error', done, { once: true });
      el.addEventListener('pause', () => { if (id !== run || el.ended) done(); }, { once: true });
      el.play().catch(done);
    });
  }

  function speakBrowser(text) {
    if (!synth) return Promise.resolve();
    const id = ++run;
    const bv = voice && !voice.id ? voice : browserVoices[0] ?? null;
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
        if (bv) u.voice = bv;
        u.lang = bv?.lang ?? 'en-GB';
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
    if (playing) { playing.pause(); playing = null; }
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    duck(false);
  }

  return {
    supported: Boolean(synth) || STUDIO.length > 0,
    get voices() { return all(); },
    get voice() { return voice; },
    setVoice,
    setRate(r) { rate = r; if (playing) playing.playbackRate = r; },
    onVoices(fn) { listeners.add(fn); fn(all()); },
    speak,
    cancel,
    get speaking() { return Boolean(playing) || Boolean(synth?.speaking); },
  };
}
