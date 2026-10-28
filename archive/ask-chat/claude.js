// Ask-a-guide backend: calls Claude straight from the browser with the
// viewer's own API key (kept in localStorage on this machine only).
// Fine for personal local use. Before hosting publicly, move this call
// behind a small server so the key never reaches the browser.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
const MODEL = 'claude-opus-5-5';
const KEY_STORAGE = 'history-atlas.anthropic-key';

let sdkPromise = null;
const loadSdk = () => (sdkPromise ??= import(SDK_URL).then((m) => m.default ?? m.Anthropic));

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) ?? ''; } catch { return ''; }
}

export function setApiKey(key) {
  try {
    key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE);
  } catch { /* storage blocked: key lasts for this page only */ }
}

// messages: [{role, content}] history. onText receives streamed deltas.
export async function askGuide({ system, messages, onText, signal }) {
  const key = getApiKey();
  if (!key) throw new Error('Add your Anthropic API key first.');
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });

  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort: 'low' },
      // If a safety classifier declines, retry on a suitable fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );
  stream.on('text', onText);
  let message;
  try {
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('That API key was rejected. Check it in Settings.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Rate limited. Wait a moment and try again.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach Anthropic. Check your connection.');
    if (err instanceof Anthropic.APIError) throw new Error(`The guide hit an error (${err.status ?? 'unknown'}). Try again.`);
    throw err;
  }
  if (message.stop_reason === 'refusal') {
    throw new Error('The guide declined to answer that one. Try rephrasing.');
  }
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}
