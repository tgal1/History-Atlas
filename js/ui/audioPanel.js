// The Sound button in the timeline bar and its pop-up: sound on/off,
// narration on/off, voice, speed, and volumes for soundscape and music.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createAudioPanel(button, panel, soundtrack) {
  const s = soundtrack.settings;
  const { narrator } = soundtrack;

  panel.innerHTML = `
    <div class="sp-row">
      <label class="toggle"><input type="checkbox" data-k="sound"> Sound</label>
      <span class="sp-now"></span>
    </div>
    <div class="sp-row">
      <label class="toggle"><input type="checkbox" data-k="narration"> Narration</label>
    </div>
    <label class="sp-field">Voice
      <select data-k="voice"></select>
    </label>
    <label class="sp-field">Speed <output data-o="rate"></output>
      <input type="range" min="0.7" max="1.4" step="0.05" data-k="rate">
    </label>
    <label class="sp-field">Soundscape
      <input type="range" min="0" max="1" step="0.05" data-k="ambience">
    </label>
    <label class="sp-field">Music
      <input type="range" min="0" max="1" step="0.05" data-k="music">
    </label>
    <button class="btn ghost sp-test" type="button">Test the voice</button>
    <p class="fine">Voices come from your browser (Edge has the most natural ones). Sounds and music are generated in your browser as you listen.</p>`;

  const $ = (sel) => panel.querySelector(sel);
  const voiceSelect = $('[data-k="voice"]');

  function fillVoices(voices) {
    if (!narrator.supported) {
      voiceSelect.innerHTML = '<option>Not available in this browser</option>';
      voiceSelect.disabled = true;
      return;
    }
    const current = s.voice ?? voices[0]?.name;
    voiceSelect.innerHTML = voices.map((v) => `<option value="${esc(v.name)}" ${v.name === current ? 'selected' : ''}>${esc(v.name.replace(/^Microsoft /, '').replace(/ - English.*$/, ''))} (${esc(v.lang)})</option>`).join('');
    if (!s.voice && voices[0]) narrator.setVoice(voices[0].name);
  }
  narrator.onVoices(fillVoices);

  function sync() {
    $('[data-k="sound"]').checked = s.sound;
    $('[data-k="narration"]').checked = s.narration;
    $('[data-k="narration"]').disabled = !s.sound || !narrator.supported;
    $('[data-k="rate"]').value = s.rate;
    $('[data-o="rate"]').textContent = `${Number(s.rate).toFixed(2)}x`;
    $('[data-k="ambience"]').value = s.ambience;
    $('[data-k="music"]').value = s.music;
    $('.sp-now').textContent = s.sound && soundtrack.sceneLabel ? `Now: ${soundtrack.sceneLabel}` : '';
    button.classList.toggle('off', !s.sound);
    button.querySelector('span').textContent = s.sound ? 'Sound' : 'Muted';
  }
  sync();
  soundtrack.onChange(sync);

  panel.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    soundtrack.unlock();
    soundtrack.update({ [k]: v });
  });
  $('.sp-test').addEventListener('click', () => {
    soundtrack.unlock();
    if (!s.sound) soundtrack.update({ sound: true });
    narrator.speak('This is how I will narrate the story.');
  });

  const close = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    soundtrack.unlock();
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target) && e.target !== button) close(); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); button.focus(); } });
}
