"""Rebuild American territory outlines from US Census boundaries.

Hand-drawn regions are fine for an empire, but zoom into New York or Boston
and their straight edges cut across rivers and islands. This replaces the
geometry of listed regions with real state and county shapes from the Census
Bureau's 1:500,000 cartographic boundary files (clipped to the shoreline),
keeping each region's properties and periods.

    python tools/census_territories.py data/stories/american-revolution/territories.geojson \\
        cb_2023_us_state_500k.zip cb_2023_us_county_500k.zip

A region's recipe (REGIONS below) names states and counties by FIPS code.
"clip": "hand" intersects with the region's existing hand-drawn outline,
grown slightly, to keep a historical limit (eastern Maine, Aquidneck Island);
"minus" subtracts other regions. Needs: pip install shapely pyshp
Census boundary files are public domain.
"""

import io
import json
import re
import sys
import zipfile

import shapefile
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

S = lambda *codes: [("state", c) for c in codes]
Cn = lambda *codes: [("county", c) for c in codes]

SC_LOW = Cn("45019", "45015", "45029", "45035", "45013", "45053", "45043")
GA_COAST = Cn("13051", "13103", "13029", "13179", "13191", "13127", "13039")
LONG_ISLAND = Cn("36047", "36081", "36059", "36103")

REGIONS = {
    "massachusetts": {"parts": S("25")},
    "maine": {"parts": S("23"), "minus": ["eastern-maine"]},
    "eastern-maine": {"parts": S("23"), "clip": "hand"},
    "new-hampshire": {"parts": S("33")},
    "vermont": {"parts": S("50")},
    "rhode-island": {"parts": S("44")},
    "connecticut": {"parts": S("09")},
    "new-york": {"parts": S("36")},
    "new-jersey": {"parts": S("34")},
    "pennsylvania": {"parts": S("42")},
    "delaware": {"parts": S("10")},
    "maryland": {"parts": S("24")},
    "virginia": {"parts": S("51", "54")},  # West Virginia was part of Virginia
    "north-carolina": {"parts": S("37")},
    "sc-low": {"parts": SC_LOW},
    "sc-up": {"parts": S("45"), "minus": ["sc-low"]},
    "ga-coast": {"parts": GA_COAST},
    "ga-up": {"parts": S("13"), "clip": "hand", "minus": ["ga-coast"]},
    "kentucky": {"parts": S("21")},
    "boston": {"parts": Cn("25025", "25021"), "clip": "hand"},
    "charlestown": {"parts": Cn("25025", "25017"), "clip": "hand"},
    "newport": {"parts": S("44"), "clip": "hand"},
    "staten-island": {"parts": Cn("36085")},
    "long-island": {"parts": LONG_ISLAND},
    "manhattan": {"parts": Cn("36061")},
    "philadelphia": {"parts": Cn("42101")},
    "yorktown": {"parts": Cn("51199", "51073", "51830"), "clip": "hand"},
}
# Small occupied areas keep fine detail; whole colonies are simplified harder.
FINE = {"boston", "charlestown", "newport", "staten-island", "long-island", "manhattan", "philadelphia", "yorktown"}


def read_shapes(zip_path, key_fn):
    z = zipfile.ZipFile(zip_path)
    stem = [n[:-4] for n in z.namelist() if n.endswith(".shp")][0]
    r = shapefile.Reader(shp=io.BytesIO(z.read(stem + ".shp")), dbf=io.BytesIO(z.read(stem + ".dbf")), shx=io.BytesIO(z.read(stem + ".shx")))
    fields = [f[0] for f in r.fields[1:]]
    out = {}
    for sr in r.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        out[key_fn(rec)] = shape(sr.shape.__geo_interface__)
    return out


def main(path, state_zip, county_zip):
    states = read_shapes(state_zip, lambda r: r["STATEFP"])
    counties = read_shapes(county_zip, lambda r: r["STATEFP"] + r["COUNTYFP"])
    fc = json.load(open(path, encoding="utf-8"))
    by_id = {f["properties"]["id"]: f for f in fc["features"]}
    built = {}

    def build(rid):
        if rid in built:
            return built[rid]
        recipe = REGIONS[rid]
        geom = unary_union([(states if kind == "state" else counties)[code] for kind, code in recipe["parts"]])
        if recipe.get("clip") == "hand":
            geom = geom.intersection(shape(by_id[rid]["geometry"]).buffer(0.03))
        for other in recipe.get("minus", []):
            geom = geom.difference(build(other))
        built[rid] = geom
        return geom

    for rid in REGIONS:
        if rid not in by_id:
            print(f"  skip {rid}: not in file")
            continue
        geom = build(rid).simplify(0.0003 if rid in FINE else 0.002, preserve_topology=True)
        geom = geom.buffer(0) if not geom.is_valid else geom
        gj = mapping(geom)
        f = by_id[rid]
        f["geometry"] = json.loads(json.dumps(gj), parse_float=lambda v: round(float(v), 5))
        f["properties"].pop("clip", None)  # already follows the shore
        n = len(re.findall(r"\[-?\d", json.dumps(f["geometry"])))
        print(f"  {rid}: {f['geometry']['type']}, {n} points")

    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    text = text.replace('{"type":"Feature"', '\n{"type":"Feature"')  # one region per line
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")


if __name__ == "__main__":
    main(*sys.argv[1:4])
