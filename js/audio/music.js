// Background music: recorded tracks chosen for each story's time and place,
// played in turn with a short pause between. Each story picks a mood in
// story.json ("music": "roman").
//
// Most tracks are by Kevin MacLeod (incompetech.com), licensed under
// Creative Commons Attribution 4.0, and live in audio/music/. The WW2 mood
// also streams two Chopin polonaise recordings from Wikimedia Commons: Polish
// Radio played the 'Military' Polonaise during the 1939 siege of Warsaw.
// The Napoleonic mood streams a public-domain 1907 recording of La
// Marseillaise and Beethoven's Egmont overture (1810), written for a play
// about a people rising against foreign rule.

import { audioContext, buses, gain } from './engine.js';

const MACLEOD = 'Kevin MacLeod (incompetech.com), CC BY 4.0';
const track = (file, title) => ({ url: `audio/music/${file}.mp3`, title: `"${title}"`, credit: MACLEOD });
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';

const MOODS = {
  roman: [track('teller-of-the-tales', 'Teller of the Tales'), track('anguish', 'Anguish'), track('ancient-rite', 'Ancient Rite')],
  carthage: [track('return-of-the-mummy', 'Return of the Mummy'), track('teller-of-the-tales', 'Teller of the Tales'), track('ancient-rite', 'Ancient Rite')],
  aztec: [track('night-of-the-owl', 'Night of the Owl'), track('thunderhead', 'Thunderhead')],
  celtic: [track('moorland', 'Moorland'), track('errigal', 'Errigal'), track('decline', 'Decline')],
  colonial: [track('fife-and-drum', 'Fife and Drum'), track('americana', 'Americana')],
  civilwar: [track('crossing-the-divide', 'Crossing the Divide'), track('long-road-ahead', 'Long Road Ahead'), track('taps', 'Taps')],
  napoleonic: [
    track('egmont-overture-finale', 'Egmont Overture Finale (Beethoven)'),
    { url: `${COMMONS}a/ad/French_national_anthem_%28La_Marseillaise%2C_Old_recording_from_1907%29.ogg`, title: 'La Marseillaise (1907 recording)', credit: 'Public domain recording, Wikimedia Commons' },
    track('hero-down', 'Hero Down'),
    track('death-of-kings', 'Death of Kings'),
  ],
  ww2: [
    { url: `${COMMONS}9/9a/Polonaise_militaire_in_A_major-Brunswick_15098-Josef_Hofmann.mp3`, title: "Chopin, 'Military' Polonaise (Josef Hofmann)", credit: 'Public domain recording, Wikimedia Commons' },
    track('night-vigil', 'Night Vigil'),
    { url: `${COMMONS}3/38/Polonaise_no.5_-_Op.40_no.2_C-minor.mp3`, title: 'Chopin, Polonaise in C minor, Op. 40 No. 2', credit: 'CC0, Wikimedia Commons' },
  ],
};

const LEVEL = 1.1; // about level with the soundscape; both duck under narration

export function createMusic() {
  let current = null;
  return {
    get mood() { return current?.mood ?? null; },
    get nowPlaying() { return current?.now ?? null; },
    set(mood) {
      if (!audioContext() || (current?.mood ?? null) === (mood ?? null)) return;
      current?.stop();
      current = mood && MOODS[mood] ? play(mood) : null;
    },
    stop() { current?.stop(); current = null; },
  };
}

function play(mood) {
  const ctx = audioContext();
  const list = MOODS[mood];
  const S = { mood, now: null, dead: false };
  let i = 0;
  let el = null;
  let level = null;
  let wait = null;
  const next = () => {
    if (S.dead) return;
    const t = list[i++ % list.length];
    el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = t.url;
    level = gain(0);
    ctx.createMediaElementSource(el).connect(level).connect(buses.music);
    level.gain.setTargetAtTime(LEVEL, ctx.currentTime, 1.5);
    const onEnd = () => { wait = setTimeout(next, 3000); };
    el.addEventListener('ended', onEnd, { once: true });
    el.addEventListener('error', onEnd, { once: true });
    el.play().catch(() => {});
    S.now = { title: t.title, credit: t.credit };
  };
  next();
  S.stop = () => {
    S.dead = true;
    clearTimeout(wait);
    if (!el) return;
    level.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
    const old = el;
    setTimeout(() => old.pause(), 4000);
  };
  return S;
}
