// Clips territory shapes to the coastline, so authors can draw generous
// outlines that spill into the sea and still get crisp coasts.
// Uses Natural Earth 1:50m land (via the world-atlas package) and
// polygon-clipping, both loaded from a CDN only when a story asks for it.

const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json';
const TOPOJSON_URL = 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
const CLIPPING_URL = 'https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/+esm';

const asMulti = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates);

function ringBox(polygon) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of polygon[0]) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

// bbox: [west, south, east, north] covering every shape to clip.
export async function clipToLand(features, bbox) {
  const targets = features.filter((f) => f.properties.clip === 'land');
  if (!targets.length) return;

  const [topojson, clipping, topo] = await Promise.all([
    import(TOPOJSON_URL),
    import(CLIPPING_URL).then((m) => m.default ?? m),
    fetch(LAND_URL).then((r) => r.json()),
  ]);

  // Cut the world down to the story's box first: far cheaper than clipping everything.
  const [w, s, e, n] = bbox;
  const nearby = topojson.feature(topo, topo.objects.land).features
    .flatMap((f) => asMulti(f.geometry))
    .filter((poly) => {
      const [pw, ps, pe, pn] = ringBox(poly);
      return pe >= w && pw <= e && pn >= s && ps <= n;
    });
  const box = [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
  const land = clipping.intersection(nearby, box);

  for (const f of targets) {
    const clipped = clipping.intersection(asMulti(f.geometry), land);
    if (clipped.length) f.geometry = { type: 'MultiPolygon', coordinates: clipped };
  }
}
