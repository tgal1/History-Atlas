# Archived: "Ask the guide" chat

Removed from the site for now (the browser-side API key isn't safe on a public host). Nothing here is loaded by the app.

| File | Was |
|---|---|
| `askPanel.js` | `js/ui/askPanel.js`: the chat tab, context note and spoiler guard |
| `claude.js` | `js/services/claude.js`: the Claude API call, streamed from the browser with the viewer's own key |
| `ask.css` | The chat and question-chip styles from `css/panel.css` |

The story data still carries what the chat used, so nothing needs re-authoring: `ask.persona` and `ask.defaultQuestions` in each `story.json`, and `questions` on events.

## Bringing it back

1. Move `askPanel.js` back to `js/ui/` and `claude.js` to `js/services/`, and paste `ask.css` back into `css/panel.css`.
2. In `index.html`, add the tab button `<button role="tab" data-tab="ask">Ask the guide</button>` and the panel `<div id="panel-ask" class="panel-body" hidden></div>`.
3. In `js/main.js`, create the panel with `createAskPanel($('#panel-ask'), { story, getContext })` and restore tab switching between `#panel-event` and `#panel-ask`.
4. In `js/ui/eventPanel.js`, add back the question chips that call `onAsk`.
5. For a public site, move the API call behind a small server (for example a Cloudflare Worker) that holds the key and limits usage, instead of calling Anthropic from the browser.
