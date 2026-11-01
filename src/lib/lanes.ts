import { greatCircle, type LonLat } from "./geo";
import { BY_ID, lonlat } from "./gazetteer";
import { shortestSea, buildRoute, NODES } from "./seagraph";

/** Smooth a polyline of waypoints along great circles so it hugs the sphere. */
export function smoothPath(path: LonLat[], maxStepDeg = 3): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    let dLon = Math.abs(b[0] - a[0]);
    if (dLon > 180) dLon = 360 - dLon;
    const steps = Math.max(2, Math.ceil(Math.max(dLon, Math.abs(b[1] - a[1])) / maxStepDeg));
    const seg = greatCircle(a, b, steps);
    if (i > 1) seg.shift();
    out.push(...seg);
  }
  return out;
}

export interface Lane {
  id: string;
  mode: "sea" | "air" | "rail" | "road";
  label: string;
  path: LonLat[];
}

function sea(id: string, from: string, to: string): Lane | null {
  const a = BY_ID[from];
  const b = BY_ID[to];
  if (!a?.seaNode || !b?.seaNode) return null;
  const r = shortestSea(a.seaNode, b.seaNode);
  if (!r) return null;
  const route = buildRoute(r.nodes, { start: lonlat(a), end: lonlat(b) });
  return { id, mode: "sea", label: `${a.name} → ${b.name}`, path: smoothPath(route.path) };
}

const SEA_PAIRS: [string, string, string][] = [
  ["s1", "shenzhen", "mundra"],
  ["s2", "shanghai", "rotterdam"],
  ["s3", "singapore", "jebel_ali"],
  ["s4", "jnpt", "rotterdam"],
  ["s5", "chennai_port", "singapore"],
  ["s6", "jnpt", "mombasa"],
  ["s7", "colombo", "jeddah"],
  ["s8", "hamburg", "newyork"],
  ["s9", "shanghai", "losangeles"],
  ["s10", "mundra", "durban"],
  ["s11", "busan", "singapore"],
  ["s12", "piraeus", "newyork"],
  ["s13", "vizag", "colombo"],
  ["s14", "haldia", "singapore"],
  ["s15", "lagos", "rotterdam"],
];

export function seaLanes(): Lane[] {
  return SEA_PAIRS.map(([id, a, b]) => sea(id, a, b)).filter(Boolean) as Lane[];
}

export function airLanes(): Lane[] {
  const pairs: [string, string, string][] = [
    ["a1", "BOM", "FRA"], ["a2", "DEL", "JFK"], ["a3", "DEL", "DXB"], ["a4", "BLR", "SIN"],
    ["a5", "MAA", "HKG"], ["a6", "BOM", "LHR"], ["a7", "HYD", "DOH"], ["a8", "DEL", "ORD"], ["a9", "CCU", "BKK"],
  ];
  return pairs.map(([id, a, b]) => ({
    id,
    mode: "air" as const,
    label: `${BY_ID[a].iata} → ${BY_ID[b].iata}`,
    path: greatCircle(lonlat(BY_ID[a]), lonlat(BY_ID[b]), 64),
  }));
}

/** Indian rail trunk corridors: curated waypoints at real junction / terminal coordinates. */
export const RAIL_CORRIDORS: { id: string; label: string; stations: { name: string; lon: number; lat: number }[] }[] = [
  {
    id: "wdfc",
    label: "Western Freight Corridor (JNPT to Dadri)",
    stations: [
      { name: "JNPT", lon: 72.95, lat: 18.95 },
      { name: "Vasai Road", lon: 72.83, lat: 19.38 },
      { name: "Surat", lon: 72.83, lat: 21.17 },
      { name: "Vadodara", lon: 73.18, lat: 22.31 },
      { name: "Ahmedabad", lon: 72.57, lat: 23.02 },
      { name: "Palanpur", lon: 72.43, lat: 24.17 },
      { name: "Marwar Jn", lon: 73.63, lat: 25.73 },
      { name: "Ajmer", lon: 74.64, lat: 26.45 },
      { name: "Rewari", lon: 76.62, lat: 28.19 },
      { name: "Dadri", lon: 77.55, lat: 28.57 },
    ],
  },
  {
    id: "mundra-delhi",
    label: "Mundra to Delhi (via Palanpur junction)",
    stations: [
      { name: "Mundra", lon: 69.7, lat: 22.74 },
      { name: "Gandhidham", lon: 70.13, lat: 23.08 },
      { name: "Palanpur", lon: 72.43, lat: 24.17 },
      { name: "Marwar Jn", lon: 73.63, lat: 25.73 },
      { name: "Ajmer", lon: 74.64, lat: 26.45 },
      { name: "Rewari", lon: 76.62, lat: 28.19 },
      { name: "Tughlakabad", lon: 77.28, lat: 28.5 },
    ],
  },
  {
    id: "chennai-blr",
    label: "Chennai to Bengaluru",
    stations: [
      { name: "Chennai", lon: 80.27, lat: 13.08 },
      { name: "Arakkonam", lon: 79.67, lat: 13.08 },
      { name: "Katpadi", lon: 79.14, lat: 12.97 },
      { name: "Jolarpettai", lon: 78.57, lat: 12.57 },
      { name: "Bengaluru", lon: 77.59, lat: 12.97 },
    ],
  },
  {
    id: "edfc",
    label: "Kolkata to Delhi (Eastern Corridor)",
    stations: [
      { name: "Kolkata", lon: 88.36, lat: 22.57 },
      { name: "Asansol", lon: 86.98, lat: 23.68 },
      { name: "Gaya", lon: 85.0, lat: 24.8 },
      { name: "Mughalsarai", lon: 83.12, lat: 25.28 },
      { name: "Prayagraj", lon: 81.85, lat: 25.43 },
      { name: "Kanpur", lon: 80.35, lat: 26.45 },
      { name: "Tundla", lon: 78.23, lat: 27.21 },
      { name: "Delhi", lon: 77.28, lat: 28.5 },
    ],
  },
];

export function railLanes(): Lane[] {
  return RAIL_CORRIDORS.map((c) => ({
    id: c.id,
    mode: "rail" as const,
    label: c.label,
    path: smoothPath(c.stations.map((s) => [s.lon, s.lat] as LonLat), 1),
  }));
}

export function allLanes(): Lane[] {
  return [...seaLanes(), ...airLanes(), ...railLanes()];
}

export { NODES };
