"""Take a city plan's water from today's OpenStreetMap, where no historic map exists.

For towns OpenHistoricalMap has not covered (Yorktown), the river and its
creeks as mapped today are the best outline of the shore. The recipe lives
in the city file's "osmWater" member:

    "osmWater": { "bbox": [south, west, north, east],
                  "relations": [8688981],      water areas (multipolygons) to use
                  "ways": [123],               optional: closed water ways
                  "add": [[[lng, lat], ...]],  optional: hand-drawn water to join on
                  "minArea": 2000 }            drop pieces smaller than this (m2)

It writes one "sea" feature (id "osm-water", "src": "osm"), replacing the old
one, clipped to the box and lightly simplified.

    python tools/osm_water.py data/cities/yorktown.geojson
Needs: pip install shapely. OSM data is (c) OpenStreetMap contributors, ODbL.
"""

import json
import math
import re
import sys

from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping
from shapely.ops import polygonize, unary_union

from osm_footprints import fetch


def area_of(e):
    """Shapely area of a relation (outer minus inner members) or a closed way."""
    if e["type"] == "way":
        pts = [(p["lon"], p["lat"]) for p in e["geometry"]]
        return Polygon(pts) if len(pts) >= 4 else None
    rings = {"outer": [], "inner": []}
    for m in e.get("members", []):
        if m.get("type") == "way" and "geometry" in m:
            pts = [(p["lon"], p["lat"]) for p in m["geometry"] if p]
            if len(pts) >= 2:
                rings["inner" if m.get("role") == "inner" else "outer"].append(LineString(pts))
    outer = unary_union(list(polygonize(unary_union(rings["outer"]))))
    inner = unary_union(list(polygonize(unary_union(rings["inner"])))) if rings["inner"] else None
    return outer.difference(inner) if inner is not None else outer


def main(path):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    recipe = data["city"]["osmWater"]
    s, w, n, e = recipe["bbox"]
    refs = [f"relation/{r}" for r in recipe.get("relations", [])] + [f"way/{r}" for r in recipe.get("ways", [])]
    elements = fetch(refs)
    parts = [area_of(elements[r]) for r in refs if r in elements]
    parts += [Polygon(ring) for ring in recipe.get("add", [])]
    water = unary_union([p.buffer(0) for p in parts if p is not None]).intersection(box(w, s, e, n))
    water = water.simplify(0.00002, preserve_topology=True)

    # Drop slivers and ponds below the size limit (degrees to m2 at this latitude).
    m2 = 111320 ** 2 * math.cos(math.radians((s + n) / 2))
    polys = list(water.geoms) if hasattr(water, "geoms") else [water]
    polys = [p for p in polys if isinstance(p, Polygon) and p.area * m2 >= recipe.get("minArea", 2000)]
    geom = mapping(MultiPolygon(polys))
    geom = json.loads(json.dumps(geom), parse_float=lambda v: round(float(v), 6))

    feature = {"type": "Feature", "properties": {"kind": "sea", "src": "osm", "id": "osm-water", "showLabel": False},
               "geometry": geom}
    data["features"] = [feature] + [f for f in data["features"] if f["properties"].get("id") != "osm-water"]
    text = json.dumps(data, ensure_ascii=False, indent=1)
    text = re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1, \2]", text)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    print(f"water: {len(polys)} pieces, {sum(len(p.exterior.coords) for p in polys)} points")


if __name__ == "__main__":
    main(sys.argv[1])
