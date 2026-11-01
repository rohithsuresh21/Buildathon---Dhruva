"use client";

import { useEffect, useMemo, useState } from "react";
import { geoNaturalEarth1, geoMercator, geoPath, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import type { LonLat } from "@/lib/geo";

export interface MapRoute {
  id: string;
  path: LonLat[];
  color: string;
  width?: number;
  dashed?: boolean;
  glow?: boolean;
  opacity?: number;
  animate?: boolean;
}
export interface MapMarker {
  id: string;
  at: LonLat;
  label?: string;
  color?: string;
  kind?: "port" | "air" | "choke" | "hazard" | "city";
  r?: number;
  pulse?: boolean;
  onClick?: () => void;
}
export interface MapZone {
  id: string;
  ring: LonLat[];
  color: string;
}

type Topo = any;
let landCache: { lo?: any; hi?: any } = {};

async function loadLand(detail: "lo" | "hi") {
  if (landCache[detail]) return landCache[detail];
  const mod = detail === "hi" ? await import("world-atlas/land-50m.json") : await import("world-atlas/land-110m.json");
  const topo = (mod as any).default as Topo;
  const f = feature(topo, topo.objects.land) as any;
  landCache[detail] = f;
  return f;
}

export default function FlatMap({
  routes,
  markers = [],
  zones = [],
  fit,
  height = 420,
  detail = "lo",
  projection = "natural",
  label,
}: {
  routes: MapRoute[];
  markers?: MapMarker[];
  zones?: MapZone[];
  /** points to fit the view to; defaults to all route points */
  fit?: LonLat[];
  height?: number;
  detail?: "lo" | "hi";
  projection?: "natural" | "mercator";
  label?: string;
}) {
  const [land, setLand] = useState<any>(null);
  const [w, setW] = useState(760);
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let dead = false;
    loadLand(detail).then((f) => !dead && setLand(f));
    return () => {
      dead = true;
    };
  }, [detail]);

  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, e[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const pts = useMemo<LonLat[]>(() => {
    const base = fit && fit.length ? fit : routes.flatMap((r) => r.path);
    return base.length ? base : [[-170, -50], [170, 70]];
  }, [fit, routes]);

  const proj = useMemo(() => {
    const p = projection === "mercator" ? geoMercator() : geoNaturalEarth1();
    const mp = { type: "MultiPoint", coordinates: pts } as any;
    p.fitExtent(
      [
        [18, 18],
        [w - 18, height - 18],
      ],
      mp,
    );
    return p;
  }, [pts, w, height, projection]);

  const path = useMemo(() => geoPath(proj), [proj]);
  const line = (coords: LonLat[]) => {
    const f = { type: "LineString", coordinates: coords } as any;
    return path(f) ?? "";
  };

  return (
    <div ref={setEl} style={{ width: "100%" }}>
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label ?? "Map"} style={{ display: "block", background: "#000" }}>
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,238,208,.05)" strokeWidth="1" />
          </pattern>
        </defs>
        <path d={path(geoGraticule10() as any) ?? ""} fill="none" stroke="rgba(255,238,208,.06)" strokeWidth="0.5" />
        {land && <path d={path(land) ?? ""} fill="#141311" stroke="rgba(255,226,170,.34)" strokeWidth="0.6" />}
        {land && <path d={path(land) ?? ""} fill="url(#hatch)" />}
        {zones.map((z) => (
          <path key={z.id} d={line([...z.ring, z.ring[0]])} fill={z.color} fillOpacity="0.16" stroke={z.color} strokeOpacity="0.8" strokeWidth="1" strokeDasharray="4 3" />
        ))}
        {routes.map((r) => {
          const d = line(r.path);
          return (
            <g key={r.id} opacity={r.opacity ?? 1}>
              {r.glow && <path d={d} fill="none" stroke={r.color} strokeWidth={(r.width ?? 2) + 5} opacity="0.35" filter="url(#glow)" />}
              <path d={d} fill="none" stroke={r.color} strokeWidth={r.width ?? 2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={r.dashed ? "6 5" : undefined} className={r.animate ? "route-draw" : undefined} pathLength={r.animate ? 1 : undefined} />
            </g>
          );
        })}
        {markers.map((m) => {
          const p = proj(m.at);
          if (!p) return null;
          const c = m.color ?? "#ffd99a";
          const r = m.r ?? 4;
          return (
            <g key={m.id} transform={`translate(${p[0]},${p[1]})`} style={{ cursor: m.onClick ? "pointer" : "default" }} onClick={m.onClick}>
              {m.pulse && <circle r={r} fill="none" stroke={c} className="pulse-ring" />}
              {m.kind === "air" ? <path d={`M0 ${-r - 1} L${r} ${r} L0 ${r - 2} L${-r} ${r} Z`} fill={c} /> : <circle r={r} fill={c} stroke="#000" strokeWidth="1.5" />}
              {m.label && (
                <text x={r + 6} y={4} fill="#f4efe6" fontSize="11.5" fontFamily="var(--font-ui)" style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 3 }}>
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
