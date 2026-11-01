import { fetchSource } from "../http";
import { haversineKm, distToPathKm, type LonLat } from "../geo";
import type { SourceStamp } from "../types";

const BASE = "https://www.gdacs.org/gdacsapi/api/events/geteventlist";
export const GDACS_PAGE = "https://www.gdacs.org/";

export interface Cyclone {
  id: string;
  name: string;
  at: LonLat;
  alert: "Green" | "Orange" | "Red";
  windKmh: number;
  windText: string;
  from?: string;
  to?: string;
  country?: string;
  /** forecast track points, if GDACS provides them */
  track: LonLat[];
  report?: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function getCyclones(): Promise<{ list: Cyclone[]; stamp: SourceStamp }> {
  const now = Date.now();
  const url = `${BASE}/MAP?eventtype=TC&alertlevel=Green;Orange;Red&fromdate=${iso(new Date(now - 12 * 864e5))}&todate=${iso(new Date(now + 864e5))}`;
  const r = await fetchSource<any>(url, {
    id: "gdacs-tc",
    name: "GDACS tropical cyclones",
    ttlMs: 10 * 60_000,
    timeoutMs: 20_000,
    observed: (d) =>
      (d.features ?? [])
        .map((f: any) => f.properties?.datemodified)
        .filter(Boolean)
        .sort()
        .pop() + "Z",
  });
  if (!r.data?.features) return { list: [], stamp: r.stamp };
  const byEvent = new Map<number, Cyclone>();
  const lines = new Map<number, LonLat[]>();
  for (const f of r.data.features) {
    const p = f.properties ?? {};
    if (String(p.iscurrent) !== "true") continue;
    const id = p.eventid as number;
    if (f.geometry?.type === "Point" && p.Class === "Point_Centroid") {
      byEvent.set(id, {
        id: String(id),
        name: p.eventname || p.name,
        at: f.geometry.coordinates as LonLat,
        alert: p.alertlevel,
        windKmh: Number(p.severitydata?.severity ?? 0),
        windText: p.severitydata?.severitytext ?? "",
        from: p.fromdate,
        to: p.todate,
        country: p.country || undefined,
        track: [],
        report: p.url?.report,
      });
    } else if (f.geometry?.type === "LineString" && /^Line/.test(p.Class ?? "")) {
      const arr = lines.get(id) ?? [];
      arr.push(...(f.geometry.coordinates as LonLat[]));
      lines.set(id, arr);
    }
  }
  for (const [id, c] of byEvent) c.track = lines.get(id) ?? [];
  return { list: [...byEvent.values()], stamp: r.stamp };
}

/** Radius of damaging winds assumed per intensity class. Estimate, shown as such. */
export function stormRadiusKm(windKmh: number): number {
  if (windKmh >= 209) return 400;
  if (windKmh >= 119) return 300;
  if (windKmh >= 63) return 220;
  return 120;
}

export function cycloneExposure(path: LonLat[], c: Cyclone) {
  const pts: LonLat[] = [c.at, ...c.track];
  let best = Infinity;
  let at: LonLat = c.at;
  for (const p of pts) {
    const d = distToPathKm(p, path);
    if (d < best) {
      best = d;
      at = p;
    }
  }
  const r = stormRadiusKm(c.windKmh);
  let sev: 0 | 1 | 2 | 3 = 0;
  if (best <= r) sev = c.alert === "Green" ? 2 : 3;
  else if (best <= r * 2) sev = c.alert === "Green" ? 1 : 2;
  return { distKm: best, radiusKm: r, sev, at };
}

export interface GdacsEvent {
  id: string;
  type: string;
  name: string;
  alert: string;
  at?: LonLat;
  country?: string;
  from?: string;
}

/** Other recent hazard events (earthquake, flood, volcano, drought, wildfire) at Orange/Red. */
export async function getOtherEvents(): Promise<{ list: GdacsEvent[]; stamp: SourceStamp }> {
  const r = await fetchSource<any>(`${BASE}/EVENTS4APP`, {
    id: "gdacs-events",
    name: "GDACS multi-hazard events",
    ttlMs: 10 * 60_000,
    timeoutMs: 20_000,
  });
  const list: GdacsEvent[] = [];
  for (const f of r.data?.features ?? []) {
    const p = f.properties ?? {};
    if (!["Orange", "Red"].includes(p.alertlevel)) continue;
    if (p.eventtype === "TC") continue;
    list.push({
      id: `${p.eventtype}${p.eventid}`,
      type: p.eventtype,
      name: p.name || p.description,
      alert: p.alertlevel,
      at: f.geometry?.type === "Point" ? (f.geometry.coordinates as LonLat) : undefined,
      country: p.country || undefined,
      from: p.fromdate,
    });
  }
  return { list, stamp: r.stamp };
}

export { haversineKm };
