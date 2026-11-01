import { CHOKEPOINT_LIST } from "@/lib/seagraph";
import { getChoke, PW_ID } from "@/lib/sources/portwatch";
import { getCyclones, getOtherEvents } from "@/lib/sources/gdacs";
import type { PulseChoke, PulseData, Status } from "@/lib/pulse-types";
import type { SourceStamp } from "@/lib/types";

export const maxDuration = 90;

export async function GET() {
  const sources: SourceStamp[] = [];
  const keys = CHOKEPOINT_LIST;
  const [stats, tc, ev] = await Promise.all([
    Promise.all(keys.map((c) => (PW_ID[c.key] ? getChoke(c.key) : Promise.resolve(null)))),
    getCyclones(),
    getOtherEvents(),
  ]);
  const chokepoints: PulseChoke[] = keys.map((c, i) => {
    const s = stats[i];
    if (s) sources.push(s.stamp);
    const st = s?.stat;
    const status: Status = !st ? "na" : st.severity >= 3 ? "red" : st.severity >= 1 ? "amber" : "green";
    return {
      key: c.key, name: c.name, lon: c.lon, lat: c.lat, status,
      z: st ? Math.round(st.z * 10) / 10 : null,
      latest: st ? Math.round(st.latest * 10) / 10 : null,
      baseline: st ? Math.round(st.longMedian * 10) / 10 : null,
      date: st?.date ?? null,
      series: st?.series.slice(-90),
    };
  });
  sources.push(tc.stamp, ev.stamp);
  const dates = chokepoints.map((c) => c.date).filter(Boolean) as string[];
  const data: PulseData = {
    generatedAt: new Date().toISOString(),
    chokepoints,
    cyclones: tc.list.map((c) => ({ id: c.id, name: c.name, lon: c.at[0], lat: c.at[1], alert: c.alert, country: c.country, fromdate: c.from, track: c.track.slice(0, 40) })),
    events: ev.list.slice(0, 12).map((e) => ({ id: e.id, type: e.type, name: e.name, alert: e.alert, country: e.country, lon: e.at?.[0], lat: e.at?.[1], fromdate: e.from })),
    sources: sources.filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i),
    newestRecord: dates.sort().pop() ?? null,
  };
  return Response.json(data, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
}
