"""Draw a city's period shoreline where OpenHistoricalMap has none.

Outside the town the modern coast from OpenStreetMap is close enough. Inside
it, where land has since been made by filling marsh and river, the shore is
traced by hand from period plans. This writes the result into the city file
as one "sea" feature ("src": "shore"), trims the generated town blocks
("ohm-town") to the land, and drops OpenHistoricalMap buildings that sit under
a hand-placed landmark, so they are not drawn twice.

The recipe lives in the city file's "shore" member:
    "shore": { "bbox": [south, west, north, east],   area the water covers
               "zone": [[lng, lat], ...],   rough box round the town's modern land,
                                            whose coast (plus a margin) is replaced
               "land": [[lng, lat], ...],   the period land inside the zone
               "water": [[[lng, lat], ...]] optional: creeks since filled }

Run it last, after tools/osm_footprints.py and tools/ohm_city.py (which
rebuilds the town blocks):
    python tools/shoreline.py data/cities/charleston.geojson
Needs: pip install shapely. Coast data (c) OpenStreetMap contributors, ODbL.
"""

import json
import math
import sys
import time
import urllib.parse
import urllib.request

from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from ohm_city import geom_of, round_geom

SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
LANDMARKS = {"church", "house", "building", "hall", "fort", "palace", "market"}


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(3):
        for url in SERVERS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": "history-atlas/0.1"})
                with urllib.request.urlopen(req, timeout=180) as res:
                    text = res.read().decode("utf-8")
                if text.lstrip().startswith("{"):
                    return json.loads(text)["elements"]
            except Exception as err:  # busy server: try the next one
                print(f"  {url}: {err}", file=sys.stderr)
            time.sleep(5 + attempt * 10)
    sys.exit("All Overpass servers failed")


def modern_land(area, s, w, n, e):
    """Land inside the box: the coastline splits it into faces, and OSM draws
    coastlines with the land on the left, so each face is voted land or water."""
    els = overpass(f"[out:json][timeout:150];(way({s},{w},{n},{e})[natural=coastline];"
                   f"nwr({s},{w},{n},{e})[natural=water][water~\"^(river|bay|lagoon|tidal|estuary)$\"];"
                   f"nwr({s},{w},{n},{e})[waterway=riverbank];);out geom;")
    coast = [geom_of(el) for el in els if el.get("tags", {}).get("natural") == "coastline"]
    coast = [g for g in coast if g is not None and g.geom_type == "LineString"]
    rivers = [g for el in els if el.get("tags", {}).get("natural") != "coastline"
              for g in [geom_of(el)] if g is not None and g.geom_type != "LineString"]
    faces = list(polygonize(unary_union([g.intersection(area) for g in coast] + [area.boundary])))
    tree = STRtree(faces)
    votes = [0] * len(faces)
    eps = 2e-5
    for line in coast:
        pts = list(line.coords)
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            d = math.hypot(x1 - x0, y1 - y0)
            if d == 0:
                continue
            mx, my, nx, ny = (x0 + x1) / 2, (y0 + y1) / 2, -(y1 - y0) / d, (x1 - x0) / d
            for sign in (1, -1):  # left of the line is land
                q = Point(mx + nx * eps * sign, my + ny * eps * sign)
                for i in tree.query(q, predicate="intersects"):
                    votes[i] += sign
    land = unary_union([f for f, v in zip(faces, votes) if v >= 0])
    if rivers:
        land = land.difference(unary_union(rivers))
    print(f"  coast {len(coast)} ways, {len(faces)} faces, rivers {len(rivers)}")
    return land


def main(path):
    fc = json.load(open(path, encoding="utf-8"))
    recipe = fc["city"]["shore"]
    s, w, n, e = recipe["bbox"]
    area = box(w, s, e, n)
    deg = lambda m: m / 111_320

    print("Fetching the modern coast from OpenStreetMap...")
    land = modern_land(area, s, w, n, e)
    # The zone is the modern land in the box, with a margin out into the water
    # so that every bit of later fill along its shore is covered.
    zone = land.intersection(Polygon(recipe["zone"])).buffer(deg(recipe.get("marginM", 150)))
    land = land.difference(zone).union(Polygon(recipe["land"]).intersection(zone))
    creeks = unary_union([Polygon(r) for r in recipe.get("water", [])])
    if not creeks.is_empty:
        land = land.difference(creeks)
    sea = area.difference(land).simplify(deg(2))

    out = [f for f in fc["features"] if f["properties"].get("src") != "shore"]
    keep = []
    hand = [f for f in out if f["properties"].get("src") is None and f["properties"].get("kind") in LANDMARKS]
    marks = []
    for f in hand:
        g = shape(f["geometry"])
        size = (f["properties"].get("model") or {}).get("size")
        marks.append(g.buffer(deg(max(size) / 2 if size else 12)) if g.geom_type == "Point" else g.buffer(deg(2)))
    marks = unary_union(marks) if marks else None
    dropped = 0
    for f in out:
        p = f["properties"]
        if p.get("id") == "ohm-town":
            town = shape(f["geometry"]).intersection(land)
            f["geometry"] = round_geom(mapping(town.simplify(deg(1))))
        elif marks is not None and str(p.get("id", "")).startswith("ohm-building") and shape(f["geometry"]).centroid.within(marks):
            dropped += 1
            continue
        keep.append(f)
    keep.insert(0, {"type": "Feature", "properties": {"kind": "sea", "src": "shore", "id": "shore-water", "showLabel": False},
                     "geometry": round_geom(mapping(sea))})
    fc["features"] = keep
    fc["city"]["osmCredit"] = "Monument outlines and the coast beyond the old town (c) OpenStreetMap contributors, ODbL"
    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    text = text.replace('{"type":"Feature"', '\n{"type":"Feature"')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    print(f"  sea written, town trimmed to the shore, {dropped} duplicate buildings dropped")


if __name__ == "__main__":
    main(sys.argv[1])
