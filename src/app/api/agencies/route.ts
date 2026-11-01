import { rank, scoreAgency } from "@/lib/agencies/score";
import { slotFromLocal } from "@/lib/agencies/hours";
import type { Need } from "@/lib/agencies/types";
import { nearbyAgencies } from "@/lib/sources/osm";
import { googleAgencies, mergeGoogle } from "@/lib/sources/googleplaces";
import type { SourceStamp } from "@/lib/types";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

const num = (v: string | null) => (v === null || v.trim() === "" ? NaN : Number(v));

/**
 * GET /api/agencies?lat=22.72&lon=75.86&intl=1&air=0&freight=0&at=2026-11-02T11:00
 * Parcel agencies near a point, scored for the shipment. Coordinates are used for this one lookup and never stored.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const lat = num(q.get("lat"));
  const lon = num(q.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "Send lat and lon, for example ?lat=22.72&lon=75.86." }, { status: 400 });
  }
  const need: Need = { international: q.get("intl") === "1", air: q.get("air") === "1", freight: q.get("freight") === "1" };
  const slot = slotFromLocal(q.get("at"));
  const stamps: SourceStamp[] = [];
  const notes: string[] = [];

  let radius = 8;
  let { agencies: raw, stamp } = await nearbyAgencies(lat, lon, radius);
  stamps.push(stamp);
  if (stamp.ok && raw.length < 5) {
    radius = 25;
    const wider = await nearbyAgencies(lat, lon, radius);
    stamps.push(wider.stamp);
    if (wider.stamp.ok) raw = wider.agencies;
    notes.push("Few agencies within 8 km, so the search widened to 25 km.");
  }
  const g = await googleAgencies(lat, lon, radius);
  if (g) {
    stamps.push(g.stamp);
    if (g.stamp.ok) raw = mergeGoogle(raw, g.agencies);
    else notes.push("Google ratings could not be fetched this time.");
  }
  if (!stamp.ok) notes.push("OpenStreetMap did not answer. Nothing is shown rather than a guess; try again in a moment.");

  const ranked = rank(raw.map((a) => scoreAgency(a, [lon, lat], need, slot)).filter((a) => a.distanceKm <= radius + 1)).slice(0, 15);
  return Response.json(
    { center: { lat, lon }, radiusKm: radius, ratings: !!g && g.stamp.ok, agencies: ranked, stamps, notes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
