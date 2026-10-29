"""Give story territories real outer borders instead of straight cut lines.

Hand-drawn regions are clipped to the coast in the browser, but where a region
runs inland past the edge of what was drawn (the Soviet Union beyond the map
box, North Africa south of the coast) it ended in a straight line. This
rebuilds the listed regions from Natural Earth countries and provinces
(public domain), keeping each region's properties and periods.

Each region gets a frame of real units: whole countries ("countries"), named
provinces ("provinces"), or the provinces it mostly covers ("auto"). The
hand-drawn shape is trimmed to its frame, so its outer edge follows real
borders and coasts, while edges it shares with neighbouring regions stay as
drawn. Land in the frames that no region covers goes to the nearest region
whose frame holds it. "deserts" cuts named deserts out of a frame, so an
ancient province ends where the desert begins rather than at a modern line.
"extend" adds a hand polygon first (to carry a dividing
line on to a border), "add" also widens the frame with it (land beyond today's
borders, like Finland's Petsamo), "within" keeps a frame inside a given area, "exclude" drops provinces from a
frame, and
"fill": false stops a region taking unclaimed land.

    python tools/country_territories.py <Natural Earth folder> [story ...]

The folder holds ne_10m_admin_0_countries.zip, ne_10m_admin_1_states_provinces.zip,
ne_10m_land.zip and ne_10m_geography_regions_polys.zip from naturalearthdata.com.
Needs: pip install shapely pyshp
"""

import io
import json
import os
import re
import sys
import unicodedata
import zipfile

import shapefile
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union, voronoi_diagram
from shapely.strtree import STRtree

# The Soviet Union and its 1914 predecessor, as today's states. Each story
# subtracts the regions it draws separately (Baltics, Ukraine, Poland...).
USSR = ["RUS", "KAZ", "UZB", "TKM", "KGZ", "TJK", "GEO", "ARM", "AZE", "BLR", "UKR", "MDA"]
# East Prussia was German, Transcarpathia Hungarian or Czechoslovak and
# Northern Bukovina Romanian or Austrian, in 1914 and 1939 alike.
NOT_RUSSIAN = {"RUS": ["Kaliningrad"], "UKR": ["Transcarpathia", "Chernivtsi"]}

AFRICA_DESERTS = ["SAHARA", "LIBYAN DESERT", "WESTERN DESERT", "Hamada de Tinrhert", "Grand Erg Oriental",
                  "Grand Erg Occidental", "Sarir Kalanshiyu", "Jabal as Sawda"]
LEVANT_DESERTS = ["SYRIAN DESERT", "An Nafud Desert"]
DESERT_EDGED = {"numidia": AFRICA_DESERTS, "mauretania": AFRICA_DESERTS,
                "syria": LEVANT_DESERTS, "arabia": LEVANT_DESERTS, "damascus": LEVANT_DESERTS, "oultrejordain": LEVANT_DESERTS}
# Natural Earth's Sahara reaches the Libyan coast and covers the Nile, so these
# follow the provinces of the valley and the coast instead.
NILE = {"EGY": ["Al Iskandariyah", "Al Buhayrah", "Kafr ash Shaykh", "Ad Daqahliyah", "Dumyat", "Bur Sa`id", "Ash Sharqiyah",
                "Al Isma`iliyah", "As Suways", "Al Gharbiyah", "Al Minufiyah", "Al Qalyubiyah", "Al Qahirah", "Al Jizah",
                "Al Fayyum", "Bani Suwayf", "Al Minya", "Asyut", "Suhaj", "Qina", "Luxor", "Aswan"]}
# The governorates beside the Nile run far out into the desert, so Egypt is
# also kept to the Delta, the Fayum and about 30 km either side of the river:
# rounded edges where the desert begins, not straight governorate lines.
NILE_CORRIDOR = unary_union([
    LineString([(31.25, 30.05), (31.1, 29.07), (30.75, 28.1), (31.18, 27.18), (31.7, 26.56), (32.72, 26.16),
                (32.64, 25.69), (32.9, 24.09)]).buffer(0.3),
    # the Delta: the fan between its two branches (Rosetta and Damietta), rounded
    unary_union([LineString([(31.2, 30.15), (30.85, 30.6), (30.6, 31.0), (30.4, 31.45)]),
                 LineString([(31.2, 30.15), (31.3, 30.6), (31.55, 31.1), (31.8, 31.5)])]).convex_hull.buffer(0.3),
    Point(30.8, 29.3).buffer(0.4),
])
CYRENAICA = {"LBY": ["Al Jabal al Akhdar", "Al Marj", "Benghazi", "Al Qubbah"]}
TRIPOLI_COAST = {"LBY": ["An Nuqat al Khams", "Az Zawiyah", "Al Jifarah", "Tajura' wa an Nawahi al Arba", "Al Marqab", "Misratah"]}


def edged(recipes):
    """Ancient frames stop at the desert edge."""
    return {r: {**v, "deserts": DESERT_EDGED[r]} if r in DESERT_EDGED else v for r, v in recipes.items()}


STORIES = {
    "ww2-europe": {
        "ussr-interior": {"countries": USSR, "exclude": NOT_RUSSIAN},
        "algeria-morocco": {"countries": ["DZA", "MAR"]},
        "tunisia": {"countries": ["TUN"]},
        # Italian Libya: the line between the two provinces runs on south to the border.
        "tripolitania": {"countries": ["LBY"], "extend": [[9, 33.5], [19, 33.5], [19, 30], [19.5, 19], [9, 19]], "fill": False},
        "cyrenaica": {"countries": ["LBY"]},
        "egypt": {"countries": ["EGY"]},
        "turkey": {"countries": ["TUR"]},
        "norway": {"countries": ["NOR"]},
        "sweden": {"countries": ["SWE"]},
        # Petsamo, Finland's corridor to the Arctic until 1944.
        "finland": {"countries": ["FIN"], "add": [[28.4, 69.95], [31.9, 69.95], [31.9, 69.05], [29.3, 68.9], [28.4, 69.1]]},
        # Carpatho-Ukraine, annexed by Hungary in March 1939.
        "hungary": {"countries": ["HUN"], "provinces": {"UKR": ["Transcarpathia"]}},
    },
    "ww1": {
        "russia": {"countries": USSR + ["FIN", "EST", "LVA", "LTU"], "exclude": NOT_RUSSIAN},
        "persia": {"countries": ["IRN"]},
        "arabia": {"countries": ["SAU"]},
        "egypt": {"countries": ["EGY"]},
        "libya": {"countries": ["LBY"]},
        "north-africa": {"countries": ["DZA", "MAR", "TUN"]},
    },
    "french-revolution": {
        "sweden": {"countries": ["SWE"]},
        "finland": {"countries": ["FIN"]},
        "norway": {"countries": ["NOR"]},
        # The empire of 1800: no Central Asia or Caucasus yet, Bessarabia from 1812.
        "russia": {"countries": ["RUS", "BLR", "UKR", "EST", "LVA", "LTU"], "exclude": NOT_RUSSIAN},
    },
    "american-revolution": {
        # The 1774 province stopped at the height of land: beyond it the rivers ran
        # to Hudson Bay, the Hudson's Bay Company's Rupert's Land.
        "quebec": {"provinces": {"CAN": ["Québec", "Ontario"]}, "fill": False,
                   "extend": [[-92, 45], [-92, 48.3], [-90, 48.7], [-88, 49.4], [-86, 49.7], [-84, 49.4], [-82, 49.1],
                              [-80, 48.8], [-78.5, 49.0], [-77, 49.5], [-75.5, 49.9], [-74, 50.3], [-72.5, 50.8], [-71, 51.3],
                              [-69.5, 51.8], [-68, 52.2], [-66.5, 52.6], [-65, 52.7], [-63.5, 52.6], [-62, 52.3], [-60, 52.1],
                              [-57, 51.6], [-57, 45]]},
        # West of the Mississippi to the Rockies: its western limit was the
        # continental divide, never surveyed, so that edge follows the mountains.
        "louisiana": {"provinces": {"USA": ["Louisiana", "Arkansas", "Missouri", "Iowa", "Minnesota", "Kansas", "Nebraska",
                                            "South Dakota", "North Dakota", "Oklahoma", "Montana", "Wyoming", "Colorado"]},
                      "extend": [[-89.5, 49], [-113.9, 49], [-113.1, 47.6], [-112.3, 46.6], [-110.9, 45.6], [-110.2, 44.6],
                                 [-109.1, 43.6], [-108.0, 42.7], [-106.6, 41.6], [-105.9, 40.6], [-105.6, 39.6], [-105.4, 38.6],
                                 [-105.1, 37.6], [-104.9, 37.0], [-103, 36.6], [-100, 36.5], [-89.5, 36.5]],
                      "fill": False},
        "southern-nations": {"auto": ["USA"]},
        "northwest": {"provinces": {"USA": ["Ohio", "Indiana", "Illinois", "Michigan", "Wisconsin"]}},
    },
}

# Older stories: no fixed borders in the desert, so the outer edge follows
# the provinces a region mostly covers, or the edge of the desert.
STORIES_ANCIENT = {
    "rome": {r: {"auto": c} for r, c in {
        "gaul-north": ["FRA", "BEL", "NLD", "LUX", "DEU"], "gaul-east": ["FRA", "CHE", "DEU"],
        "raetia-noricum": ["AUT", "DEU", "CHE", "ITA", "SVN"], "pannonia": ["HUN", "AUT", "HRV", "SVN", "SRB", "SVK"],
        "moesia": ["BGR", "SRB", "ROU", "MKD", "KOS"], "dacia": ["ROU"], "cappadocia": ["TUR"],
        "armenia": ["ARM", "TUR", "AZE", "IRN", "GEO"], "syria": ["SYR", "LBN", "TUR", "ISR", "JOR"],
        "arabia": ["JOR", "SAU", "ISR", "EGY", "SYR"],
        "numidia": ["DZA", "TUN"], "mauretania": ["MAR", "DZA"],
        "upper-mesopotamia": ["TUR", "SYR", "IRQ"], "lower-mesopotamia": ["IRQ", "SYR", "KWT"], "thrace": ["BGR", "TUR", "GRC"],
    }.items()} | {
        "iran": {"countries": ["IRN"]},  # Parthia held all of Iran
        "egypt": {"provinces": NILE, "within": NILE_CORRIDOR}, "cyrenaica": {"provinces": CYRENAICA},
        "tripolitania": {"provinces": TRIPOLI_COAST, "auto": ["TUN"]},
    },
    "punic-wars": {r: {"auto": c} for r, c in {
        "numidia": ["DZA", "TUN"],
        "spain-barcid": ["ESP", "PRT"], "spain-roman-advance": ["ESP"], "spain-roman": ["ESP", "PRT"], "spain-roman-foothold": ["ESP"],
        # Cisalpine Gaul, the Po valley up to the Alps: the same land in four periods
        "cisalpine-gauls": ["ITA"], "cisalpine-roman": ["ITA"], "cisalpine-revolt": ["ITA"], "cisalpine-final": ["ITA"],
    }.items()} | {
        "emporia-carthage": {"provinces": TRIPOLI_COAST, "auto": ["TUN"]},
        "emporia-numidia": {"provinces": TRIPOLI_COAST, "auto": ["TUN"]},
    },
    "crusades": {r: {"auto": c} for r, c in {
        "oultrejordain": ["JOR", "ISR", "PSX"], "damascus": ["SYR", "JOR", "LBN"],
        "mosul": ["IRQ", "SYR", "TUR"], "iraq": ["IRQ"], "rum": ["TUR"], "macedonia": ["MKD", "GRC", "BGR", "ALB"],
        "bulgaria": ["BGR", "ROU", "SRB"], "ionia": ["TUR"], "bithynia": ["TUR"],
    }.items()} | {"egypt": {"provinces": NILE, "within": NILE_CORRIDOR}},
    "aztecs": {r: {"auto": c} for r, c in {"empire": ["MEX"], "soconusco": ["MEX", "GTM"], "tarascan": ["MEX"]}.items()},
}
STORIES |= {sid: edged(recipes) for sid, recipes in STORIES_ANCIENT.items()}
AUTO_SHARE = 0.4  # a province joins an "auto" frame when this share of it lies in the hand shape


def fold(name):
    """Desert names without accents or case, so recipes can be typed plainly."""
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()


def read(folder, name):
    z = zipfile.ZipFile(os.path.join(folder, name))
    stem = [n[:-4] for n in z.namelist() if n.endswith(".shp")][0]
    r = shapefile.Reader(shp=io.BytesIO(z.read(stem + ".shp")), dbf=io.BytesIO(z.read(stem + ".dbf")),
                         shx=io.BytesIO(z.read(stem + ".shx")), encoding="utf-8")
    fields = [f[0] for f in r.fields[1:]]
    return [(dict(zip(fields, sr.record)), shape(sr.shape.__geo_interface__).buffer(0)) for sr in r.iterShapeRecords()]


def near(geom, ref, deg=8):
    """Drop far-flung pieces (overseas territories) of a frame."""
    zone = ref.envelope.buffer(deg)
    return unary_union([p for p in getattr(geom, "geoms", [geom]) if p.intersects(zone)])


def frame_of(recipe, hand, countries, provinces, deserts):
    parts = [countries[c] for c in recipe.get("countries", []) if c in countries]
    for c, names in recipe.get("provinces", {}).items():
        parts += [g for (cc, n), g in provinces.items() if cc == c and n in names]
    for c in recipe.get("auto", []):
        for (cc, _), g in provinces.items():
            if cc == c and g.area and g.intersection(hand).area / g.area >= AUTO_SHARE:
                parts.append(g)
    frame = unary_union(parts) if parts else hand
    for c, names in recipe.get("exclude", {}).items():
        frame = frame.difference(unary_union([provinces[(c, n)] for n in names if (c, n) in provinces]))
    if recipe.get("add"):
        frame = frame.union(Polygon(recipe["add"]).intersection(hand))  # hand is already on land
    if recipe.get("within") is not None:
        frame = frame.intersection(recipe["within"])
    if recipe.get("deserts"):
        cut = [g for name, g in deserts.items() if any(name.startswith(fold(n)) for n in recipe["deserts"])]
        frame = frame.difference(unary_union(cut))
    return near(frame, hand)


def split_nearest(piece, owners):
    """Share a piece of land between regions: each point goes to the nearest region."""
    pts, who = [], []
    for rid, g in owners.items():
        line = g.boundary
        n = max(20, int(line.length / 0.1))
        for k in range(n):
            p = line.interpolate(k / n, normalized=True)
            if p.distance(piece) < 3:
                pts.append(p)
                who.append(rid)
    if not pts:
        return {}
    cells = voronoi_diagram(MultiPoint(pts), envelope=piece.envelope.buffer(2))
    tree = STRtree(pts)
    out = {}
    for cell in cells.geoms:
        idx = [i for i in tree.query(cell) if cell.contains(pts[i])]
        if idx:
            out.setdefault(who[idx[0]], []).append(cell.intersection(piece))
    return {rid: unary_union(gs) for rid, gs in out.items()}


def year(value, default):
    """'-160', '1775-06-17', '1522-07' -> decimal year; missing -> default."""
    if value in (None, ""):
        return default
    m = re.match(r"(-?\d+)(?:-(\d+))?(?:-(\d+))?", str(value))
    y, mo, d = int(m.group(1)), int(m.group(2) or 1), int(m.group(3) or 1)
    return y + (mo - 1) / 12 + (d - 1) / 365


def span(props):
    """When a region is on the map: from its first period's start to its last's end."""
    periods = props.get("periods") or [props]
    return (min(year(p.get("from"), -1e9) for p in periods), max(year(p.get("to"), 1e9) for p in periods))


def round_geom(g):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]
    m = mapping(g)
    return {"type": m["type"], "coordinates": r(m["coordinates"])}


def rebuild(path, recipes, countries, provinces, land, deserts):
    fc = json.load(open(path, encoding="utf-8"))
    by_id = {f["properties"]["id"]: f for f in fc["features"]}
    land_tree = STRtree(land)

    def on_land(g):
        g = g if g.is_valid else g.buffer(0)
        return g.intersection(unary_union([land[i] for i in land_tree.query(g)]))

    hands = {rid: on_land(shape(f["geometry"])) for rid, f in by_id.items()}
    frames, cores = {}, {}
    for rid, recipe in recipes.items():
        if rid not in by_id:
            print(f"  skip {rid}: not in file")
            continue
        hand = hands[rid]
        for key in ("extend", "add"):
            if recipe.get(key):
                hand = hand.union(on_land(Polygon(recipe[key])))
        frames[rid] = frame_of(recipe, hand, countries, provinces, deserts)
        cores[rid] = hand.intersection(frames[rid])
    # Regions are only neighbours if they are on the map at the same time:
    # Barcid Spain and Roman Spain cover the same land in turn.
    spans = {rid: span(f["properties"]) for rid, f in by_id.items()}
    meets = lambda a, b: spans[a][0] < spans[b][1] and spans[b][0] < spans[a][1]
    fillers = [r for r in frames if recipes[r].get("fill", True)]
    gains = {rid: [] for rid in frames}
    for rid in fillers:
        rivals = [r for r in by_id if r != rid and meets(r, rid)]
        claimed = unary_union([cores.get(r, hands[r]) for r in rivals] + [cores[rid]])
        free = frames[rid].difference(claimed)
        for piece in getattr(free, "geoms", [free]):
            if piece.geom_type != "Polygon" or piece.area < 1e-4:
                continue
            # Land another region's frame also holds is split by nearness.
            spot = piece.representative_point()
            owners = {r: cores[r] for r in fillers if (r == rid or r in rivals) and frames[r].contains(spot)}
            owners = {r: g for r, g in owners.items() if g.distance(piece) < 0.5} or owners
            if list(owners) == [rid]:
                gains[rid].append(piece)
            elif rid in owners:
                share = split_nearest(piece, owners).get(rid)
                if share is not None:
                    gains[rid].append(share)

    for rid in frames:
        # A tiny grow-and-shrink closes hairline slits where pieces meet.
        g = unary_union([cores[rid]] + gains[rid]).buffer(0.003).buffer(-0.003)
        # About 3 km of detail for country-sized regions, 1 km for small ones.
        g = g.simplify(0.03 if g.area > 50 else 0.012 if g.area > 5 else 0.005, preserve_topology=True).buffer(0)
        g = unary_union([p for p in getattr(g, "geoms", [g]) if p.area > 0.002])
        f = by_id[rid]
        f["geometry"] = round_geom(g)
        f["properties"].pop("clip", None)  # already follows the coast
        n = len(re.findall(r"\[-?\d", json.dumps(f["geometry"])))
        print(f"  {rid}: {f['geometry']['type']}, {n} points")

    text = json.dumps(fc, ensure_ascii=False, separators=(",", ":"))
    text = text.replace('{"type":"Feature"', '\n{"type":"Feature"')  # one region per line
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text + "\n")


def widen_land_mask(story_path, territories_path):
    """The browser clips "clip": "land" regions to the story's box too: make the
    box cover every region that still asks for clipping, so none is cut."""
    story = json.load(open(story_path, encoding="utf-8"))
    if not story.get("landMask"):
        return
    fc = json.load(open(territories_path, encoding="utf-8"))
    clipped = [shape(f["geometry"]).buffer(0) for f in fc["features"] if f["properties"].get("clip") == "land"]
    if not clipped:
        return
    w, s, e, n = unary_union(clipped).bounds
    old = story["landMask"]["bbox"]
    new = [min(old[0], int(w) - 1), min(old[1], int(s) - 1), max(old[2], int(e) + 2), max(old[3], int(n) + 2)]
    if new != old:
        text = open(story_path, encoding="utf-8").read()
        text = re.sub(r'("landMask"\s*:\s*\{\s*"bbox"\s*:\s*)\[[^\]]*\]', lambda m: m.group(1) + json.dumps(new), text, count=1)
        open(story_path, "w", encoding="utf-8", newline="").write(text)
        print(f"  landMask bbox {old} -> {new}")


def main(folder, only):
    countries = {}
    for rec, g in read(folder, "ne_10m_admin_0_countries.zip"):
        countries[rec["ADM0_A3"]] = g
    provinces = {(rec["adm0_a3"], rec["name"]): g for rec, g in read(folder, "ne_10m_admin_1_states_provinces.zip")}
    land = [p for _, g in read(folder, "ne_10m_land.zip") for p in getattr(g, "geoms", [g])]
    deserts = {fold(rec["NAME"]): g for rec, g in read(folder, "ne_10m_geography_regions_polys.zip") if rec["FEATURECLA"] == "Desert"}
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "stories")
    for sid, recipes in STORIES.items():
        if only and sid not in only:
            continue
        print(sid)
        terr = os.path.join(root, sid, "territories.geojson")
        rebuild(terr, recipes, countries, provinces, land, deserts)
        widen_land_mask(os.path.join(root, sid, "story.json"), terr)


if __name__ == "__main__":
    main(sys.argv[1], set(sys.argv[2:]))
