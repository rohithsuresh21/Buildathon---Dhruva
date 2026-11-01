import { fetchSource } from "@/lib/http";
import { probe as pwProbe } from "@/lib/sources/portwatch";
import { getCyclones } from "@/lib/sources/gdacs";
import { getSachetFeed } from "@/lib/sources/sachet";
import { getWeather, getMarine } from "@/lib/sources/openmeteo";
import { roadRoute } from "@/lib/sources/osrm";
import { getMetars, getIsigmets, getNasEvents } from "@/lib/sources/air";
import { getQuakes } from "@/lib/sources/usgs";
import { getHeadlines } from "@/lib/sources/news";
import type { SourceStamp } from "@/lib/types";

export const maxDuration = 60;

interface Row {
  id: string;
  name: string;
  covers: string;
  terms: string;
  url: string;
  ok: boolean;
  ms: number;
  observedAt?: string;
  fetchedAt: string;
  note?: string;
}

const row = (s: SourceStamp, covers: string, terms: string, url?: string): Row => ({
  id: s.id, name: s.name, covers, terms, url: url ?? s.url, ok: s.ok, ms: s.ms, observedAt: s.observedAt, fetchedAt: s.fetchedAt, note: s.note,
});

export async function GET() {
  const now: [number, number][] = [[72.9, 19.0]];
  const [pw, tc, sa, wx, mar, osrm, metar, sig, nas, eq, gd, geo] = await Promise.all([
    pwProbe(),
    getCyclones(),
    getSachetFeed(),
    getWeather(now),
    getMarine([[68, 20]]),
    roadRoute([72.83, 19.07], [77.2, 28.6]),
    getMetars(["VABB"]),
    getIsigmets(),
    getNasEvents(),
    getQuakes(),
    getHeadlines('"Strait of Hormuz"'),
    fetchSource("https://geocoding-api.open-meteo.com/v1/search?name=Pune&count=1", { id: "om-geocode", name: "Open-Meteo geocoding (GeoNames)", ttlMs: 3600_000, timeoutMs: 5000 }),
  ]);
  const sources: Row[] = [
    row(pw.stamp, "Daily ship transits at 28 chokepoints (we use 9 on our sea graph)", "IMF PortWatch. Public data; cite IMF and Oxford; check terms for commercial use.", "https://portwatch.imf.org/"),
    row(tc.stamp, "Active tropical cyclones with forecast track and alert level", "GDACS (UN / EU JRC). Free with attribution.", "https://www.gdacs.org/"),
    row(sa.stamp, "Official Indian alerts (cyclone, flood, rain, surge) in CAP format", "NDMA Sachet. Government of India public alert feed.", "https://sachet.ndma.gov.in/"),
    row(wx.stamp, "72-hour wind, rain and visibility forecast at any coordinate", "Open-Meteo. Free for non-commercial use; commercial use needs an API plan.", "https://open-meteo.com/"),
    row(mar.stamp, "72-hour wave height and period over open water", "Open-Meteo marine. Same terms.", "https://open-meteo.com/en/docs/marine-weather-api"),
    row(osrm ? osrm.stamp : { id: "osrm", name: "OSRM road routing (OpenStreetMap)", url: "https://router.project-osrm.org/", fetchedAt: new Date().toISOString(), ok: false, ms: 0, note: "no route" }, "Real road geometry and distance for trucking legs", "OSRM public demo server. Fair use only; self-host for production.", "https://project-osrm.org/"),
    row(metar.stamp, "Airport weather observations (METAR)", "NOAA Aviation Weather Center. US public domain.", "https://aviationweather.gov/"),
    row(sig.stamp, "International SIGMET hazard polygons for aviation", "NOAA Aviation Weather Center. US public domain.", "https://aviationweather.gov/"),
    row(nas.stamp, "US airport ground stops, delay programmes and closures", "FAA NAS Status. US government public data.", "https://nasstatus.faa.gov/"),
    row(eq.stamp, "Earthquakes of magnitude 4.5 and above, past day", "USGS. US public domain.", "https://earthquake.usgs.gov/"),
    row(gd.stamp, "Global news headlines about chokepoints (weak signal, best effort)", "GDELT Project. Free; cite GDELT.", "https://www.gdeltproject.org/"),
    row(geo.stamp, "Looks up cities that are not in Dhruva's built-in port list", "Open-Meteo geocoding on GeoNames data. CC BY 4.0.", "https://open-meteo.com/en/docs/geocoding-api"),
  ];
  return Response.json({ generatedAt: new Date().toISOString(), sources }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } });
}
