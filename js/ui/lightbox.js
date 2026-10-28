// Full-screen image viewer for city galleries: arrows or keys to move
// through images, Esc or a click outside to close. Always shows the credit.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let el = null;
let images = [];
let index = 0;

function ensure() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'lightbox';
  el.hidden = true;
  el.innerHTML = `
    <button class="lb-close" aria-label="Close">&times;</button>
    <button class="lb-prev" aria-label="Previous image">&#8249;</button>
    <figure><img alt=""><figcaption></figcaption></figure>
    <button class="lb-next" aria-label="Next image">&#8250;</button>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  el.querySelector('.lb-close').addEventListener('click', close);
  el.querySelector('.lb-prev').addEventListener('click', () => show(index - 1));
  el.querySelector('.lb-next').addEventListener('click', () => show(index + 1));
  document.addEventListener('keydown', (e) => {
    if (el.hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowLeft') { e.stopPropagation(); show(index - 1); }
    if (e.key === 'ArrowRight') { e.stopPropagation(); show(index + 1); }
  }, true);
}

function show(i) {
  index = (i + images.length) % images.length;
  const img = images[index];
  el.querySelector('img').src = img.large;
  el.querySelector('img').alt = img.caption ?? '';
  el.querySelector('figcaption').innerHTML = `
    <strong>${esc(img.caption ?? '')}</strong>
    <span>${index + 1} / ${images.length} · ${esc(img.artist)}${img.license ? `, ${esc(img.license)}` : ''} ·
    <a href="${esc(img.page)}" target="_blank" rel="noopener">Wikimedia Commons</a></span>`;
  el.querySelector('.lb-prev').hidden = images.length < 2;
  el.querySelector('.lb-next').hidden = images.length < 2;
}

function close() { el.hidden = true; }

export function openLightbox(list, start = 0) {
  ensure();
  images = list;
  el.hidden = false;
  show(start);
}
