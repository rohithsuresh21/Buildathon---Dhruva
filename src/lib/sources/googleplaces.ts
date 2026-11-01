import { fetchSource } from "../http";
import { identify } from "../agencies/catalog";
import { haversineKm } from "../geo";
import type { RawAgency } from "../agencies/types";
import type { SourceStamp } from "../types";

/**
 * Optional enrichment from Google Places (New). Active only when GOOGLE_MAPS_API_KEY is set on the server.
 * It adds the star rating and review count that OpenStreetMap does not carry, and contributes agencies OpenStreetMap
 * has not mapped yet. Without a key the finder still works and says plainly that ratings are unavailable.
 */

interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  businessStatus?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

export const googleEnabled = () => !!process.env.GOOGLE_MAPS_API_KEY;

export async function googleAgencies(lat: number, lon: number, radiusKm: number): Promise<{ agencies: RawAgency[]; stamp: SourceStamp } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const r = await fetchSource<{ places?: GPlace[] }>("https://places.googleapis.com/v1/places:searchText", {
    id: "google-places",
    name: "Google Places",
    method: "POST",
    body: JSON.stringify({
      textQuery: "courier service",
      maxResultCount: 20,
      locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: Math.min(50_000, radiusKm * 1000) } },
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.nationalPhoneNumber,places.websiteUri,places.businessStatus",
    },
    ttlMs: 15 * 60_000,
    timeoutMs: 9000,
    valid: (d) => !d?.error,
  });
  const out: RawAgency[] = [];
  for (const p of r.data?.places ?? []) {
    if (!p.location || !p.displayName || p.businessStatus === "CLOSED_PERMANENTLY") continue;
    out.push({
      id: `google:${p.id}`,
      name: p.displayName.text,
      carrier: identify(p.displayName.text)?.id,
      kind: "courier",
      lat: p.location.latitude,
      lon: p.location.longitude,
      address: p.formattedAddress,
      phone: p.nationalPhoneNumber,
      website: p.websiteUri,
      source: "google",
      mapsUrl: p.googleMapsUri,
      rating: p.rating,
      ratingCount: p.userRatingCount,
    });
  }
  return { agencies: out, stamp: r.stamp };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Fold Google results into the OpenStreetMap list: same place when the names overlap and they are within 150 m. */
export function mergeGoogle(osm: RawAgency[], google: RawAgency[]): RawAgency[] {
  const merged = osm.map((o) => ({ ...o }));
  const extra: RawAgency[] = [];
  for (const g of google) {
    const hit = merged.find((o) => haversineKm([o.lon, o.lat], [g.lon, g.lat]) < 0.15 && (norm(o.name).includes(norm(g.name)) || norm(g.name).includes(norm(o.name)) || (o.carrier && o.carrier === g.carrier)));
    if (hit) {
      hit.rating = g.rating;
      hit.ratingCount = g.ratingCount;
      hit.mapsUrl = g.mapsUrl;
      hit.phone = hit.phone ?? g.phone;
      hit.website = hit.website ?? g.website;
      hit.address = hit.address ?? g.address;
      hit.source = "osm+google";
    } else extra.push(g);
  }
  return [...merged, ...extra];
}
