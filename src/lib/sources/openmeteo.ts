import { fetchSource } from "../http";
import type { LonLat } from "../geo";
import type { SourceStamp } from "../types";

const WX = "https://api.open-meteo.com/v1/forecast";
const MARINE = "https://marine-api.open-meteo.com/v1/marine";

export interface PointWeather {
  at: LonLat;
  maxGustKmh: number;
  maxWindKmh: number;
  rain24h: number;
  rain72h: number;
  minVisM: number;
  stormCode: boolean;
  /** hours from now of the worst gust */
  worstInH: number;
}
export interface PointMarine {
  at: LonLat;
  maxWaveM: number;
  maxPeriodS: number;
  worstInH: number;
}

const list = (pts: LonLat[], i: 0 | 1) => pts.map((p) => p[i].toFixed(3)).join(",");

export async function getWeather(points: LonLat[]): Promise<{ pts: PointWeather[]; stamp: SourceStamp }> {
  if (!points.length) return { pts: [], stamp: { id: "om", name: "Open-Meteo forecast", url: WX, fetchedAt: new Date().toISOString(), ok: true, ms: 0 } };
  const url = `${WX}?latitude=${list(points, 1)}&longitude=${list(points, 0)}&hourly=wind_speed_10m,wind_gusts_10m,precipitation,visibility,weather_code&forecast_days=3&timezone=UTC&wind_speed_unit=kmh`;
  const r = await fetchSource<any>(url, {
    id: "open-meteo",
    name: "Open-Meteo forecast (NWP model data)",
    ttlMs: 15 * 60_000,
    timeoutMs: 12_000,
    observed: (d) => {
      const x = Array.isArray(d) ? d[0] : d;
      return x?.hourly?.time?.[0] ? x.hourly.time[0] + ":00Z" : undefined;
    },
  });
  if (!r.data) return { pts: [], stamp: r.stamp };
  const arr: any[] = Array.isArray(r.data) ? r.data : [r.data];
  const nowH = Date.now();
  const pts: PointWeather[] = arr.map((x, i) => {
    const h = x.hourly ?? {};
    const times: string[] = h.time ?? [];
    const start = Math.max(0, times.findIndex((t) => Date.parse(t + "Z") >= nowH - 3600_000));
    const slice = (k: string, n: number) => (h[k] ?? []).slice(start, start + n).map((v: any) => (v == null ? 0 : v));
    const gust: number[] = slice("wind_gusts_10m", 72);
    const wind: number[] = slice("wind_speed_10m", 72);
    const rain: number[] = slice("precipitation", 72);
    const vis: number[] = slice("visibility", 72).filter((v: number) => v > 0);
    const code: number[] = slice("weather_code", 72);
    const mx = Math.max(0, ...gust);
    return {
      at: points[i],
      maxGustKmh: mx,
      maxWindKmh: Math.max(0, ...wind),
      rain24h: rain.slice(0, 24).reduce((a, b) => a + b, 0),
      rain72h: rain.reduce((a, b) => a + b, 0),
      minVisM: vis.length ? Math.min(...vis) : 20000,
      stormCode: code.some((c) => c >= 95),
      worstInH: gust.indexOf(mx),
    };
  });
  return { pts, stamp: r.stamp };
}

export async function getMarine(points: LonLat[]): Promise<{ pts: PointMarine[]; stamp: SourceStamp }> {
  if (!points.length) return { pts: [], stamp: { id: "om-marine", name: "Open-Meteo marine", url: MARINE, fetchedAt: new Date().toISOString(), ok: true, ms: 0 } };
  const url = `${MARINE}?latitude=${list(points, 1)}&longitude=${list(points, 0)}&hourly=wave_height,wave_period&forecast_days=3&timezone=UTC`;
  const r = await fetchSource<any>(url, {
    id: "open-meteo-marine",
    name: "Open-Meteo marine (wave model data)",
    ttlMs: 30 * 60_000,
    timeoutMs: 12_000,
    observed: (d) => {
      const x = Array.isArray(d) ? d[0] : d;
      return x?.hourly?.time?.[0] ? x.hourly.time[0] + ":00Z" : undefined;
    },
  });
  if (!r.data) return { pts: [], stamp: r.stamp };
  const arr: any[] = Array.isArray(r.data) ? r.data : [r.data];
  const nowH = Date.now();
  const pts: PointMarine[] = arr.map((x, i) => {
    const h = x.hourly ?? {};
    const times: string[] = h.time ?? [];
    const start = Math.max(0, times.findIndex((t) => Date.parse(t + "Z") >= nowH - 3600_000));
    const wave: number[] = (h.wave_height ?? []).slice(start, start + 72).map((v: any) => (v == null ? 0 : v));
    const per: number[] = (h.wave_period ?? []).slice(start, start + 72).map((v: any) => (v == null ? 0 : v));
    const mx = Math.max(0, ...wave);
    return { at: points[i], maxWaveM: mx, maxPeriodS: Math.max(0, ...per), worstInH: wave.indexOf(mx) };
  });
  return { pts, stamp: r.stamp };
}

/** WMO-style plain-language scoring for a land or port point. 0..3 */
export function scoreLandWeather(w: PointWeather): { sev: 0 | 1 | 2 | 3; reasons: string[] } {
  let sev: 0 | 1 | 2 | 3 = 0;
  const reasons: string[] = [];
  const up = (s: 1 | 2 | 3) => {
    if (s > sev) sev = s;
  };
  if (w.maxGustKmh >= 100) { up(3); reasons.push(`gusts to ${Math.round(w.maxGustKmh)} km/h`); }
  else if (w.maxGustKmh >= 75) { up(2); reasons.push(`gusts to ${Math.round(w.maxGustKmh)} km/h`); }
  else if (w.maxGustKmh >= 60) { up(1); reasons.push(`gusts to ${Math.round(w.maxGustKmh)} km/h`); }
  if (w.rain24h >= 115) { up(3); reasons.push(`${Math.round(w.rain24h)} mm of rain in 24 h`); }
  else if (w.rain24h >= 65) { up(2); reasons.push(`${Math.round(w.rain24h)} mm of rain in 24 h`); }
  else if (w.rain24h >= 35) { up(1); reasons.push(`${Math.round(w.rain24h)} mm of rain in 24 h`); }
  if (w.minVisM < 200) { up(2); reasons.push(`visibility down to ${Math.round(w.minVisM)} m`); }
  else if (w.minVisM < 800) { up(1); reasons.push(`visibility down to ${Math.round(w.minVisM)} m`); }
  if (w.stormCode) { up(1); reasons.push("thunderstorms forecast"); }
  return { sev, reasons };
}

export function scoreSeaState(m: PointMarine): { sev: 0 | 1 | 2 | 3; reason?: string } {
  if (m.maxWaveM >= 7) return { sev: 3, reason: `waves up to ${m.maxWaveM.toFixed(1)} m` };
  if (m.maxWaveM >= 5) return { sev: 2, reason: `waves up to ${m.maxWaveM.toFixed(1)} m` };
  if (m.maxWaveM >= 3.5) return { sev: 1, reason: `waves up to ${m.maxWaveM.toFixed(1)} m` };
  return { sev: 0 };
}

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
export interface Geo {
  name: string;
  lon: number;
  lat: number;
  cc: string;
  country: string;
  admin1?: string;
}
export async function geocode(name: string): Promise<{ hit: Geo | null; stamp: SourceStamp }> {
  const url = `${GEO}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const r = await fetchSource<any>(url, { id: "om-geocode", name: "Open-Meteo geocoding (GeoNames)", ttlMs: 24 * 3600_000, timeoutMs: 5000 });
  const x = r.data?.results?.[0];
  return { hit: x ? { name: x.name, lon: x.longitude, lat: x.latitude, cc: x.country_code, country: x.country, admin1: x.admin1 } : null, stamp: r.stamp };
}
