import gsap from "gsap";

export interface CamPose {
  lon: number;
  lat: number;
  dist: number;
  /** horizontal projection offset as a fraction of the viewport width (positive pushes the globe right) */
  ox: number;
  /** vertical offset as a fraction of viewport height (positive pushes the globe up) */
  oy: number;
  /** 0..1 amount of route / marker overlay shown */
  layers: number;
  /** 0..1 air arcs */
  air: number;
  /** 0..1 rail overlay */
  rail: number;
}

/** What is rendered right now (eased towards `target` inside the render loop). */
export const camNow: CamPose = { lon: 72, lat: 17, dist: 1.32, ox: 0, oy: 0, layers: 0, air: 0, rail: 0 };
/** Where the scroll story wants the camera. Tweened by GSAP, followed by the render loop. */
export const camTarget: CamPose = { ...camNow };

/** Extra yaw/pitch the visitor adds by dragging the globe. */
export const drag = { dLon: 0, dLat: 0, active: false, hovering: false };

/** Things the scene reads every frame. Plain object, never React state. */
export const sceneState = { autorotate: 1, laneDim: 1, laneDimTarget: 1 };

export const sunState = { dir: [0.6, 0.35, 0.7] as [number, number, number] };

export function flyTo(p: Partial<CamPose>, duration = 2.4, reduce = false) {
  if (reduce) {
    Object.assign(camTarget, p);
    Object.assign(camNow, p);
    return;
  }
  gsap.to(camTarget, { ...p, duration, ease: "power3.inOut", overwrite: "auto" });
}

export const lonLatToVec = (lon: number, lat: number, r = 1): [number, number, number] => {
  const λ = (lon * Math.PI) / 180;
  const φ = (lat * Math.PI) / 180;
  return [r * Math.cos(φ) * Math.cos(λ), r * Math.sin(φ), -r * Math.cos(φ) * Math.sin(λ)];
};

/** Real subsolar point from UTC time so the terminator on the globe is the actual one right now. */
export function subsolar(date = new Date()): { lon: number; lat: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = (date.getTime() - start) / 86400000;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (n + 10));
  const B = ((2 * Math.PI) / 365) * (n - 81);
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = -15 * (hours - 12 + eot / 60);
  lon = ((lon + 540) % 360) - 180;
  return { lon, lat: decl };
}

export function updateSun() {
  const s = subsolar();
  sunState.dir = lonLatToVec(s.lon, s.lat, 1);
  return s;
}

/**
 * Camera pose that frames a set of points: the centre is the mean direction, the distance grows with how far
 * apart the points are. Returns only lon/lat/dist so the caller's offsets and overlay levels are kept.
 */
export function frameOf(points: [number, number][], min = 1.7, max = 4.1): { lon: number; lat: number; dist: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of points) {
    const v = lonLatToVec(lon, lat);
    x += v[0];
    y += v[1];
    z += v[2];
  }
  const n = Math.hypot(x, y, z) || 1;
  const c: [number, number, number] = [x / n, y / n, z / n];
  let worst = 0;
  for (const [lon, lat] of points) {
    const v = lonLatToVec(lon, lat);
    worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, v[0] * c[0] + v[1] * c[1] + v[2] * c[2]))));
  }
  const lat = (Math.asin(c[1]) * 180) / Math.PI;
  const lon = (Math.atan2(-c[2], c[0]) * 180) / Math.PI;
  return { lon, lat, dist: Math.max(min, Math.min(max, 1.5 + worst * 2.2)) };
}
