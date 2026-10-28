// The start menu: pick a story to follow, or a city to explore.
// Choosing either reloads the page with the right story (and city) in the URL.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createMenu(el, { catalog, currentStory }) {
  const body = el.querySelector('.menu-body');
  const tabs = el.querySelectorAll('.menu-tabs button');

  function show(tab) {
    tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    body.innerHTML = tab === 'cities' ? cities() : stories();
    body.scrollTop = 0;
  }

  const stories = () => `
    <div class="menu-grid">${catalog.stories.map((s) => {
      const ready = s.status === 'ready';
      return `
      <a class="menu-item${s.id === currentStory ? ' current' : ''}${ready ? '' : ' soon'}" ${ready ? `href="?story=${encodeURIComponent(s.id)}"` : ''}>
        <span class="eyebrow">${esc(s.subtitle)}</span>
        <strong>${esc(s.title)}</strong>
        <p>${esc(s.blurb ?? '')}</p>
        <span class="menu-go">${s.id === currentStory ? 'Reading now' : ready ? 'Open the story &rarr;' : 'Coming soon'}</span>
      </a>`;
    }).join('')}</div>`;

  const cities = () => `
    <div class="menu-grid">${(catalog.cities ?? []).map((c) => {
      const story = catalog.stories.find((s) => s.id === c.story);
      const href = (view) => `?story=${encodeURIComponent(c.story)}&city=${encodeURIComponent(c.id)}&t=${encodeURIComponent(c.at ?? '')}${view ? `&view=${view}` : ''}`;
      return `
      <div class="menu-item city">
        <span class="eyebrow">${esc(c.when ?? '')}</span>
        <strong>${esc(c.name)}</strong>
        <p>${esc(c.blurb)}</p>
        <span class="menu-from">From the story <em>${esc(story?.title ?? c.story)}</em></span>
        <div class="menu-actions">
          ${c.threeD ? `<a class="btn primary" href="${href('3d')}">Explore in 3D</a>` : ''}
          <a class="btn ${c.threeD ? 'ghost' : 'primary'}" href="${href()}">City plan</a>
        </div>
      </div>`;
    }).join('')}</div>`;

  function open(tab = 'stories') {
    show(tab);
    el.hidden = false;
    el.querySelector('.menu-card').focus();
  }
  const close = () => { el.hidden = true; };

  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  el.querySelector('[data-act="close"]').addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  return { open, close, get isOpen() { return !el.hidden; } };
}
