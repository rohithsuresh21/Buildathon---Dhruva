"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import "@/app/globe-labels.css";
import { Html, Line } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { CHOKEPOINT_LIST } from "@/lib/seagraph";
import { allLanes, type Lane } from "@/lib/lanes";
import { greatCirclePoint, haversineKm } from "@/lib/geo";
import { camNow, camTarget, drag, lonLatToVec, sceneState, sunState, updateSun } from "./camera";
import type { PulseData, PulseChoke } from "@/lib/pulse-types";

const CDN = "https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/";
const TEX = {
  day: [CDN + "earth-blue-marble.jpg", "/tex/day.jpg"],
  night: [CDN + "earth-night.jpg", "/tex/night.jpg"],
  water: [CDN + "earth-water.png", "/tex/water.jpg"],
};

function useTex(urls: string[], onLoaded?: () => void) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let dead = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    (async () => {
      for (const u of urls) {
        try {
          const t = await loader.loadAsync(u);
          if (dead) {
            t.dispose();
            return;
          }
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          setTex(t);
          onLoaded?.();
          return;
        } catch {
          /* try next */
        }
      }
      onLoaded?.();
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return tex;
}

/* ───────── shared types ───────── */
export interface GlobeLeg {
  id: string;
  mode: "sea" | "air" | "rail" | "road";
  path: [number, number][];
  /** overrides the mode colour, e.g. a verdict colour */
  color?: string;
}
export interface GlobeEnd {
  name: string;
  code?: string;
  lon: number;
  lat: number;
}
export interface GlobeRoute {
  key: string;
  legs: GlobeLeg[];
  ghosts?: GlobeLeg[];
  from: GlobeEnd;
  to: GlobeEnd;
}
export interface GlobePin {
  id: string;
  at: [number, number];
  color: string;
  label?: string;
}

export const MODE_COLOR: Record<GlobeLeg["mode"], string> = {
  sea: "#ffd99a",
  air: "#c9bbff",
  rail: "#ff9d6e",
  road: "#e8e2d4",
};

/* ───────── shaders ───────── */
const EARTH_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main(){
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position,1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/*
  Real Earth. The Blue Marble texture gives true ocean, forest, desert and ice colour. The sun side is lit by the real
  sun position for the current UTC time, the night side keeps a dim copy of the same colours plus city lights, and
  the sea catches a soft sun glint. Route lines are drawn over it with a dark edge so they stay readable on any colour.
*/
const EARTH_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uWater;
uniform float uHasDay; uniform float uHasNight; uniform float uHasWater;
uniform vec3 uSun; uniform float uTime;
uniform vec3 uRipSrc; uniform float uRipR; uniform float uRipA;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
float wat(vec2 uv){ return smoothstep(0.42, 0.58, texture2D(uWater, uv).r); }
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vP);
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.14, 0.42, ndl);

  float w = uHasWater > 0.5 ? wat(vUv) : 0.0;
  vec3 tex = uHasDay > 0.5 ? texture2D(uDay, vUv).rgb : vec3(0.05, 0.10, 0.22);
  // a touch more colour and contrast than the raw photograph, so land and sea separate clearly
  float lum = dot(tex, vec3(0.299, 0.587, 0.114));
  tex = mix(vec3(lum), tex, 1.28);
  tex = clamp(tex * 1.12, 0.0, 1.0);

  vec3 dayCol = tex * (0.30 + 0.92 * max(ndl, 0.0));
  vec3 nightCol = tex * 0.20;
  vec3 col = mix(nightCol, dayCol, lit);

  // city lights on the dark side
  vec3 lights = uHasNight > 0.5 ? texture2D(uNight, vUv).rgb : vec3(0.0);
  float l2 = dot(lights, vec3(0.299, 0.587, 0.114));
  vec3 city = vec3(1.0, 0.62, 0.28) * pow(l2, 1.25) * 2.2 + vec3(1.0, 0.88, 0.66) * pow(l2, 3.0) * 1.5;
  col += city * (1.0 - lit) * (1.0 - lit);

  // sun glint on the sea
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 260.0) * w * lit;
  col += spec * vec3(1.0, 0.93, 0.80) * 0.32;

  // blue limb and a thin dusk line
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += fres * vec3(0.30, 0.55, 1.0) * (0.18 + 0.42 * lit);
  float dusk = smoothstep(0.0, 0.22, 0.22 - abs(ndl));
  col += dusk * vec3(0.16, 0.07, 0.02);

  // propagating disruption signal
  if (uRipA > 0.001) {
    float ang = acos(clamp(dot(normalize(vP), normalize(uRipSrc)), -1.0, 1.0));
    float ring = exp(-pow((ang - uRipR) * 26.0, 2.0));
    float trail = smoothstep(uRipR, uRipR - 0.45, ang) * step(ang, uRipR) * 0.08;
    col += (ring * 0.8 + trail) * uRipA * vec3(1.0, 0.78, 0.45);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vNormal; varying vec3 vView;
void main(){
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const ATMO_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal; varying vec3 vView;
uniform vec3 uColor; uniform float uPower; uniform float uAmp;
void main(){
  float i = pow(max(0.0, 0.78 - dot(normalize(vNormal), normalize(vView))), uPower);
  gl_FragColor = vec4(uColor * i * uAmp, i * uAmp);
}`;

/* ───────── sky ───────── */
function Stars({ count, reduce }: { count: number; reduce: boolean }) {
  const { gl } = useThree();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const size = new Float32Array(count);
    // a faint band of denser, dimmer stars along a tilted great circle
    const n = new THREE.Vector3(0.34, 0.86, 0.38).normalize();
    const a = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 0, 1)).normalize();
    const b = new THREE.Vector3().crossVectors(n, a).normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const band = i < count * 0.34;
      if (band) {
        const th = Math.random() * Math.PI * 2;
        const off = (Math.random() + Math.random() + Math.random() - 1.5) * 0.34;
        v.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(b, Math.sin(th)).addScaledVector(n, off).normalize();
      } else {
        const u = Math.random() * 2 - 1;
        const th = Math.random() * Math.PI * 2;
        const q = Math.sqrt(1 - u * u);
        v.set(q * Math.cos(th), u, q * Math.sin(th));
      }
      const r = 45 + Math.random() * 25;
      p[i * 3] = v.x * r;
      p[i * 3 + 1] = v.y * r;
      p[i * 3 + 2] = v.z * r;
      seed[i] = Math.random();
      size[i] = (band ? 1.2 : 1.5) + Math.pow(Math.random(), 6) * (band ? 3.4 : 9);
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    return g;
  }, [count]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPR: { value: 1 }, uMotion: { value: reduce ? 0 : 1 } }), [reduce]);
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    uniforms.uPR.value = gl.getPixelRatio();
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={/* glsl */ `
          attribute float aSeed; attribute float aSize; uniform float uTime; uniform float uPR; uniform float uMotion;
          varying float vA; varying vec3 vC; varying float vBig;
          void main(){
            float tw = 0.5 + 0.5 * sin(uTime * (0.7 + aSeed * 3.1) + aSeed * 40.0);
            float flick = step(0.3, fract(aSeed * 7.13));
            vA = mix(0.85, 0.3 + 0.7 * tw * tw, flick * uMotion);
            vC = mix(vec3(1.0, 0.91, 0.80), vec3(0.82, 0.88, 1.0), fract(aSeed * 13.7));
            vBig = step(3.2, aSize);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = max(2.2 * uPR, aSize * uPR * (0.8 + 0.4 * vA));
            gl_Position = projectionMatrix * mv;
          }`}
        fragmentShader={/* glsl */ `
          varying float vA; varying vec3 vC; varying float vBig;
          void main(){
            vec2 p = gl_PointCoord - 0.5; float d = length(p);
            float core = smoothstep(0.5, 0.08, d);
            float spike = vBig * (exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 4.0) + exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 4.0)) * 0.75;
            float a = (core + spike) * vA;
            gl_FragColor = vec4(vC * a * 1.25, a);
          }`}
      />
    </points>
  );
}

/** An occasional shooting star across the sky behind the globe. */
function Meteors() {
  const { camera } = useThree();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    g.setAttribute("aT", new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
    return g;
  }, []);
  const st = useRef({ next: 3, t0: -10, dur: 0.9, a: new THREE.Vector3(), d: new THREE.Vector3() });
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uA: { value: 0 } },
        vertexShader: "attribute float aT; varying float vT; void main(){ vT=aT; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
        fragmentShader: "varying float vT; uniform float uA; void main(){ gl_FragColor=vec4(vec3(1.0,0.95,0.85)*vT*uA, vT*uA); }",
      }),
    [],
  );
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const s = st.current;
    if (t > s.next) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      s.a.copy(camera.position).addScaledVector(fwd, 30).addScaledVector(right, (Math.random() - 0.5) * 22).addScaledVector(up, 3 + Math.random() * 7);
      s.d.copy(right).multiplyScalar(Math.random() < 0.5 ? -1 : 1).addScaledVector(up, -0.35 - Math.random() * 0.3).normalize();
      s.t0 = t;
      s.dur = 0.7 + Math.random() * 0.5;
      s.next = t + 5 + Math.random() * 8;
    }
    const k = (t - s.t0) / s.dur;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    if (k < 0 || k > 1) {
      mat.uniforms.uA.value = 0;
      return;
    }
    const head = s.a.clone().addScaledVector(s.d, k * 14);
    const tail = head.clone().addScaledVector(s.d, -3.2);
    pos.setXYZ(0, tail.x, tail.y, tail.z);
    pos.setXYZ(1, head.x, head.y, head.z);
    pos.needsUpdate = true;
    mat.uniforms.uA.value = Math.sin(Math.PI * k) * 0.9;
  });
  return (
    <lineSegments geometry={geo} material={mat} frustumCulled={false} />
  );
}

/* ───────── earth ───────── */
function Earth({ onTex, earthRef }: { onTex: () => void; earthRef: React.RefObject<THREE.Mesh | null> }) {
  const day = useTex(TEX.day, onTex);
  const night = useTex(TEX.night, onTex);
  const water = useTex(TEX.water, onTex);
  const uniforms = useMemo(
    () => ({
      uDay: { value: null as THREE.Texture | null },
      uNight: { value: null as THREE.Texture | null },
      uWater: { value: null as THREE.Texture | null },
      uHasDay: { value: 0 },
      uHasNight: { value: 0 },
      uHasWater: { value: 0 },
      uSun: { value: new THREE.Vector3(0.6, 0.3, 0.7) },
      uTime: { value: 0 },
      uRipSrc: { value: new THREE.Vector3(...lonLatToVec(43.3, 12.6)) },
      uRipR: { value: 0 },
      uRipA: { value: 0 },
    }),
    [],
  );
  const material = useMemo(() => new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }), [uniforms]);
  useEffect(() => {
    uniforms.uDay.value = day;
    uniforms.uHasDay.value = day ? 1 : 0;
  }, [day, uniforms]);
  useEffect(() => {
    uniforms.uNight.value = night;
    uniforms.uHasNight.value = night ? 1 : 0;
  }, [night, uniforms]);
  useEffect(() => {
    uniforms.uWater.value = water;
    uniforms.uHasWater.value = water ? 1 : 0;
  }, [water, uniforms]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    uniforms.uTime.value = t;
    uniforms.uSun.value.set(...sunState.dir);
    // a slow, repeating ripple from Bab el-Mandeb outward; strongest while the hero is on screen
    const period = 11;
    const ph = (t % period) / period;
    const heroness = Math.max(0, 1 - camNow.layers * 0.6) * sceneState.laneDim;
    uniforms.uRipR.value = ph * 1.5;
    uniforms.uRipA.value = (1 - ph) * (ph > 0.02 ? 1 : 0) * 0.5 * heroness;
  });

  return (
    <mesh ref={earthRef}>
      <sphereGeometry args={[1, 128, 96]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function Atmosphere() {
  return (
    <>
      <mesh scale={1.07}>
        <sphereGeometry args={[1, 96, 72]} />
        <shaderMaterial
          vertexShader={ATMO_VERT}
          fragmentShader={ATMO_FRAG}
          uniforms={{ uColor: { value: new THREE.Color("#5f9bff") }, uPower: { value: 4.6 }, uAmp: { value: 0.42 } }}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh scale={1.022}>
        <sphereGeometry args={[1, 96, 72]} />
        <shaderMaterial
          vertexShader={ATMO_VERT}
          fragmentShader={ATMO_FRAG}
          uniforms={{ uColor: { value: new THREE.Color("#9cc4ff") }, uPower: { value: 6.0 }, uAmp: { value: 0.2 } }}
          side={THREE.FrontSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/* ───────── ambient lanes (background context, never live data) ───────── */
function useLanePoints(lanes: Lane[]) {
  return useMemo(
    () =>
      lanes.map((l) => {
        const radius = (f: number) => (l.mode === "air" ? 1.004 + 0.075 * Math.sin(Math.PI * f) : 1.005);
        const n = l.path.length;
        const pts = l.path.map((p, i) => new THREE.Vector3(...lonLatToVec(p[0], p[1], radius(i / (n - 1)))));
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
        return { lane: l, pts, cum, total: cum[cum.length - 1] };
      }),
    [lanes],
  );
}

function pointAt(pts: THREE.Vector3[], cum: number[], total: number, f: number, out: THREE.Vector3) {
  const d = Math.max(0, Math.min(1, f)) * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < d) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / seg;
  out.copy(pts[lo]).lerp(pts[hi], t);
}

function Lanes({ low }: { low: boolean }) {
  const lanes = useMemo(() => allLanes(), []);
  const data = useLanePoints(lanes);
  const perLane = low ? 4 : 7;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = data.length * perLane;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array(n * 3);
    const kind = new Float32Array(n);
    let k = 0;
    data.forEach((d) => {
      const c = new THREE.Color(MODE_COLOR[d.lane.mode]);
      for (let i = 0; i < perLane; i++) {
        col.set([c.r, c.g, c.b], k * 3);
        kind[k] = d.lane.mode === "air" ? 1 : d.lane.mode === "rail" ? 2 : 0;
        k++;
      }
    });
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
    return g;
  }, [data, perLane]);
  const pm = useRef<THREE.ShaderMaterial>(null);
  const lineRefs = useRef<(any | null)[]>([]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const phases = useMemo(() => data.map((_, i) => Array.from({ length: perLane }, (_, j) => (j / perLane + i * 0.137) % 1)), [data, perLane]);
  const speeds = useMemo(() => data.map((d) => (d.lane.mode === "air" ? 0.045 : d.lane.mode === "rail" ? 0.07 : 0.026) * (0.85 + ((d.total * 7) % 1) * 0.3)), [data]);

  useFrame((_, dt) => {
    const dim = sceneState.laneDim;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    let k = 0;
    data.forEach((d, i) => {
      for (let j = 0; j < perLane; j++) {
        phases[i][j] = (phases[i][j] + dt * speeds[i]) % 1;
        pointAt(d.pts, d.cum, d.total, phases[i][j], tmp);
        pos.setXYZ(k++, tmp.x, tmp.y, tmp.z);
      }
    });
    pos.needsUpdate = true;
    if (pm.current) {
      pm.current.uniforms.uSeaA.value = camNow.layers * dim;
      pm.current.uniforms.uAirA.value = camNow.air * dim;
      pm.current.uniforms.uRailA.value = camNow.rail * dim;
    }
    data.forEach((d, i) => {
      const l = lineRefs.current[i];
      if (!l) return;
      const a = (d.lane.mode === "air" ? camNow.air : d.lane.mode === "rail" ? camNow.rail : camNow.layers) * dim;
      l.material.opacity = a * (d.lane.mode === "sea" ? 0.3 : 0.38);
      l.visible = a > 0.01;
    });
  });

  return (
    <group>
      {data.map((d, i) => (
        <Line
          key={d.lane.id}
          ref={(r: any) => {
            lineRefs.current[i] = r;
          }}
          points={d.pts}
          color={MODE_COLOR[d.lane.mode]}
          lineWidth={d.lane.mode === "sea" ? 0.9 : 0.8}
          transparent
          opacity={0}
          depthWrite={false}
        />
      ))}
      <points geometry={geo}>
        <shaderMaterial
          ref={pm}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{ uSeaA: { value: 0 }, uAirA: { value: 0 }, uRailA: { value: 0 } }}
          vertexShader={`attribute float aKind; varying vec3 vC; varying float vA; uniform float uSeaA; uniform float uAirA; uniform float uRailA;
            void main(){ vC=color; vA = aKind<0.5 ? uSeaA : (aKind<1.5 ? uAirA : uRailA);
              vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize = (aKind<0.5? 6.0 : 5.0) * (2.4/ -mv.z) * 1.2 + 1.5; gl_Position=projectionMatrix*mv; }`}
          fragmentShader={`varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); gl_FragColor=vec4(vC, a*a*vA*0.8); }`}
          vertexColors
        />
      </points>
    </group>
  );
}

/* ───────── beacons, chokepoints, cyclones ───────── */
function Beacon({ pos, color, size, steady = false }: { pos: THREE.Vector3; color: string; size: number; steady?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const ref2 = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => Math.random() * 6, []);
  useEffect(() => {
    ref.current?.lookAt(pos.clone().multiplyScalar(2));
    ref2.current?.lookAt(pos.clone().multiplyScalar(2));
  }, [pos]);
  useFrame(({ clock }) => {
    const ph = ((clock.getElapsedTime() + seed) % 2.4) / 2.4;
    const vis = steady ? 1 : Math.min(1, camNow.layers * 1.4);
    if (ref.current) {
      ref.current.scale.setScalar(size * (0.6 + ph * 2.6));
      (ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.75 * vis;
    }
    if (ref2.current) (ref2.current.material as THREE.MeshBasicMaterial).opacity = vis;
  });
  return (
    <group position={pos}>
      <mesh ref={ref}>
        <ringGeometry args={[0.8, 1, 40]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={ref2}>
        <circleGeometry args={[size * 0.42, 20]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

const STATUS_COLOR = { green: "#58e6a6", amber: "#ffab2e", red: "#ff5252", na: "#ffefcf" } as const;

function Markers({
  pulse,
  earthRef,
  labels,
  selected,
  onSelect,
}: {
  pulse: PulseData | null;
  earthRef: React.RefObject<THREE.Mesh | null>;
  labels: boolean;
  selected: string | null;
  onSelect: (k: string) => void;
}) {
  const byKey = useMemo(() => {
    const m: Record<string, PulseChoke> = {};
    pulse?.chokepoints.forEach((c) => (m[c.key] = c));
    return m;
  }, [pulse]);
  return (
    <group>
      {CHOKEPOINT_LIST.map((c) => {
        const live = byKey[c.key];
        const status = live?.status ?? "na";
        const pos = new THREE.Vector3(...lonLatToVec(c.lon, c.lat, 1.008));
        return (
          <group key={c.key}>
            <Beacon pos={pos} color={STATUS_COLOR[status]} size={status === "red" ? 0.034 : status === "amber" ? 0.028 : 0.022} />
            {labels && (
              <Html position={pos.clone().multiplyScalar(1.02)} occlude={[earthRef as React.RefObject<THREE.Object3D>]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
                <button type="button" className={`mk ${status} ${selected === c.key ? "sel" : ""}`} onClick={() => onSelect(c.key)} aria-label={`${c.name}: open details`}>
                  <i />
                  <span>{c.name.replace(" Strait", "").replace(" Canal", "").replace(" Channel", "")}</span>
                </button>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Cyclones({ pulse }: { pulse: PulseData | null }) {
  if (!pulse?.cyclones.length) return null;
  return (
    <group>
      {pulse.cyclones.map((c) => {
        const pos = new THREE.Vector3(...lonLatToVec(c.lon, c.lat, 1.012));
        return (
          <group key={c.id}>
            <CycloneSprite pos={pos} />
            {c.track && c.track.length > 1 && (
              <Line points={c.track.map((p) => new THREE.Vector3(...lonLatToVec(p[0], p[1], 1.01)))} color="#ffab2e" lineWidth={1.3} dashed dashSize={0.02} gapSize={0.014} transparent opacity={0.9} />
            )}
          </group>
        );
      })}
    </group>
  );
}

function CycloneSprite({ pos }: { pos: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => {
    ref.current?.lookAt(pos.clone().multiplyScalar(2));
  }, [pos]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
  });
  return (
    <mesh ref={ref} position={pos}>
      <planeGeometry args={[0.16, 0.16]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`}
        fragmentShader={`varying vec2 vUv; uniform float uTime;
          void main(){ vec2 p=vUv-.5; float r=length(p); float a=atan(p.y,p.x);
            float spiral = .5+.5*sin(a*3.0 - r*26.0 + uTime*1.6);
            float body = smoothstep(.5,.05,r);
            float eye = smoothstep(.035,.05,r);
            gl_FragColor = vec4(vec3(1.,.78,.4), body*spiral*eye*.8); }`}
      />
    </mesh>
  );
}

/* ───────── the route the visitor asked for ───────── */
function densify(path: [number, number][], maxDeg: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const deg = (haversineKm(a, b) / 6371) * (180 / Math.PI);
    const n = Math.max(1, Math.ceil(deg / maxDeg));
    for (let k = 0; k < n; k++) out.push(k === 0 ? a : (greatCirclePoint(a, b, k / n) as [number, number]));
  }
  out.push(path[path.length - 1]);
  return out;
}

interface Built {
  leg: GlobeLeg;
  pts: THREE.Vector3[];
  segs: number;
  /** share of the whole route where this leg starts and ends, by length */
  from: number;
  to: number;
  color: string;
}

function buildLegs(legs: GlobeLeg[]): { items: Built[]; all: THREE.Vector3[]; cum: number[]; total: number; modeAt: (f: number) => GlobeLeg["mode"]; colorAt: (f: number) => string } {
  const items: Built[] = [];
  const all: THREE.Vector3[] = [];
  const bounds: { to: number; mode: GlobeLeg["mode"]; color: string }[] = [];
  const raw = legs.map((leg) => {
    const dense = densify(leg.path, leg.mode === "air" ? 1.2 : 0.9);
    // angular length, for the height of an air arc
    let ang = 0;
    for (let i = 1; i < dense.length; i++) ang += haversineKm(dense[i - 1], dense[i]) / 6371;
    const lift = leg.mode === "air" ? 0.03 + 0.2 * Math.min(1, ang / 2.1) : 0;
    const base = leg.mode === "sea" ? 1.0035 : 1.0045;
    const pts = dense.map((p, i) => new THREE.Vector3(...lonLatToVec(p[0], p[1], base + lift * Math.sin(Math.PI * (i / (dense.length - 1))))));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    return { leg, pts, len };
  });
  const total = raw.reduce((s, r) => s + r.len, 0) || 1;
  let run = 0;
  for (const r of raw) {
    const color = r.leg.color ?? MODE_COLOR[r.leg.mode];
    items.push({ leg: r.leg, pts: r.pts, segs: r.pts.length - 1, from: run / total, to: (run + r.len) / total, color });
    run += r.len;
    bounds.push({ to: run / total, mode: r.leg.mode, color });
    all.push(...(all.length ? r.pts.slice(1) : r.pts));
  }
  const cum = [0];
  for (let i = 1; i < all.length; i++) cum.push(cum[i - 1] + all[i].distanceTo(all[i - 1]));
  const pick = (f: number) => bounds.find((b) => f <= b.to) ?? bounds[bounds.length - 1];
  return { items, all, cum, total: cum[cum.length - 1] || 1, modeAt: (f) => pick(f).mode, colorAt: (f) => pick(f).color };
}

const MODE_STYLE: Record<GlobeLeg["mode"], { width: number; dashed: boolean; dash: number; gap: number; glow: number }> = {
  sea: { width: 2.6, dashed: false, dash: 0, gap: 0, glow: 8 },
  air: { width: 2.0, dashed: true, dash: 0.022, gap: 0.016, glow: 6 },
  rail: { width: 3.2, dashed: true, dash: 0.005, gap: 0.011, glow: 6 },
  road: { width: 3.4, dashed: true, dash: 0.0015, gap: 0.011, glow: 6 },
};

function RouteArc({ route, reduce, earthRef, labels }: { route: GlobeRoute; reduce: boolean; earthRef: React.RefObject<THREE.Mesh | null>; labels: boolean }) {
  const built = useMemo(() => buildLegs(route.legs), [route]);
  const ghosts = useMemo(() => (route.ghosts ?? []).map((g) => ({ g, pts: densify(g.path, 1.2).map((p) => new THREE.Vector3(...lonLatToVec(p[0], p[1], g.mode === "air" ? 1.03 : 1.003))) })), [route]);
  const lineRefs = useRef<(any | null)[]>([]);
  const t0 = useRef<number | null>(null);
  const cometGeo = useMemo(() => {
    const N = 44;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const a = new Float32Array(N);
    for (let i = 0; i < N; i++) a[i] = 1 - i / (N - 1);
    g.setAttribute("aA", new THREE.BufferAttribute(a, 1));
    return g;
  }, []);
  const cometMat = useRef<THREE.ShaderMaterial>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const lengthU = built.total;
  const reveal = useMemo(() => Math.max(1.6, Math.min(4.2, 1.5 + lengthU * 1.1)), [lengthU]);
  const loop = useMemo(() => Math.max(4.5, Math.min(11, 3.5 + lengthU * 2.6)), [lengthU]);

  useEffect(() => {
    t0.current = null;
  }, [route]);

  // drei's Html can lose its content when the canvas finishes connecting after the first mount;
  // remounting the end labels shortly after mount puts them back
  const [gen, nudge] = useState(0);
  useEffect(() => {
    const ids = [350, 1400].map((ms) => setTimeout(() => nudge((n) => n + 1), ms));
    return () => ids.forEach(clearTimeout);
  }, [route]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (t0.current === null) t0.current = t;
    const el = t - t0.current;
    const p0 = reduce ? 1 : Math.min(1, el / reveal);
    const p = 1 - Math.pow(1 - p0, 3);
    built.items.forEach((it, i) => {
      const l = lineRefs.current[i * 3];
      const g = lineRefs.current[i * 3 + 1];
      const c = lineRefs.current[i * 3 + 2];
      const share = it.to - it.from || 1;
      const k = Math.max(0, Math.min(1, (p - it.from) / share));
      const n = Math.floor(it.segs * k);
      if (l?.geometry) l.geometry.instanceCount = n;
      if (g?.geometry) g.geometry.instanceCount = n;
      if (c?.geometry) c.geometry.instanceCount = n;
    });
    // comet: leads the reveal, then loops along the finished route
    let head: number;
    let vis = 1;
    if (p0 < 1) head = p;
    else {
      const f = ((el - reveal) / loop) % 1.3;
      head = Math.min(1, f);
      vis = f > 1 ? 0 : 1;
    }
    const tail = 0.085;
    const pos = cometGeo.getAttribute("position") as THREE.BufferAttribute;
    const N = pos.count;
    for (let i = 0; i < N; i++) {
      pointAt(built.all, built.cum, built.total, Math.max(0, head - (i / (N - 1)) * tail), tmp);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
    if (cometMat.current) {
      cometMat.current.uniforms.uVis.value = vis;
      cometMat.current.uniforms.uColor.value.set(built.colorAt(head));
    }
  });

  const e1 = useMemo(() => new THREE.Vector3(...lonLatToVec(route.from.lon, route.from.lat, 1.006)), [route]);
  const e2 = useMemo(() => new THREE.Vector3(...lonLatToVec(route.to.lon, route.to.lat, 1.006)), [route]);

  return (
    <group>
      {ghosts.map((g, i) => (
        <Line key={`gh${i}`} points={g.pts} color={MODE_COLOR[g.g.mode]} lineWidth={1.2} dashed dashSize={0.012} gapSize={0.012} transparent opacity={0.5} depthWrite={false} />
      ))}
      {built.items.map((it, i) => {
        const st = MODE_STYLE[it.leg.mode];
        return (
          <group key={it.leg.id + i}>
            <Line
              ref={(r: any) => {
                lineRefs.current[i * 3 + 2] = r;
              }}
              points={it.pts}
              color="#02030a"
              lineWidth={st.width + 3.4}
              dashed={st.dashed}
              dashSize={st.dash}
              gapSize={st.gap}
              transparent
              opacity={0.62}
              depthWrite={false}
            />
            <Line
              ref={(r: any) => {
                lineRefs.current[i * 3] = r;
              }}
              points={it.pts}
              color={it.color}
              lineWidth={st.width}
              dashed={st.dashed}
              dashSize={st.dash}
              gapSize={st.gap}
              transparent
              depthWrite={false}
            />
            <Line
              ref={(r: any) => {
                lineRefs.current[i * 3 + 1] = r;
              }}
              points={it.pts}
              color={it.color}
              lineWidth={st.glow}
              transparent
              opacity={0.14}
              depthWrite={false}
            />
          </group>
        );
      })}
      <points geometry={cometGeo} frustumCulled={false}>
        <shaderMaterial
          ref={cometMat}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={{ uColor: { value: new THREE.Color("#ffefcf") }, uVis: { value: 0 } }}
          vertexShader={`attribute float aA; varying float vA; uniform float uVis;
            void main(){ vA = aA * uVis; vec4 mv = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = (3.0 + 20.0 * pow(aA, 4.0)) * (2.6 / -mv.z); gl_Position = projectionMatrix * mv; }`}
          fragmentShader={`varying float vA; uniform vec3 uColor;
            void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a;
              vec3 c = mix(uColor, vec3(1.0), 0.6 * vA * vA);
              gl_FragColor = vec4(c * a * vA * 1.6, a * vA); }`}
        />
      </points>
      {[
        { at: e1, end: route.from },
        { at: e2, end: route.to },
      ].map(({ at, end }, i) => (
        <group key={i}>
          <Beacon pos={at} color="#ffefcf" size={0.026} steady />
          {labels && (
            <Html key={`end-${i}-${gen}`} position={at.clone().multiplyScalar(1.02)} occlude={[earthRef as React.RefObject<THREE.Object3D>]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
              <span className={`mk end ${i === 0 ? "from" : "to"}`}>
                {end.code && <b className="tag" style={{ color: "var(--lamp)", fontWeight: 400, letterSpacing: ".08em" }}>{end.code}</b>}
                <span>{end.name}</span>
              </span>
            </Html>
          )}
        </group>
      ))}
    </group>
  );
}

function Pins({ pins, earthRef }: { pins: GlobePin[]; earthRef: React.RefObject<THREE.Mesh | null> }) {
  return (
    <group>
      {pins.map((p) => {
        const pos = new THREE.Vector3(...lonLatToVec(p.at[0], p.at[1], 1.01));
        return (
          <group key={p.id}>
            <Beacon pos={pos} color={p.color} size={0.03} steady />
            {p.label && (
              <Html position={pos.clone().multiplyScalar(1.025)} occlude={[earthRef as React.RefObject<THREE.Object3D>]} zIndexRange={[18, 0]} style={{ pointerEvents: "none" }}>
                <span className="mk pin" style={{ borderColor: p.color }}>
                  <i style={{ background: p.color }} />
                  <span>{p.label}</span>
                </span>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ───────── camera ───────── */
function Rig({ reduce }: { reduce: boolean }) {
  const { camera, size, pointer } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  useEffect(() => {
    cam.fov = size.width < 700 ? 40 : 32;
    cam.updateProjectionMatrix();
  }, [size.width, cam]);
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 3.4);
    (["lon", "lat", "dist", "ox", "oy", "layers", "air", "rail"] as const).forEach((key) => {
      if (key === "lon") {
        const d = ((camTarget.lon - camNow.lon + 540) % 360) - 180;
        camNow.lon += d * k;
      } else camNow[key] += (camTarget[key] - camNow[key]) * k;
    });
    sceneState.laneDim += ((sceneState.laneDimTarget - sceneState.laneDim) * k);
    if (!reduce && !drag.active) camNow.lon += dt * 0.35 * (1 - Math.min(1, camNow.layers)) * sceneState.autorotate;
    if (!drag.active) {
      drag.dLon *= 1 - Math.min(1, dt * 0.6);
      drag.dLat *= 1 - Math.min(1, dt * 0.6);
    }
    const lon = camNow.lon + drag.dLon + pointer.x * 1.6;
    const lat = Math.max(-78, Math.min(78, camNow.lat + drag.dLat + pointer.y * 1.2));
    const p = lonLatToVec(lon, lat, camNow.dist);
    cam.position.set(p[0], p[1], p[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    const w = size.width;
    const h = size.height;
    if (Math.abs(camNow.ox) > 0.001 || Math.abs(camNow.oy) > 0.001) {
      cam.setViewOffset(w, h, -camNow.ox * w, camNow.oy * h, w, h);
    } else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  });
  return null;
}

function SunClock() {
  useEffect(() => {
    updateSun();
    const id = setInterval(updateSun, 30_000);
    return () => clearInterval(id);
  }, []);
  return null;
}

export interface GlobeSceneProps {
  pulse: PulseData | null;
  reduce: boolean;
  low: boolean;
  labels: boolean;
  selected: string | null;
  onSelect: (key: string) => void;
  onProgress: (loaded: number) => void;
  onReady: () => void;
  route?: GlobeRoute | null;
  pins?: GlobePin[];
  /** hide the ambient chokepoint rings, e.g. on the desk where the route is the subject */
  quiet?: boolean;
}

export default function GlobeScene({ pulse, reduce, low, labels, selected, onSelect, onProgress, onReady, route = null, pins = [], quiet = false }: GlobeSceneProps) {
  const earthRef = useRef<THREE.Mesh>(null);
  const loaded = useRef(0);
  const bump = () => {
    loaded.current += 1;
    onProgress(loaded.current / 3);
  };
  useEffect(() => {
    sceneState.laneDimTarget = route || quiet ? 0.18 : 1;
    sceneState.autorotate = route ? 0 : 1;
  }, [route, quiet]);
  return (
    <Canvas
      dpr={[1, low ? 1.25 : 1.75]}
      camera={{ fov: 32, near: 0.05, far: 200, position: [0, 0, 3] }}
      gl={{ antialias: !low, powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor("#000000");
        scene.background = new THREE.Color("#000000");
        gl.domElement.addEventListener("webglcontextlost", (e) => e.preventDefault());
        onReady();
      }}
      style={{ position: "absolute", inset: 0 }}
    >
      <SunClock />
      <Rig reduce={reduce} />
      <Stars count={low ? 12000 : 38000} reduce={reduce} />
      {!reduce && !low && <Meteors />}
      <Earth onTex={bump} earthRef={earthRef} />
      <Atmosphere />
      <Lanes low={low} />
      {!quiet && <Markers pulse={pulse} earthRef={earthRef} labels={labels} selected={selected} onSelect={onSelect} />}
      <Cyclones pulse={pulse} />
      {route && <RouteArc route={route} reduce={reduce} earthRef={earthRef} labels />}
      {pins.length > 0 && <Pins pins={pins} earthRef={earthRef} />}
    </Canvas>
  );
}
