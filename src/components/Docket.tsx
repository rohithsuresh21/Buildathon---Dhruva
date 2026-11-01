"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight, Dices, LoaderCircle, Plane, Ship, Sparkles, TrainFront, Truck } from "lucide-react";
import type { GlobeRoute, GlobeLeg } from "./globe/GlobeScene";
import type { Itinerary } from "@/lib/types";
import type { ParsedShipment } from "@/lib/analysis-types";

export interface PlacePick {
  id: string;
  name: string;
  type: string;
  cc: string;
  country?: string;
  state?: string;
  kind?: string;
  lon: number;
  lat: number;
  code?: string;
}
export type ModeChoice = "auto" | "sea" | "air" | "rail" | "road";
export interface DocketValue {
  from: PlacePick | null;
  to: PlacePick | null;
  mode: ModeChoice;
  cargo: string;
}

export const emptyDocket: DocketValue = { from: null, to: null, mode: "auto", cargo: "" };

const MODES: { id: ModeChoice; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "auto", label: "Best fit", icon: <Sparkles size={14} />, color: "#ffd99a" },
  { id: "sea", label: "Sea", icon: <Ship size={14} />, color: "#ffd99a" },
  { id: "air", label: "Air", icon: <Plane size={14} />, color: "#c9bbff" },
  { id: "rail", label: "Rail", icon: <TrainFront size={14} />, color: "#ff9d6e" },
  { id: "road", label: "Road", icon: <Truck size={14} />, color: "#e8e2d4" },
];

const KIND: Record<string, string> = { port: "PORT", airport: "AIRPORT", inland: "INLAND" };
const SURFACE_KIND: Record<string, string> = { icd: "ICD", cfs: "CFS", rail_terminal: "RAIL YARD", junction: "RAIL JN", inland_port: "RIVER PORT", dry_port: "DRY PORT" };
const kindOf = (p: PlacePick) => (p.kind && SURFACE_KIND[p.kind]) || KIND[p.type] || "";

/** Real lanes Indian MSMEs actually use; each name is resolved through the same place search a visitor uses. */
const SURPRISES: [string, string, ModeChoice][] = [
  ["Tiruppur", "Hamburg", "auto"],
  ["Mundra", "Rotterdam", "sea"],
  ["Shenzhen", "Nhava Sheva", "sea"],
  ["Hyderabad", "Frankfurt", "air"],
  ["Ludhiana", "Mundra", "rail"],
  ["Chennai", "Singapore", "sea"],
  ["Jebel Ali", "Tuticorin", "sea"],
  ["Delhi", "Dubai", "air"],
  ["Surat", "Kolkata", "road"],
  ["Kandla", "Mombasa", "sea"],
];

/* ───────── one end of the docket ───────── */
function PlaceField({ id, label, value, onPick, placeholder, autoFocus }: { id: string; label: string; value: PlacePick | null; onPick: (p: PlacePick | null) => void; placeholder: string; autoFocus?: boolean }) {
  const [q, setQ] = useState(value?.name ?? "");
  const [list, setList] = useState<PlacePick[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const ctl = useRef<AbortController | null>(null);
  const tm = useRef<number | null>(null);
  const focused = useRef(false);
  const listRef = useRef<PlacePick[]>([]);
  const valueRef = useRef<PlacePick | null>(value);
  listRef.current = list;
  valueRef.current = value;

  // the parent can set the value (swap, surprise me, a shared link); mirror it unless the visitor is typing
  useEffect(() => {
    if (!focused.current) setQ(value?.name ?? "");
  }, [value]);

  const search = useCallback((text: string) => {
    if (tm.current) window.clearTimeout(tm.current);
    if (text.trim().length < 2) {
      setList([]);
      return;
    }
    tm.current = window.setTimeout(async () => {
      ctl.current?.abort();
      const ac = new AbortController();
      ctl.current = ac;
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(text.trim())}`, { signal: ac.signal });
        const j = await r.json();
        setList(j.results ?? []);
        setSel(0);
      } catch {
        /* superseded or offline: keep the last list */
      }
    }, 170);
  }, []);

  const choose = (p: PlacePick) => {
    setQ(p.name);
    setOpen(false);
    setList([]);
    onPick(p);
  };

  const sub = value ? [value.state, value.country].filter(Boolean).join(", ") : "";

  return (
    <div className="dk-end">
      <label htmlFor={id}>{label}</label>
      <div className="dk-in">
        <input
          id={id}
          value={q}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open && list.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          onFocus={() => {
            focused.current = true;
            setOpen(true);
            if (q.length >= 2 && !value) search(q);
          }}
          onBlur={() => {
            focused.current = false;
            // leaving the field with a pending suggestion picks the best one, so a typed name is never silently dropped
            window.setTimeout(() => {
              setOpen(false);
              if (!valueRef.current && listRef.current.length && !focused.current) choose(listRef.current[0]);
            }, 120);
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (value) onPick(null);
            search(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(list.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter" && open && list[sel]) {
              e.preventDefault();
              choose(list[sel]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        {value && <span className="dk-code">{value.code ?? value.cc}</span>}
      </div>
      <div className="dk-sub">{sub}</div>
      {open && list.length > 0 && (
        <ul className="dk-list" id={`${id}-list`} role="listbox">
          {list.map((p, i) => (
            <li key={p.id} role="presentation">
              <button type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)} onMouseEnter={() => setSel(i)}>
                <span>
                  {p.name}
                  <br />
                  <small>{[p.state, p.country].filter(Boolean).join(", ")}</small>
                </span>
                <span className="dk-kind">{p.code ? `${p.code} · ` : ""}{kindOf(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────── the docket ───────── */
export default function Docket({
  value,
  onChange,
  onSubmit,
  busy = false,
  wide = false,
  cta = "Check this shipment",
  autoFocus = false,
  free,
}: {
  value: DocketValue;
  onChange: (v: DocketValue) => void;
  onSubmit: () => void;
  busy?: boolean;
  wide?: boolean;
  cta?: string;
  autoFocus?: boolean;
  /** optional free-text path, shown under a "type it as a sentence" toggle */
  free?: React.ReactNode;
}) {
  const [showFree, setShowFree] = useState(false);
  const [rolling, setRolling] = useState(false);
  const ready = !!value.from && !!value.to;

  const surprise = async () => {
    setRolling(true);
    try {
      const pick = SURPRISES[Math.floor(Math.random() * SURPRISES.length)];
      const look = async (n: string) => (await (await fetch(`/api/places?q=${encodeURIComponent(n)}`)).json()).results?.[0] as PlacePick | undefined;
      const [a, b] = await Promise.all([look(pick[0]), look(pick[1])]);
      if (a && b) onChange({ ...value, from: a, to: b, mode: pick[2] });
    } finally {
      setRolling(false);
    }
  };

  return (
    <form
      className={`docket ${wide ? "wide" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
    >
      <div className="dk-ends">
        <PlaceField id={`${wide ? "d" : "h"}-from`} label="From" value={value.from} onPick={(p) => onChange({ ...value, from: p })} placeholder="Shenzhen" autoFocus={autoFocus} />
        <div className="dk-mid">
          <button type="button" className="dk-swap" aria-label="Swap start and end" onClick={() => onChange({ ...value, from: value.to, to: value.from })}>
            <ArrowLeftRight size={16} />
          </button>
        </div>
        <PlaceField id={`${wide ? "d" : "h"}-to`} label="To" value={value.to} onPick={(p) => onChange({ ...value, to: p })} placeholder="Mundra" />
      </div>
      <div className="dk-row">
        <div className="dk-modes" role="group" aria-label="How it travels">
          {MODES.map((m) => (
            <button key={m.id} type="button" className="dk-mode" aria-pressed={value.mode === m.id} style={{ ["--m" as string]: m.color }} onClick={() => onChange({ ...value, mode: m.id })}>
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        <input className="dk-cargo" aria-label="What are you shipping" placeholder="What are you shipping? (optional)" value={value.cargo} maxLength={80} onChange={(e) => onChange({ ...value, cargo: e.target.value })} />
      </div>
      <div className="dk-go">
        <button type="submit" className="btn" disabled={!ready || busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
          {busy ? "Agents working" : cta}
        </button>
        <button type="button" className="btn ghost small" onClick={surprise} disabled={rolling}>
          {rolling ? <LoaderCircle size={14} className="spin" /> : <Dices size={15} />} Surprise me
        </button>
      </div>
      {free && (
        <div className="dk-or">
          <button type="button" onClick={() => setShowFree((s) => !s)} aria-expanded={showFree}>
            {showFree ? "Hide the sentence box" : "Or type it as a sentence, in English, Hindi, Gujarati or Tamil"}
          </button>
        </div>
      )}
      {free && showFree && <div className="dk-free">{free}</div>}
      {free && showFree && <div style={{ height: 14 }} />}
    </form>
  );
}

/* ───────── route preview for the globe ───────── */
export interface RoutePreview {
  route: GlobeRoute | null;
  loading: boolean;
  error: string | null;
  primary: Itinerary | null;
  itineraries: Itinerary[];
  parsed: ParsedShipment | null;
}

const asLeg = (l: Itinerary["legs"][number]): GlobeLeg => ({ id: l.id, mode: l.mode, path: l.path as [number, number][] });

export function useRoutePreview(v: DocketValue, enabled = true): RoutePreview {
  const [st, setSt] = useState<RoutePreview>({ route: null, loading: false, error: null, primary: null, itineraries: [], parsed: null });
  const key = v.from && v.to ? `${v.from.id}>${v.to.id}>${v.mode}` : "";
  const last = useRef("");
  useEffect(() => {
    if (!enabled || !key || !v.from || !v.to) {
      last.current = "";
      setSt((s) => (s.route || s.error || s.loading ? { route: null, loading: false, error: null, primary: null, itineraries: [], parsed: null } : s));
      return;
    }
    if (last.current === key) return;
    last.current = key;
    const ac = new AbortController();
    setSt((s) => ({ ...s, loading: true, error: null }));
    const ref = (p: PlacePick) => ({ id: p.id, name: p.name, type: p.type, cc: p.cc, country: p.country, state: p.state, lon: p.lon, lat: p.lat });
    (async () => {
      try {
        const r = await fetch("/api/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: ref(v.from!), to: ref(v.to!), mode: v.mode, cargo: v.cargo }), signal: ac.signal });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
        const itineraries: Itinerary[] = j.itineraries;
        const primary = itineraries.find((i) => i.id === j.primary) ?? itineraries[0];
        const other = itineraries.filter((i) => i.id !== primary.id).flatMap((i) => i.legs.map(asLeg));
        const o = j.parsed.origin;
        const d = j.parsed.destination;
        setSt({
          loading: false,
          error: null,
          primary,
          itineraries,
          parsed: j.parsed,
          route: {
            key: `${key}:${primary.id}`,
            legs: primary.legs.map(asLeg),
            ghosts: other,
            from: { name: o.name.split(" (")[0], code: v.from!.code, lon: o.lon, lat: o.lat },
            to: { name: d.name.split(" (")[0], code: v.to!.code, lon: d.lon, lat: d.lat },
          },
        });
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        last.current = "";
        setSt({ route: null, loading: false, error: String(e?.message ?? e), primary: null, itineraries: [], parsed: null });
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return useMemo(() => st, [st]);
}

export const MODE_NAME = { sea: "sea", air: "air", rail: "rail", road: "road" } as const;
