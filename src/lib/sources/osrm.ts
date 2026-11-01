import { fetchSource } from "../http";
import type { LonLat } from "../geo";
import type { SourceStamp } from "../types";

export interface RoadRoute {
  path: LonLat[];
  km: number;
  carHours: number;
  stamp: SourceStamp;
}

/** OSRM public demo server on OpenStreetMap data. Fair-use only; each call is one origin-destination pair. */
export async function roadRoute(a: LonLat, b: LonLat): Promise<RoadRoute | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[0].toFixed(5)},${a[1].toFixed(5)};${b[0].toFixed(5)},${b[1].toFixed(5)}?overview=simplified&geometries=geojson`;
  const r = await fetchSource<any>(url, { id: "osrm", name: "OSRM road routing (OpenStreetMap)", ttlMs: 6 * 3600_000, timeoutMs: 10_000 });
  const rt = r.data?.routes?.[0];
  if (!rt?.geometry?.coordinates?.length) return null;
  return { path: rt.geometry.coordinates as LonLat[], km: rt.distance / 1000, carHours: rt.duration / 3600, stamp: r.stamp };
}
