import { BY_ID, type Place } from "../gazetteer";
import type { ParsedShipment } from "../analysis-types";

/** A place the browser picked from the place search. Known ids are re-read from the built-in list, so the browser cannot move a port. */
export interface PlaceRef {
  id: string;
  name?: string;
  type?: string;
  cc?: string;
  country?: string;
  lon?: number;
  lat?: number;
  state?: string;
}

export interface Structured {
  cargo?: string;
  from: PlaceRef;
  to: PlaceRef;
  mode?: ParsedShipment["modeHint"];
}

const MODES = new Set(["auto", "sea", "air", "rail", "road"]);

const pick = (p: Place) => ({ id: p.id, name: p.name, type: p.type, country: p.country, cc: p.cc, state: p.state, lon: p.lon, lat: p.lat });

function resolve(r: PlaceRef): ParsedShipment["origin"] | null {
  if (!r || typeof r.id !== "string") return null;
  const known = BY_ID[r.id];
  if (known) return pick(known);
  // A place found by the geocoder: accept it only with sane coordinates.
  const lon = Number(r.lon);
  const lat = Number(r.lat);
  if (!r.id.startsWith("geo:") || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const name = String(r.name ?? r.id.slice(4)).slice(0, 80);
  return {
    id: "geo:" + name,
    name,
    type: "inland",
    country: String(r.country ?? r.cc ?? "").slice(0, 60),
    cc: String(r.cc ?? "").slice(0, 2).toUpperCase(),
    state: r.state ? String(r.state).slice(0, 60) : undefined,
    lon,
    lat,
  };
}

export function buildParsed(s: Structured): { parsed?: ParsedShipment; error?: { message: string; hint: string } } {
  const origin = resolve(s?.from);
  const destination = resolve(s?.to);
  if (!origin || !destination) return { error: { message: "One of the two places was not recognised.", hint: "Pick a place from the suggestions, or type the whole sentence instead." } };
  if (origin.id === destination.id) return { error: { message: "The start and the end are the same place.", hint: "Pick two different places." } };
  const mode = MODES.has(String(s.mode)) ? (s.mode as ParsedShipment["modeHint"]) : "auto";
  const cargo = String(s.cargo ?? "").trim().slice(0, 80) || "general cargo";
  const notes: string[] = [];
  if (origin.id.startsWith("geo:") || destination.id.startsWith("geo:")) notes.push("A place was located through a geocoder rather than Dhruva's built-in list.");
  return {
    parsed: {
      raw: `${cargo} from ${origin.name} to ${destination.name}${mode !== "auto" ? ` by ${mode}` : ""}`,
      cargo,
      origin,
      destination,
      modeHint: mode,
      notes,
      parsedBy: "rules",
    },
  };
}
