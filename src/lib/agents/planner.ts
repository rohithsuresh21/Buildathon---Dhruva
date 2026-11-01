import { BY_ID, PLACES, nearestAirport, type Place } from "../gazetteer";
import { chaikin, greatCircle, haversineKm, pathLengthKm, distToPathKm, type LonLat } from "../geo";
import { RAIL_CORRIDORS, smoothPath } from "../lanes";
import { NODES, buildRoute, shortestSea } from "../seagraph";
import { roadRoute } from "../sources/osrm";
import type { ParsedShipment } from "../analysis-types";
import type { Itinerary, Leg, SourceStamp } from "../types";

const ROAD_KM_PER_DAY = 400;
const RAIL_KM_PER_DAY = 450;
const AIR_KMH = 800;

export interface PlanResult {
  itineraries: Itinerary[];
  primary: string;
  notes: string[];
  stamps: SourceStamp[];
  places: { origin: Place; destination: Place };
}

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function placeOf(p: ParsedShipment["origin"]): Place {
  const known = BY_ID[p.id];
  if (known) return known;
  return { id: p.id, name: p.name, type: p.type as Place["type"], country: p.country, cc: p.cc, lon: p.lon, lat: p.lat, aliases: [], state: p.state };
}

const pt = (p: { lon: number; lat: number }): LonLat => [p.lon, p.lat];
const ref = (p: Place) => ({ id: p.id, name: p.name, lon: p.lon, lat: p.lat });

function portsNear(p: Place, n: number): Place[] {
  const cc = p.cc;
  const usable = (x: Place) => x.type === "port" && !!x.seaNode && (!x.bulk || (x.size ?? 0) >= 2) && x.id !== p.id;
  const pool = PLACES.filter((x) => usable(x) && (cc === "IN" ? x.cc === "IN" : x.cc === cc));
  const ranked = (pool.length ? pool : PLACES.filter(usable)).sort((a, b) => haversineKm(pt(p), pt(a)) - haversineKm(pt(p), pt(b)));
  return ranked.slice(0, n);
}

function seaLeg(a: Place, b: Place, avoid: Set<string> = new Set()): { leg: Leg; nodes: string[] } | null {
  if (!a.seaNode || !b.seaNode) return null;
  const r = shortestSea(a.seaNode, b.seaNode, avoid);
  if (!r) return null;
  const route = buildRoute(r.nodes, { start: pt(a), end: pt(b) });
  const path = smoothPath(chaikin(route.path));
  return {
    nodes: r.nodes,
    leg: {
      id: `sea-${hash(a.id + b.id + r.nodes.join(">"))}`,
      mode: "sea",
      label: `${short(a)} to ${short(b)} by sea`,
      from: ref(a),
      to: ref(b),
      path,
      km: route.km,
      days: route.days,
      chokepoints: route.chokepoints,
      geometry: "Curated sea-lane graph; shortest path, great-circle segments. Not a vessel's actual track.",
    },
  };
}

function short(p: Place) {
  return p.name.split(" (")[0];
}

function railBetween(a: Place, b: Place): { path: LonLat[]; label: string } | null {
  for (const c of RAIL_CORRIDORS) {
    const near = (p: Place) => {
      let best = -1;
      let bd = Infinity;
      c.stations.forEach((s, i) => {
        const d = haversineKm(pt(p), [s.lon, s.lat]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return { i: best, d: bd };
    };
    const na = near(a);
    const nb = near(b);
    if (na.d <= 90 && nb.d <= 90 && na.i !== nb.i) {
      const [i, j] = na.i < nb.i ? [na.i, nb.i] : [nb.i, na.i];
      let pts: LonLat[] = c.stations.slice(i, j + 1).map((s) => [s.lon, s.lat] as LonLat);
      if (na.i > nb.i) pts = pts.reverse();
      return { path: smoothPath([pt(a), ...pts, pt(b)], 1), label: c.label };
    }
  }
  return null;
}

async function landLeg(a: Place, b: Place, prefer: "road" | "rail" | "auto", stamps: SourceStamp[], notes: string[]): Promise<Leg | null> {
  if (haversineKm(pt(a), pt(b)) < 8) return null;
  const sameIn = a.cc === "IN" && b.cc === "IN";
  if ((prefer === "rail" || prefer === "auto") && sameIn) {
    const r = railBetween(a, b);
    if (r) {
      const km = pathLengthKm(r.path) * 1.06;
      return {
        id: `rail-${hash(a.id + b.id)}`,
        mode: "rail",
        label: `${short(a)} to ${short(b)} by rail`,
        from: ref(a),
        to: ref(b),
        path: r.path,
        km,
        days: km / RAIL_KM_PER_DAY + 0.5,
        geometry: `Curated trunk corridor (${r.label}) through real station coordinates; distance +6% for track curvature. Not a timetable.`,
      };
    }
  }
  const rr = await roadRoute(pt(a), pt(b));
  if (rr) {
    stamps.push(rr.stamp);
    return {
      id: `road-${hash(a.id + b.id)}`,
      mode: "road",
      label: `${short(a)} to ${short(b)} by road`,
      from: ref(a),
      to: ref(b),
      path: rr.path,
      km: rr.km,
      days: rr.km / ROAD_KM_PER_DAY,
      geometry: "OpenStreetMap road route from OSRM. Transit days assume about 400 km a day for a truck, not OSRM's car speed.",
    };
  }
  notes.push(`Road routing was unavailable for ${short(a)} to ${short(b)}; drawn as a straight line with distance +25%.`);
  const path = greatCircle(pt(a), pt(b), 24);
  const km = pathLengthKm(path) * 1.25;
  return {
    id: `road-${hash(a.id + b.id)}`,
    mode: "road",
    label: `${short(a)} to ${short(b)} by road`,
    from: ref(a),
    to: ref(b),
    path,
    km,
    days: km / ROAD_KM_PER_DAY,
    geometry: "Straight line with +25% distance (routing service did not answer). Estimate.",
  };
}

function airLeg(a: Place, b: Place): Leg {
  const path = greatCircle(pt(a), pt(b), 64);
  const km = pathLengthKm(path);
  return {
    id: `air-${hash(a.id + b.id)}`,
    mode: "air",
    label: `${a.iata ?? short(a)} to ${b.iata ?? short(b)} by air`,
    from: ref(a),
    to: ref(b),
    path,
    km,
    days: km / AIR_KMH / 24 + 1,
    geometry: "Great-circle between airports. Real airways differ. Includes about one day for handling.",
  };
}

const sum = (legs: Leg[]) => ({ km: legs.reduce((s, l) => s + l.km, 0), days: legs.reduce((s, l) => s + l.days, 0) });
const itin = (id: string, label: string, legs: Leg[], note?: string): Itinerary => ({ id, label, legs, ...sum(legs), note });

function airportFor(p: Place): Place | undefined {
  if (p.type === "airport") return p;
  return nearestAirport(p, p.cc) ?? nearestAirport(p);
}

export interface PlanOptions {
  /** search wider for safer routings: sister ports, every chokepoint avoided, more candidates */
  deep?: boolean;
}

export async function plan(parsed: ParsedShipment, opts: PlanOptions = {}): Promise<PlanResult | { error: { message: string; hint: string } }> {
  const o = placeOf(parsed.origin);
  const d = placeOf(parsed.destination);
  const stamps: SourceStamp[] = [];
  const notes: string[] = [];
  const out: Itinerary[] = [];
  const dist = haversineKm(pt(o), pt(d));
  const bothIndia = o.cc === "IN" && d.cc === "IN";
  const places = { origin: o, destination: d };

  const wantAir = parsed.modeHint === "air" || (o.type === "airport" && d.type === "airport");

  // ---- AIR as the main plan
  const makeAir = (): Itinerary | null => {
    const ao = airportFor(o);
    const ad = airportFor(d);
    if (!ao || !ad || ao.id === ad.id) return null;
    const legs = [airLeg(ao, ad)];
    return itin("air", `By air, ${ao.iata} to ${ad.iata}`, legs, "Airport to airport. First and last mile are not included.");
  };

  // ---- Domestic (both in India)
  if (bothIndia && !wantAir) {
    const rail = await landLeg(o, d, "rail", stamps, notes);
    const road = await landLeg(o, d, "road", stamps, notes);
    if (rail && rail.mode === "rail") out.push(itin("rail", "By rail", [rail]));
    if (road) out.push(itin("road", "By road", [road]));
    if (parsed.modeHint === "road" && out.length > 1) out.reverse();
    if (!out.length) return { error: { message: "Could not build a route between those two places.", hint: "Try two different cities." } };
    const a = dist > 600 ? makeAir() : null;
    if (a) out.push(a);
    return { itineraries: out, primary: out[0].id, notes, stamps, places };
  }

  // ---- International by sea (default) with land pre/post-carriage
  if (!wantAir) {
    const oPorts = o.type === "port" && o.seaNode ? [o] : portsNear(o, 2);
    const dPorts = d.type === "port" && d.seaNode ? [d] : portsNear(d, 2);
    for (const [x, ps] of [[o, oPorts], [d, dPorts]] as [Place, Place[]][]) {
      if (x.type === "port" && !x.seaNode && ps[0]) notes.push(`${short(x)} is not on Dhruva's sea-lane graph, so the sea leg starts at ${short(ps[0])}.`);
    }
    if (!oPorts.length || !dPorts.length) return { error: { message: "No port found near one of those places.", hint: "Name a port city, or an Indian city with a port nearby." } };

    const build = async (op: Place, dp: Place, id: string, label: string, avoid: Set<string> = new Set()): Promise<{ it: Itinerary; nodes: string[] } | null> => {
      const sl = seaLeg(op, dp, avoid);
      if (!sl) return null;
      const legs: Leg[] = [];
      if (op.id !== o.id) {
        const pre = await landLeg(o, op, "auto", stamps, notes);
        if (pre) legs.push(pre);
      }
      legs.push(sl.leg);
      if (dp.id !== d.id) {
        const post = await landLeg(dp, d, "auto", stamps, notes);
        if (post) legs.push(post);
      }
      return { it: itin(id, label, legs), nodes: sl.nodes };
    };

    const primary = await build(oPorts[0], dPorts[0], "primary", `Main plan via ${short(o.type === "port" && o.seaNode ? dPorts[0] : oPorts[0])}`);
    if (!primary) return { error: { message: "Could not find a sea route between those ports.", hint: "Try ports on the same ocean network, like Mundra and Rotterdam." } };
    primary.it.label = bothPortLabel(o, d, oPorts[0], dPorts[0]);
    out.push(primary.it);

    // Alternatives: avoid each chokepoint on the primary sea leg
    const seen = new Set<string>([primary.nodes.join(">")]);
    const chokeNodes = primary.nodes.filter((n) => NODES[n]?.chokepoint);
    for (const cn of chokeNodes) {
      const name = NODES[cn].chokepoint!.name;
      const alt = await build(oPorts[0], dPorts[0], `avoid-${cn}`, `Avoid ${name}`, new Set([cn]));
      if (alt && !seen.has(alt.nodes.join(">"))) {
        seen.add(alt.nodes.join(">"));
        alt.it.note = `Sea graph recomputed with ${name} closed.`;
        out.push(alt.it);
      }
    }
    if (opts.deep) {
      // Every chokepoint on the main sea leg closed at once, when a sea path still exists without them.
      if (chokeNodes.length > 1) {
        const alt = await build(oPorts[0], dPorts[0], "avoid-all", "Avoid every chokepoint on the main route", new Set(chokeNodes));
        if (alt && !seen.has(alt.nodes.join(">"))) {
          seen.add(alt.nodes.join(">"));
          alt.it.note = "Sea graph recomputed with every chokepoint on the main route closed.";
          out.push(alt.it);
        }
      }
      // Sister ports: other deep-sea ports within trucking or rail range of each end. The land feeder is part of the plan.
      const sisters = (x: Place, used: Place) => portsNear(x, 6).filter((q) => q.id !== used.id && haversineKm(pt(x), pt(q)) <= 800).slice(0, 2);
      for (const sp of sisters(o, oPorts[0])) {
        const alt = await build(sp, dPorts[0], `alt-o-${sp.id}`, `Ship out of ${short(sp)} instead`);
        if (alt) out.push(alt.it);
      }
      for (const sp of sisters(d, dPorts[0])) {
        const alt = await build(oPorts[0], sp, `alt-d-${sp.id}`, `Land at ${short(sp)} instead`);
        if (alt) out.push(alt.it);
      }
    } else {
      // Alternative port when the origin or destination is inland
      if (!(o.type === "port" && o.seaNode) && oPorts[1]) {
        const alt = await build(oPorts[1], dPorts[0], "alt-oport", `Ship out of ${short(oPorts[1])} instead`);
        if (alt && !seen.has(alt.nodes.join(">") + oPorts[1].id)) out.push(alt.it);
      }
      if (!(d.type === "port" && d.seaNode) && dPorts[1]) {
        const alt = await build(oPorts[0], dPorts[1], "alt-dport", `Land at ${short(dPorts[1])} instead`);
        if (alt) out.push(alt.it);
      }
    }
    if (dist > 1500) {
      const a = makeAir();
      if (a) out.push(a);
    }
    // keep the air option even when the list is capped
    const cap = opts.deep ? 9 : 5;
    const airAlt = out.find((i) => i.id === "air");
    const rest = out.filter((i) => i.id !== "air").slice(0, airAlt ? cap - 1 : cap);
    return { itineraries: airAlt ? [...rest, airAlt] : rest, primary: "primary", notes, stamps, places };
  }

  // ---- Air requested
  const a = makeAir();
  if (!a) return { error: { message: "Could not find airports for those places.", hint: "Name cities with an international airport." } };
  out.push(a);
  if (o.cc !== d.cc || dist > 1500) {
    const oPorts = o.type === "port" && o.seaNode ? [o] : portsNear(o, 1);
    const dPorts = d.type === "port" && d.seaNode ? [d] : portsNear(d, 1);
    if (oPorts[0] && dPorts[0]) {
      const sl = seaLeg(oPorts[0], dPorts[0]);
      if (sl) out.push(itin("sea", `By sea, ${short(oPorts[0])} to ${short(dPorts[0])}`, [sl.leg], "Port to port. Pre- and on-carriage not included."));
    }
  }
  return { itineraries: out, primary: "air", notes, stamps, places };
}

function bothPortLabel(o: Place, d: Place, op: Place, dp: Place) {
  const parts: string[] = [];
  if (o.id !== op.id) parts.push(short(o));
  parts.push(short(op));
  parts.push(short(dp));
  if (d.id !== dp.id) parts.push(short(d));
  return `Main plan: ${parts.join(" → ")}`;
}

export { distToPathKm };
