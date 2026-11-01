export type LonLat = [number, number];

const R_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLengthKm(path: LonLat[]): number {
  let t = 0;
  for (let i = 1; i < path.length; i++) t += haversineKm(path[i - 1], path[i]);
  return t;
}

/** Intermediate point along the great circle between a and b, f in [0,1]. */
export function greatCirclePoint(a: LonLat, b: LonLat, f: number): LonLat {
  const φ1 = toRad(a[1]), λ1 = toRad(a[0]);
  const φ2 = toRad(b[1]), λ2 = toRad(b[0]);
  const d = haversineKm(a, b) / R_KM;
  if (d < 1e-9) return a;
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))];
}

export function greatCircle(a: LonLat, b: LonLat, steps = 48): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i <= steps; i++) out.push(greatCirclePoint(a, b, i / steps));
  return out;
}

/** Cross-track style distance from point p to the polyline, in km (planar approximation per segment on a local scale). */
export function distToPathKm(p: LonLat, path: LonLat[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineKm(p, path[0]);
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const d = distToSegmentKm(p, path[i - 1], path[i]);
    if (d < best) best = d;
  }
  return best;
}

function distToSegmentKm(p: LonLat, a: LonLat, b: LonLat): number {
  // Local equirectangular projection around p
  const k = Math.cos(toRad(p[1]));
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  const degKm = (Math.PI / 180) * R_KM;
  return Math.hypot(cx, cy) * degKm;
}

/** Resample a path to roughly evenly spaced points (km). */
export function resample(path: LonLat[], stepKm: number): LonLat[] {
  if (path.length < 2) return path.slice();
  const out: LonLat[] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1];
    const b = path[i];
    let seg = haversineKm(a, b);
    while (carry + seg >= stepKm) {
      const f = (stepKm - carry) / seg;
      const p: LonLat = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      out.push(p);
      a = p;
      seg = haversineKm(a, b);
      carry = 0;
    }
    carry += seg;
  }
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Evenly pick up to n samples from an array including first and last. */
export function pickEven<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Corner-cutting for display: rounds the sharp turns where a sea route changes direction between waypoints.
 * Endpoints never move. Paths that cross the antimeridian are returned unchanged.
 */
export function chaikin(path: LonLat[], iterations = 2, ratio = 0.22): LonLat[] {
  if (path.length < 3) return path;
  for (let i = 1; i < path.length; i++) if (Math.abs(path[i][0] - path[i - 1][0]) > 180) return path;
  let p = path;
  for (let it = 0; it < iterations; it++) {
    const out: LonLat[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      if (i > 0) out.push([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]);
      if (i < p.length - 2) out.push([a[0] + (b[0] - a[0]) * (1 - ratio), a[1] + (b[1] - a[1]) * (1 - ratio)]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
