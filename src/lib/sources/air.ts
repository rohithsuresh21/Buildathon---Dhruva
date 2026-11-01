import { fetchSource, type Fetched } from "../http";
import type { LonLat } from "../geo";

const AWC = "https://aviationweather.gov/api/data";

export interface Metar {
  icaoId: string;
  reportTime: string;
  visib?: number | string;
  wxString?: string;
  fltCat?: string;
  wgst?: number;
  wspd?: number;
  rawOb?: string;
  name?: string;
}

export interface Isigmet {
  firId: string;
  firName?: string;
  seriesId?: string;
  hazard: string;
  qualifier?: string;
  validTimeFrom: number;
  validTimeTo: number;
  coords?: { lat: number; lon: number }[];
  rawSigmet?: string;
}

export async function getMetars(icaos: string[]): Promise<Fetched<Metar[]>> {
  const ids = [...new Set(icaos)].join(",");
  return fetchSource<Metar[]>(`${AWC}/metar?ids=${ids}&format=json`, {
    id: "awc-metar",
    name: "AviationWeather.gov METAR",
    ttlMs: 60_000,
    observed: (d: Metar[]) => d.map((m) => m.reportTime).sort().slice(-1)[0],
  });
}

export async function getIsigmets(): Promise<Fetched<Isigmet[]>> {
  return fetchSource<Isigmet[]>(`${AWC}/isigmet?format=json`, {
    id: "awc-isigmet",
    name: "AviationWeather.gov international SIGMET",
    ttlMs: 120_000,
    observed: (d: Isigmet[]) => new Date(Math.max(...d.map((s) => s.validTimeFrom)) * 1000).toISOString(),
  });
}

export interface NasEvent {
  airportId: string;
  airportLongName?: string;
  groundStop?: { impactingCondition?: string; endTime?: string } | null;
  groundDelay?: unknown;
  airportClosure?: unknown;
}

export async function getNasEvents(): Promise<Fetched<NasEvent[]>> {
  return fetchSource<NasEvent[]>("https://nasstatus.faa.gov/api/airport-events", {
    id: "faa-nas",
    name: "FAA NAS Status",
    ttlMs: 120_000,
  });
}

/** Best-effort live air traffic count in a box (OpenSky anonymous; may be blocked from cloud IPs). */
export async function getOpenSky(bbox: { lamin: number; lomin: number; lamax: number; lomax: number }) {
  const q = `lamin=${bbox.lamin}&lomin=${bbox.lomin}&lamax=${bbox.lamax}&lomax=${bbox.lomax}`;
  return fetchSource<{ time: number; states: unknown[][] | null }>(`https://opensky-network.org/api/states/all?${q}`, {
    id: "opensky",
    name: "OpenSky Network (anonymous)",
    ttlMs: 120_000,
    timeoutMs: 6000,
    observed: (d) => new Date(d.time * 1000).toISOString(),
  });
}

// ---- scoring (hazard exposure, not realised delay) -------------------------------------------

export function visibilityMetres(m: Metar): number {
  if (m.visib === undefined || m.visib === null) return 9999;
  if (typeof m.visib === "string") return 9999; // "6+" or "10+" means unrestricted
  return m.visib * 1609.34; // statute miles
}

export function metarSeverity(m: Metar, nowMs: number) {
  const ageMin = (nowMs - Date.parse(m.reportTime)) / 60000;
  const vis = visibilityMetres(m);
  const wx = m.wxString ?? "";
  const reasons: string[] = [];
  let score = 0;
  if (m.fltCat === "LIFR" || vis < 800) {
    score += 25;
    reasons.push(`visibility ${Math.round(vis)} m`);
  } else if (m.fltCat === "IFR" && vis < 1600) {
    score += 12;
    reasons.push(`low visibility ${Math.round(vis)} m`);
  }
  if (/TS|FC|SS|DS|VA|\+SH|FZ/.test(wx)) {
    score += 15;
    reasons.push(`weather ${wx}`);
  }
  if ((m.wgst ?? 0) >= 35) {
    score += 8;
    reasons.push(`gusts ${m.wgst} kt`);
  }
  return { score, reasons, ageMin: Math.round(ageMin), stale: ageMin > 120 };
}

function inPoly(p: LonLat, coords: { lat: number; lon: number }[]): boolean {
  let c = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i].lon, yi = coords[i].lat, xj = coords[j].lon, yj = coords[j].lat;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const HAZ_W: Record<string, number> = { TC: 40, VA: 40, TS: 20, TURB: 5, ICE: 5, MTW: 3 };

export function sigmetExposure(route: LonLat[], sigmets: Isigmet[], nowSec: number) {
  let score = 0;
  const hits: { fir: string; series?: string; hazard: string; frac: number; validTo: number; at: LonLat }[] = [];
  for (const s of sigmets) {
    if (nowSec < s.validTimeFrom - 3 * 3600 || nowSec > s.validTimeTo) continue;
    if (!s.coords || s.coords.length < 3) continue;
    const inside = route.filter((p) => inPoly(p, s.coords!));
    if (!inside.length) continue;
    const frac = inside.length / route.length;
    score += (HAZ_W[s.hazard] ?? 5) * Math.min(1, 0.4 + frac);
    hits.push({ fir: s.firId, series: s.seriesId, hazard: s.hazard, frac, validTo: s.validTimeTo, at: inside[Math.floor(inside.length / 2)] });
  }
  return { score: Math.min(score, 50), hits };
}
