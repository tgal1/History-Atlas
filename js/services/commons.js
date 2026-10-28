// Images from Wikimedia Commons by exact file name: photos of museum models,
// reconstruction drawings and historic maps. Returns a thumbnail, a larger
// image for the viewer, and the author and licence for attribution.

const API = 'https://commons.wikimedia.org/w/api.php';
const cache = new Map();

const stripHtml = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// items: [{ file: "Model of Rome - Gismondi.jpg", caption: "..." }]
export async function getCommonsImages(items) {
  const missing = items.map((i) => i.file).filter((f) => !cache.has(f));
  for (let i = 0; i < missing.length; i += 40) {
    const batch = missing.slice(i, i + 40);
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', prop: 'imageinfo',
      iiprop: 'url|extmetadata|size', iiurlwidth: '1400',
      titles: batch.map((f) => `File:${f}`).join('|'),
    });
    try {
      const data = await fetch(`${API}?${params}`).then((r) => r.json());
      const normal = new Map((data.query?.normalized ?? []).map((n) => [n.to, n.from]));
      for (const page of Object.values(data.query?.pages ?? {})) {
        const info = page.imageinfo?.[0];
        const asked = (normal.get(page.title) ?? page.title).replace(/^File:/, '');
        if (!info) { cache.set(asked, null); continue; }
        const meta = info.extmetadata ?? {};
        cache.set(asked, {
          large: info.thumburl ?? info.url,
          thumb: (info.thumburl ?? info.url).replace(/\/\d+px-/, '/360px-'),
          page: info.descriptionurl,
          artist: stripHtml(meta.Artist?.value) || 'Unknown',
          license: stripHtml(meta.LicenseShortName?.value) || '',
        });
      }
    } catch {
      batch.forEach((f) => cache.set(f, null));
    }
  }
  return items.map((i) => (cache.get(i.file) ? { ...i, ...cache.get(i.file) } : null)).filter(Boolean);
}
