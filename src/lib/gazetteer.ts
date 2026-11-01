import type { LonLat } from "./geo";
import { ROWS_A } from "./gz/rows-a";
import { ROWS_B } from "./gz/rows-b";
import { ROWS_C } from "./gz/rows-c";
import { ROWS_D } from "./gz/rows-d";
import { ROWS_E } from "./gz/rows-e";
import WORLD_PORTS from "./gz/ports.json";
import WORLD_AIRPORTS from "./gz/airports.json";
import INDIA_SURFACE from "./gz/surface.json";
import PORT_NODES from "./gz/portnodes.json";

export type PlaceType = "port" | "airport" | "inland";

export interface Place {
  id: string;
  name: string;
  type: PlaceType;
  country: string;
  /** ISO 3166-1 alpha-2 */
  cc: string;
  lon: number;
  lat: number;
  aliases: string[];
  icao?: string;
  iata?: string;
  /** Indian state, used to filter NDMA Sachet alerts */
  state?: string;
  /** Sea-graph node this port attaches to */
  seaNode?: string;
  /** Imported from the open datasets, not hand-curated. Free-text parsing ignores these; the place search and the docket use them. */
  bulk?: boolean;
  /** 0 (tiny) to 3 (large). Heuristic from port or airport attributes, not throughput. */
  size?: number;
  /** For inland places: icd, cfs, rail_terminal, junction, inland_port */
  kind?: string;
  /** Nearest city, for airports */
  city?: string;
}

export type Row = [
  id: string,
  name: string,
  type: PlaceType,
  cc: string,
  lat: number,
  lon: number,
  aliases: string,
  extra?: Partial<Place>,
];

const R: Row[] = [...ROWS_A, ...ROWS_B, ...ROWS_C, ...ROWS_D, ...ROWS_E];

const COUNTRY: Record<string, string> = {
  IN: "India", LK: "Sri Lanka", BD: "Bangladesh", AE: "UAE", OM: "Oman", SA: "Saudi Arabia", QA: "Qatar",
  CN: "China", HK: "Hong Kong", KR: "South Korea", SG: "Singapore", MY: "Malaysia", TH: "Thailand",
  VN: "Vietnam", ID: "Indonesia", NL: "Netherlands", BE: "Belgium", DE: "Germany", GB: "United Kingdom",
  IT: "Italy", GR: "Greece", ES: "Spain", EG: "Egypt", ZA: "South Africa", KE: "Kenya", NG: "Nigeria",
  US: "United States", TW: "Taiwan", JP: "Japan",
};

const CURATED: Place[] = R.map(([id, name, type, cc, lat, lon, aliases, extra]) => ({
  id,
  name,
  type,
  cc,
  lat,
  lon,
  country: COUNTRY[cc] ?? cc,
  aliases: aliases.split("|").map((s) => s.trim()).filter(Boolean),
  ...extra,
}));
const regionName = (() => {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return (cc: string) => {
      try {
        return dn.of(cc) ?? cc;
      } catch {
        return cc;
      }
    };
  } catch {
    return (cc: string) => cc;
  }
})();

const nrm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = (t: string) => nrm(t).replace(/ /g, "-");
const kmBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
};

/** Open datasets merged under the curated list. Curated entries always win when two describe the same place. */
function importOpenData(base: Place[]): Place[] {
  const out: Place[] = [];
  const ids = new Set(base.map((p) => p.id));
  const uid = (id: string) => {
    let k = id;
    for (let n = 2; ids.has(k); n++) k = `${id}-${n}`;
    ids.add(k);
    return k;
  };
  const byCc = new Map<string, Place[]>();
  for (const p of base) byCc.set(p.cc, [...(byCc.get(p.cc) ?? []), p]);
  const near = (cc: string, type: Place["type"], lat: number, lon: number, km: number) => (byCc.get(cc) ?? []).some((p) => p.type === type && kmBetween(p, { lat, lon }) <= km);
  const add = (p: Place) => {
    out.push(p);
    byCc.set(p.cc, [...(byCc.get(p.cc) ?? []), p]);
  };

  // ports: [name, cc, lat, lon, size, locode]; PORT_NODES is index-aligned with the file
  (WORLD_PORTS as unknown as [string, string, number, number, number, string][]).forEach(([name, cc, lat, lon, size, locode], i) => {
    if (near(cc, "port", lat, lon, 12)) return;
    // the same port described twice by different sources can sit tens of km apart (a city point against a terminal)
    const key = nrm(name.split(/[/(]/)[0]);
    if (key.length >= 4 && (byCc.get(cc) ?? []).some((p) => p.type === "port" && kmBetween(p, { lat, lon }) <= 60 && (nrm(p.name).includes(key) || key.includes(nrm(p.name.split("(")[0]))))) return;
    const node = (PORT_NODES as string[])[i] || undefined;
    const parts = name.split(/[/(]/).map((x) => x.replace(/\)/g, "").trim()).filter((x) => x.length >= 3);
    add({
      id: uid(locode ? `w-${locode.toLowerCase()}` : `w-${slug(name)}-${cc.toLowerCase()}`),
      name,
      type: "port",
      country: regionName(cc),
      cc,
      lat,
      lon,
      aliases: [...parts.slice(1), locode].filter(Boolean),
      seaNode: node,
      bulk: true,
      size,
    });
  });

  // airports: [name, cc, lat, lon, iata, icao, size, city]
  const haveIata = new Set(base.filter((p) => p.iata).map((p) => p.iata));
  (WORLD_AIRPORTS as unknown as [string, string, number, number, string, string, number, string][]).forEach(([name, cc, lat, lon, iata, icao, size, city]) => {
    if (haveIata.has(iata) || near(cc, "airport", lat, lon, 4)) return;
    const nm = name.split(" / ")[0].replace(/ International( Airport)?$/i, "").replace(/ Airport$/i, "").trim() || name;
    const label = city && !nrm(nm).includes(nrm(city)) ? `${city} (${nm})` : nm;
    add({ id: uid(`a-${iata.toLowerCase()}`), name: label, type: "airport", country: regionName(cc), cc, lat, lon, aliases: [city, `${city} airport`, iata, icao].filter(Boolean), iata, icao: icao || undefined, bulk: true, size, city });
  });

  // India's inland container depots, rail yards and river ports: [name, kind, state, lat, lon]
  (INDIA_SURFACE as unknown as [string, string, string, number, number][]).forEach(([name, kind, state, lat, lon]) => {
    if (kind === "inland_port" && near("IN", "port", lat, lon, 15)) return;
    if ((byCc.get("IN") ?? []).some((p) => p.type !== "airport" && nrm(p.name) === nrm(name) && kmBetween(p, { lat, lon }) < 5)) return;
    add({ id: uid(`s-${slug(name)}`), name, type: "inland", country: "India", cc: "IN", lat, lon, aliases: [], state, bulk: true, kind });
  });
  return out;
}

export const PLACES: Place[] = [...CURATED, ...importOpenData(CURATED)];


function lonlat(p: Place): LonLat {
  return [p.lon, p.lat];
}
export { lonlat };

export const BY_ID: Record<string, Place> = Object.fromEntries(PLACES.map((p) => [p.id, p]));

/** Nearest large Indian airport to an Indian place — used for air alternatives. */
export function nearestAirport(p: { lon: number; lat: number }, ccFilter?: string): Place | undefined {
  let best: Place | undefined;
  let bd = Infinity;
  for (const a of PLACES) {
    if (a.type !== "airport") continue;
    if (ccFilter && a.cc !== ccFilter) continue;
    const d = (a.lon - p.lon) ** 2 + (a.lat - p.lat) ** 2;
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/** Nearest port to a coordinate. */
export function nearestPort(p: { lon: number; lat: number }, ccFilter?: string): Place | undefined {
  let best: Place | undefined;
  let bd = Infinity;
  for (const a of PLACES) {
    if (a.type !== "port") continue;
    if (ccFilter && a.cc !== ccFilter) continue;
    const d = (a.lon - p.lon) ** 2 + (a.lat - p.lat) ** 2;
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}
