"""Turn a MIDI score into a compact note list the in-browser music player can perform.

    python tools/midi_to_json.py score.mid data/music/seikilos.json "Seikilos epitaph" "Public domain"

Output: { "title", "credit", "duration", "notes": [[start, length, midi, velocity, part], ...] }
with times in seconds. Only note on/off and tempo events are read; everything
else (instruments, controllers) is ignored, since the player picks its own
period instruments.
"""

import json
import sys


def read_var(data, i):
    value = 0
    while True:
        b = data[i]
        i += 1
        value = (value << 7) | (b & 0x7F)
        if not b & 0x80:
            return value, i


def parse(path):
    data = open(path, "rb").read()
    assert data[:4] == b"MThd", "not a MIDI file"
    ntracks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    i = 8 + int.from_bytes(data[4:8], "big")
    events = []  # (tick, kind, payload, track)
    for track in range(ntracks):
        assert data[i:i + 4] == b"MTrk"
        end = i + 8 + int.from_bytes(data[i + 4:i + 8], "big")
        i += 8
        tick = 0
        status = 0
        while i < end:
            delta, i = read_var(data, i)
            tick += delta
            b = data[i]
            if b == 0xFF:  # meta
                kind = data[i + 1]
                length, j = read_var(data, i + 2)
                if kind == 0x51:
                    events.append((tick, "tempo", int.from_bytes(data[j:j + 3], "big"), track))
                i = j + length
                continue
            if b in (0xF0, 0xF7):  # sysex
                length, j = read_var(data, i + 1)
                i = j + length
                continue
            if b & 0x80:
                status = b
                i += 1
            kind = status & 0xF0
            if kind in (0xC0, 0xD0):
                i += 1
                continue
            a, v = data[i], data[i + 1]
            i += 2
            if kind == 0x90 and v > 0:
                events.append((tick, "on", (a, v, status & 0x0F), track))
            elif kind in (0x80, 0x90):
                events.append((tick, "off", (a, status & 0x0F), track))
        i = end
    return events, division


def notes(events, division):
    events.sort(key=lambda e: (e[0], 0 if e[1] == "tempo" else 1 if e[1] == "off" else 2))
    tempo = 500000
    last_tick, seconds = 0, 0.0
    open_notes = {}
    out = []
    for tick, kind, payload, track in events:
        seconds += (tick - last_tick) * tempo / division / 1e6
        last_tick = tick
        if kind == "tempo":
            tempo = payload
        elif kind == "on":
            pitch, vel, ch = payload
            open_notes[(pitch, ch, track)] = (seconds, vel)
        else:
            pitch, ch = payload
            start = open_notes.pop((pitch, ch, track), None)
            if start:
                out.append([round(start[0], 3), round(seconds - start[0], 3), pitch, start[1], track])
    out.sort()
    # Number the parts 0, 1, 2... in order of first appearance.
    parts = {}
    for n in out:
        n[4] = parts.setdefault(n[4], len(parts))
    return out, round(seconds, 3)


if __name__ == "__main__":
    src, dst, title, credit = sys.argv[1:5]
    ns, duration = notes(*parse(src))
    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"title": title, "credit": credit, "duration": duration, "notes": ns}, f, separators=(",", ":"))
    print(f"{dst}: {len(ns)} notes, {duration:.0f}s, parts {sorted({n[4] for n in ns})}")
