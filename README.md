# History Atlas

Interactive history told on a map. Scrub through time, watch events appear where they happened, fly in for close-ups, play animated scenes (marches, battles), and explore drawn plans of ancient cities.

| Story | Events | Animated scenes |
|---|---|---|
| **The Troubles**, Northern Ireland 1966–1998 | 47 | Belfast–Derry march, 1969 |
| **Rome v Carthage**, the Punic Wars 264–146 BC | 33 | Hannibal's march over the Alps; the Battle of Cannae |
| **Rise and fall of Rome**, 753 BC – AD 476 | 54 | The Siege of Alesia |
| **Cortés and the Aztecs**, 1519–1522 | 27 | The march from Cuba to Tenochtitlan; La Noche Triste; the siege of Tenochtitlan |
| **Second World War in Europe**, 1939–1945 | 57 | The Fall of France; Operation Barbarossa; Stalingrad; D-Day |
| **The American Revolution**, 1765–1783 | 60 | The march to Yorktown; the Battle of Cowpens |
| **The First World War**, 1914–1919 | 69 | The Western Front in 1914, from the Schlieffen Plan to the race to the sea; the first day of the Somme |

**City plans.** Zoom into Tenochtitlan, Rome or Carthage (or press *Explore the city* on an event there) and the map turns into a drawn plan of the city at that date: lakes, canals, causeways and bridges, walls, temples, palaces, markets, hills and street blocks. Click anything for a card with a description and a gallery of reconstructions (photos of museum models such as Gismondi's model of imperial Rome, the Tenochtitlan models at the Templo Mayor and the Carthage museum's harbour model, plus historic maps), viewable full screen with credits. The city guide in the panel lists the landmarks. The *Then ⟷ Today* slider blends the ancient plan with modern satellite imagery. Scrub the timeline and the city changes: the Colosseum appears in AD 80, Tenochtitlan's bridges are pulled up in June 1520, Carthage burns in 146 BC and a Roman grid rises on its ruins.

Switch stories with the picker in the top-left, or `?story=punic-wars`, `?story=rome`, `?story=aztecs`, `?story=ww2-europe`, `?story=american-revolution` or `?story=ww1` in the URL. Events shared between stories link across (Cannae in the Rome story opens the full battle in Rome v Carthage).

## Run it

Needs Python 3 (no build step, no npm install).

```bash
python history-atlas/tools/serve.py
```

Open http://127.0.0.1:8765. Opening `index.html` directly from disk will not work, because browsers block module and data loading from `file://`.

## Using it

| Control | What it does |
|---|---|
| Play / Space | Guided tour. The clock runs, the map flies to each event, holds, then moves on |
| Timeline drag | Scrub through time. Dots appear and fade; shaded territories change |
| ◀◀ ▶▶ / arrow keys | Previous / next event. During the tour, ▶▶ skips the wait |
| Stop at events | Off = the clock runs straight through without pausing |
| Watch it unfold | Plays the event's animated scene (e.g. the Belfast–Derry march) |
| Esc | Deselect and fly back out |
| `#event-id` in the URL | Deep link to an event, e.g. `/#bloody-sunday` |
| Stories & cities | Menu to switch story or jump straight into a city |
| View in 3D | Rome, Carthage and Tenochtitlan as 3D cities with terrain, landmark models and generated houses. Right-drag or Ctrl+drag to tilt and turn |
| Sound | Narration (studio voices recorded with Kokoro, or your browser's own), a soundscape for where you are (calm Mediterranean shore, jungle, harbour, air raid...), music to suit each story, and battle sounds that follow the animation (hooves, marching, clashing blades, musket volleys) |
| `?story=rome&city=rome&t=150&view=3d` | Deep link to a city at a date, optionally in 3D |

## Project layout

```
history-atlas/
├── index.html                 Page shell: map, HUD, panel, timeline
├── css/
│   ├── base.css               Tokens, layout, buttons, HUD
│   ├── map.css                Dots, pulse, labels, scene units, legend, scene bar
│   ├── panel.css              Event card, intro, city guide, galleries
│   └── timeline.css           Controls and scrubbable track
├── js/
│   ├── main.js                Boots a story and wires modules together
│   ├── core/
│   │   ├── time.js            Decimal-year dates (handles BC)
│   │   ├── store.js           Shared state + subscriptions
│   │   └── player.js          Clock and tour stepping
│   ├── data/loader.js         Loads and validates a story bundle
│   ├── map/
│   │   ├── basemaps.js        Tile styles (slate, OSM, parchment relief for ancient maps)
│   │   ├── mapView.js         Leaflet setup + awaitable camera moves
│   │   ├── eventLayer.js      Event dots that appear and fade over time
│   │   ├── territoryLayer.js  Who-controls-what polygons with date ranges
│   │   ├── landMask.js        Clips territory outlines to the real coastline
│   │   ├── cityLayer.js       Drawn city plans: styles, generated street blocks, dates, clicks
│   │   ├── labelLayer.js      Story-specific place labels
│   │   ├── scenePlayer.js     Animated scenes: marching armies and battle formations
│   │   └── unitIcons.js       Little figures for scene units: soldiers, riders, canoes, tanks
│   ├── audio/                 Narration, synthesised soundscapes and music (Web Speech + Web Audio)
│   ├── map3d/                 3D city view (MapLibre GL, loaded on demand)
│   │   ├── city3d.js          Terrain, layers, time filter, clicks, Then/Today
│   │   ├── models.js          Landmark recipes: temples, amphitheatres, baths, walls...
│   │   ├── houses.js          Generated streets and houses (insulae, domus, shops, gardens)
│   │   └── geom.js            Metres frame, oriented boxes, rings, seeded randomness
│   ├── ui/
│   │   ├── timeline.js        Eras, intensity strip, ticks, playhead
│   │   ├── eventPanel.js      Intro and event cards
│   │   ├── menu.js            Start menu: stories and cities
│   │   ├── audioPanel.js      Sound button and settings pop-up
│   │   ├── sceneBar.js        Scene play / scrub / caption
│   │   ├── lightbox.js        Full-screen image viewer for galleries
│   │   └── legend.js          Map key
│   └── services/
│       ├── wikipedia.js       Lead image + extract per event
│       └── commons.js         Reconstruction images and credits from Wikimedia Commons
├── data/
│   ├── catalog.json           Stories and cities shown in the menu
│   ├── cities/                City plans shared between stories
│   │   ├── tenochtitlan.geojson
│   │   ├── rome.geojson
│   │   └── carthage.geojson
│   └── stories/
│       ├── troubles/
│       │   ├── story.json     Metadata, chapters, categories, factions, intro
│       │   ├── events.json    The events
│       │   ├── territories.geojson  Controlled areas over time
│       │   └── scenes.json    Animated close-ups
│       ├── punic-wars/        Same four files for Rome v Carthage
│       ├── rome/              Same four files for the Rise and fall of Rome
│       ├── aztecs/            Same four files for Cortés and the Aztecs
│       ├── ww2-europe/        Same four files for the Second World War in Europe
│       ├── american-revolution/  Same four files for the American Revolution
│       └── ww1/               Same four files for the First World War
├── archive/
│   └── ask-chat/              The 'Ask the guide' chat, removed for now (see its README)
├── docs/
│   └── DATA_FORMAT.md         How to write a new story
└── tools/
    ├── serve.py               No-cache local dev server
    ├── osm_footprints.py      Refreshes monument outlines from OpenStreetMap
    ├── route_scenes.py        Routes scene marches along roads (OSRM)
    └── render_narration.py    Records the narration with Kokoro voices
```

The engine knows nothing about Ireland or Rome. Everything story-specific lives in `data/stories/<id>/`. A new story is a new folder plus its `status` set to `"ready"` in `catalog.json`. See [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md).

## External services

| Service | Used for | Key needed |
|---|---|---|
| Leaflet 1.9.4 (unpkg) | Map library | No |
| Esri basemap tiles | Slate map with labels; shaded relief for ancient stories | No |
| Natural Earth land (world-atlas 2.0.2), topojson-client 3.1.0, polygon-clipping 0.15.7 | Clipping territories to the coastline | No |
| Wikipedia REST API | Event images and extracts | No |
| Wikimedia Commons API | Reconstruction galleries and credits | No |
| Esri World Imagery | Satellite view for *Then ⟷ Today* | No |
| MapLibre GL JS 5.6.0 (unpkg) | 3D city view | No |
| AWS Terrain Tiles (Terrarium) | Elevation for the 3D hills | No |
| OpenStreetMap (via `tools/osm_footprints.py`, offline) | Real outlines of surviving monuments, ODbL, credited on the map | No |

Narration uses the browser's built-in voices and soundscapes are synthesised with the Web Audio API. Music is by Kevin MacLeod (incompetech.com), licensed under Creative Commons Attribution 4.0 ("Teller of the Tales", "Anguish", "Ancient Rite", "Return of the Mummy", "Night of the Owl", "Thunderhead", "Moorland", "Errigal", "Decline", "Fife and Drum", "Americana", "Night Vigil"), plus two Chopin polonaise recordings streamed from Wikimedia Commons (public domain, and CC0). Studio narration is recorded with Kokoro (Apache 2.0) by `tools/render_narration.py`. Nothing needs an API key, so the folder can be hosted as-is on any static host (Cloudflare Pages, GitHub Pages, Netlify). Check Esri's terms of use before a public launch.

## Performance

Dots, territories and battle blocks are drawn on canvas rather than SVG. Event dots are only restyled when their fade step changes, tiles aren't fetched mid-flight, and there are no blur effects over the moving map. The Cannae scene runs at 60fps in Chrome.

## Accuracy notes

- In the 3D city, landmarks use real outlines where they survive, with heights from the literature; their details (column counts, roof pitch) are generic. Ordinary houses are generated, so the street plan is plausible, not surveyed.

- Event text is written for this project and kept short. Dates and death tolls follow standard sources (CAIN, Polybius, Livy, Wikipedia); the deaths-per-year strip is approximate.
- Inland borders (the Irish border, Free Derry, every Punic Wars territory) are hand-drawn approximations, clipped to the real coastline. Ancient borders were fuzzy anyway; treat them as a guide.
- Ancient numbers are the ancient historians' own, and say so.
- Scene routes and the Cannae layout are reconstructions and are labelled as such. The Cannae site and orientation are debated.

## Next steps

1. More battle scenes: Zama, Lake Trasimene, Teutoburg, Adrianople all fit the existing unit format.
2. Fleets for the sea battles (Mylae, Actium): ship units are just narrow blocks.
3. A zoomable timeline, so a 1,200-year story can be scrubbed century by century.
4. Bring back the *Ask the guide* chat behind a small server that holds the API key (see `archive/ask-chat/README.md`).

## Debugging a story

With the site open, `atlas` in the browser console holds the loaded story, events, scenes, store, Leaflet map and scene player. For example, `atlas.scenePlayer.seek(0.5)` jumps a playing scene to halfway.
