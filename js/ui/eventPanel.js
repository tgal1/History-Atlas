// Side-panel content: the story intro, or the card for one event
// (date, image, summary, why it matters, scene and city buttons),
// plus the city guide and place cards.

import { formatDate, formatEventDate } from '../core/time.js';
import { getWikiCard } from '../services/wikipedia.js';
import { getCommonsImages } from '../services/commons.js';
import { kindInfo } from '../map/cityLayer.js';
import { openLightbox } from './lightbox.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createEventPanel(el, { story, cities = [], onPrev, onNext, onPlayScene, onStartTour, onExploreCity }) {
  let renderToken = 0;
  const cityById = new Map(cities.map((c) => [c.id, c]));

  // Fill a <figure class="ev-figure"> with a Wikipedia lead image, if there is one.
  function attachWiki(title, token) {
    getWikiCard(title).then((card) => {
      if (token !== renderToken) return;
      const fig = el.querySelector('.ev-figure');
      if (!fig) return;
      if (!card?.image) { fig.remove(); return; }
      fig.classList.remove('loading');
      fig.innerHTML = `<img src="${esc(card.image)}" alt="${esc(card.title)}" loading="lazy">
        <figcaption>Image via <a href="${esc(card.url)}" target="_blank" rel="noopener">Wikipedia: ${esc(card.title)}</a></figcaption>`;
      fig.querySelector('img').addEventListener('error', () => fig.remove());
    });
  }

  // Fill a <figure class="ev-figure"> with a gallery of reconstruction images
  // from Wikimedia Commons: one large, thumbnails below, click for full screen.
  function attachGallery(items, token, fallbackWiki) {
    getCommonsImages(items).then((images) => {
      if (token !== renderToken) return;
      const fig = el.querySelector('.ev-figure');
      if (!fig) return;
      if (!images.length) { if (fallbackWiki) attachWiki(fallbackWiki, token); else fig.remove(); return; }
      fig.classList.remove('loading');
      fig.classList.add('gallery');
      const main = (i) => `
        <button class="g-main" data-i="${i}" aria-label="View larger">
          <img src="${esc(images[i].large)}" alt="${esc(images[i].caption)}">
        </button>
        <figcaption>${esc(images[i].caption)} <span>· ${esc(images[i].artist)}${images[i].license ? `, ${esc(images[i].license)}` : ''}</span></figcaption>`;
      fig.innerHTML = `<div class="g-stage">${main(0)}</div>
        ${images.length > 1 ? `<div class="g-thumbs">${images.map((img, i) => `
          <button class="g-thumb${i === 0 ? ' active' : ''}" data-i="${i}" aria-label="${esc(img.caption)}"><img src="${esc(img.thumb)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        <p class="g-hint">Reconstructions and models · click to enlarge</p>`;
      const stage = fig.querySelector('.g-stage');
      const wire = () => stage.querySelector('.g-main').addEventListener('click', (e) => openLightbox(images, Number(e.currentTarget.dataset.i)));
      wire();
      fig.querySelectorAll('.g-thumb').forEach((b) => b.addEventListener('click', () => {
        fig.querySelectorAll('.g-thumb').forEach((t) => t.classList.toggle('active', t === b));
        stage.innerHTML = main(Number(b.dataset.i));
        wire();
      }));
    });
  }

  // City guide: what the city was, and its landmarks as they stood at time t.
  function renderCity(city, landmarks, { t, onLandmark, onBack }) {
    const token = ++renderToken;
    const groups = new Map();
    for (const f of landmarks) {
      const label = kindInfo(f.properties.kind).label;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(f);
    }
    el.innerHTML = `
      <article class="ev-card city-guide">
        <p class="eyebrow">City plan · as it stood in ${formatDate(t, story.clockPrecision ?? 'month')}</p>
        <h2>${esc(city.name)}</h2>
        <figure class="ev-figure loading"><div class="ph"></div></figure>
        ${(Array.isArray(city.summary) ? city.summary : [city.summary]).map((p) => `<p>${esc(p)}</p>`).join('')}
        <p class="fine">Click any building, bridge or canal on the map, or pick a landmark below. Scrub the timeline to see the city change.</p>
        ${[...groups].map(([label, fs]) => `
          <h3>${esc(label)}</h3>
          <div class="landmarks">${fs.map((f) => `
            <button class="landmark" data-id="${esc(f.properties.id)}">
              <i style="--c:${f.properties.fill ?? kindInfo(f.properties.kind).fill ?? kindInfo(f.properties.kind).color}"></i>${esc(f.properties.name)}
            </button>`).join('')}
          </div>`).join('')}
        ${city.note ? `<p class="sources">${esc(city.note)}</p>` : ''}
        ${onBack ? '<nav class="ev-nav single"><button class="btn ghost" data-act="back">&larr; Back to the story</button></nav>' : ''}
      </article>`;
    el.scrollTop = 0;
    el.querySelectorAll('.landmark').forEach((b) => b.addEventListener('click', () => {
      onLandmark(landmarks.find((f) => f.properties.id === b.dataset.id));
    }));
    el.querySelector('[data-act="back"]')?.addEventListener('click', onBack);
    if (city.gallery?.length) attachGallery(city.gallery, token, city.wiki);
    else attachWiki(city.wiki, token);
  }

  // One building, bridge or canal.
  function renderPlace(feature, city, { onBack }) {
    const token = ++renderToken;
    const p = feature.properties;
    const kind = kindInfo(p.kind);
    el.innerHTML = `
      <article class="ev-card place">
        <div class="ev-meta">
          <span class="chip" style="--c:${p.fill ?? kind.fill ?? kind.color}">${esc(kind.label)}</span>
          <span class="fine">${esc(city.name)}</span>
        </div>
        <h2>${esc(p.name)}</h2>
        ${p.when ? `<p class="ev-place">${esc(p.when)}</p>` : ''}
        <figure class="ev-figure loading"><div class="ph"></div></figure>
        ${(Array.isArray(p.description) ? p.description : [p.description ?? '']).map((d) => `<p class="ev-summary">${esc(d)}</p>`).join('')}
        <nav class="ev-nav single"><button class="btn ghost" data-act="back">&larr; ${esc(city.name)} city guide</button></nav>
      </article>`;
    el.scrollTop = 0;
    el.querySelector('[data-act="back"]').addEventListener('click', onBack);
    if (p.images?.length) attachGallery(p.images, token, p.wiki);
    else if (p.wiki) attachWiki(p.wiki, token);
    else el.querySelector('.ev-figure')?.remove();
  }

  function renderIntro() {
    renderToken++;
    const intro = story.intro ?? {};
    el.innerHTML = `
      <article class="ev-card intro">
        <p class="eyebrow">${esc(story.subtitle)}</p>
        <h2>${esc(intro.title ?? story.title)}</h2>
        ${(intro.body ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}
        <button class="btn primary" data-act="tour">&#9654; Start the guided tour</button>
        <h3>How it works</h3>
        <ul class="tips">${(intro.tips ?? []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <h3>Chapters</h3>
        <ol class="era-list">${(story.eras ?? []).map((e) => `
          <li><strong>${esc(e.title)}</strong> <span>${formatDate(e.t0, 'year')}–${formatDate(e.t1, 'year')}</span><p>${esc(e.text)}</p></li>`).join('')}
        </ol>
        ${story.sources?.length ? `<p class="sources">Sources: ${story.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(' · ')}</p>` : ''}
      </article>`;
    el.querySelector('[data-act="tour"]').addEventListener('click', onStartTour);
    el.scrollTop = 0;
  }

  function renderEvent(ev, { prev, next, scene }) {
    const token = ++renderToken;
    const cat = story.categories[ev.category] ?? { label: ev.category, color: '#ccc' };
    const victor = ev.victor && story.factions?.[ev.victor];
    const stat = ev.stat
      ?? (ev.deaths ? `<strong>${ev.deaths.toLocaleString()}</strong> ${ev.deaths === 1 ? 'person' : 'people'} killed` : '');

    el.innerHTML = `
      <article class="ev-card">
        <div class="ev-meta">
          <span class="chip" style="--c:${cat.color}">${esc(cat.label)}</span>
          <time>${formatEventDate(ev)}</time>
        </div>
        <h2>${esc(ev.title)}</h2>
        <p class="ev-place">${esc(ev.place)}</p>
        <figure class="ev-figure loading"><div class="ph"></div></figure>
        ${victor || stat ? `<div class="ev-facts">
          ${victor ? `<span class="victor" style="--c:${victor.color}">Victory: ${esc(victor.short ?? victor.label)}</span>` : ''}
          ${stat ? `<span class="ev-stat${ev.deaths ? '' : ' neutral'}">${ev.stat ? esc(stat) : stat}</span>` : ''}
        </div>` : ''}
        <p class="ev-summary">${esc(ev.summary)}</p>
        ${ev.significance ? `<section class="ev-why"><h3>Why it matters</h3><p>${esc(ev.significance)}</p></section>` : ''}
        ${scene ? `<button class="btn primary" data-act="scene">&#9654; Watch it unfold <span>${esc(scene.title)}</span></button>` : ''}
        ${ev.city && cityById.has(ev.city) ? `<button class="btn see-also" data-act="city">Explore ${esc(cityById.get(ev.city).name)}: the city plan &rarr;</button>` : ''}
        ${ev.seeAlso ? `<a class="btn see-also" href="?story=${encodeURIComponent(ev.seeAlso.story)}#${encodeURIComponent(ev.seeAlso.event ?? '')}">${esc(ev.seeAlso.label)} &rarr;</a>` : ''}
        <details class="ev-wiki" hidden><summary>From Wikipedia</summary><p></p><a target="_blank" rel="noopener">Read the full article</a></details>
        <nav class="ev-nav">
          <button class="btn ghost" data-act="prev" ${prev ? '' : 'disabled'}>&larr; ${esc(prev?.title ?? 'Start')}</button>
          <button class="btn ghost" data-act="next" ${next ? '' : 'disabled'}>${esc(next?.title ?? 'End')} &rarr;</button>
        </nav>
      </article>`;
    el.scrollTop = 0;

    el.querySelector('[data-act="prev"]').addEventListener('click', onPrev);
    el.querySelector('[data-act="next"]').addEventListener('click', onNext);
    el.querySelector('[data-act="scene"]')?.addEventListener('click', onPlayScene);
    el.querySelector('[data-act="city"]')?.addEventListener('click', () => onExploreCity(ev.city));

    getWikiCard(ev.wiki).then((card) => {
      if (token !== renderToken) return;
      const fig = el.querySelector('.ev-figure');
      if (!card) { fig.remove(); return; }
      if (card.image) {
        fig.classList.remove('loading');
        fig.innerHTML = `<img src="${esc(card.image)}" alt="${esc(card.title)}" loading="lazy">
          <figcaption>Image via <a href="${esc(card.url)}" target="_blank" rel="noopener">Wikipedia: ${esc(card.title)}</a></figcaption>`;
        fig.querySelector('img').addEventListener('error', () => fig.remove());
      } else {
        fig.remove();
      }
      if (card.extract) {
        const wiki = el.querySelector('.ev-wiki');
        wiki.querySelector('p').textContent = card.extract;
        wiki.querySelector('a').href = card.url;
        wiki.hidden = false;
      }
    });
  }

  return { renderIntro, renderEvent, renderCity, renderPlace };
}
