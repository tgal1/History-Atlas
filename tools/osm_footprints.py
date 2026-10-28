"""Refresh city-plan footprints from OpenStreetMap.

Any feature in a city file with an "osm" property ("way/123", "relation/456",
or a list of them) gets its geometry replaced by the real outline from
OpenStreetMap. Walls and aqueducts (LineString kinds) become MultiLineStrings;
everything else becomes a Polygon or MultiPolygon.

    python tools/osm_footprints.py data/cities/rome.geojson

OSM data is (c) OpenStreetMap contributors, available under the ODbL.
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request

SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
LINE_KINDS = {"wall", "aqueduct", "road", "river", "canal", "bridge", "causeway", "dike"}


def fetch(refs):
    ways = [r.split("/")[1] for r in refs if r.startswith("way/")]
    rels = [r.split("/")[1] for r in refs if r.startswith("relation/")]
    parts = []
    if ways:
        parts.append(f"way(id:{','.join(ways)});")
    if rels:
        parts.append(f"relation(id:{','.join(rels)});")
    query = f"[out:json][timeout:90];({''.join(parts)});out geom;"
    body = urllib.parse.urlencode({"data": query}).encode()
    for url in SERVERS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "history-atlas/0.1"})
            with urllib.request.urlopen(req, timeout=120) as res:
                text = res.read().decode("utf-8")
            if text.lstrip().startswith("{"):
                return {f"{e['type']}/{e['id']}": e for e in json.loads(text)["elements"]}
        except Exception as err:  # busy server: try the next one
            print(f"  {url}: {err}", file=sys.stderr)
        time.sleep(2)
    sys.exit("All Overpass servers failed")


def pts(geometry):
    return [[round(p["lon"], 6), round(p["lat"], 6)] for p in geometry]


def join_rings(lines):
    """Chain way segments end to end into closed rings."""
    lines = [l[:] for l in lines if len(l) > 1]
    rings = []
    while lines:
        ring = lines.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, l in enumerate(lines):
                if l[0] == ring[-1]:
                    ring += l[1:]
                elif l[-1] == ring[-1]:
                    ring += l[::-1][1:]
                elif l[-1] == ring[0]:
                    ring = l + ring[1:]
                elif l[0] == ring[0]:
                    ring = l[::-1] + ring[1:]
                else:
                    continue
                lines.pop(i)
                changed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def inside(pt, ring):
    x, y = pt
    hit = False
    for (xi, yi), (xj, yj) in zip(ring, ring[-1:] + ring[:-1]):
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
    return hit


def polygons(element):
    if element["type"] == "way":
        ring = pts(element["geometry"])
        return [[ring]] if ring[0] == ring[-1] else []
    members = [m for m in element["members"] if m["type"] == "way" and "geometry" in m]
    outers = join_rings([pts(m["geometry"]) for m in members if m.get("role") != "inner"])
    inners = join_rings([pts(m["geometry"]) for m in members if m.get("role") == "inner"])
    polys = [[o] for o in outers]
    for hole in inners:
        for poly in polys:
            if inside(hole[0], poly[0]):
                poly.append(hole)
                break
    return polys


def lines(element):
    if element["type"] == "way":
        return [pts(element["geometry"])]
    return [pts(m["geometry"]) for m in element["members"] if m["type"] == "way" and "geometry" in m]


def main(path):
    with open(path, encoding="utf-8") as f:
        fc = json.load(f)
    wanted = [f for f in fc["features"] if f["properties"].get("osm")]
    refs = sorted({r for f in wanted for r in ([f["properties"]["osm"]] if isinstance(f["properties"]["osm"], str) else f["properties"]["osm"])})
    print(f"Fetching {len(refs)} OSM objects for {len(wanted)} features")
    elements = fetch(refs)

    for feature in wanted:
        p = feature["properties"]
        ids = [p["osm"]] if isinstance(p["osm"], str) else p["osm"]
        missing = [r for r in ids if r not in elements]
        if missing:
            print(f"  {p['id']}: missing {missing}", file=sys.stderr)
            continue
        if p["kind"] in LINE_KINDS:
            segs = [l for r in ids for l in lines(elements[r])]
            feature["geometry"] = {"type": "MultiLineString", "coordinates": segs}
        else:
            polys = [poly for r in ids for poly in polygons(elements[r])]
            if not polys:
                print(f"  {p['id']}: no closed outline", file=sys.stderr)
                continue
            feature["geometry"] = (
                {"type": "Polygon", "coordinates": polys[0]} if len(polys) == 1
                else {"type": "MultiPolygon", "coordinates": polys}
            )
        print(f"  {p['id']}: {feature['geometry']['type']}")

    fc.setdefault("city", {})["osmCredit"] = "Monument outlines (c) OpenStreetMap contributors, ODbL"
    text = json.dumps(fc, ensure_ascii=False, indent=1)
    # Keep each [lng, lat] pair on one line so long outlines stay readable.
    text = re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1, \2]", text)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text + "\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/cities/rome.geojson")
