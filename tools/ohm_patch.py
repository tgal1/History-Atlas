"""Second pass over a city plan built by tools/ohm_city.py.

Run it straight after ohm_city.py (which rewrites everything this touches),
and after osm_footprints.py so landmarks have their real outlines:

    python tools/ohm_city.py data/cities/new-york.geojson
    python tools/osm_footprints.py data/cities/new-york.geojson
    python tools/ohm_patch.py data/cities/new-york.geojson

It does four things, each only if the city's "ohm" recipe asks for it or
the data needs it:

    land     "land": [[[lng, lat], ...], ...]  rings of dry land. The sea becomes
             the bounding box minus this land, and the town blocks are trimmed to
             it. Use it where OpenHistoricalMap's water is missing or rough (New
             York: Ratzer's Manhattan shore plus a hand-drawn Brooklyn).
    fire     "fire": { "date": "1776-09-21", "area": [[lng, lat], ...],
                       "name", "description", "wiki" }
             Houses and generated blocks inside the area end on the date, and
             a "rubble" fabric of the same blocks begins then.
    repeats  OpenHistoricalMap buildings that stand where a hand-made landmark
             already is (a church, a fort) are dropped, so they are not drawn twice.
    shapes   L- and U-shaped buildings (rows of houses round a block) are cut into
             near-rectangles, so the 3D view gives each its own roof.

Needs: pip install shapely
"""

import json
import math
import sys

from shapely.geometry import Point, Polygon, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

LANDMARKS = {"church", "building", "house", "fort", "redoubt", "palace", "temple", "market", "hall", "wharf"}


def round_geom(g):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
    m = mapping(g)
    return {"type": m["type"], "coordinates": r(m["coordinates"])}


def footprint(f, mx, my):
    """A landmark's ground plan, also for points standing for rectangles or circles."""
    g = shape(f["geometry"])
    p = f["properties"]
    if g.geom_type != "Point":
        return g
    size = (p.get("model") or {}).get("size")
    if size:
        a = math.radians((p.get("model") or {}).get("angle", 0))
        u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
        pts = [(g.x + (su * size[0] / 2 * u[0] + sv * size[1] / 2 * v[0]) / mx,
                g.y + (su * size[0] / 2 * u[1] + sv * size[1] / 2 * v[1]) / my)
               for su, sv in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
        return Polygon(pts)
    radius = p.get("radiusM")
    return g.buffer(radius / my) if radius else None


def squareness(g):
    return g.area / g.minimum_rotated_rectangle.area if g.area else 1


def half_plane(p, d, big):
    """The half of the plane to the left of the line through p along d."""
    n = (-d[1], d[0])
    a = (p[0] - d[0] * big, p[1] - d[1] * big)
    b = (p[0] + d[0] * big, p[1] + d[1] * big)
    return Polygon([a, b, (b[0] + n[0] * big, b[1] + n[1] * big), (a[0] + n[0] * big, a[1] + n[1] * big)])


def pieces(g):
    return [q for q in getattr(g, "geoms", [g]) if q.geom_type == "Polygon" and not q.is_empty]


def cut_square(poly, mx, my, depth=0):
    """Split a concave footprint at its inner corners until each piece is near-rectangular."""
    if depth > 5 or squareness(poly) > 0.82:
        return [poly]
    # Work in metres so angles are true.
    m = Polygon([(x * mx, y * my) for x, y in poly.exterior.coords])
    m = orient(m)
    pts = list(m.exterior.coords)[:-1]
    best, best_score = None, squareness(m)
    for i, p in enumerate(pts):
        a, c = pts[i - 1], pts[(i + 1) % len(pts)]
        e1 = (p[0] - a[0], p[1] - a[1])
        e2 = (c[0] - p[0], c[1] - p[1])
        if e1[0] * e2[1] - e1[1] * e2[0] >= 0:  # convex corner
            continue
        for d in (e1, e2):
            length = math.hypot(*d)
            if not length:
                continue
            d = (d[0] / length, d[1] / length)
            left = half_plane(p, d, 1000)
            parts = pieces(m.intersection(left)) + pieces(m.difference(left))
            parts = [q for q in parts if q.area > 4]
            if len(parts) < 2:
                continue
            score = sum(squareness(q) * q.area for q in parts) / sum(q.area for q in parts)
            if score > best_score + 0.02:
                best, best_score = parts, score
    if not best:
        return [poly]
    out = []
    for q in best:
        out += cut_square(Polygon([(x / mx, y / my) for x, y in q.exterior.coords]), mx, my, depth + 1)
    return out


def main(path):
    fc = json.load(open(path, encoding="utf-8"))
    recipe = fc["city"]["ohm"]
    s, w, n, e = recipe["bbox"]
    mx, my = 111_320 * math.cos(math.radians((s + n) / 2)), 111_320
    feats = fc["features"]

    # Sea from land.
    if recipe.get("land"):
        land = unary_union([Polygon(r).buffer(0) for r in recipe["land"]])
        sea = box(w, s, e, n).difference(land).simplify(2 / my)
        for f in feats:
            if f["properties"].get("id") == "ohm-town":
                f["geometry"] = round_geom(shape(f["geometry"]).intersection(land))
        for f in feats:
            if f["properties"].get("id") == "ohm-water":
                f["geometry"] = round_geom(sea)
                break
        else:
            feats.insert(0, {"type": "Feature", "properties": {"kind": "sea", "src": "ohm", "id": "ohm-water", "showLabel": False},
                             "geometry": round_geom(sea)})
        print("  sea redrawn from land")

    # Buildings already drawn as landmarks.
    marks = [footprint(f, mx, my) for f in feats
             if f["properties"].get("src") != "ohm" and f["properties"].get("kind") in LANDMARKS]
    marks = unary_union([m.buffer(3 / my) for m in marks if m is not None])
    kept, dropped, split = [], 0, 0
    for f in feats:
        p = f["properties"]
        if p.get("src") == "ohm" and p["kind"] == "house":
            g = shape(f["geometry"])
            if not marks.is_empty and (marks.contains(g.centroid) or g.intersection(marks).area > 0.3 * g.area):
                dropped += 1
                continue
            parts = cut_square(g, mx, my)
            if len(parts) > 1:
                split += 1
                for k, q in enumerate(parts):
                    piece = {**p, "id": f"{p['id']}-{k}"}
                    if k and p.get("name"):
                        piece["showLabel"] = False
                    kept.append({**f, "properties": piece, "geometry": round_geom(q)})
                continue
        kept.append(f)
    feats = kept
    print(f"  {dropped} buildings dropped under landmarks, {split} cut into rectangles")

    # The fire.
    fire = recipe.get("fire")
    if fire and not any(f["properties"].get("id") == "ohm-ruins" for f in feats):
        area = Polygon(fire["area"]).buffer(0)
        date = fire["date"]
        burned = 0
        for f in feats:
            p = f["properties"]
            if p.get("src") == "ohm" and p["kind"] == "house" and area.contains(shape(f["geometry"]).centroid):
                p["to"] = date
                burned += 1
        town = next(f for f in feats if f["properties"].get("id") == "ohm-town")
        g = shape(town["geometry"])
        inside = g.intersection(area)
        town["geometry"] = round_geom(g.difference(area))
        fabric = town["properties"]["fabric"]
        feats.append({"type": "Feature", "properties": {"kind": "houses", "src": "ohm", "id": "ohm-town-burned", "showLabel": False,
                      "to": date, "fabric": fabric}, "geometry": round_geom(inside)})
        ruins = {"kind": "rubble", "src": "ohm", "id": "ohm-ruins", "from": date, "fabric": fabric}
        for k in ("name", "description", "wiki"):
            if fire.get(k):
                ruins[k] = fire[k]
        feats.append({"type": "Feature", "properties": ruins, "geometry": round_geom(inside)})
        print(f"  fire on {date}: {burned} buildings and {inside.area * mx * my / 1e4:.1f} ha of blocks burn")

    fc["features"] = feats
    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    text = text.replace('{"type":"Feature"', '\n{"type":"Feature"')
    with open(path, "w", encoding="utf-8") as f:
        f.write(text + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
