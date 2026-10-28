// "Ask the guide" chat. Each question carries what the viewer is looking at
// (date, chapter, selected event) so answers stay grounded in the map.
// A spoiler guard keeps answers from giving away later events.

import { formatDate, formatEventDate } from '../core/time.js';
import { askGuide, getApiKey, setApiKey } from '../services/claude.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Just enough markdown for chat replies: paragraphs, bold, italics.
function renderText(text) {
  return esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function createAskPanel(el, { story, getContext }) {
  const history = [];
  let controller = null;

  el.innerHTML = `
    <div class="ask">
      <div class="ask-context"></div>
      <label class="toggle"><input type="checkbox" class="ask-spoilers" checked> No spoilers past the current date</label>
      <div class="ask-log" aria-live="polite"></div>
      <form class="ask-form">
        <textarea rows="2" placeholder="Ask anything about what's on the map…"></textarea>
        <button class="btn primary" type="submit">Ask</button>
      </form>
      <details class="ask-settings">
        <summary>Settings</summary>
        <label>Anthropic API key
          <input type="password" class="ask-key" autocomplete="off" placeholder="sk-ant-…">
        </label>
        <div class="row">
          <button type="button" class="btn ghost" data-act="save">Save key</button>
          <button type="button" class="btn ghost" data-act="clear">New conversation</button>
        </div>
        <p class="fine">The key is stored only in this browser and sent only to Anthropic. Fine for personal use; put a server in front before sharing the site publicly.</p>
      </details>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const log = $('.ask-log');
  const form = $('.ask-form');
  const input = $('textarea');
  const keyInput = $('.ask-key');
  keyInput.value = getApiKey();

  $('[data-act="save"]').addEventListener('click', () => {
    setApiKey(keyInput.value.trim());
    renderEmpty();
  });
  $('[data-act="clear"]').addEventListener('click', () => {
    controller?.abort();
    history.length = 0;
    renderEmpty();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
  });

  function renderEmpty() {
    if (history.length) return;
    log.innerHTML = getApiKey()
      ? `<p class="hint">Ask about anything on screen. The guide knows where you are in the timeline.</p>`
      : `<p class="hint">To chat with the guide, open <strong>Settings</strong> below and paste an Anthropic API key.</p>`;
    if (!getApiKey()) $('.ask-settings').open = true;
  }

  function systemPrompt() {
    return [
      `You are ${story.ask?.persona ?? 'a knowledgeable, even-handed history guide'}.`,
      `You are built into History Atlas, an interactive map that tells the story of "${story.title}" (${story.subtitle}).`,
      'Each user message starts with a [Viewer context] note saying where they are on the timeline and what they are looking at. Use it to ground your answer; never mention the note itself.',
      'Write plain, conversational English in two to four short paragraphs, under about 200 words unless asked for more. No headings or bullet lists.',
      'Be even-handed: where communities or historians see something differently, say so. Flag disputed or uncertain facts, and do not invent numbers.',
    ].join('\n');
  }

  function contextNote() {
    const { t, event, era } = getContext();
    const when = formatDate(t, story.clockPrecision ?? 'day');
    const lines = [`Current date on the timeline: ${when}.`];
    if (era) lines.push(`Chapter: ${era.title}. ${era.text}`);
    if (event) {
      lines.push(`Selected event: ${event.title} (${formatEventDate(event)}, ${event.place}). ${event.summary}`);
    }
    if ($('.ask-spoilers').checked) {
      lines.push(`The viewer is following the story in order. Do not reveal events after ${when} unless they explicitly ask what happens later.`);
    }
    return `[Viewer context]\n${lines.join('\n')}`;
  }

  function addBubble(role, html) {
    if (!history.length && log.querySelector('.hint')) log.innerHTML = '';
    const div = document.createElement('div');
    div.className = `bubble ${role}`;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  async function ask(question) {
    question = question.trim();
    if (!question || controller) return;
    input.value = '';
    addBubble('user', esc(question));
    const bubble = addBubble('guide', '<span class="typing"><i></i><i></i><i></i></span>');

    const userTurn = { role: 'user', content: `${contextNote()}\n\n${question}` };
    controller = new AbortController();
    let text = '';
    try {
      const answer = await askGuide({
        system: systemPrompt(),
        messages: [...history, userTurn],
        signal: controller.signal,
        onText: (delta) => {
          text += delta;
          bubble.innerHTML = renderText(text);
          log.scrollTop = log.scrollHeight;
        },
      });
      bubble.innerHTML = renderText(answer);
      history.push(userTurn, { role: 'assistant', content: answer });
    } catch (err) {
      if (controller?.signal.aborted) bubble.remove();
      else bubble.innerHTML = `<p class="error">${esc(err.message ?? err)}</p>`;
    } finally {
      controller = null;
    }
  }

  function refreshContext() {
    const { t, event } = getContext();
    $('.ask-context').innerHTML = event
      ? `Talking about <strong>${esc(event.title)}</strong> · ${formatEventDate(event)}`
      : `Timeline at <strong>${formatDate(t, story.clockPrecision ?? 'month')}</strong>`;
  }

  renderEmpty();
  refreshContext();

  return {
    ask,
    refreshContext,
    focus: () => input.focus(),
  };
}
