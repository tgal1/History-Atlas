"""Record the narration with Kokoro, an open-source voice model (Apache 2.0).

Renders every event, city guide and landmark description as a small MP3 per
voice, so every visitor hears the same studio voice in any browser:

    audio/narration/<voice>/events/<story>/<event-id>.mp3
    audio/narration/<voice>/cities/<city>/_city.mp3 and <feature-id>.mp3
    audio/narration/<voice>/manifest.json   { "events/rome/founding": "<text hash>", ... }

Only new or changed text is re-rendered, so it is quick to re-run after
editing a story. The site plays a recording when the manifest lists it and
falls back to the browser's own voice otherwise.

Needs Python 3.10-3.12 with:  pip install "kokoro>=0.9.4" soundfile lameenc
    python tools/render_narration.py                 # all voices, everything
    python tools/render_narration.py bm_george       # one voice
"""

import glob
import hashlib
import json
import os
import re
import sys
import time

import lameenc
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio", "narration")
VOICES = {"bm_george": "b", "af_heart": "a"}  # voice -> Kokoro language ('b' British, 'a' American)
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
DATE_RE = re.compile(r"^(-?\d{1,6})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# Keep in step with spokenDate() in js/core/time.js.
def spoken_date(ev, ad):
    m = DATE_RE.match(str(ev["date"]).strip())
    year = int(m.group(1))
    label = f"{1 - year} BC" if year <= 0 else (f"AD {year}" if ad else str(year))
    if m.group(3):
        text = f"{int(m.group(3))} {MONTHS[int(m.group(2)) - 1]} {label}"
    elif m.group(2):
        text = f"{MONTHS[int(m.group(2)) - 1]} {label}"
    else:
        text = label
    return f"Around {text}" if ev.get("circa") else text


def paragraphs(x):
    return " ".join(x if isinstance(x, list) else [x or ""])


def texts():
    """Everything the site narrates, keyed by the path its recording lives at."""
    items = {"_test": "This is how I will narrate the story."}
    for story_dir in sorted(glob.glob(os.path.join(ROOT, "data", "stories", "*"))):
        sid = os.path.basename(story_dir)
        story = load(os.path.join(story_dir, "story.json"))
        ad = bool(story.get("calendar", {}).get("ad"))
        events = load(os.path.join(story_dir, story.get("files", {}).get("events", "events.json")))
        events = events["events"] if isinstance(events, dict) else events
        for ev in events:
            # Keep in step with narrateEvent() in js/main.js.
            items[f"events/{sid}/{ev['id']}"] = " ".join(
                [f"{spoken_date(ev, ad)}. {ev['title']}.", ev["summary"], ev.get("significance") or ""]).strip()
    for path in sorted(glob.glob(os.path.join(ROOT, "data", "cities", "*.geojson"))):
        fc = load(path)
        city = fc["city"]
        items[f"cities/{city['id']}/_city"] = f"{city['name']}. {paragraphs(city.get('summary'))}"
        for f in fc["features"]:
            p = f["properties"]
            if p.get("id") and p.get("name") and p.get("description"):
                items[f"cities/{city['id']}/{p['id']}"] = f"{p['name']}. {paragraphs(p['description'])}"
    return items


def to_mp3(audio, rate=24000):
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    return enc.encode(pcm) + enc.flush()


def render(voice):
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code=VOICES[voice], repo_id="hexgrad/Kokoro-82M")
    vdir = os.path.join(OUT, voice)
    manifest_path = os.path.join(vdir, "manifest.json")
    manifest = load(manifest_path) if os.path.exists(manifest_path) else {}
    items = texts()
    todo = {k: t for k, t in items.items() if manifest.get(k) != digest(t) or not os.path.exists(os.path.join(vdir, k + ".mp3"))}
    print(f"{voice}: {len(items)} texts, {len(todo)} to render")
    started = time.time()
    for i, (key, text) in enumerate(todo.items(), 1):
        chunks = [audio.numpy() if hasattr(audio, "numpy") else audio for _, _, audio in pipeline(text, voice=voice, speed=1.0)]
        audio = np.concatenate(chunks) if chunks else np.zeros(2400, dtype=np.float32)
        out = os.path.join(vdir, key + ".mp3")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "wb") as f:
            f.write(to_mp3(audio))
        manifest[key] = digest(text)
        if i % 10 == 0 or i == len(todo):
            save(manifest_path, manifest)
            print(f"  {i}/{len(todo)}  {time.time() - started:.0f}s", flush=True)
    # Forget recordings whose text no longer exists.
    for key in [k for k in manifest if k not in items]:
        del manifest[key]
        try:
            os.remove(os.path.join(vdir, key + ".mp3"))
        except FileNotFoundError:
            pass
    save(manifest_path, manifest)


def digest(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), sort_keys=True)


if __name__ == "__main__":
    for v in sys.argv[1:] or VOICES:
        render(v)
