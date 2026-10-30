// Where a date sits on the timeline, from 0 (story start) to 1 (story end).
//
// Most stories run at an even pace. A story can instead give its timeline
// segments of their own width, so that a few crowded weeks get room:
//
//   "timeScale": [{ "end": "1981", "share": 1 }, { "end": "1993-02-28", "share": 1 },
//                 { "end": "1993-04-20", "share": 3 }, { "share": 1 }]
//
// Each segment runs from the end of the one before (the story's start for
// the first) to its own `end`; the last always runs to the story's end.
// Shares are relative widths. The tour plays each segment in proportion to
// its width, so the 51 days of a siege last as long as the decades before.

import { clamp, parseDate } from './time.js';

export function createTimeScale(range, segments) {
  const { t0, t1 } = range;
  let stops = [{ t: t0, x: 0 }, { t: t1, x: 1 }];
  if (segments?.length) {
    const total = segments.reduce((sum, s) => sum + (s.share ?? 1), 0);
    stops = [{ t: t0, x: 0 }];
    let x = 0;
    segments.forEach((s, i) => {
      x += (s.share ?? 1) / total;
      const t = i === segments.length - 1 || !s.end ? t1 : clamp(parseDate(s.end), t0, t1);
      if (t > stops.at(-1).t) stops.push({ t, x });
    });
    stops.at(-1).t = t1;
    stops.at(-1).x = 1;
  }

  // The pair of stops either side of a value (a date, or a position).
  const around = (key, v) => {
    let i = 1;
    while (i < stops.length - 1 && v > stops[i][key]) i++;
    return [stops[i - 1], stops[i]];
  };

  return {
    even: stops.length === 2,
    // Date to position, 0..1.
    x(t) {
      const c = clamp(t, t0, t1);
      const [a, b] = around('t', c);
      return a.x + ((c - a.t) / (b.t - a.t)) * (b.x - a.x);
    },
    // Position (0..1) to date.
    t(x) {
      const c = clamp(x, 0, 1);
      const [a, b] = around('x', c);
      return a.t + ((c - a.x) / (b.x - a.x)) * (b.t - a.t);
    },
    // How much story time a stretch of timeline holds here, against an even
    // scale (1 = even). The tour multiplies its pace by this.
    density(t) {
      const [a, b] = around('t', clamp(t, t0, t1));
      return (b.t - a.t) / (b.x - a.x) / (t1 - t0);
    },
  };
}
