// Snap each world port to the nearest curated sea-graph node whose straight approach does not cross land.
// Land: Natural Earth 110m (world-atlas). The first 60 km of the approach are exempt because a port sits on the coast
// and 110m coastlines are coarse. Output is index-aligned with ports.json; "" means "no safe node, leave unsnapped".
import fs from "node:fs";
import { feature } from "topojson-client";
import { geoContains, geoInterpolate } from "d3-geo";

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const hav = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const src = fs.readFileSync("src/lib/seagraph.ts", "utf8");
const nodes = [...src.matchAll(/\["([a-z0-9_]+)",\s*(-?[\d.]+),\s*(-?[\d.]+)/g)].map((m) => ({ id: m[1], p: [parseFloat(m[2]), parseFloat(m[3])] }));
console.log("nodes", nodes.length);
const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/land-110m.json", "utf8"));
const land = feature(topo, topo.objects.land);
const ports = JSON.parse(fs.readFileSync("src/lib/gz/ports.json", "utf8"));
const out = [];
let snapped = 0;
const dists = [];
for (const r of ports) {
  const p = [r[3], r[2]];
  const cand = nodes.map((n) => ({ ...n, d: hav(p, n.p) })).filter((n) => n.d <= 700).sort((a, b) => a.d - b.d).slice(0, 8);
  let pick = "";
  for (const c of cand) {
    const steps = Math.max(2, Math.ceil(c.d / 25));
    const interp = geoInterpolate(p, c.p);
    let bad = 0;
    for (let i = 1; i < steps; i++) {
      const q = interp(i / steps);
      if ((i / steps) * c.d <= 60) continue;
      if (geoContains(land, q)) {
        bad++;
        break;
      }
    }
    if (!bad) {
      pick = c.id;
      dists.push(c.d);
      break;
    }
  }
  if (pick) snapped++;
  out.push(pick);
}
fs.writeFileSync("src/lib/gz/portnodes.json", JSON.stringify(out));
dists.sort((a, b) => a - b);
console.log("ports", ports.length, "snapped", snapped, "median km", Math.round(dists[Math.floor(dists.length / 2)]), "p90", Math.round(dists[Math.floor(dists.length * 0.9)]));
const inRows = ports.map((r, i) => [r, out[i]]).filter(([r]) => r[1] === "IN");
console.log("IN snapped", inRows.filter(([, n]) => n).length, "of", inRows.length);
