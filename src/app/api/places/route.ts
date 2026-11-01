import { PLACES } from "@/lib/gazetteer";
import { geocode } from "@/lib/sources/openmeteo";

export const maxDuration = 15;
export const dynamic = "force-dynamic";

const MARKS = new RegExp("[" + String.fromCharCode(768) + "-" + String.fromCharCode(879) + "]", "g");
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(MARKS, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

interface Row {
  p: (typeof PLACES)[number];
  names: string[];
  codes: string[];
}
let INDEX: Row[] | null = null;
function index() {
  if (INDEX) return INDEX;
  INDEX = PLACES.map((p) => ({
    p,
    names: [p.name, ...p.aliases].map(norm).filter(Boolean),
    codes: [p.id, p.iata, p.icao].filter(Boolean).map((c) => String(c).toLowerCase()),
  }));
  return INDEX;
}

const KIND_ORDER: Record<string, number> = { port: 0, airport: 1, inland: 2 };

export async function GET(req: Request) {
  const q = norm(new URL(req.url).searchParams.get("q") ?? "");
  if (q.length < 2) return Response.json({ results: [] });
  const scored: { s: number; p: Row["p"] }[] = [];
  for (const r of index()) {
    let s = 0;
    if (r.codes.includes(q)) s = 100;
    for (const n of r.names) {
      if (n === q) s = Math.max(s, 95);
      else if (n.startsWith(q)) s = Math.max(s, 80);
      else if (n.split(" ").some((w) => w.startsWith(q))) s = Math.max(s, 55);
      else if (q.length >= 3 && n.includes(q)) s = Math.max(s, 30);
    }
    if (s) scored.push({ s: s - (KIND_ORDER[r.p.type] ?? 3) * 0.5 + (r.p.cc === "IN" ? 0.4 : 0) + (r.p.bulk ? 0 : 1.5) + (r.p.size ?? 1) * 0.3, p: r.p });
  }
  scored.sort((a, b) => b.s - a.s);
  const results = scored.slice(0, 8).map(({ p }) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    cc: p.cc,
    country: p.country,
    state: p.state,
    kind: p.kind,
    lon: p.lon,
    lat: p.lat,
    code: p.iata ?? (/^w-[a-z]{5}$/.test(p.id) ? p.id.slice(2).toUpperCase(): undefined),
  }));
  // Anything outside the built-in list is looked up live, so the list is never a wall.
  if (results.length < 2 && q.length >= 3) {
    const g = await Promise.race([geocode(q), new Promise<{ hit: null }>((r) => setTimeout(() => r({ hit: null }), 1600))]);
    if (g.hit?.cc && !results.some((r) => norm(r.name) === norm(g.hit!.name))) {
      results.push({ id: `geo:${g.hit.name}`, name: g.hit.name, type: "inland", cc: g.hit.cc, country: g.hit.country, state: g.hit.admin1, kind: undefined, lon: g.hit.lon, lat: g.hit.lat, code: undefined });
    }
  }
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
