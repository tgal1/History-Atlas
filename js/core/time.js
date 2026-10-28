// Time is stored everywhere as a decimal year (1972.08 ≈ 30 Jan 1972).
// This works for BC dates too, which JS Date strings cannot parse.
// Dates in data files use ISO "YYYY-MM-DD" with astronomical years:
// year 0 = 1 BC, -215 = 216 BC. Month and day are optional ("1972", "1972-01");
// a partial date sits in the middle of its year or month.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_RE = /^(-?\d{1,6})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/;

function utcMs(year, month, day) {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function parseDate(value) {
  if (typeof value === 'number') return value;
  const m = DATE_RE.exec(String(value).trim());
  if (!m) throw new Error(`Unrecognised date "${value}". Use YYYY-MM-DD.`);
  const year = Number(m[1]);
  if (!m[2]) return year + 0.5;
  const month = Number(m[2]) - 1;
  const start = utcMs(year, 0, 1);
  const span = utcMs(year + 1, 0, 1) - start;
  if (!m[3]) return year + ((utcMs(year, month, 1) + utcMs(year, month + 1, 1)) / 2 - start) / span;
  // Midday, so an event sits inside its own day rather than on the boundary.
  return year + (utcMs(year, month, Number(m[3])) + 43_200_000 - start) / span;
}

// "year" | "month" | "day": how much of a date string was given.
export function datePrecision(value) {
  const m = DATE_RE.exec(String(value).trim());
  if (!m) return 'day';
  return m[3] ? 'day' : m[2] ? 'month' : 'year';
}

function parts(t) {
  const year = Math.floor(t);
  const start = utcMs(year, 0, 1);
  const next = utcMs(year + 1, 0, 1);
  const d = new Date(start + (t - year) * (next - start));
  return { year, month: d.getUTCMonth(), day: d.getUTCDate() };
}

// Stories that cross from BC into AD label AD years too ("AD 117").
let adPrefix = false;
export function configureCalendar({ ad = false } = {}) {
  adPrefix = ad;
}

export function yearLabel(year) {
  if (year <= 0) return `${1 - year} BC`;
  return adPrefix ? `AD ${year}` : String(year);
}

export function formatDate(t, precision = 'day') {
  const p = parts(t);
  if (precision === 'year') return yearLabel(p.year);
  if (precision === 'month') return `${MONTHS[p.month]} ${yearLabel(p.year)}`;
  return `${p.day} ${MONTHS[p.month]} ${yearLabel(p.year)}`;
}

// An event's date at the precision its data gave, e.g. "c. 237 BC".
export function formatEventDate(ev) {
  return `${ev.circa ? 'c. ' : ''}${formatDate(ev.t, ev.precision)}`;
}

// The date as a narrator would say it: "30 January 1972", "Around 237 BC".
// Keep in step with spoken_date() in tools/render_narration.py.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function spokenDate(ev) {
  const m = DATE_RE.exec(String(ev.date).trim());
  if (!m) return formatEventDate(ev);
  const label = yearLabel(Number(m[1]));
  const text = m[3] ? `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${label}`
    : m[2] ? `${MONTH_NAMES[Number(m[2]) - 1]} ${label}` : label;
  return ev.circa ? `Around ${text}` : text;
}

export const clamp =(v, lo, hi) => Math.min(hi, Math.max(lo, v));
