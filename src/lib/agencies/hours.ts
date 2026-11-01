import type { Slot } from "./types";

/**
 * A small reader for the common shapes of OpenStreetMap `opening_hours`:
 *   "24/7"   "Mo-Sa 09:00-18:00"   "Mo-Fr 09:00-13:00,14:00-18:00; Sa 09:00-14:00; Su off"
 * Anything it does not understand (public holidays aside) returns null, meaning "unknown", never a guess.
 */

const DAY = ["su", "mo", "tu", "we", "th", "fr", "sa"];
type Range = [number, number];

function parseDays(part: string): number[] | null {
  const p = part.replace(/\bph\b/g, "").replace(/\s+/g, "").replace(/,+/g, ",").replace(/^,|,$/g, "");
  if (!p) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<number>();
  for (const seg of p.split(",")) {
    const m = /^([a-z]{2})(?:-([a-z]{2}))?$/.exec(seg);
    if (!m) return null;
    const a = DAY.indexOf(m[1]);
    const b = m[2] ? DAY.indexOf(m[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let i = a, n = 0; n < 8; i = (i + 1) % 7, n++) {
      out.add(i);
      if (i === b) break;
    }
  }
  return [...out];
}

function parseTimes(part: string): Range[] | "off" | null {
  const t = part.trim();
  if (t === "off" || t === "closed") return "off";
  if (t === "24/7") return [[0, 1440]];
  const out: Range[] = [];
  for (const seg of t.split(",")) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(seg);
    if (!m) return null;
    const a = +m[1] * 60 + +m[2];
    let b = +m[3] * 60 + +m[4];
    if (b <= a) b += 1440;
    out.push([a, b]);
  }
  return out;
}

/** true / false when the hours can be read, null when they are missing or in a shape this reader does not know. */
export function isOpenAt(spec: string | undefined, at: Slot): boolean | null {
  if (!spec) return null;
  const s = spec.toLowerCase().trim();
  if (s === "24/7") return true;
  const perDay: (Range[] | "off" | undefined)[] = [];
  for (const rule of s.split(";")) {
    const r = rule.trim();
    if (!r) continue;
    const m = /^([a-z, \-]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*)?)+|off|closed|24\/7)$/.exec(r);
    if (!m) return null;
    const days = parseDays(m[1]);
    const times = parseTimes(m[2]);
    if (!days || !times) return null;
    for (const d of days) perDay[d] = times;
  }
  const today = perDay[at.day];
  // a range that ran past midnight yesterday can still cover the early hours of today
  const yesterday = perDay[(at.day + 6) % 7];
  if (Array.isArray(yesterday) && yesterday.some(([a, b]) => b > 1440 && at.minutes + 1440 >= a && at.minutes + 1440 < b)) return true;
  if (!today || today === "off") return false;
  return today.some(([a, b]) => at.minutes >= a && at.minutes < b);
}

/** "2026-11-02T11:30" (the value of a datetime-local input) to a Slot, or null when it cannot be read. */
export function slotFromLocal(v: string | undefined | null): Slot | null {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return { day: d.getUTCDay(), minutes: +m[4] * 60 + +m[5] };
}
