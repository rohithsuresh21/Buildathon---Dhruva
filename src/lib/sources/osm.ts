import { fetchSource } from "../http";
import { identify, SERVICE_WORDS } from "../agencies/catalog";
import type { AgencyKind, RawAgency } from "../agencies/types";
import type { SourceStamp } from "../types";

/**
 * Parcel and freight handling points around a coordinate, from OpenStreetMap through the Overpass API.
 * Contributors tag couriers, post offices and logistics offices; nothing here is invented or estimated.
 * Two public mirrors are tried in turn because any one of them can be busy.
 */

const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

const NAME_RE = "DTDC|Blue ?Dart|Delhivery|Gati|DHL|Fed ?Ex|Professional Courier|Xpress ?Bees|Ecom Express|Safe ?express|TCI|VRL|Shadowfax|India Post|Speed Post|Aramex|UPS|Courier|Cargo|Logistic|Parcel|Freight|Packers|Movers";

function query(lat: number, lon: number, meters: number): string {
  const a = `(around:${meters},${lat},${lon})`;
  return `[out:json][timeout:20];(
nwr["shop"="courier"]${a};
nwr["office"="courier"]${a};
nwr["amenity"="courier"]${a};
nwr["office"="logistics"]${a};
nwr["amenity"="post_office"]${a};
nwr["name"~"${NAME_RE}",i]["amenity"!~"atm|bank|restaurant|cafe|fast_food|school|college|hospital"]${a};
);out center tags 150;`;
}

interface Element {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function address(t: Record<string, string>): string | undefined {
  if (t["addr:full"]) return t["addr:full"];
  const parts = [t["addr:housenumber"], t["addr:street"], t["addr:suburb"] ?? t["addr:neighbourhood"], t["addr:city"], t["addr:postcode"]].filter(Boolean);
  return parts.length >= 2 ? parts.join(", ") : undefined;
}

function toAgency(e: Element): RawAgency | null {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  const name = t.name ?? t.brand ?? t.operator;
  if (!name || lat === undefined || lon === undefined) return null;
  const carrier = identify(t.brand, t.name, t.operator);
  const isPost = t.amenity === "post_office";
  const isCourier = t.shop === "courier" || t.office === "courier" || t.amenity === "courier";
  const isLogistics = t.office === "logistics";
  if (!carrier && !isPost && !isCourier && !isLogistics && !SERVICE_WORDS.test(name)) return null;
  const kind: AgencyKind = isPost ? "post_office" : isLogistics || carrier?.kind === "logistics" ? "logistics" : "courier";
  const phone = t.phone ?? t["contact:phone"] ?? t["contact:mobile"];
  const website = t.website ?? t["contact:website"];
  return {
    id: `osm:${e.type}/${e.id}`,
    name: t.brand && !name.toLowerCase().includes(t.brand.toLowerCase()) ? `${t.brand} ${name}` : name,
    carrier: carrier?.id,
    kind,
    lat,
    lon,
    address: address(t),
    phone: phone?.split(";")[0]?.trim(),
    website: website && /^https?:\/\//i.test(website) ? website : undefined,
    hours: t.opening_hours,
    source: "osm",
    osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
  };
}

export async function nearbyAgencies(lat: number, lon: number, radiusKm: number): Promise<{ agencies: RawAgency[]; stamp: SourceStamp }> {
  const body = "data=" + encodeURIComponent(query(lat, lon, Math.round(radiusKm * 1000)));
  let last: Awaited<ReturnType<typeof fetchSource<{ elements?: Element[] }>>> | null = null;
  for (const url of MIRRORS) {
    const r = await fetchSource<{ elements?: Element[] }>(url, {
      id: "osm-overpass",
      name: "OpenStreetMap (Overpass API)",
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      ttlMs: 5 * 60_000,
      timeoutMs: 22_000,
      valid: (d) => Array.isArray(d?.elements),
      observed: (d) => d?.osm3s?.timestamp_osm_base,
    });
    last = r;
    if (r.stamp.ok) break;
  }
  const els = last?.data?.elements ?? [];
  const seen = new Set<string>();
  const out: RawAgency[] = [];
  for (const e of els) {
    const a = toAgency(e);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return { agencies: out, stamp: last!.stamp };
}
