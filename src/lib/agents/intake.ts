import { PLACES, type Place } from "../gazetteer";
import { geocode } from "../sources/openmeteo";
import type { ParsedShipment } from "../analysis-types";
import type { SourceStamp } from "../types";

interface Hit {
  place: Place;
  start: number;
  end: number;
  alias: string;
}

const ORIGIN_AFTER = ["से", "થી", "இலிருந்து", "இல் இருந்து", "ने"];
const DEST_AFTER = ["तक", "સુધી", "வரை", "को"];

const ALIAS: { alias: string; place: Place }[] = PLACES.filter((p) => !p.bulk).flatMap((p) => [...(p.type === "airport" ? [] : [p.name.toLowerCase()]), ...p.aliases.map((a) => a.toLowerCase())].map((alias) => ({ alias, place: p })))
  .filter((x) => x.alias.length >= 3)
  .sort((a, b) => b.alias.length - a.alias.length);

function isWordBoundary(s: string, i: number, len: number, alias: string): boolean {
  const latin = /^[a-z0-9' .\-]+$/.test(alias);
  if (!latin) return true;
  const before = i === 0 ? " " : s[i - 1];
  const after = i + len >= s.length ? " " : s[i + len];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

function findPlaces(text: string): Hit[] {
  const s = text.toLowerCase();
  const taken: [number, number][] = [];
  const hits: Hit[] = [];
  for (const { alias, place } of ALIAS) {
    let from = 0;
    for (;;) {
      const i = s.indexOf(alias, from);
      if (i < 0) break;
      from = i + 1;
      const end = i + alias.length;
      if (!isWordBoundary(s, i, alias.length, alias)) continue;
      if (taken.some(([a, b]) => i < b && end > a)) continue;
      taken.push([i, end]);
      hits.push({ place, start: i, end, alias });
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

const pick = (p: Place) => ({ id: p.id, name: p.name, type: p.type, country: p.country, cc: p.cc, state: p.state, lon: p.lon, lat: p.lat });

function modeHint(t: string): ParsedShipment["modeHint"] {
  const s = t.toLowerCase();
  if (/\b(by air|air ?freight|air cargo|airfreight|flight)\b|हवाई|એર|விமான/.test(s)) return "air";
  if (/\bby (sea|ship|ocean|vessel)\b|समुद्र|દરિયા|கடல்/.test(s)) return "sea";
  if (/\bby (road|truck|lorry)\b|सड़क|રોડ|சாலை/.test(s)) return "road";
  if (/\bby (rail|train)\b|रेल|રેલ|ரயில்/.test(s)) return "rail";
  return "auto";
}

function cargoFrom(text: string, hits: Hit[]): string {
  let t = text;
  for (const h of [...hits].reverse()) t = t.slice(0, h.start) + " " + t.slice(h.end);
  t = t
    .replace(/\b(from|to|by air|by sea|by road|by rail|by truck|by ship|via|shipment of|shipment|ship|send|sending|moving|move|export|import|exporting|importing|of)\b/gi, " ")
    .replace(/से|तक|થી|સુધી|இலிருந்து|வரை/g, " ")
    .replace(/[,.;:!?()\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length >= 2 ? t.slice(0, 60) : "your cargo";
}

/** Rule-based intake. Deterministic; no model. Unknown cities fall back to a real geocoder. */
export async function parseShipment(raw: string): Promise<{ parsed?: ParsedShipment; error?: { message: string; hint: string }; stamps: SourceStamp[] }> {
  const text = raw.trim().slice(0, 400);
  const stamps: SourceStamp[] = [];
  if (text.length < 5) return { error: { message: "That is too short to read as a shipment.", hint: "Try: Solar inverters from Shenzhen to Mundra." }, stamps };
  let hits = findPlaces(text);

  // Unknown places: try "from X to Y" with a geocoder so the list of supported places is not a hard wall.
  const unknown: Place[] = [];
  if (hits.length < 2) {
    const m = /from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:by|via|in|with)\b|$)/i.exec(text);
    if (m) {
      for (const name of [m[1], m[2]]) {
        if (findPlaces(name).length) continue;
        const g = await geocode(name.trim());
        stamps.push(g.stamp);
        if (g.hit && g.hit.cc) {
          const idx = text.toLowerCase().indexOf(name.trim().toLowerCase());
          const p: Place = { id: `geo:${g.hit.name}`, name: g.hit.name, type: "inland", country: g.hit.country, cc: g.hit.cc, lon: g.hit.lon, lat: g.hit.lat, aliases: [], state: g.hit.cc === "IN" ? g.hit.admin1 : undefined };
          unknown.push(p);
          if (idx >= 0) hits.push({ place: p, start: idx, end: idx + name.trim().length, alias: name.trim() });
        }
      }
      hits = hits.sort((a, b) => a.start - b.start);
    }
  }

  // de-duplicate the same place appearing twice
  const uniq: Hit[] = [];
  for (const h of hits) if (!uniq.some((u) => u.place.id === h.place.id)) uniq.push(h);
  if (uniq.length < 2) {
    return {
      error: {
        message: uniq.length === 1 ? `I found ${uniq[0].place.name} but not a second place.` : "I could not find two places in that sentence.",
        hint: "Name the start and the end, like “Cotton yarn from Tiruppur to Hamburg”. Hindi, Gujarati and Tamil place names work too.",
      },
      stamps,
    };
  }

  const lower = text.toLowerCase();
  let origin: Hit | undefined;
  let dest: Hit | undefined;
  for (const h of uniq) {
    const before = lower.slice(Math.max(0, h.start - 8), h.start);
    const after = text.slice(h.end, h.end + 12);
    if (!origin && (/\bfrom\s+$/.test(before) || ORIGIN_AFTER.some((w) => after.trimStart().startsWith(w)))) origin = h;
    else if (!dest && (/\bto\s+$/.test(before) || DEST_AFTER.some((w) => after.trimStart().startsWith(w)))) dest = h;
  }
  if (!origin) origin = uniq.find((h) => h !== dest);
  if (!dest) dest = uniq.find((h) => h !== origin);
  if (!origin || !dest || origin.place.id === dest.place.id) {
    return { error: { message: "I could not tell which place is the start and which is the end.", hint: "Use “from … to …”." }, stamps };
  }

  const notes: string[] = [];
  const hint = modeHint(text);
  if (unknown.length) notes.push(`${unknown.map((u) => u.name).join(" and ")} located through a geocoder rather than Dhruva's built-in port list.`);
  return {
    parsed: {
      raw: text,
      cargo: cargoFrom(text, uniq),
      origin: pick(origin.place),
      destination: pick(dest.place),
      modeHint: hint,
      notes,
      parsedBy: "rules",
    },
    stamps,
  };
}
