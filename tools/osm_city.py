"""Build a city plan's streets and house blocks from today's OpenStreetMap.

For cities whose street plan has hardly changed since the period shown
(the French colonial centres of Saigon, Hue and Hanoi), today's streets are
the best plan we have. This keeps only the streets inside the districts that
were built up then, renames them to their period names where they have
changed, and cuts each district into its real blocks for the 3D house
generator (as tools/ohm_city.py does from OpenHistoricalMap).

The recipe lives in the city file's "osmCity" member:

    "osmCity": {
      "bbox": [south, west, north, east],
      "districts": [                      built-up areas, each its own house fabric
        { "id": "old-quarter", "name": "Old Quarter", "extent": [[lng, lat], ...],
          "fabric": { "style": "vietnamese", "mix": { "tube-old": 0.8, ... } },
          "holes": [[[lng, lat], ...]],     optional: areas cut out of it
          "from": "1900", "to": null } ],
      "roads": [[[lng, lat], ...]],       optional: more areas whose streets are kept
      "classes": ["primary", ...],        optional: highway values (default below)
      "rename": { "Đồng Khởi": "Tự Do" }, optional: today's name -> period name
      "labels": "all" | "renamed",        label every named street, or only renamed ones
      "skip": ["Võ Văn Kiệt"],            optional: streets built later, by name
      "unlabelled": ["Khâm Thiên"]        optional: streets labelled by a feature of their own
    }

Water comes out of the blocks: run tools/osm_water.py first. Streets and
blocks are written with "src": "osm-city" and replaced on each run.

    python tools/osm_city.py data/cities/hanoi.geojson [--cache DIR]
Needs: pip install shapely. OSM data is (c) OpenStreetMap contributors, ODbL.
"""

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

from shapely.geometry import LineString, MultiPolygon, Polygon, mapping, shape
from shapely.ops import split, unary_union

from osm_footprints import SERVERS

WIDTH = {"motorway": 24, "trunk": 24, "primary": 18, "secondary": 14, "tertiary": 10, "residential": 7,
         "unclassified": 7, "living_street": 5, "pedestrian": 6}


def overpass(query, cache=None, key=None):
    if cache and key and os.path.exists(os.path.join(cache, key)):
        with open(os.path.join(cache, key), encoding="utf-8") as fh:
            return json.load(fh)
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(3):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "history-atlas/0.1"})
                with urllib.request.urlopen(req, timeout=200) as res:
                    text = res.read().decode("utf-8")
                if text.lstrip().startswith("{"):
                    els = json.loads(text)["elements"]
                    if cache and key:
                        with open(os.path.join(cache, key), "w", encoding="utf-8") as fh:
                            json.dump(els, fh)
                    return els
            except Exception as err:  # busy server: try the next one
                print(f"  {url}: {err}", file=sys.stderr)
            time.sleep(3)
        time.sleep(20)
    sys.exit("All Overpass servers failed")


def streets_in(bbox, classes, cache, cid):
    """Highway ways in the box, fetched in tiles (big boxes time out)."""
    s, w, n, e = bbox
    steps = max(1, math.ceil(max(n - s, (e - w)) / 0.035))
    seen = {}
    for i in range(steps):
        for j in range(steps):
            a, b = s + (n - s) * i / steps, s + (n - s) * (i + 1) / steps
            c, d = w + (e - w) * j / steps, w + (e - w) * (j + 1) / steps
            q = f'[out:json][timeout:120];way[highway~"^({"|".join(classes)})$"]({a},{c},{b},{d});out geom;'
            for el in overpass(q, cache, f"{cid}-streets{i}{j}.json"):
                seen[el["id"]] = el
    return list(seen.values())


def main(path, cache=None):
    with open(path, encoding="utf-8") as fh:
        fc = json.load(fh)
    city = fc["city"]
    recipe = city["osmCity"]
    s, w, n, e = recipe["bbox"]
    my = 111_320
    mx = my * math.cos(math.radians((s + n) / 2))
    deg = lambda m: m / my
    classes = recipe.get("classes", list(WIDTH))
    rename = recipe.get("rename", {})
    skip = set(recipe.get("skip", []))

    districts = [(d, Polygon(d["extent"], d.get("holes", [])).buffer(0)) for d in recipe["districts"]]
    keep = unary_union([g for _, g in districts] + [Polygon(r).buffer(0) for r in recipe.get("roads", [])])
    water = [shape(f["geometry"]).buffer(0) for f in fc["features"] if f["properties"].get("id") == "osm-water"]
    water = unary_union(water) if water else None

    print("Fetching streets from OpenStreetMap...")
    ways = streets_in(recipe["bbox"], classes, cache, city["id"])
    streets = []
    for el in ways:
        t = el.get("tags", {})
        name = t.get("name")
        if name in skip or t.get("highway") not in WIDTH or t.get("tunnel"):
            continue
        pts = [(p["lon"], p["lat"]) for p in el.get("geometry", []) if p]
        if len(pts) < 2:
            continue
        g = LineString(pts).intersection(keep)
        if g.is_empty:
            continue
        streets.append((g, t))
    print(f"  {len(ways)} ways, {len(streets)} kept")

    out = [f for f in fc["features"] if f["properties"].get("src") != "osm-city"]
    # Seas and lakes stay first so they draw under the streets.
    head = [f for f in out if f["properties"].get("id") == "osm-water"]
    rest = [f for f in out if f["properties"].get("id") != "osm-water"]
    gen = []

    def add(kind, g, **props):
        gen.append({"type": "Feature", "properties": {"kind": kind, "src": "osm-city", **props}, "geometry": round_geom(mapping(g))})

    # Merge each named street into one feature so it is labelled once.
    by_name = {}
    for g, t in streets:
        by_name.setdefault((t.get("name"), t["highway"]), []).append(g)
    i = 0
    for (name, hw), parts in sorted(by_name.items(), key=lambda kv: (-WIDTH[kv[0][1]], kv[0][0] or "")):
        label = rename.get(name, name)
        show = bool(name) and (recipe.get("labels", "all") == "all" or name in rename) and name not in recipe.get("unlabelled", [])
        merged = unary_union(parts).simplify(deg(1))
        add("road", merged, id=f"osm-street-{i}", name=label if show else None, widthM=WIDTH[hw], showLabel=show, labelZoom=16 if WIDTH[hw] >= 14 else 17)
        i += 1

    cuts = unary_union([g.buffer(deg(WIDTH[t["highway"]] / 2), cap_style=2) for g, t in streets])
    for d, extent in districts:
        blocks = extent.difference(cuts)
        if water is not None:
            blocks = blocks.difference(water)
        # Shave off slivers and spikes: the 3D block splitter needs clean outlines.
        blocks = blocks.buffer(-deg(0.6), join_style=2).buffer(deg(0.6), join_style=2).simplify(deg(1))
        polys = [q for b in getattr(blocks, "geoms", [blocks]) if b.geom_type == "Polygon" for q in no_holes(b)]
        polys = [b for b in polys if b.area * mx * my > 120]
        props = {"id": f"osm-{d['id']}", "name": d.get("name"), "showLabel": False,
                 "fabric": {"layout": "blocks", **d.get("fabric", {"style": city.get("style3d", "vietnamese")})}}
        for k in ("from", "to", "description", "wiki"):
            if d.get(k):
                props[k] = d[k]
        if polys:
            add(d.get("kind", "houses"), MultiPolygon(polys), **props)
        print(f"  {d['id']}: {len(polys)} blocks")

    fc["features"] = head + gen + rest
    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    text = text.replace('{"type":"Feature"', '\n{"type":"Feature"')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")


def no_holes(poly):
    """Cut a polygon through each hole until none is left: the 3D house
    generator reads only outer rings, so a lake inside a block would fill with houses."""
    if not poly.interiors:
        return [poly]
    x = poly.interiors[0].centroid.x
    s, n = poly.bounds[1] - 1, poly.bounds[3] + 1
    pieces = split(poly, LineString([(x, s), (x, n)]))
    # Pull the halves a little apart so they stay separate pieces.
    pieces = [g.buffer(-0.000002, join_style=2) for g in pieces.geoms if g.geom_type == "Polygon"]
    return [q for g in pieces if g.geom_type == "Polygon" for q in no_holes(g)]


def round_geom(g):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


if __name__ == "__main__":
    args = sys.argv[1:]
    cache = None
    if "--cache" in args:
        cache = args[args.index("--cache") + 1]
        os.makedirs(cache, exist_ok=True)
        args = [a for a in args if a not in ("--cache", cache)]
    main(args[0], cache)
