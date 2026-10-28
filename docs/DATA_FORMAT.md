# Writing a story

A story is a folder in `data/stories/<id>/` plus an entry in `data/catalog.json`. No code changes needed.

`catalog.json` also lists the cities for the menu's Cities tab: `{ "id": "rome", "name": "Rome", "story": "rome", "at": "150", "when": "Shown in AD 150", "blurb": "...", "threeD": true }`. `story` is the story that loads the city and `at` the date it opens on.

```
data/stories/<id>/
├── story.json           required
├── events.json          required
├── territories.geojson  optional
└── scenes.json          optional
```

## Dates

ISO `YYYY-MM-DD`, with month and day optional (`"1972"`, `"1972-01"`). BC dates use astronomical years: `0` = 1 BC, `-215` = 216 BC. So the Battle of Cannae, 2 August 216 BC, is `"-215-08-02"`. The UI shows it as "2 Aug 216 BC".

**Rule of thumb: astronomical year = 1 − the BC year.** 264 BC is `-263`, 146 BC is `-145`.

A date given only to the year or month is shown at that precision ("218 BC", "Oct 218 BC") and placed mid-year or mid-month on the timeline.

## story.json

| Field | Purpose |
|---|---|
| `id`, `title`, `subtitle` | Shown in the HUD |
| `range.start`, `range.end` | Timeline span |
| `overview.bounds` | The zoomed-out home view, `[[south, west], [north, east]]`. Fits any screen size |
| `overview.center`, `overview.zoom` | Fallback home view if `bounds` is absent. `center` is `[lat, lng]` |
| `minZoom` | Stops users zooming out too far |
| `basemap` | `esri-dark` (slate, modern labels), `osm`, or `esri-relief` (parchment relief, no modern labels: use for ancient history) |
| `clockPrecision` | `"year"` makes the timeline clock count in years. Use it for ancient stories |
| `calendar.ad` | `true` labels AD years ("AD 117"). Use it when a story crosses from BC into AD |
| `landMask.bbox` | `[west, south, east, north]`. Turns on coastline clipping for territories marked `clip: "land"` |
| `files` | Names of the other files, if not the defaults |
| `intro.title`, `intro.body[]`, `intro.tips[]` | The opening card |
| `categories` | `{ key: { label, color } }`. Each event has one. Drives dot and tick colours |
| `factions` | `{ key: { label, short?, color, style? } }`. Each territory has one. Drives shading, the legend, scene unit colours and "Victory: Rome" chips. `style` overrides the default look with any Leaflet path option, e.g. solid lakes `{ "dashArray": null, "fillOpacity": 0.45 }` or thick causeway lines `{ "weight": 4 }` |
| `eras[]` | `{ start, end, title, text }`. Chapters shown on the timeline and in the HUD |
| `intensity` | Optional bar strip behind the timeline: `{ label, note, values: { "1972": 479, ... } }` |
| `mapLabels[]` | `{ text, at: [lat, lng], from?, to?, minZoom?, maxZoom? }` |
| `ask.persona` | Not used at the moment (kept for the archived chat): who the guide is |
| `ask.defaultQuestions[]` | Not used at the moment (kept for the archived chat) |
| `sources[]` | `{ label, url }` shown on the intro card |
| `ambience` | Soundscapes: `{ "default": "countryside", "byCategory": { "battle": "battle" }, "scene": "battle" }`. `default` plays in the overview, `byCategory` on an event of that category, `scene` during an animated scene. Names are listed under *Sound* below |
| `music` | Background music mood: `celtic`, `roman`, `carthage`, `aztec` or `ww2` |

## events.json

An array. Order doesn't matter; the loader sorts by date.

```json
{
  "id": "bloody-sunday",
  "date": "1972-01-30",
  "title": "Bloody Sunday",
  "place": "Bogside, Derry",
  "coords": [54.9975, -7.3272],
  "zoom": 16,
  "category": "security",
  "deaths": 14,
  "summary": "What happened, in two or three sentences.",
  "significance": "Why it matters.",
  "wiki": "Bloody Sunday (1972)",
  "scene": "scene-id"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | URL-safe; used for deep links (`/#bloody-sunday`) |
| `date`, `title`, `place`, `coords`, `category`, `summary` | yes | `coords` is `[lat, lng]` |
| `zoom` | no | How close the camera flies. 7 = country, 13 = town, 16 = street |
| `deaths` | no | Sizes the dot and the timeline tick |
| `stat` | no | Free-text figure shown on the card instead of "N people killed", e.g. "Livy: 48,200 Romans killed. Polybius: 70,000" |
| `victor` | no | Faction key. Shows a "Victory: …" chip |
| `circa` | no | `true` shows the date as "c. 237 BC" |
| `seeAlso` | no | `{ "story": "punic-wars", "event": "cannae", "label": "Watch Cannae unfold" }` adds a link to the same moment in another story |
| `significance` | no | "Why it matters" box |
| `wiki` | no | English Wikipedia article title. Supplies the image and extract. If the title misses, a search is used |
| `questions` | no | Not used at the moment (kept for the archived chat) |
| `scene` | no | Key into `scenes.json`. Adds a "Watch it unfold" button and auto-plays during the tour |
| `ambience` | no | Soundscape for this event, overriding its category's, e.g. `"jungle"` for Cortés's landing on the Gulf coast |

The loader logs a console warning for missing ids, bad coordinates, unknown categories or unknown scenes.

## territories.geojson

A standard GeoJSON FeatureCollection. **GeoJSON coordinates are `[lng, lat]`**, the reverse of everywhere else.

Each feature's `properties`:

| Field | Notes |
|---|---|
| `id` | Unique |
| `faction` | Key into `story.factions` |
| `label` | Tooltip text |
| `from`, `to` | Date range when this area is held. `null` = open-ended |
| `minZoom`, `maxZoom` | Hide the shape outside this zoom band (e.g. hide a rough country outline when zoomed into a street) |
| `clip` | `"land"` trims the shape to the coastline (needs `landMask` in story.json). Draw the outline generously into the sea and let the clip do the coast |
| `layer` | `"top"` draws the feature above all others, whatever changes hands around it. Use for lakes, rivers, cities |
| `fillOpacity` | Per-feature (or per-period) override |

Features can be Polygons with holes (the Aztec Empire has holes for Tlaxcala, the Totonac coast and the Valley of Mexico, which are separate regions) or LineStrings (causeways, walls).

To show territory changing hands, either add one feature per faction per period with back-to-back date ranges, or (better for long stories) draw the region once and list its owners in `periods`:

```json
{ "type": "Feature",
  "properties": { "id": "aquitania", "label": "South-west Gaul", "clip": "land",
    "periods": [
      { "faction": "rome", "from": "-50", "to": "260" },
      { "faction": "gallic", "from": "260", "to": "274" },
      { "faction": "rome", "from": "274", "to": "395-01-17" },
      { "faction": "rome-west", "from": "395-01-17", "to": "418" },
      { "faction": "barbarian", "from": "418", "label": "Aquitania: Visigothic kingdom" } ] },
  "geometry": { ... } }
```

The tooltip reads "South-west Gaul: Gallic Empire" unless a period gives its own `label`. The Rome story's 48 regions are all drawn this way.

## City plans (data/cities/&lt;id&gt;.geojson)

A city plan is drawn when you zoom in past about level 12. Plans live in a shared folder so a city can appear in several stories; a story lists the ones it uses in `story.json`: `"cities": ["rome", "carthage"]`. Events within the city's `radiusKm` automatically get an *Explore the city* button. While zoomed into a plan, territory shading steps aside and the base map fades.

The file is a GeoJSON FeatureCollection with an extra `city` member:

```json
{ "type": "FeatureCollection",
  "city": { "id": "rome", "name": "Rome", "center": [41.893, 12.487], "zoom": 14, "radiusKm": 6,
            "wiki": "Ancient Rome", "summary": ["...", "..."], "note": "How it was reconstructed" },
  "features": [ ... ] }
```

Each feature's `properties`:

| Field | Notes |
|---|---|
| `id`, `name` | Required for anything clickable |
| `kind` | Sets the look (below) |
| `description` | String or array of paragraphs. Features with a description appear in the city guide |
| `wiki` | Wikipedia title for the place card image |
| `from`, `to` | Dates it existed. The plan redraws as the timeline moves |
| `minZoom`, `maxZoom` | Zoom range (default from 12). Give lakes and causeways a lower `minZoom` so they show from further out |
| `radiusM` | For Point features: drawn as a circle with this radius in metres (round temples, hills, towns, arenas) |
| `widthM` | Real width of a line in metres; it scales with zoom |
| `labelZoom`, `labelAt`, `showLabel` | When and where the name label appears |
| `zoom` | How close to fly when the place is picked from the guide |
| `images` | Gallery for the place card: `[{ "file": "Exact Commons file name.jpg", "caption": "..." }]`. Photos of museum models and reconstruction drawings work best. Credits and licences are pulled from Wikimedia Commons automatically |
| `ellipse` | For Point features: `[rx, ry, angle]` in metres and degrees, for oval buildings (the Colosseum, amphitheatres) |
| `innerM`, `count`, `gapDeg` | For `shipsheds`: a ring of `count` sheds from `innerM` to `radiusM`, leaving a `gapDeg` opening |
| `smooth` | `false` keeps a natural shape's corners sharp; `true` rounds off any shape (use it on a house fabric that copies a smoothed island) |
| `fabric` | Fill the area with generated blocks: `{ "w": 34, "h": 38, "gap": 8, "angle": 20 }` in metres. Blocks automatically keep clear of canals, roads, walls and named buildings. Add `"base"`, `"fill"`, `"stroke"` colours for things like chinampa strips between canals |

Kinds:

| Group | Kinds |
|---|---|
| Water | `sea`, `lake`, `lake-salt`, `river` (line), `canal` (line), `harbour`, `gap` (a breach in a causeway, line) |
| Ground | `land`, `island`, `town`, `hill`, `garden`, `chinampa`, `district`, `houses`, `rubble` |
| Routes | `road`, `causeway`, `bridge`, `aqueduct`, `aqueduct-cut`, `dike`, `wall` (all lines) |
| Buildings | `plaza`, `precinct`, `ruins`, `building`, `palace`, `temple`, `market`, `arena`, `baths`, `fort`, `tomb` |
| Harbours | `shipsheds` (a Point: radiating slipways) |
| Text | `label` (a Point with a name only, for quarters and districts) |

The `city` member can also carry a `gallery` in the same format as `images`, shown at the top of the city guide.

**Getting positions right.** Two tools help:
- Wikipedia's API returns coordinates for most ancient monuments: `https://en.wikipedia.org/w/api.php?action=query&prop=coordinates&titles=Colosseum|Circus_Maximus&format=json&origin=*` (try the French or Italian Wikipedia for smaller sites).
- In the app, zoom into a city and drag the *Then ⟷ Today* slider to about halfway: the plan sits over modern satellite imagery, so coastlines, harbours and surviving monuments can be lined up by eye. `atlas.map.containerPointToLatLng([x, y])` in the browser console turns a screen point into coordinates.

Shores, islands, hills and rivers are smoothed automatically, so a dozen hand-placed points make a natural outline.

### 3D cities

Set `"view3d": true` in the `city` member to offer *View in 3D* (Rome, Carthage and Tenochtitlan have it), and `"style3d"` to `"roman"` (default), `"punic"` or `"mexica"` to pick the house types and building colours. The 3D view uses the same file:

- **Houses** come from every `houses` or `rubble` feature with a `fabric`, and from `town` points with a `radiusM`. By default the area is cut into irregular street blocks; `"layout": "grid"` uses the fabric's `w`, `h`, `gap` and `angle` as a regular street grid instead. Each block becomes houses of the style: Roman insulae, shops and domus; Punic courtyard houses, tall houses and workshops; Mexica family compounds, noble houses and reed huts; or a garden. Blocks on a `hill` lean towards larger houses; districts with `outer` in their id, and towns, get more gardens. `"style"` on a fabric overrides the city's (Roman Carthage), and `"mix"` sets the shares, e.g. `{ "domus": 0.45, "insula": 0.25, "taberna": 0.2, "garden": 0.1 }`. `rubble` fabrics become low broken walls. `chinampa` fabrics become raised fields between canals, edged with willows; `garden` fabrics become orchards with a few villas. Houses disappear when a dated landmark is built over them.
- **Landmarks** get a `model`: `{ "type": "temple", "h": 24 }`. Types: `temple`, `tholos` (round temple), `pantheon`, `amphitheatre`, `circus`, `stadium`, `theatre`, `drum-tomb`, `baths`, `basilica`, `hall`, `market`, `palace`, `forum` (paved with porticoes), `plaza` (paving only), `precinct` (paved, walled; `minor` adds that many lesser temples round the edge), `fort`, `arch`, `column`, `altar`, `wall`, `aqueduct`, `bridge`, `garden`, `ruins`; for Mesoamerica `pyramid` (`twin` for two stairs and shrines), `round-pyramid`, `ballcourt`, `tzompantli`, `stalls` (market awnings), `causeway`, `dike`; for Carthage `shipsheds`, `admiral`, `tophet`, `cisterns`. Without a `model`, the `kind` picks one (`temple` becomes a temple, `baths` becomes baths, and so on). `h` is the height in metres. A Point can stand for a rectangle with `size: [length, width]` and `angle`. Extras: `facing` (compass bearing of a temple's front or a theatre's stage; temples otherwise face the nearest square), `columns`, `podium`, `inset`, `twoFronts`, `peripteral`, `squareBase`, `apse`, `towers` (wall tower spacing in metres), `bays` (1 or 3 for arches), `wallH` (forum and precinct walls), `courts` (a palace with that many courtyards in a row), `w` and `colour` (walls, dikes, aqueducts), `arcade: false` (an aqueduct channel without arches), `wood: true` (a timber causeway bridge; it spans the opening the 3D view cuts in the causeway at each `bridge` and `gap`).
- **Real outlines.** Give a feature `"osm": "way/123"` or `"relation/456"` (or a list) and run `python tools/osm_footprints.py data/cities/rome.geojson`. Its geometry is replaced by the OpenStreetMap outline, on the flat map too. Find ids at [openstreetmap.org](https://www.openstreetmap.org) with the query tool. OSM data is ODbL; the credit is added to the city file and shown on the 3D map.

Time tricks used in the existing plans: Tenochtitlan's `bridge` features end on `1520-06-25` and `gap` features start then; the `aqueduct` becomes `aqueduct-cut` on `1521-05-26`; Carthage's Punic districts end in `-145`, `rubble` covers `-145` to `-28`, then the Roman grid begins.

## scenes.json

Animated close-ups. Scene time runs from `0` to `duration` in whatever unit suits (days for a march, hours for a battle).

```json
{
  "scene-id": {
    "title": "Shown in the scene bar",
    "note": "Route and timings are approximate.",
    "duration": 4,
    "unitLabel": "Day",
    "playSeconds": 24,
    "view": { "bounds": [[south, west], [north, east]] },
    "tracks": [
      { "id": "marchers", "label": "Marchers", "color": "#5aa9ff",
        "keyframes": [ { "t": 0, "at": [lat, lng] }, { "t": 1.5, "at": [lat, lng] } ] }
    ],
    "markers": [
      { "t": 3.3, "until": 4, "at": [lat, lng], "label": "Ambush", "color": "#ff5252", "pulse": true }
    ],
    "captions": [
      { "t": 0, "text": "Narration shown from this moment until the next caption." }
    ]
  }
}
```

- **tracks**: a moving point (an army on campaign). Position is interpolated between keyframes and a trail is drawn behind it. Hold a position by repeating a keyframe at a later `t`. Give it `side` (a faction key) or `color`.
- **markers**: appear at `t` (and vanish at `until`, if set).
- **captions**: the latest caption with `t` ≤ now is shown.
- **dimMap**: `true` fades the base map so troops stand out.
- **cameras**: `[{ "t": 0, "bounds": [[s, w], [n, e]] }, { "t": 24.5, "bounds": ... }]` moves the camera as the scene plays, e.g. from the whole Gulf of Mexico to the march inland. In a local-metres scene use `"xy"` instead of `"bounds"`.

Stories shorter than four years get month labels on the timeline automatically.

### Battles: local metres, blocks and lines

**Following the land.** A keyframe can carry `via`: the waypoints (`[lat, lng]`, or `viaXy` in a battle frame) of the path taken to reach it, so a march bends along valleys and coasts instead of cutting straight across. You rarely type these by hand: set `"route": "road"` on a track and run `python tools/route_scenes.py data/stories/<id>/scenes.json`, which routes each leg along today's roads (OSRM, OpenStreetMap data) and stores the result. Per leg, `"route": "sea"` keeps hand-placed `via` points (smoothed, and the column becomes a ship) and `"route": "straight"` keeps a straight line.

**Figures.** Units and track heads are drawn as little figures in the faction colour: `spear`, `legionary`, `gaul`, `cavalry`, `light-cavalry`, `elephant`, `mexica`, `conquistador`, `canoe`, `ship`, `soldier`, `tank`, `para`, `marcher`, `camp`. Set `type` on a unit or track, or `figures` on the scene (`{ "rome": "legionary", "default": "soldier" }`); otherwise the label is used to guess (cavalry, canoes, fleet, panzers, airborne). A battle unit's footprint fills with rows of figures that thin out as its `strength` falls. Tracks also take `army`, `army-elephants` and `conquistadors` for a mixed marching column.

Battle layouts are much easier in metres than in lat/lng. Give the scene a `frame.origin` and write positions as `"xy": [metres east, metres north]`. The loader converts them. `view.xy` sets the camera box in the same units.

```json
"frame": { "origin": [41.322, 16.105] },
"view": { "xy": [[-1750, -650], [1750, 1150]] },
"lines": [ { "label": "River Aufidus", "xy": [[-1700, -900], [-1640, 1500]] } ],
"units": [
  { "id": "rom-inf-c", "label": "Roman infantry", "side": "rome", "w": 600, "d": 220,
    "keyframes": [
      { "t": 0, "xy": [0, 350], "angle": 180 },
      { "t": 3, "xy": [0, -180], "w": 520, "d": 260 },
      { "t": 6, "xy": [0, -290], "strength": 0.3 }
    ] }
]
```

**units** are blocks of troops drawn as rotated rectangles with a white front edge.

| Keyframe field | Meaning |
|---|---|
| `xy` / `at` | Centre of the block |
| `angle` | Direction it faces, degrees clockwise from north (180 = facing south) |
| `w`, `d` | Frontage and depth in metres. Shrink them to show a formation being compressed |
| `strength` | 1 = full, 0 = gone. Fades the block to show it breaking or fleeing |

Each keyframe lists only what changes; everything else carries forward. Angles turn the short way round. Add `"trail": true` to draw the unit's path (Hasdrubal's ride round the Roman rear).

**lines** are static features such as rivers or walls. `dash` (e.g. `"6 6"`) draws them dashed, as for the Aztec aqueduct. Close a ring by repeating the first point (the Alesia siege walls). `labelIndex` picks which point carries the label, so labels don't collide.

Unit names sit just above their block. Remember that strength is interpolated: to make a unit appear suddenly at `t: 4.5`, give it `strength: 0` at `t: 4.4` as well as at `t: 0`.

## Sound

The *Sound* button in the timeline bar controls narration, the soundscape and the music. Nothing plays until the first click, as browsers require.

- **Narration** reads each event aloud (date, title, summary, why it matters) with the browser's own voices; the tour waits for the voice to finish. Opening a city or a place reads its description.
- **Soundscapes** are synthesised in the browser, so there are no sound files to license or host. Names: `countryside`, `highlands`, `jungle`, `lake`, `sea`, `harbour`, `city`, `lake-city`, `market`, `battle`, `conquest-battle` (drums, conch shells, the odd gunshot), `naval`, `siege`, `march`, `war`, `air-raid`, `town`, `quiet`, `sombre` (near silence, no music), `urban`, `tense-urban` (helicopters and sirens, no gunfire), `protest`, `silence`.
- **Choosing a soundscape**: inside a city, the city file's `"ambience"` in its `city` member (default `city`); during an animated scene, the story's `ambience.scene`; on an event, the event's `ambience`, then `ambience.byCategory`; otherwise `ambience.default`.
- **Music** follows `story.music` and is muted for `sombre` and `silence`.

Choose sounds with care for recent or painful events: the Troubles uses patrols and sirens rather than gunfire, and Holocaust events are `sombre`.
