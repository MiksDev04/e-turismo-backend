// Parses naive MySQL date/datetime strings ("YYYY-MM-DD" or
// "YYYY-MM-DD HH:mm:ss") as local wall-clock so day arithmetic (nights,
// guest-days, period bounds) is deterministic and never shifts dates due to
// UTC-midnight parsing of date-only strings. The DB session time zone is
// pinned to Asia/Manila (UTC+8), so the wall-clock components returned here
// match the app's canonical timezone.
export function parseDbDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const y  = +m[1];
  const mo = +m[2];
  const d  = +m[3];
  const hh = m[4] ? +m[4] : 0;
  const mm = m[5] ? +m[5] : 0;
  const ss = m[6] ? +m[6] : 0;
  return new Date(y, mo - 1, d, hh, mm, ss);
}

export default { parseDbDate };
