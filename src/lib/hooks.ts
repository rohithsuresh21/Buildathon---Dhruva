"use client";
import { useEffect, useRef, useState } from "react";
import type { PulseData } from "./pulse-types";

export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const f = () => setR(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return r;
}

export function usePulse() {
  const [data, setData] = useState<PulseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch("/api/pulse");
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = (await r.json()) as PulseData;
        if (!dead) {
          setData(j);
          setError(null);
        }
      } catch (e: any) {
        if (!dead) setError(String(e?.message ?? e));
      }
    };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, []);
  return { data, error };
}

/** Magnetic hover for buttons: sets --mx/--my on the element. */
export function useMagnetic<T extends HTMLElement>(strength = 0.25) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${(e.clientX - (r.left + r.width / 2)) * strength}px`);
      el.style.setProperty("--my", `${(e.clientY - (r.top + r.height / 2)) * strength}px`);
    };
    const leave = () => {
      el.style.setProperty("--mx", "0px");
      el.style.setProperty("--my", "0px");
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);
  return ref;
}

/** Cursor-reactive light for .plate elements. */
export function usePlateLight() {
  useEffect(() => {
    const f = (e: PointerEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.(".plate") as HTMLElement | null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty("--px", `${e.clientX - r.left}px`);
      t.style.setProperty("--py", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", f, { passive: true });
    return () => window.removeEventListener("pointermove", f);
  }, []);
}

export function fmtDate(iso?: string | null) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtTime(iso?: string | null) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (isNaN(+d)) return iso;
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }) + " UTC";
}

export function ageLabel(iso?: string | null, now = Date.now()) {
  if (!iso) return "age unknown";
  const ms = now - new Date(iso).getTime();
  if (isNaN(ms)) return "age unknown";
  const m = Math.round(ms / 60000);
  if (m < 90) return `${Math.max(m, 0)} min old`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h old`;
  return `${Math.round(h / 24)} days old`;
}
