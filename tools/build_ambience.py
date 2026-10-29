"""Builds the recorded soundscapes in audio/ambience from public field recordings.

Beds are long, steady recordings (birdsong, surf, a crowd, distant guns) cut
into seamless loops: the steadiest stretch of each source is taken, its ends
crossfaded, and its loudness normalised so every bed sits at the same level.
Spots are short one-shots (a cow, a bell, a sword clash) cut from their
sources, which the player drops in at random.

Every source is CC0: BigSoundBank (bigsoundbank.com) unless marked as
Freesound. audio/ambience/SOURCES.md lists them all.

Needs Python 3.10+ with:  pip install numpy soundfile lameenc
    python tools/build_ambience.py            # everything
    python tools/build_ambience.py walla cow  # just these
"""

import os
import sys
import urllib.request

import lameenc
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "audio", "ambience")
CACHE = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~/.cache")), "history-atlas-ambience")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"

BED_RMS = 0.05    # every bed is normalised to this loudness (-26 dBFS)
SPOT_RMS = 0.1    # the loudest half-second of every spot is normalised to this
FADE = 3.0        # loop crossfade, seconds
PAD = 0.25        # wrap-around added to each end of a loop (js/audio/soundscapes.js BED_PAD)

# ---------- Sources ----------
# key -> (title, author, page). BigSoundBank keys are their sound numbers; Freesound keys start "fs".
SOURCES = {
    "0912": ("Campaign Morning", "BigSoundBank", "https://bigsoundbank.com/campaign-morning-s0912.html"),
    "1906": ("Birds Waking #4", "BigSoundBank", "https://bigsoundbank.com/birds-waking-4-s1906.html"),
    "0908": ("Wind in Tall Grass", "BigSoundBank", "https://bigsoundbank.com/wind-in-tall-grass-s0908.html"),
    "3203": ("Mountain, Evening #1", "BigSoundBank", "https://bigsoundbank.com/mountain-evening-1-s3203.html"),
    "0691": ("Pond in a Field", "BigSoundBank", "https://bigsoundbank.com/pond-in-a-field-s0691.html"),
    "1448": ("Small Waves and Beach #2", "BigSoundBank", "https://bigsoundbank.com/small-waves-and-beach-2-s1448.html"),
    "2397": ("Cicada 1, Long", "BigSoundBank", "https://bigsoundbank.com/cicada-1-long-s2397.html"),
    "0698": ("Sea Waves", "BigSoundBank", "https://bigsoundbank.com/sea-waves-s0698.html"),
    "1444": ("Pontoon, Marina", "BigSoundBank", "https://bigsoundbank.com/pontoon-marina-s1444.html"),
    "2968": ("Outside Talks #1", "BigSoundBank", "https://bigsoundbank.com/outside-talks-1-s2968.html"),
    "0130": ("Flea #1", "BigSoundBank", "https://bigsoundbank.com/flea-1-s0130.html"),
    "0989": ("Big Branching Fire #3", "BigSoundBank", "https://bigsoundbank.com/big-branching-fire-3-s0989.html"),
    "1117": ("Footsteps on Gravels #2", "BigSoundBank", "https://bigsoundbank.com/footsteps-on-gravels-2-s1117.html"),
    "0641": ("London Street", "BigSoundBank", "https://bigsoundbank.com/london-street-s0641.html"),
    "2458": ("Sound Atmosphere in a House", "BigSoundBank", "https://bigsoundbank.com/sound-atmosphere-in-a-house-s2458.html"),
    "0546": ("Cow Moos #1", "BigSoundBank", "https://bigsoundbank.com/cow-moos-1-s0546.html"),
    "2383": ("Cow Moos #3", "BigSoundBank", "https://bigsoundbank.com/cow-moos-3-s2383.html"),
    "0104": ("Rooster", "BigSoundBank", "https://bigsoundbank.com/rooster-s0104.html"),
    "0859": ("Neighing Horse #2", "BigSoundBank", "https://bigsoundbank.com/neighing-horse-2-s0859.html"),
    "1542": ("Horse Neighing #5", "BigSoundBank", "https://bigsoundbank.com/horse-neighing-5-s1542.html"),
    "1854": ("Horse Walking on a Path", "BigSoundBank", "https://bigsoundbank.com/horse-walking-on-a-path-s1854.html"),
    "1850": ("Horse Gallop, Tall Grass", "BigSoundBank", "https://bigsoundbank.com/horse-gallop-tall-grass-s1850.html"),
    "2353": ("Old Dog Barking #2", "BigSoundBank", "https://bigsoundbank.com/old-dog-barking-2-s2353.html"),
    "1551": ("Donkey, Braying #3", "BigSoundBank", "https://bigsoundbank.com/donkey-braying-3-s1551.html"),
    "3464": ("Carrion Crow #4", "BigSoundBank", "https://bigsoundbank.com/carrion-crow-4-s3464.html"),
    "0754": ("Crows #1", "BigSoundBank", "https://bigsoundbank.com/crows-1-s0754.html"),
    "0830": ("1 Church Bell", "BigSoundBank", "https://bigsoundbank.com/1-church-bell-s0830.html"),
    "3589": ("Anvil #1", "BigSoundBank", "https://bigsoundbank.com/anvil-1-s3589.html"),
    "0005": ("Nail and Hammer #1", "BigSoundBank", "https://bigsoundbank.com/nail-and-hammer-1-s0005.html"),
    "0559": ("Saw Wood", "BigSoundBank", "https://bigsoundbank.com/saw-wood-s0559.html"),
    "3420": ("Rope #1", "BigSoundBank", "https://bigsoundbank.com/rope-1-s3420.html"),
    "3421": ("Rope #2", "BigSoundBank", "https://bigsoundbank.com/rope-2-s3421.html"),
    "3422": ("Rope #3", "BigSoundBank", "https://bigsoundbank.com/rope-3-s3422.html"),
    "2573": ("Gulls on the Harbor", "BigSoundBank", "https://bigsoundbank.com/gulls-on-the-harbor-s2573.html"),
    "1529": ("Splash, Small #1", "BigSoundBank", "https://bigsoundbank.com/splash-small-1-s1529.html"),
    "1514": ("Rowing Slowly", "BigSoundBank", "https://bigsoundbank.com/rowing-slowly-s1514.html"),
    "1762": ("Screaming Piha", "BigSoundBank", "https://bigsoundbank.com/screaming-piha-s1762.html"),
    "0821": ("Small Herd of Goats", "BigSoundBank", "https://bigsoundbank.com/small-herd-of-goats-s0821.html"),
    "1023": ("Explosion Far Away #1", "BigSoundBank", "https://bigsoundbank.com/explosion-far-away-1-s1023.html"),
    "2853": ("Rifle: Shot #1", "BigSoundBank", "https://bigsoundbank.com/rifle-shot-1-s2853.html"),
    "2854": ("Rifle: Shot #2", "BigSoundBank", "https://bigsoundbank.com/rifle-shot-2-s2854.html"),
    "2478": ("Passage of Small Propeller Plane", "BigSoundBank", "https://bigsoundbank.com/passage-of-small-propeller-plane-s2478.html"),
    "3004": ("Airplane, Pass #1", "BigSoundBank", "https://bigsoundbank.com/airplane-pass-1-s3004.html"),
    "3008": ("Airplane, Pass #5", "BigSoundBank", "https://bigsoundbank.com/airplane-pass-5-s3008.html"),
    "0861": ("Two Helicopters Flying", "BigSoundBank", "https://bigsoundbank.com/two-helicopters-flying-s0861.html"),
    "0886": ("Gendarmerie, Outdoor Siren", "BigSoundBank", "https://bigsoundbank.com/gendarmerie-outdoor-siren-s0886.html"),
    "3259": ("National Alert Signal", "BigSoundBank", "https://bigsoundbank.com/national-alert-signal-s3259.html"),
    "fs195193": ("LargeWoodenShip", "PimFeijen (Freesound)", "https://freesound.org/people/PimFeijen/sounds/195193/"),
    "fs653743": ("Peruvian Amazon birds frogs daytime", "nonamethefish (Freesound)", "https://freesound.org/people/nonamethefish/sounds/653743/"),
    "fs384401": ("Crowd/Mob/Riot Noise (Voices Only)", "FillMat (Freesound)", "https://freesound.org/people/FillMat/sounds/384401/"),
    "fs751279": ("Shotgun, multiple shots (war scene ambience distant)", "Julien_Matthey (Freesound)", "https://freesound.org/people/Julien_Matthey/sounds/751279/"),
    "fs320788": ("distant explosions", "Kostrava (Freesound)", "https://freesound.org/people/Kostrava/sounds/320788/"),
    "fs453867": ("crowd ext large after parade, yelling", "kyles (Freesound)", "https://freesound.org/people/kyles/sounds/453867/"),
    "fs631829": ("old horse drawn carriage drives past", "Garuda1982 (Freesound)", "https://freesound.org/people/Garuda1982/sounds/631829/"),
    "fs658736": ("Sword Clashes (Assorted)", "courter (Freesound)", "https://freesound.org/people/courter/sounds/658736/"),
    "fs563011": ("People screaming in agony when charging into battle", "florianreichelt (Freesound)", "https://freesound.org/people/florianreichelt/sounds/563011/"),
    "fs764049": ("Crowd Yells Charge, Continues", "ShangusBurger (Freesound)", "https://freesound.org/people/ShangusBurger/sounds/764049/"),
}
# Freesound previews (the 128 kbps copies Freesound serves to every visitor).
FS_PREVIEW = {
    "fs195193": "195/195193_1731095", "fs653743": "653/653743_8323061", "fs384401": "384/384401_3252134",
    "fs751279": "751/751279_1535323", "fs320788": "320/320788_1134415", "fs453867": "453/453867_612689",
    "fs631829": "631/631829_2061858", "fs658736": "658/658736_1224849", "fs563011": "563/563011_6253486",
    "fs764049": "764/764049_11744683",
}

# ---------- Beds ----------
# name -> (source, loop seconds, options). Options: start (seconds; otherwise the
# steadiest stretch is found), hp / lp (filter corners in Hz), compress (tame peaks).
BEDS = {
    "fields": ("0912", 60, {"hp": 60}),        # meadow at dawn: birds, a light wind
    "birds": ("1906", 60, {"hp": 120}),        # dawn chorus
    "wind": ("0908", 60, {"hp": 40}),          # wind in tall grass
    "mountain": ("3203", 60, {"hp": 50}),      # mountain evening: stream, distant cowbells
    "pond": ("0691", 60, {"hp": 80}),          # pond in a field: frogs, birds
    "beach": ("1448", 60, {}),                 # small waves on sand
    "cicadas": ("2397", 50, {}),
    "surf": ("0698", 60, {}),                  # Atlantic waves
    "lapping": ("1444", 60, {"hp": 60, "compress": True}),       # water against a wooden pontoon
    "ship": ("fs195193", 75, {}),              # creaking wooden ship at sea
    "walla": ("2968", 75, {"hp": 90}),         # a hundred people talking outdoors
    "market": ("0130", 60, {"hp": 90}),        # flea market voices
    "jungle": ("fs653743", 50, {}),            # Amazon forest: birds, rain frogs
    "mob": ("fs384401", 75, {"hp": 80}),       # an angry crowd, voices only
    "fire": ("0989", 45, {"hp": 50, "compress": True}),          # big fire
    "footsteps": ("1117", 60, {"hp": 60, "compress": True}),     # many feet on gravel
    "gunfire": ("fs751279", 75, {"compress": True}),           # distant shots, a firing range
    "shelling": ("fs320788", 55, {"compress": True}),          # distant explosions
    "street": ("0641", 60, {"hp": 50}),        # London street
    "room": ("2458", 60, {"hp": 150}),         # room tone in a house
    "window": ("1906", 60, {"start": 120, "hp": 200, "lp": 2500}),  # birdsong heard through a window
    "rally": ("fs453867", 75, {"hp": 70}),     # large crowd yelling after a parade
}

# ---------- Spots ----------
# name -> list of (source, options). Options: events (cut each sound out
# automatically, up to n of them), at (explicit [start, length] pairs), max
# (longest clip, seconds), hp / lp.
SPOTS = {
    "cow": [("0546", {"events": 3}), ("2383", {"events": 1})],
    "rooster": [("0104", {"events": 1, "max": 6})],
    "neigh": [("0859", {"events": 2}), ("1542", {"events": 1})],
    "hooves": [("1854", {"at": [[2, 9], [18, 9], [33, 9]]})],
    "gallop": [("1850", {"at": [[0, 9], [14, 9], [26, 9]]})],
    "carriage": [("fs631829", {"at": [[0, 22]]})],
    "dog": [("2353", {"events": 2, "max": 5})],
    "donkey": [("1551", {"events": 1, "max": 9})],
    "crows": [("3464", {"events": 2, "max": 5}), ("0754", {"events": 3, "max": 6})],
    "bell": [("0830", {"at": [[5, 12], [40, 12]]})],
    "anvil": [("3589", {"at": [[0, 5], [10, 5], [22, 5]]})],
    "hammer": [("0005", {"at": [[0, 6]]})],
    "saw": [("0559", {"at": [[0, 10]]})],
    "rope": [("3420", {"events": 1}), ("3421", {"events": 1}), ("3422", {"events": 1})],
    "gull": [("2573", {"events": 4, "max": 4, "hp": 400})],
    "splash": [("1529", {"events": 1})],
    "oars": [("1514", {"at": [[2, 8], [20, 8], [40, 8]]})],
    "piha": [("1762", {"events": 1})],
    "goatbells": [("0821", {"at": [[5, 10], [30, 10], [55, 10]]})],
    "boom": [("1023", {"events": 1, "max": 5})],
    "rifle": [("2853", {"events": 1}), ("2854", {"events": 1})],
    "plane": [("2478", {"at": [[0, 16]]}), ("3004", {"at": [[0, 11]]}), ("3008", {"at": [[0, 10]]})],
    "heli": [("0861", {"at": [[5, 25], [35, 25]]})],
    "siren-2tone": [("0886", {"at": [[2, 9]]})],
    "siren": [("3259", {"at": [[0, 40]]})],
    "swords": [("fs658736", {"events": 8, "max": 3})],
    "warcry": [("fs563011", {"at": [[0, 9], [9, 9]]}), ("fs764049", {"at": [[0, 11]]})],
}


# ---------- Audio helpers ----------
def fetch(key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{key}.mp3")
    if not os.path.exists(path):
        url = (f"https://cdn.freesound.org/previews/{FS_PREVIEW[key]}-hq.mp3" if key.startswith("fs")
               else f"https://bigsoundbank.com/UPLOAD/mp3/{key}.mp3")
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://bigsoundbank.com/"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as f:
            f.write(r.read())
        os.replace(path + ".part", path)
    data, rate = sf.read(path, always_2d=True, dtype="float32")
    return data, rate


def band(x, rate, hp=None, lp=None):
    """Brick-wall-free filtering in the frequency domain, with soft 1-octave slopes."""
    if not hp and not lp:
        return x
    spec = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / rate)
    g = np.ones_like(f)
    if hp:
        g *= np.clip(np.log2(np.maximum(f, 1) / (hp / 2)), 0, 1)
    if lp:
        g *= np.clip(np.log2((lp * 2) / np.maximum(f, 1)), 0, 1)
    return np.fft.irfft(spec * g[:, None], n=len(x), axis=0).astype(np.float32)


def window_rms(mono, rate, win):
    n = int(rate * win)
    k = len(mono) // n
    return np.sqrt((mono[: k * n].reshape(k, n) ** 2).mean(1)) + 1e-9


def steadiest(x, rate, seconds):
    """Start of the stretch whose loudness varies least (no passing cars, no sudden bangs)."""
    db = 20 * np.log10(window_rms(x.mean(1), rate, 1.0))
    need = int(seconds) + 1
    if len(db) <= need:
        return 0.0
    scores = [np.std(db[i:i + need]) + 0.5 * max(0, db[i:i + need].max() - np.median(db[i:i + need]) - 6)
              for i in range(len(db) - need + 1)]
    return float(np.argmin(scores))


def compress(x, rate, above=6.0, ratio=4.0):
    """Pulls peaks more than `above` dB over the average down, so single shots or knocks don't jump out."""
    mono = np.abs(x).max(1)
    hold = int(rate * 0.02)
    k = len(mono) // hold
    peaks = np.repeat(mono[: k * hold].reshape(k, hold).max(1), hold)
    peaks = np.concatenate([peaks, np.full(len(mono) - len(peaks), peaks[-1] if len(peaks) else 0)])
    smooth = int(rate * 0.15)
    env = np.convolve(peaks, np.ones(smooth) / smooth, mode="same") + 1e-9
    threshold = np.sqrt((x ** 2).mean()) * 10 ** (above / 20)
    g = np.minimum(1, (threshold / env) ** (1 - 1 / ratio))
    return (x * g[:, None]).astype(np.float32)


def make_loop(x, rate, seconds, start):
    n, fade = int(seconds * rate), int(FADE * rate)
    seg = x[int(start * rate): int(start * rate) + n + fade]
    if len(seg) < n + fade:
        raise ValueError(f"source too short for a {seconds}s loop from {start}s")
    t = np.linspace(0, np.pi / 2, fade, dtype=np.float32)[:, None]
    loop = seg[:n].copy()
    # The tail that runs past the loop point fades into the head, so the end flows back into the start.
    loop[:fade] = seg[:fade] * np.sin(t) + seg[n:n + fade] * np.cos(t)
    return loop


def encode(x, rate, kbps):
    x = np.clip(x, -1, 1)
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(rate)
    enc.set_channels(x.shape[1])
    enc.set_quality(2)
    pcm = (x * 32767).astype("<i2").tobytes()
    return enc.encode(pcm) + enc.flush()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def build_bed(name):
    key, seconds, opts = BEDS[name]
    x, rate = fetch(key)
    x = band(x, rate, opts.get("hp"), opts.get("lp"))
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    start = opts.get("start", steadiest(x, rate, seconds + FADE))
    loop = make_loop(x, rate, seconds, start)
    if opts.get("compress"):
        loop = compress(loop, rate)
    # Aim for BED_RMS, but leave peaky beds (crackling fire, knocks) quieter rather than crush them;
    # the player measures each bed when it loads and makes up the difference.
    rms = np.sqrt((loop ** 2).mean())
    loop *= min(BED_RMS / rms, 0.9 / np.percentile(np.abs(loop), 99.98))
    loop = np.tanh(loop / 0.95) * 0.95
    # A little of the loop's own end before it and start after it, so the player can loop any
    # whole-length stretch in between: it no longer matters whether the browser trims MP3 padding.
    pad = int(PAD * rate)
    padded = np.concatenate([loop[-pad:], loop, loop[:pad]])
    write(os.path.join(OUT, "beds", f"{name}.mp3"), encode(padded, rate, 80))
    print(f"  bed {name:10s} {key:9s} from {start:5.0f}s  {seconds}s  rms {20 * np.log10(np.sqrt((loop ** 2).mean())):.1f} dB")


def events(mono, rate, n, longest):
    """The n loudest separate sounds in a recording, as (start, end) sample pairs."""
    hop = int(rate * 0.05)
    env = window_rms(mono, rate, 0.05)
    db = 20 * np.log10(env)
    floor = np.percentile(db, 20)
    on = db > max(floor + 10, db.max() - 30)
    found, i = [], 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and (on[j:j + 8].any()):  # bridge gaps under 0.4 s
                j += 1
            found.append((i, j))
            i = j
        i += 1
    found = [(a, b) for a, b in found if b - a >= 4]
    found.sort(key=lambda ab: -db[ab[0]:ab[1]].max())
    out = []
    for a, b in found[:n]:
        a0 = max(0, a * hop - int(0.08 * rate))
        b0 = min(len(mono), b * hop + int(0.35 * rate), a0 + int(longest * rate))
        out.append((a0, b0))
    return sorted(out)


def build_spot(name):
    clips = []
    for key, opts in SPOTS[name]:
        x, rate = fetch(key)
        mono = band(x.mean(1, keepdims=True), rate, opts.get("hp"), opts.get("lp"))[:, 0]
        if "at" in opts:
            spans = [(int(s * rate), min(len(mono), int((s + d) * rate))) for s, d in opts["at"]]
        else:
            spans = events(mono, rate, opts["events"], opts.get("max", 8))
        for a, b in spans:
            clip = mono[a:b].copy()
            fi, fo = min(len(clip) // 4, int(0.02 * rate)), min(len(clip) // 3, int(0.4 * rate))
            clip[:fi] *= np.linspace(0, 1, fi)
            clip[len(clip) - fo:] *= np.linspace(1, 0, fo)
            loud = window_rms(clip, rate, 0.5).max() if len(clip) > rate // 2 else np.sqrt((clip ** 2).mean())
            clip *= min(SPOT_RMS / loud, 0.9 / np.abs(clip).max())
            clips.append((clip, rate, key))
    for i, (clip, rate, key) in enumerate(clips, 1):
        write(os.path.join(OUT, "spots", f"{name}-{i}.mp3"), encode(clip[:, None], rate, 64))
    print(f"  spot {name:12s} {len(clips)} clips ({', '.join(sorted({k for _, _, k in clips}))})")
    return len(clips)


def sources_md():
    used = {}
    for name, (key, _, _) in BEDS.items():
        used.setdefault(key, []).append(f"beds/{name}")
    for name, items in SPOTS.items():
        for key, _ in items:
            used.setdefault(key, []).append(f"spots/{name}")
    rows = [f"| {', '.join(sorted(set(v)))} | [{SOURCES[k][0]}]({SOURCES[k][2]}) | {SOURCES[k][1]} | CC0 |"
            for k, v in sorted(used.items(), key=lambda kv: kv[1][0])]
    return ("# Soundscape recordings\n\n"
            "Field recordings and sound effects behind the soundscapes, all released under CC0 "
            "(public domain). Built by `tools/build_ambience.py`, which cuts loops and one-shots from them.\n\n"
            "| Used as | Recording | From | Licence |\n|---|---|---|---|\n" + "\n".join(rows) + "\n")


def main(only):
    print("Beds")
    for name in BEDS:
        if not only or name in only:
            build_bed(name)
    print("Spots")
    counts = {}
    for name in SPOTS:
        if not only or name in only:
            counts[name] = build_spot(name)
    write(os.path.join(OUT, "SOURCES.md"), sources_md().encode("utf-8"))
    if counts:
        print("Clip counts for js/audio/soundscapes.js:", counts)


if __name__ == "__main__":
    main(set(sys.argv[1:]))
