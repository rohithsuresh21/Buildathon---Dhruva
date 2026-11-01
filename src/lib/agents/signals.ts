import { PLACES, BY_ID, type Place } from "../gazetteer";
import { distToPathKm, haversineKm, pickEven, resample, type LonLat } from "../geo";
import { getChoke, PW_ID } from "../sources/portwatch";
import { getCyclones, cycloneExposure, type Cyclone } from "../sources/gdacs";
import { getMarine, getWeather, scoreLandWeather, scoreSeaState } from "../sources/openmeteo";
import { getSachetFeed, getCap, sachetSeverity, CARGO_EVENT, type SachetAlert } from "../sources/sachet";
import { getQuakes } from "../sources/usgs";
import { getHeadlines } from "../sources/news";
import { getMetars, getIsigmets, getNasEvents, metarSeverity, sigmetExposure } from "../sources/air";
import type { AgentId, Leg, Signal, Severity, SourceStamp, TraceStage, Family } from "../types";

export type Emit = (e: { agent: AgentId; stage: TraceStage; status: "start" | "progress" | "ok" | "warn" | "fail" | "done"; text: string; source?: SourceStamp }) => void;

const ageDays = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / 864e5 : Infinity);
const ageH = (iso?: string) => (iso ? (Date.now() - Date.parse(iso)) / 36e5 : Infinity);
const sev = (n: number): Severity => (n >= 3 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0);
const sid = (...p: (string | number)[]) => p.join(":");

function mk(p: Omit<Signal, "confidence"> & { confidence?: number; fresh?: boolean }): Signal {
  const { fresh, confidence, ...rest } = p;
  return { ...rest, confidence: confidence ?? 0.6, data: { ...(p.data ?? {}), fresh: fresh ?? true } };
}

/** Request-scoped memo so that legs and itineraries share one fetch per source. */
export class Shared {
  private memo = new Map<string, Promise<any>>();
  once<T>(k: string, f: () => Promise<T>): Promise<T> {
    if (!this.memo.has(k)) this.memo.set(k, f());
    return this.memo.get(k)!;
  }
  cyclones() { return this.once("tc", () => getCyclones()); }
  quakes() { return this.once("eq", () => getQuakes()); }
  isigmets() { return this.once("sig", () => getIsigmets()); }
  nas() { return this.once("nas", () => getNasEvents()); }
  choke(key: string) { return this.once("pw:" + key, () => getChoke(key)); }
  async sachet(): Promise<{ alerts: SachetAlert[]; stamp: SourceStamp }> {
    return this.once("sachet", async () => {
      const feed = await getSachetFeed();
      const fresh = feed.items.filter((i) => ageH(i.published) <= 36).slice(0, 70);
      const alerts = await Promise.all(fresh.map((i) => getCap(i)));
      const live = alerts.filter((a) => !a.expires || Date.parse(a.expires) > Date.now());
      return { alerts: live, stamp: feed.stamp };
    });
  }
}

const place = (id: string): Place | undefined => BY_ID[id];

// --- MARITIME ---
export async function maritime(leg: Leg, sh: Shared, emit: Emit): Promise<Signal[]> {
  const out: Signal[] = [];
  const jobs: Promise<void>[] = [];

  for (const c of leg.chokepoints ?? []) {
    if (!PW_ID[c.key]) {
      emit({ agent: "maritime", stage: 3, status: "warn", text: `${c.name}: IMF PortWatch does not publish this passage, so no traffic reading.` });
      continue;
    }
    jobs.push(
      (async () => {
        emit({ agent: "maritime", stage: 3, status: "start", text: `Reading daily transits through ${c.name}` });
        const { stat, stamp } = await sh.choke(c.key);
        if (!stat) {
          emit({ agent: "maritime", stage: 3, status: "warn", text: `${c.name}: no transit data (${stamp.note ?? "unavailable"}).`, source: stamp });
          return;
        }
        const lag = Math.round(ageDays(stat.date + "T00:00:00Z"));
        const pct = Math.round(stat.ratio * 100);
        const title =
          stat.structural ? `${c.name}: transits far below their usual level` : stat.direction === "drop" ? `${c.name}: transits well below normal` : stat.direction === "surge" ? `${c.name}: transits unusually high` : `${c.name}: transits near normal`;
        const detail = `Latest 3-day average ${stat.latest.toFixed(1)} ships a day against a six-month median of ${stat.longMedian.toFixed(0)} (${pct}%) and a busy-day reference of ${stat.refLevel.toFixed(0)} from the past two years (${Math.round(stat.refRatio * 100)}%).${stat.structural ? " Traffic fell sharply earlier and has stayed low, so the recent baseline hides it." : ""} Data runs about ${lag} days behind. PortWatch counts are AIS-derived, so a drop can reflect fewer ships or gaps in AIS coverage.`;
        out.push(
          mk({
            id: sid(leg.id, "pw", c.key), agent: "maritime", legId: leg.id, mode: "sea", family: "traffic", severity: sev(stat.severity),
            confidence: lag <= 7 ? 0.8 : 0.5, fresh: lag <= 14, title, detail, at: [c.lon, c.lat], sources: [stamp],
            data: { series: stat.series.slice(-60), ratio: stat.ratio, z: stat.z },
          }),
        );
        emit({ agent: "maritime", stage: 3, status: stat.severity ? "warn" : "ok", text: `${c.name}: ${stat.latest.toFixed(1)} a day, ${pct}% of the six-month median, ${Math.round(stat.refRatio * 100)}% of its two-year busy-day level (z ${stat.z.toFixed(1)}).`, source: stamp });
      })(),
    );
  }

  // sea state along the open-water part of the route
  jobs.push(
    (async () => {
      const interior = leg.path.slice(Math.floor(leg.path.length * 0.06), Math.ceil(leg.path.length * 0.94));
      const samples = pickEven(resample(interior.length > 3 ? interior : leg.path, 700), 10);
      emit({ agent: "maritime", stage: 6, status: "start", text: `Reading wave forecasts at ${samples.length} points along the sea lane` });
      const { pts, stamp } = await getMarine(samples);
      if (!pts.length) {
        emit({ agent: "maritime", stage: 6, status: "warn", text: `Wave forecast unavailable (${stamp.note ?? "no data"}).`, source: stamp });
        return;
      }
      let worst = pts[0];
      for (const p of pts) if (p.maxWaveM > worst.maxWaveM) worst = p;
      const s = scoreSeaState(worst);
      out.push(
        mk({
          id: sid(leg.id, "wave"), agent: "maritime", legId: leg.id, mode: "sea", family: "weather", severity: sev(s.sev), confidence: 0.6,
          title: s.sev ? `Rough seas on the lane: ${s.reason}` : "Sea state looks workable",
          detail: `Highest wave height in the next 72 hours across ${pts.length} points is ${worst.maxWaveM.toFixed(1)} m, expected about ${Math.max(0, Math.round(worst.worstInH))} hours from now. Model forecast, not an observation.`,
          at: worst.at, sources: [stamp],
        }),
      );
      emit({ agent: "maritime", stage: 6, status: s.sev ? "warn" : "ok", text: `Highest forecast wave ${worst.maxWaveM.toFixed(1)} m in the next 72 h.`, source: stamp });
    })(),
  );

  // port weather at the two ends
  jobs.push(
    (async () => {
      const ends = [place(leg.from.id), place(leg.to.id)].filter(Boolean) as Place[];
      const pts: LonLat[] = [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
      emit({ agent: "maritime", stage: 6, status: "start", text: `Reading port weather at ${leg.from.name.split(" (")[0]} and ${leg.to.name.split(" (")[0]}` });
      const { pts: w, stamp } = await getWeather(pts);
      if (!w.length) {
        emit({ agent: "maritime", stage: 6, status: "warn", text: `Port weather unavailable (${stamp.note ?? "no data"}).`, source: stamp });
        return;
      }
      w.forEach((x, i) => {
        const name = (i === 0 ? leg.from.name : leg.to.name).split(" (")[0];
        const s = scoreLandWeather(x);
        out.push(
          mk({
            id: sid(leg.id, "pw-wx", i), agent: "maritime", legId: leg.id, mode: "sea", family: "weather", severity: sev(s.sev), confidence: 0.6,
            title: s.sev ? `${name}: ${s.reasons.join(", ")}` : `${name}: calm weather for port work`,
            detail: `Next 72 hours: peak gust ${Math.round(x.maxGustKmh)} km/h, ${Math.round(x.rain24h)} mm of rain in the first 24 h, lowest visibility ${Math.round(x.minVisM)} m. Model forecast.`,
            at: pts[i], sources: [stamp],
          }),
        );
      });
      void ends;
      emit({ agent: "maritime", stage: 6, status: "ok", text: "Port forecasts read for both ends.", source: stamp });
    })(),
  );
  await Promise.all(jobs);
  return out;
}

// --- STORM / HAZARD ---
export async function storm(leg: Leg, sh: Shared, emit: Emit): Promise<Signal[]> {
  const out: Signal[] = [];
  const [{ list, stamp }, q] = await Promise.all([sh.cyclones(), sh.quakes()]);
  const cyc: Cyclone[] = list;
  let any = false;
  if (!stamp.ok) emit({ agent: "storm", stage: 4, status: "warn", text: `GDACS cyclone feed unavailable (${stamp.note}).`, source: stamp });
  else {
    for (const c of cyc) {
      const e = cycloneExposure(leg.path, c);
      if (e.sev > 0) {
        any = true;
        out.push(
          mk({
            id: sid(leg.id, "tc", c.id), agent: "storm", legId: leg.id, mode: leg.mode, family: "hazard", severity: sev(e.sev), confidence: 0.85,
            title: `Tropical cyclone ${c.name} (${c.alert} alert) near this leg`,
            detail: `${c.windText || "Tropical system"}. Closest approach of its forecast track to this leg is about ${Math.round(e.distKm)} km; damaging winds are assumed within about ${e.radiusKm} km. Alert level is GDACS's own.`,
            at: e.at, sources: [stamp], data: { track: c.track, report: c.report },
          }),
        );
        emit({ agent: "storm", stage: 4, status: "warn", text: `${c.name} (${c.alert}) passes within ~${Math.round(e.distKm)} km of ${leg.label}.`, source: stamp });
      }
    }
    if (!any) {
      out.push(
        mk({
          id: sid(leg.id, "tc-none"), agent: "storm", legId: leg.id, mode: leg.mode, family: "hazard", severity: 0, confidence: 0.8,
          title: cyc.length ? "No tropical cyclone near this leg" : "No active tropical cyclone anywhere in GDACS's list",
          detail: cyc.length ? `${cyc.length} active system${cyc.length > 1 ? "s" : ""} worldwide (${cyc.map((c) => c.name).join(", ")}); none within range of this leg.` : "GDACS lists no current tropical cyclones.",
          sources: [stamp],
        }),
      );
      emit({ agent: "storm", stage: 4, status: "ok", text: `${cyc.length} cyclone${cyc.length === 1 ? "" : "s"} active worldwide; none near ${leg.label}.`, source: stamp });
    }
  }
  // earthquakes
  if (q.stamp.ok) {
    for (const e of q.list) {
      if (e.mag < 6) continue;
      const d = distToPathKm(e.at, leg.path);
      if (d <= 400) {
        out.push(
          mk({
            id: sid(leg.id, "eq", e.id), agent: "storm", legId: leg.id, mode: leg.mode, family: "hazard", severity: sev(e.mag >= 7 && d < 250 ? 3 : d < 250 ? 2 : 1), confidence: 0.8,
            title: `M${e.mag.toFixed(1)} earthquake ${Math.round(d)} km from this leg`,
            detail: `${e.place}. ${e.tsunami ? "USGS flags a tsunami possibility." : "No tsunami flag."} Check terminals and rail or road structures nearby.`,
            at: e.at, sources: [q.stamp],
          }),
        );
        emit({ agent: "storm", stage: 4, status: "warn", text: `M${e.mag.toFixed(1)} quake ${Math.round(d)} km from ${leg.label}.`, source: q.stamp });
      }
    }
  }
  return out;
}

// --- ALERTS (India) ---
function indianStates(leg: Leg): { states: Set<string>; names: Set<string> } {
  const states = new Set<string>();
  const names = new Set<string>();
  const ends = [place(leg.from.id), place(leg.to.id)];
  for (const p of ends) {
    if (p?.cc === "IN") {
      if (p.state) states.add(p.state);
      names.add(p.name.split(" (")[0]);
      p.aliases.filter((a) => /^[a-z ]+$/.test(a)).slice(0, 3).forEach((a) => names.add(a));
    }
  }
  if (leg.mode === "rail" || leg.mode === "road") {
    for (const p of PLACES) if (p.cc === "IN" && p.state && p.type !== "airport" && distToPathKm([p.lon, p.lat], leg.path) < 90) states.add(p.state);
  }
  return { states, names };
}

export async function alerts(leg: Leg, sh: Shared, emit: Emit): Promise<Signal[]> {
  const { states, names } = indianStates(leg);
  const touchesIndia = states.size > 0 || names.size > 0;
  if (!touchesIndia) return [];
  emit({ agent: "alerts", stage: 5, status: "start", text: `Checking NDMA Sachet for ${[...states].join(", ") || "Indian waters"}` });
  const { alerts: all, stamp } = await sh.sachet();
  if (!stamp.ok) {
    emit({ agent: "alerts", stage: 5, status: "warn", text: `NDMA Sachet unavailable (${stamp.note ?? "no response"}). Official alerts for India could not be checked.`, source: stamp });
    return [];
  }
  const toks = [...states, ...names].map((s) => s.toLowerCase());
  const seaWords = /(arabian sea|bay of bengal|fishermen|high wave|swell|storm surge|cyclon|tsunami|sea condition)/i;
  const matched = all.filter((a) => {
    const hay = `${a.title} ${a.area ?? ""}`.toLowerCase();
    const byPlace = toks.some((t) => hay.includes(t));
    const bySea = leg.mode === "sea" && seaWords.test(hay);
    return (byPlace || bySea) && (CARGO_EVENT.test(`${a.event ?? ""} ${a.title}`) || sachetSeverity(a) >= 3);
  });
  const rows = matched.map((a) => ({ a, s: sachetSeverity(a) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  const out: Signal[] = [];
  if (!rows.length) {
    out.push(
      mk({
        id: sid(leg.id, "sachet-none"), agent: "alerts", legId: leg.id, mode: leg.mode, family: "official", severity: 0, confidence: 0.75,
        title: `No active NDMA alert for ${[...states].join(", ") || "this leg"}`,
        detail: `Checked ${all.length} alerts issued in the last 36 hours. Regional-language alerts are matched through their English area field.`,
        sources: [stamp],
      }),
    );
    emit({ agent: "alerts", stage: 5, status: "ok", text: `${all.length} recent alerts nationwide; none for ${[...states].join(", ") || "this leg"}.`, source: stamp });
    return out;
  }
  for (const { a, s } of rows.slice(0, 3)) {
    out.push(
      mk({
        id: sid(leg.id, "sachet", a.id), agent: "alerts", legId: leg.id, mode: leg.mode, family: "official", severity: sev(s), confidence: 0.85,
        title: `${a.event ?? "Alert"}${a.severity && a.severity !== "Unknown" ? ` (${a.severity})` : ""}: ${a.area ?? "see alert"}`.slice(0, 120),
        detail: `${a.title.slice(0, 260)} Issued by ${a.sender ?? "an Indian authority"} at ${a.published}.`,
        sources: [{ ...stamp, url: a.link, name: "NDMA Sachet CAP message", observedAt: a.published }],
      }),
    );
    emit({ agent: "alerts", stage: 5, status: s >= 2 ? "warn" : "ok", text: `${a.event ?? "Alert"} (${a.severity ?? "?"}) in ${a.area ?? "region"}.`, source: { ...stamp, observedAt: a.published } });
  }
  return out;
}

// --- AVIATION ---
export async function aviation(leg: Leg, sh: Shared, emit: Emit): Promise<Signal[]> {
  const a = place(leg.from.id);
  const b = place(leg.to.id);
  const out: Signal[] = [];
  const icaos = [a?.icao, b?.icao].filter(Boolean) as string[];
  emit({ agent: "aviation", stage: 6, status: "start", text: `Reading airport weather reports (METAR) for ${icaos.join(" and ")}` });
  const [m, sg, nas] = await Promise.all([getMetars(icaos), sh.isigmets(), sh.nas()]);
  if (m.data) {
    for (const mm of m.data) {
      const s = metarSeverity(mm, Date.now());
      const name = mm.name?.split(",")[0] ?? mm.icaoId;
      const lvl = s.score >= 40 ? 3 : s.score >= 25 ? 2 : s.score >= 12 ? 1 : 0;
      out.push(
        mk({
          id: sid(leg.id, "metar", mm.icaoId), agent: "aviation", legId: leg.id, mode: "air", family: "weather", severity: sev(lvl), confidence: 0.8, fresh: !s.stale,
          title: lvl ? `${mm.icaoId} ${name}: ${s.reasons.join(", ")}` : `${mm.icaoId} ${name}: normal operating conditions`,
          detail: `Observation ${s.ageMin} minutes old. ${mm.rawOb ?? ""}`.trim(),
          at: undefined, sources: [{ ...m.stamp, observedAt: mm.reportTime.endsWith("Z") ? mm.reportTime : mm.reportTime + "Z" }],
        }),
      );
    }
    emit({ agent: "aviation", stage: 6, status: "ok", text: `${m.data.length} airport observations read.`, source: m.stamp });
  } else emit({ agent: "aviation", stage: 6, status: "warn", text: `METAR feed unavailable (${m.stamp.note}).`, source: m.stamp });

  if (sg.data) {
    const route = resample(leg.path, 200);
    const ex = sigmetExposure(route, sg.data, Date.now() / 1000);
    const lvl = ex.score >= 40 ? 3 : ex.score >= 20 ? 2 : ex.score > 0 ? 1 : 0;
    out.push(
      mk({
        id: sid(leg.id, "sigmet"), agent: "aviation", legId: leg.id, mode: "air", family: "hazard", severity: sev(lvl), confidence: 0.75,
        title: lvl ? `Active SIGMET along the route: ${[...new Set(ex.hits.map((h) => h.hazard))].join(", ")}` : "No active SIGMET along the great-circle route",
        detail: lvl
          ? `${ex.hits.length} advisor${ex.hits.length > 1 ? "ies" : "y"} overlap the route (${ex.hits.map((h) => `${h.fir} ${h.hazard}`).join("; ")}). Airlines usually route around these.`
          : `Checked ${sg.data.length} international SIGMETs against the great-circle path. Actual airways differ from a great circle.`,
        at: ex.hits[0]?.at, sources: [sg.stamp],
      }),
    );
    emit({ agent: "aviation", stage: 4, status: lvl ? "warn" : "ok", text: lvl ? `${ex.hits.length} SIGMET(s) overlap the air route.` : "No SIGMET overlaps the air route.", source: sg.stamp });
  } else emit({ agent: "aviation", stage: 4, status: "warn", text: `SIGMET feed unavailable (${sg.stamp.note}).`, source: sg.stamp });

  const us = [a, b].filter((p) => p?.cc === "US");
  if (us.length) {
    if (nas.data) {
      for (const p of us) {
        const ev: any = nas.data.find((x: any) => x.airportId === p!.iata || x.airportId === p!.icao?.slice(1));
        const lvl = ev?.airportClosure ? 3 : ev?.groundStop ? 3 : ev?.groundDelay ? 2 : 0;
        out.push(
          mk({
            id: sid(leg.id, "faa", p!.id), agent: "aviation", legId: leg.id, mode: "air", family: "official", severity: sev(lvl), confidence: 0.85,
            title: lvl ? `FAA reports a ${ev?.groundStop ? "ground stop" : ev?.groundDelay ? "ground delay programme" : "closure"} at ${p!.iata}` : `FAA lists no ground stop or delay programme at ${p!.iata}`,
            detail: "FAA National Airspace System status.", sources: [nas.stamp],
          }),
        );
      }
      emit({ agent: "aviation", stage: 5, status: "ok", text: "FAA status read for US airports.", source: nas.stamp });
    } else emit({ agent: "aviation", stage: 5, status: "warn", text: `FAA status unavailable (${nas.stamp.note}).`, source: nas.stamp });
  }
  return out;
}

// --- SURFACE (rail + road) ---
export async function surface(leg: Leg, _sh: Shared, emit: Emit): Promise<Signal[]> {
  const samples = pickEven(resample(leg.path, 120), 14);
  emit({ agent: "surface", stage: 6, status: "start", text: `Reading weather at ${samples.length} points along the ${leg.mode} corridor` });
  const { pts, stamp } = await getWeather(samples);
  if (!pts.length) {
    emit({ agent: "surface", stage: 6, status: "warn", text: `Corridor weather unavailable (${stamp.note ?? "no data"}).`, source: stamp });
    return [];
  }
  let worstI = 0;
  let worstS = -1;
  const scored = pts.map((p, i) => {
    const s = scoreLandWeather(p);
    const key = s.sev * 1000 + p.rain24h + p.maxGustKmh / 10;
    if (key > worstS) {
      worstS = key;
      worstI = i;
    }
    return s;
  });
  const w = pts[worstI];
  const s = scored[worstI];
  let nearest = "";
  let nd = Infinity;
  for (const p of PLACES) {
    if (p.type === "airport") continue;
    const d = haversineKm(w.at, [p.lon, p.lat]);
    if (d < nd) {
      nd = d;
      nearest = p.name.split(" (")[0];
    }
  }
  const sig = mk({
    id: sid(leg.id, "corridor-wx"), agent: "surface", legId: leg.id, mode: leg.mode, family: "weather", severity: sev(s.sev), confidence: 0.6,
    title: s.sev ? `Corridor weather near ${nearest}: ${s.reasons.join(", ")}` : "Corridor weather is workable along the whole route",
    detail: `Worst of ${pts.length} sampled points in the next 72 hours: peak gust ${Math.round(w.maxGustKmh)} km/h, ${Math.round(w.rain24h)} mm of rain in 24 h, lowest visibility ${Math.round(w.minVisM)} m. Model forecast. No live road-traffic or railway-operations feed is used.`,
    at: w.at, sources: [stamp],
  });
  emit({ agent: "surface", stage: 6, status: s.sev ? "warn" : "ok", text: s.sev ? `Worst corridor weather near ${nearest}: ${s.reasons.join(", ")}.` : "Corridor weather workable at all sampled points.", source: stamp });
  return [sig];
}

// --- NEWS ---
export async function news(legs: Leg[], emit: Emit): Promise<Signal[]> {
  const names = [...new Set(legs.flatMap((l) => (l.mode === "sea" ? (l.chokepoints ?? []).map((c) => c.name) : [])))].slice(0, 4);
  if (!names.length) return [];
  emit({ agent: "news", stage: 7, status: "start", text: `Scanning the past 3 days of news for ${names.join(", ")}` });
  const q = `(${names.map((n) => `"${n}"`).join(" OR ")})`;
  const r = await getHeadlines(q);
  if (!r.stamp.ok) {
    emit({ agent: "news", stage: 7, status: "warn", text: `News index unavailable (${r.stamp.note}). Continuing without it.`, source: r.stamp });
    return [];
  }
  const out: Signal[] = [];
  for (const l of legs.filter((x) => x.mode === "sea")) {
    const mine = r.list.filter((h) => (l.chokepoints ?? []).some((c) => h.title.toLowerCase().includes(c.name.split(" ")[0].toLowerCase()) || h.title.toLowerCase().includes(c.key)));
    out.push(
      mk({
        id: sid(l.id, "news"), agent: "news", legId: l.id, mode: "sea", family: "news", severity: mine.length >= 2 ? 1 : 0, confidence: 0.4,
        title: mine.length ? `${mine.length} recent headline${mine.length > 1 ? "s" : ""} mention disruption on this lane` : "No disruption headlines found for the lane's chokepoints",
        detail: mine.length ? mine.map((h) => `${h.title} (${h.domain})`).join(" | ") : `Searched GDELT for ${names.join(", ")} over 3 days. News is a weak signal: it can only add a notch, never decide a verdict alone.`,
        sources: [r.stamp],
      }),
    );
  }
  emit({ agent: "news", stage: 7, status: "ok", text: `${r.list.length} disruption-related headline(s) in the past 3 days.`, source: r.stamp });
  return out;
}

export const FAMILIES_BY_MODE: Record<Leg["mode"], Family[]> = {
  sea: ["traffic", "hazard", "official", "weather", "news"],
  air: ["hazard", "official", "weather"],
  rail: ["weather", "official", "hazard"],
  road: ["weather", "official", "hazard"],
};
