"""Sample the 3D view's terrain under features that stand on a terrace.

The 3D view sets each solid on the ground under the middle of its points, so a
flat platform over sloping ground (the Temple Mount in Jerusalem) would follow
the slope. Features whose model has a "terrace" ({"top": 746, "h": 1}) are
raised to one level instead; this tool stores the ground under each of them as
model.terrace.dem, read from the same AWS Terrarium tiles the 3D view uses.

    python tools/terrace_dem.py data/cities/jerusalem.geojson

Run it again after moving such a feature or refreshing its outline.
"""

import io
import json
import math
import re
import sys
import urllib.request

from PIL import Image

TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 15  # the 3D view's terrain maxzoom
_cache = {}


def tile(x, y):
    if (x, y) not in _cache:
        req = urllib.request.Request(TILES.format(z=Z, x=x, y=y), headers={"User-Agent": "history-atlas/0.1"})
        with urllib.request.urlopen(req, timeout=60) as res:
            _cache[(x, y)] = Image.open(io.BytesIO(res.read())).convert("RGB")
    return _cache[(x, y)]


def pixel(px, py):
    x, y = int(px // 256), int(py // 256)
    r, g, b = tile(x, y).getpixel((int(px) % 256, int(py) % 256))
    return r * 256 + g + b / 256 - 32768


def elevation(lng, lat):
    """Bilinear sample, as the GPU reads the DEM texture."""
    n = 2 ** Z * 256
    px = (lng + 180) / 360 * n - 0.5
    py = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n - 0.5
    x0, y0 = math.floor(px), math.floor(py)
    a, b = px - x0, py - y0
    return (pixel(x0, y0) * (1 - a) * (1 - b) + pixel(x0 + 1, y0) * a * (1 - b)
            + pixel(x0, y0 + 1) * (1 - a) * b + pixel(x0 + 1, y0 + 1) * a * b)


def points(g):
    if g["type"] == "Point":
        return [g["coordinates"]]
    if g["type"] in ("LineString", "MultiPoint"):
        return g["coordinates"]
    if g["type"] in ("Polygon", "MultiLineString"):
        return [p for ring in g["coordinates"] for p in ring]
    return [p for poly in g["coordinates"] for ring in poly for p in ring]


def main(path):
    with open(path, encoding="utf-8") as f:
        fc = json.load(f)
    for feature in fc["features"]:
        t = (feature["properties"].get("model") or {}).get("terrace")
        if t is None:
            continue
        pts = points(feature["geometry"])
        lat0 = sum(p[1] for p in pts) / len(pts)
        mx = 111_320 * math.cos(math.radians(lat0))
        margin = t.get("margin", 30)
        west, east = min(p[0] for p in pts) - margin / mx, max(p[0] for p in pts) + margin / mx
        south, north = min(p[1] for p in pts) - margin / 111_320, max(p[1] for p in pts) + margin / 111_320
        width, height = (east - west) * mx, (north - south) * 111_320
        step = max(8, max(width, height) / 30)
        nx, ny = math.ceil(width / step) + 1, math.ceil(height / step) + 1
        z = [round(elevation(west + (east - west) * i / (nx - 1), south + (north - south) * j / (ny - 1)), 1)
             for j in range(ny) for i in range(nx)]
        t["dem"] = {"sw": [round(west, 6), round(south, 6)], "ne": [round(east, 6), round(north, 6)], "n": [nx, ny], "z": z}
        print(f"  {feature['properties'].get('id')}: {nx} x {ny}, ground {min(z)} to {max(z)} m")
    text = json.dumps(fc, ensure_ascii=False, indent=1)
    text = re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1, \2]", text)
    # Keep the long elevation lists on one line.
    text = re.sub(r'"z": \[[\s\d.,-]+\]', lambda m: re.sub(r"\s+", " ", m.group(0)).replace("[ ", "[").replace(" ]", "]"), text)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
