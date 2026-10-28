// Map key: event categories, plus whichever territories are active now.

export function createLegend(el, story) {
  const cats = Object.values(story.categories)
    .map((c) => `<li><i class="dot" style="--c:${c.color}"></i>${c.label}</li>`).join('');
  el.innerHTML = `
    <button class="legend-toggle" aria-expanded="true">Key</button>
    <div class="legend-body">
      <ul>${cats}</ul>
      <ul class="legend-territory"></ul>
      <p class="fine">Bigger dots, more deaths. Dots fade as time moves on.</p>
    </div>`;
  const toggle = el.querySelector('.legend-toggle');
  toggle.addEventListener('click', () => {
    const open = el.classList.toggle('collapsed') === false;
    toggle.setAttribute('aria-expanded', String(open));
  });
  const territory = el.querySelector('.legend-territory');
  let lastKey = '';

  return {
    setFactions(ids) {
      const key = ids.join(',');
      if (key === lastKey) return;
      lastKey = key;
      territory.innerHTML = ids.map((id) => {
        const f = story.factions?.[id];
        return f ? `<li><i class="area" style="--c:${f.color}"></i>${f.label}</li>` : '';
      }).join('');
    },
  };
}
