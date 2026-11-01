import { fetchSource } from "../http";
import { median, mad } from "../geo";
import type { SourceStamp } from "../types";

/** IMF PortWatch daily chokepoint transit counts (AIS-derived, published with a lag of several days). */
const BASE = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
export const PORTWATCH_PAGE = "https://portwatch.imf.org/";

/** Dhruva chokepoint key -> PortWatch portid. The Mozambique Channel is not a PortWatch chokepoint. */
export const PW_ID: Record<string, string> = {
  suez: "chokepoint1",
  babelmandeb: "chokepoint4",
  malacca: "chokepoint5",
  hormuz: "chokepoint6",
  capegoodhope: "chokepoint7",
  gibraltar: "chokepoint8",
  dover: "chokepoint9",
  taiwan: "chokepoint11",
  korea: "chokepoint12",
};

/** PortWatch's ArcGIS host throttles bursts (the landing page asks for all nine chokepoints at once), so keep at most three requests in flight. */
let inflight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(f: () => Promise<T>): Promise<T> {
  if (inflight >= 3) await new Promise<void>((r) => waiting.push(r));
  inflight++;
  try {
    return await f();
  } finally {
    inflight--;
    waiting.shift()?.();
  }
}

export interface ChokeStat {
  key: string;
  portid: string;
  date: string;
  /** mean of the newest 3 daily counts */
  latest: number;
  /** median of the 180 days before those */
  longMedian: number;
  /** robust z against the preceding 60 days */
  z: number;
  ratio: number;
  /** upper-quartile daily count over all the history we load (about two years): a "busy normal day" reference that a collapse cannot drag down */
  refLevel: number;
  refRatio: number;
  /** true when the six-month baseline looks normal but traffic is far below the reference level */
  structural: boolean;
  series: { d: string; n: number }[];
  /** 0..3 severity of a traffic drop (or an unusual surge) */
  severity: 0 | 1 | 2 | 3;
  direction: "drop" | "surge" | "normal";
  stamp: SourceStamp;
}

export async function getChoke(key: string): Promise<{ stat: ChokeStat | null; stamp: SourceStamp }> {
  const portid = PW_ID[key];
  const year = new Date().getUTCFullYear();
  const where = encodeURIComponent(`portid='${portid}' AND year>=${year - 1}`);
  const url = `${BASE}?where=${where}&outFields=*&resultRecordCount=1000&f=json`;
  const r = await slot(() => fetchSource<any>(url, {
    id: `portwatch-${key}`,
    name: "IMF PortWatch (daily chokepoint transits)",
    ttlMs: 6 * 3600_000,
    staleMs: 48 * 3600_000,
    timeoutMs: 25_000,
    retries: 3,
    valid: (d) => !d?.error && Array.isArray(d?.features),
    observed: (d) => {
      const ds = (d.features ?? []).map((f: any) => f.attributes.date).sort();
      return ds.length ? ds[ds.length - 1] + "T00:00:00Z" : undefined;
    },
  }));
  if (!r.data || r.data.error || !Array.isArray(r.data.features)) {
    return { stat: null, stamp: { ...r.stamp, ok: false, note: r.error ?? r.data?.error?.message ?? "no data" } };
  }
  const rows: { d: string; n: number }[] = r.data.features
    .map((f: any) => ({ d: String(f.attributes.date), n: Number(f.attributes.n_total) }))
    .filter((x: any) => x.d && Number.isFinite(x.n))
    .sort((a: any, b: any) => (a.d < b.d ? -1 : 1));
  if (rows.length < 90) return { stat: null, stamp: { ...r.stamp, ok: false, note: "too little history" } };
  const n = rows.length;
  const latestRows = rows.slice(n - 3);
  const latest = latestRows.reduce((s, x) => s + x.n, 0) / 3;
  const longMedian = median(rows.slice(Math.max(0, n - 183), n - 3).map((x) => x.n));
  const win60 = rows.slice(n - 63, n - 3).map((x) => x.n);
  const m60 = median(win60);
  const sd = Math.max(1.4826 * mad(win60), Math.sqrt(Math.max(m60, 1)), 1);
  const z = (latest - m60) / sd;
  const ratio = longMedian > 0 ? latest / longMedian : 1;
  const hist = rows.slice(0, n - 3).map((x) => x.n).sort((a, b) => a - b);
  const refLevel = hist.length ? hist[Math.floor(0.75 * (hist.length - 1))] : 0;
  const refRatio = refLevel > 0 ? latest / refLevel : 1;
  let severity: 0 | 1 | 2 | 3 = 0;
  let direction: ChokeStat["direction"] = "normal";
  if (longMedian >= 5) {
    if (ratio <= 0.35 || z <= -4) severity = 3;
    else if (ratio <= 0.6 || z <= -3) severity = 2;
    else if (ratio <= 0.8 || z <= -2) severity = 1;
    if (severity) direction = "drop";
    else if (ratio >= 1.6 && z >= 3) {
      severity = 1;
      direction = "surge";
    }
  }
  let structural = false;
  if (severity === 0 && refLevel >= 10 && refRatio <= 0.35) {
    severity = 2;
    direction = "drop";
    structural = true;
  }
  return {
    stat: { key, portid, date: rows[n - 1].d, latest, longMedian, z, ratio, refLevel, refRatio, structural, series: rows.slice(-120), severity, direction, stamp: r.stamp },
    stamp: r.stamp,
  };
}

/** Cheap freshness probe used by /api/health. */
export async function probe() {
  const stats = encodeURIComponent(JSON.stringify([{ statisticType: "max", onStatisticField: "date", outStatisticFieldName: "d" }]));
  return fetchSource<any>(`${BASE}?where=1%3D1&outStatistics=${stats}&f=json`, {
    id: "portwatch-probe",
    name: "IMF PortWatch (daily chokepoint transits)",
    ttlMs: 5 * 60_000,
    timeoutMs: 20_000,
    retries: 1,
    valid: (d) => !d?.error && Array.isArray(d?.features),
    observed: (d) => (d.features?.[0]?.attributes?.d ? d.features[0].attributes.d + "T00:00:00Z" : undefined),
  });
}
