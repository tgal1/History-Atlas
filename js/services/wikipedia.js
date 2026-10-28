// Fetches a lead image and short extract for an event from Wikipedia's
// public REST API (CORS-enabled, no key). If the exact title misses, it
// falls back to a search. Results are cached for the session.

const cache = new Map();

async function summary(title) {
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.type === 'disambiguation' ? null : data;
}

async function search(query) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=1&srsearch=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const hit = (await res.json()).query?.search?.[0];
  return hit ? summary(hit.title) : null;
}

export function getWikiCard(title) {
  if (!title) return Promise.resolve(null);
  if (!cache.has(title)) {
    cache.set(title, (async () => {
      try {
        const data = (await summary(title)) ?? (await search(title));
        if (!data) return null;
        return {
          title: data.title,
          extract: data.extract,
          image: data.thumbnail?.source ?? null,
          url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
        };
      } catch {
        return null;
      }
    })());
  }
  return cache.get(title);
}
