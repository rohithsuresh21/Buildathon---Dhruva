import { fetchSource } from "../http";
import type { LonLat } from "../geo";
import type { SourceStamp } from "../types";

export interface Quake {
  id: string;
  mag: number;
  place: string;
  at: LonLat;
  time: string;
  url: string;
  tsunami: boolean;
}

/** USGS earthquakes of magnitude 4.5+ in the past day. */
export async function getQuakes(): Promise<{ list: Quake[]; stamp: SourceStamp }> {
  const r = await fetchSource<any>("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", {
    id: "usgs-eq",
    name: "USGS earthquakes M4.5+ (past day)",
    ttlMs: 5 * 60_000,
    timeoutMs: 8000,
    observed: (d) => (d.metadata?.generated ? new Date(d.metadata.generated).toISOString() : undefined),
  });
  const list: Quake[] = (r.data?.features ?? []).map((f: any) => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place,
    at: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as LonLat,
    time: new Date(f.properties.time).toISOString(),
    url: f.properties.url,
    tsunami: !!f.properties.tsunami,
  }));
  return { list, stamp: r.stamp };
}
