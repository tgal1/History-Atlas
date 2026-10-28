"""Make scene marches follow roads instead of straight lines.

For every track (and unit) in a story's scenes.json with "route": "road",
each leg between keyframes is routed along today's roads with the public
OSRM server, and the waypoints are stored on the arriving keyframe as "via".
Roads mostly follow the same valleys, passes and river crossings that armies
used, so the line on the map follows the land.

A keyframe can override its leg:
    "route": "straight"  keep a straight line (a causeway, a short hop)
    "route": "sea"       sail: keep the hand-placed "via" waypoints as they are
    "route": "road"      route this leg even if the track doesn't say so
Hand-placed "via" lists are never overwritten; routed ones are marked
"viaSource": "osrm" and refreshed on each run.

    python tools/route_scenes.py data/stories/troubles/scenes.json

Routing data (c) OpenStreetMap contributors, ODbL; routes by OSRM.
"""

import json
import math
import sys
import time
import urllib.request

OSRM = "https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson"


def route(a, b):
    coords = f"{a[1]},{a[0]};{b[1]},{b[0]}"
    req = urllib.request.Request(OSRM.format(coords=coords), headers={"User-Agent": "history-atlas/0.1"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.load(res)
            if data.get("code") == "Ok":
                return [[round(lat, 5), round(lng, 5)] for lng, lat in data["routes"][0]["geometry"]["coordinates"]]
        except Exception as err:
            print(f"    retry ({err})", file=sys.stderr)
        time.sleep(2 + attempt * 3)
    return None


def simplify(points, tolerance_m):
    """Douglas-Peucker in metres, so a 300 km march keeps its shape in ~100 points."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][0])
    xy = [(p[1] * 111_320 * math.cos(lat0), p[0] * 111_320) for p in points]

    def dist(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx == dy == 0:
            return math.hypot(p[0] - a[0], p[1] - a[1])
        t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0, None
        for k in range(i + 1, j):
            d = dist(xy[k], xy[i], xy[j])
            if d > best:
                best, idx = d, k
        if idx is not None and best > tolerance_m:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(points, keep) if k]


def main(path):
    with open(path, encoding="utf-8") as f:
        scenes = json.load(f)
    for sid, scene in scenes.items():
        if scene.get("frame"):
            continue  # local battle frames are drawn by hand
        for item in scene.get("tracks", []) + scene.get("units", []):
            default = item.get("route")
            kfs = item["keyframes"]
            for prev, k in zip(kfs, kfs[1:]):
                mode = k.get("route", default)
                if mode != "road" or "at" not in k or "at" not in prev:
                    continue
                if k.get("via") and k.get("viaSource") != "osrm":
                    continue
                if prev["at"] == k["at"]:
                    continue
                pts = route(prev["at"], k["at"])
                time.sleep(1.1)  # be polite to the public server
                if not pts:
                    print(f"  {sid} / {item.get('label')}: no route to {k['at']}", file=sys.stderr)
                    continue
                pts = simplify(pts, 250)
                k["via"] = pts[1:-1]
                k["viaSource"] = "osrm"
                print(f"  {sid} / {item.get('label')}: t={k['t']} {len(k['via'])} waypoints")
    text = dump(scenes) + "\n"  # build it first, so an error never leaves the file empty
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def dump(obj, level=0):
    """JSON in the hand-written style: anything short on one line, long point lists wrapped."""
    pad = "  " * (level + 1)
    flat = json.dumps(obj, ensure_ascii=False, separators=(", ", ": "))
    if len(flat) + len(pad) <= 120 or not isinstance(obj, (list, dict)):
        return flat
    if isinstance(obj, list):
        if all(isinstance(p, list) and len(p) == 2 for p in obj):  # a run of [lat, lng] points
            rows = [", ".join(json.dumps(p, separators=(", ", ": ")) for p in obj[i:i + 6]) for i in range(0, len(obj), 6)]
            return "[\n" + ",\n".join(pad + r for r in rows) + "\n" + "  " * level + "]"
        return "[\n" + ",\n".join(pad + dump(v, level + 1) for v in obj) + "\n" + "  " * level + "]"
    items = [f"{pad}{json.dumps(k, ensure_ascii=False)}: {dump(v, level + 1)}" for k, v in obj.items()]
    return "{\n" + ",\n".join(items) + "\n" + "  " * level + "}"


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(p)
        main(p)
