"""Build a city plan's base from OpenHistoricalMap (CC0) as it stood on a date.

OpenHistoricalMap is OpenStreetMap for the past: features carry start and end
dates. For a city's bounding box and a date this pulls

    water      the historic shoreline (water polygons valid on the date),
               or listed relations such as Leventhal's 1795 Boston shoreline
    streets    every street that existed then, with its name
    wharves    piers and wharves
    buildings  buildings recorded as standing then (New York has hundreds)

and writes them into data/cities/<id>.geojson, replacing the previous
generated features (they carry "src": "ohm"). It also cuts the built-up area
into its real blocks between the streets, for the 3D house generator.

The recipe lives in the city file's "ohm" member:
    "ohm": { "bbox": [south, west, north, east], "date": "1776-08-01",
             "water": [2860006],            optional: relations to use as water
             "extent": [[lng, lat], ...],   optional: the built-up town, else all land
             "houses": "colonial" }         house style for the blocks

    python tools/ohm_city.py data/cities/boston.geojson
Needs: pip install shapely
"""

import json
import math
import sys
import time
import urllib.parse
import urllib.request

from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import polygonize, unary_union

OHM = "https://overpass-api.openhistoricalmap.org/api/interpreter"
STREET_WIDTH = {"primary": 10, "secondary": 9, "tertiary": 8, "residential": 6, "unclassified": 6,
                "service": 4, "pedestrian": 5, "footway": 3, "path": 3, "track": 4}


def overpass(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(OHM, data=body, headers={"User-Agent": "history-atlas/0.1"})
            with urllib.request.urlopen(req, timeout=300) as res:
                return json.load(res)["elements"]
        except Exception as err:
            print(f"  retry ({err})", file=sys.stderr)
            time.sleep(5 + attempt * 10)
    sys.exit("OpenHistoricalMap did not answer")


def year(value, default):
    try:
        return float(str(value)[:10].replace("-", ".", 1).split("-")[0])
    except (TypeError, ValueError):
        return default


def alive(tags, when):
    start = year(tags.get("start_date"), -1e9)
    end = year(tags.get("end_date"), 1e9)
    return start <= when < end


def geom_of(e):
    """Shapely geometry of an Overpass element with 'out geom'."""
    if e["type"] == "way":
        pts = [(p["lon"], p["lat"]) for p in e.get("geometry", []) if p]
        if len(pts) < 2:
            return None
        if pts[0] == pts[-1] and len(pts) >= 4:
            return Polygon(pts)
        return LineString(pts)
    if e["type"] == "relation":
        outers, inners = [], []
        for m in e.get("members", []):
            if m.get("type") != "way" or "geometry" not in m:
                continue
            line = LineString([(p["lon"], p["lat"]) for p in m["geometry"] if p])
            (inners if m.get("role") == "inner" else outers).append(line)
        polys = list(polygonize(unary_union(outers)))
        holes = list(polygonize(unary_union(inners))) if inners else []
        g = unary_union(polys)
        return g.difference(unary_union(holes)) if holes else g
    return None


def metres(lat):
    return 111_320 * math.cos(math.radians(lat)), 111_320


def main(path):
    fc = json.load(open(path, encoding="utf-8"))
    recipe = fc["city"]["ohm"]
    s, w, n, e = recipe["bbox"]
    when = year(recipe["date"], 0) + 0.5
    area = box(w, s, e, n)
    mx, my = metres((s + n) / 2)
    deg = lambda m: m / my  # metres to degrees (latitude scale; fine for buffers)

    print("Fetching from OpenHistoricalMap...")
    els = overpass(f"[out:json][timeout:300];(nwr({s},{w},{n},{e})[start_date];"
                   + "".join(f"relation({r});" for r in recipe.get("water", [])) + ");out geom;")
    water, streets, wharves, buildings = [], [], [], []
    for el in els:
        t = el.get("tags", {})
        if el["type"] == "relation" and el["id"] in recipe.get("water", []):
            g = geom_of(el)
            if g:
                water.append(g)
            continue
        if not alive(t, when):
            continue
        is_water = t.get("natural") == "water" or t.get("natural_") == "water" or "water" in t or t.get("waterway")
        if is_water:
            g = geom_of(el)
            if g is not None and g.geom_type != "LineString":
                water.append(g)
        elif t.get("highway") in STREET_WIDTH and el["type"] == "way":
            g = geom_of(el)
            if g is not None:
                streets.append((g if g.geom_type == "LineString" else g.exterior, t))
        elif t.get("man_made") == "pier" and el["type"] != "node":
            g = geom_of(el)
            if g is not None:
                wharves.append((g, t))
        elif t.get("building") and el["type"] != "node":
            g = geom_of(el)
            if g is not None and g.geom_type == "Polygon":
                buildings.append((g, t))

    sea = unary_union(water).intersection(area) if water else None
    land = area.difference(sea) if sea else area
    extent = Polygon(recipe["extent"]) if recipe.get("extent") else land
    town = extent.intersection(land)
    print(f"  water {len(water)}, streets {len(streets)}, wharves {len(wharves)}, buildings {len(buildings)}")

    # Blocks: the town minus the streets (as their real widths) and the wharves.
    cuts = [g.buffer(deg(STREET_WIDTH[t["highway"]] / 2)) for g, t in streets]
    cuts += [g.buffer(deg(2)) for g, _ in wharves]
    blocks = town.difference(unary_union(cuts)) if cuts else town
    blocks = [b for b in getattr(blocks, "geoms", [blocks]) if b.area * mx * my > 120]

    out = [f for f in fc["features"] if f["properties"].get("src") != "ohm"]
    add = lambda kind, g, **props: out.append({"type": "Feature", "properties": {"kind": kind, "src": "ohm", **props}, "geometry": round_geom(mapping(g))})
    if sea and not sea.is_empty:
        add("sea", sea.simplify(deg(3)), id="ohm-water", name=recipe.get("waterName"), showLabel=False)
    for i, (g, t) in enumerate(streets):
        clipped = g.intersection(area)
        if clipped.is_empty:
            continue
        add("road", clipped.simplify(deg(1)), id=f"ohm-street-{i}", name=t.get("name"), widthM=STREET_WIDTH[t["highway"]],
            showLabel=bool(t.get("name")), labelZoom=17)
    for i, (g, t) in enumerate(wharves):
        add("wharf", g if g.geom_type != "LineString" else g.buffer(deg(4)), id=f"ohm-wharf-{i}", name=t.get("name"), showLabel=False)
    for i, (g, t) in enumerate(buildings):
        props = {"id": f"ohm-building-{i}", "showLabel": False}
        if t.get("name"):
            props.update(name=t["name"], labelZoom=17)
        if t.get("height"):
            props["heightM"] = float(t["height"])
        add("house", g.simplify(deg(0.3)), **props)
    add("houses", unary_union(blocks).simplify(deg(1)), id="ohm-town", name=recipe.get("townName"), showLabel=False,
        fabric={"layout": "blocks", "style": recipe.get("houses", "colonial")})
    fc["features"] = out
    fc["city"]["ohmCredit"] = "Historic streets, shoreline and buildings: OpenHistoricalMap contributors (CC0)"
    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    text = text.replace('{"type":"Feature"', '\n{"type":"Feature"')
    with open(path, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    print(f"  {len(blocks)} blocks written to {path}")


def round_geom(g):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


if __name__ == "__main__":
    main(sys.argv[1])
