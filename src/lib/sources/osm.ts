import { fetchSource } from "../http";
import { identify, SERVICE_WORDS } from "../agencies/catalog";
import type { AgencyKind, RawAgency } from "../agencies/types";
import type { SourceStamp } from "../types";

/**
 * Parcel and freight handling points around a coordinate, from OpenStreetMap through the Overpass API.
 * Contributors tag couriers, post offices and logistics offices; nothing here is invented or estimated.
 * Several public mirrors are asked at once because any one of them can be busy.
 */

/** Public mirrors, queried together: any one of them can be slow or refuse a request, and the first good answer wins. */
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

/** Tag-only query: indexed lookups answer in a second or two, where a name regex over every object does not. */
function query(lat: number, lon: number, meters: number): string {
  const a = `(around:${meters},${lat},${lon})`;
  return `[out:json][timeout:9];(
nwr["shop"="courier"]${a};
nwr["office"="courier"]${a};
nwr["amenity"="courier"]${a};
nwr["office"="logistics"]${a};
nwr["amenity"="post_office"]${a};
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

type Reply = Awaited<ReturnType<typeof fetchSource<{ elements?: Element[]; osm3s?: { timestamp_osm_base?: string } }>>>;

async function overpass(lat: number, lon: number, radiusKm: number): Promise<{ els: Element[]; stamp: SourceStamp }> {
  const body = "data=" + encodeURIComponent(query(lat, lon, Math.round(radiusKm * 1000)));
  const ask = (url: string) =>
    fetchSource<{ elements?: Element[]; osm3s?: { timestamp_osm_base?: string } }>(url, {
      id: "osm-overpass",
      name: "OpenStreetMap (Overpass API)",
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      ttlMs: 5 * 60_000,
      timeoutMs: 10_000,
      valid: (d) => Array.isArray(d?.elements),
      observed: (d) => d?.osm3s?.timestamp_osm_base,
    });
  const last = await new Promise<Reply>((resolve) => {
    let waiting = MIRRORS.length;
    let latest: Reply | null = null;
    for (const url of MIRRORS) {
      ask(url).then((r) => {
        latest = r;
        if (r.stamp.ok) resolve(r);
        else if (--waiting === 0) resolve(latest!);
      });
    }
  });
  return { els: last.data?.elements ?? [], stamp: last.stamp };
}

interface NominatimHit {
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  category: string;
  type: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
}

/**
 * Nominatim searches the same OpenStreetMap data and answers in under a second when the Overpass mirrors are busy.
 * It finds fewer places (named businesses and post offices only), so it backs Overpass up instead of replacing it.
 * Requests are spaced one second apart, as its usage policy asks.
 */
async function nominatim(lat: number, lon: number, radiusKm: number): Promise<{ els: Element[]; stamp: SourceStamp | null }> {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const vb = `${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)},${(lat - dLat).toFixed(5)}`;
  const els: Element[] = [];
  let stamp: SourceStamp | null = null;
  for (const q of ["courier", "post office", "logistics", "parcel"]) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&viewbox=${vb}&bounded=1&limit=40&addressdetails=1&extratags=1`;
    const r = await fetchSource<NominatimHit[]>(url, { id: "osm-nominatim", name: "OpenStreetMap (Nominatim)", ttlMs: 10 * 60_000, timeoutMs: 6000, valid: (d) => Array.isArray(d) });
    stamp = r.stamp;
    if (!r.stamp.ok) break;
    for (const h of r.data ?? []) {
      const a = h.address ?? {};
      const tags: Record<string, string> = { ...(h.extratags ?? {}), [h.category]: h.type };
      if (h.name) tags.name = h.name;
      if (a.house_number) tags["addr:housenumber"] = a.house_number;
      if (a.road) tags["addr:street"] = a.road;
      if (a.suburb ?? a.neighbourhood) tags["addr:suburb"] = (a.suburb ?? a.neighbourhood)!;
      if (a.city ?? a.town ?? a.village) tags["addr:city"] = (a.city ?? a.town ?? a.village)!;
      if (a.postcode) tags["addr:postcode"] = a.postcode;
      els.push({ type: h.osm_type, id: h.osm_id, lat: Number(h.lat), lon: Number(h.lon), tags });
    }
    await new Promise((res) => setTimeout(res, 1100));
  }
  return { els, stamp };
}

export async function nearbyAgencies(lat: number, lon: number, radiusKm: number): Promise<{ agencies: RawAgency[]; stamp: SourceStamp }> {
  const [op, nom] = await Promise.all([overpass(lat, lon, radiusKm), nominatim(lat, lon, radiusKm)]);
  const seen = new Set<string>();
  const out: RawAgency[] = [];
  for (const e of [...op.els, ...nom.els]) {
    const a = toAgency(e);
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  // Report the source that actually produced the list: Overpass when it answered, otherwise the Nominatim backup.
  const stamp: SourceStamp = op.stamp.ok ? op.stamp : nom.stamp?.ok ? { ...nom.stamp, note: "Overpass was busy, so this list comes from Nominatim: fewer places than a full search" } : op.stamp;
  return { agencies: out, stamp };
}
