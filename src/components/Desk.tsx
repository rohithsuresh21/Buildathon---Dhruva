"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CircleDashed, Copy, Link2, LoaderCircle, Plane, RotateCcw, Ship, TrainFront, Truck } from "lucide-react";
import { Brand } from "./Logo";
import FlatMap, { type MapMarker, type MapRoute } from "./FlatMap";
import Docket, { emptyDocket, useRoutePreview, type DocketValue } from "./Docket";
import Flap from "./Flap";
import Safer, { type DeepState } from "./Safer";
import Handover from "./Handover";
import { flyTo, frameOf } from "./globe/camera";
import type { GlobePin, GlobeRoute } from "./globe/GlobeScene";
import { LANGS, type Lang } from "@/lib/compose";
import { ageLabel, fmtTime, usePlateLight, usePulse, useReducedMotion } from "@/lib/hooks";
import type { Alternative, FinalAnswer, ParsedShipment, StreamEvent } from "@/lib/analysis-types";
import type { Itinerary, LegVerdict, Signal, TraceEvent, Verdict } from "@/lib/types";

/** Short, readable globe label: drop filler words, then cut at a word boundary instead of mid-word. */
function pinLabel(title: string, max = 34): string {
  const t = title
    .replace(/^Tropical cyclone\s+/i, "Cyclone ")
    .replace(/\s*\((?:green|orange|red)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, "").replace(/\s+(?:near|in|at|of|to|the|and|over|off)$/i, "");
  return (cut || t.slice(0, max)) + "…";
}

const GlobeScene = dynamic(() => import("./globe/GlobeScene"), { ssr: false });

const STAGES: { n: number; title: string; who: string }[] = [
  { n: 1, title: "Understand the shipment", who: "Intake" },
  { n: 2, title: "Resolve the lanes", who: "Planner" },
  { n: 3, title: "Check chokepoint transit patterns", who: "Maritime" },
  { n: 4, title: "Check cyclone and hazard activity", who: "Storm" },
  { n: 5, title: "Check Indian disaster alerts", who: "Alerts" },
  { n: 6, title: "Check port, airport and corridor weather", who: "Maritime, Aviation, Surface" },
  { n: 7, title: "Corroborate independent signals", who: "Corroborator, News" },
  { n: 8, title: "Verdict and recommendation", who: "Strategist, Comms" },
];

const EXAMPLES = [
  "Solar inverters from Shenzhen to Mundra",
  "Cotton yarn from Tiruppur to Hamburg",
  "Electronics from Shanghai to Jaipur",
  "Auto parts from Chennai to Rotterdam",
  "शेन्ज़ेन से मुंद्रा तक सोलर इन्वर्टर",
  "Pharma samples from Hyderabad to Frankfurt by air",
];

const V_COLOR: Record<Verdict, string> = { green: "#58e6a6", amber: "#ffab2e", red: "#ff5252", abstain: "#b5ae9f" };
const V_WORD: Record<Verdict, string> = { green: "Green", amber: "Amber", red: "Red", abstain: "Unsure" };
const V_SAYS: Record<Verdict, string> = { green: "Clear to go. Nothing independent is flagging this route.", amber: "Go, but keep watching. Something is off along the way.", red: "Act now. Independent sources agree on a real problem.", abstain: "Not enough fresh data to call it either way." };
const MODE_ICON = { sea: <Ship size={16} />, air: <Plane size={16} />, rail: <TrainFront size={16} />, road: <Truck size={16} /> } as const;
const MODE_HEX = { sea: "#ffd99a", air: "#c9bbff", rail: "#ff9d6e", road: "#e8e2d4" } as const;
const SEV_WORD = ["Normal", "Mild", "Strong", "Severe"];
const MODE_WORD = { sea: "Sea", air: "Air", rail: "Rail", road: "Road" } as const;

type Phase = "idle" | "running" | "done" | "error";

export default function Desk({ initialQ, initialD }: { initialQ?: string; initialD?: string }) {
  const [text, setText] = useState(initialQ ?? "");
  const [docket, setDocket] = useState<DocketValue>(emptyDocket);
  const [view, setView] = useState<"globe" | "map">("globe");
  const [linked, setLinked] = useState(false);
  const reduce = useReducedMotion();
  const { data: pulse } = usePulse();
  const [low, setLow] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [trace, setTrace] = useState<Omit<TraceEvent, "type">[]>([]);
  const [parsed, setParsed] = useState<ParsedShipment | null>(null);
  const [plan, setPlan] = useState<{ itineraries: Itinerary[]; primary: string } | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [answer, setAnswer] = useState<FinalAnswer | null>(null);
  const [alts, setAlts] = useState<Alternative[]>([]);
  const [messages, setMessages] = useState<Record<Lang, string> | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [took, setTook] = useState<{ ms: number; llm: boolean } | null>(null);
  const [itin, setItin] = useState<string | null>(null);
  const [deepState, setDeepState] = useState<DeepState>("idle");
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);
  usePlateLight();

  const run = useCallback(async (q: string | { shipment: unknown }, opts?: { deep?: boolean }) => {
    const t = typeof q === "string" ? q.trim() : "x";
    if (!t) return;
    const deep = !!opts?.deep;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setPhase("running");
    setTrace([]);
    setError(null);
    setTook(null);
    setDeepState(deep ? "running" : "idle");
    // a wider search keeps the first answer on screen and replaces it as better data arrives
    if (!deep) {
      setParsed(null);
      setPlan(null);
      setSignals([]);
      setAnswer(null);
      setAlts([]);
      setMessages(null);
      setItin(null);
    }
    let firstSignals = deep;
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(typeof q === "string" ? { text: t } : q), deep }), signal: ac.signal });
      if (!res.ok || !res.body) throw new Error(`The analysis service answered HTTP ${res.status}.`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          switch (ev.type) {
            case "trace": {
              const { type: _t, ...rest } = ev;
              setTrace((p) => [...p, rest]);
              break;
            }
            case "parsed": setParsed(ev.data); break;
            case "plan": setPlan(ev.data); if (!deep) setItin(ev.data.primary); break;
            case "signals": {
              const batch = ev.data;
              if (firstSignals) {
                firstSignals = false;
                setSignals(batch);
              } else setSignals((p) => [...p, ...batch]);
              break;
            }
            case "verdict": setAnswer(ev.data); break;
            case "alternatives": setAlts(ev.data); break;
            case "messages": setMessages(ev.data); break;
            case "done": setTook({ ms: ev.data.tookMs, llm: ev.data.llm }); setPhase("done"); if (deep) setDeepState("done"); break;
            case "error": setError({ message: ev.message, hint: ev.hint }); setPhase("error"); if (deep) setDeepState("idle"); break;
          }
        }
      }
      setPhase((p) => (p === "running" ? "done" : p));
      if (deep) setDeepState((d) => (d === "running" ? "done" : d));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError({ message: String(e?.message ?? e), hint: "Nothing was invented to fill the gap. Try again in a moment." });
      setPhase("error");
      if (deep) setDeepState("idle");
    }
  }, []);

  const runDocket = useCallback(
    (v: DocketValue) => {
      if (!v.from || !v.to) return;
      const ref = (p: NonNullable<DocketValue["from"]>) => ({ id: p.id, name: p.name, type: p.type, cc: p.cc, country: p.country, state: p.state, lon: p.lon, lat: p.lat });
      run({ shipment: { from: ref(v.from), to: ref(v.to), mode: v.mode, cargo: v.cargo } });
    },
    [run],
  );

  // the same request again, with a wider search for safer routings
  const findSafer = useCallback(() => {
    if (docket.from && docket.to) {
      const ref = (p: NonNullable<DocketValue["from"]>) => ({ id: p.id, name: p.name, type: p.type, cc: p.cc, country: p.country, state: p.state, lon: p.lon, lat: p.lat });
      run({ shipment: { from: ref(docket.from), to: ref(docket.to), mode: docket.mode, cargo: docket.cargo } }, { deep: true });
    } else if (parsed) {
      const ref = (p: ParsedShipment["origin"]) => ({ id: p.id, name: p.name, type: p.type, cc: p.cc, country: p.country, state: p.state, lon: p.lon, lat: p.lat });
      run({ shipment: { from: ref(parsed.origin), to: ref(parsed.destination), mode: parsed.modeHint, cargo: parsed.cargo } }, { deep: true });
    }
  }, [docket, parsed, run]);

  // a shared link or a hand-off from the landing page starts the check straight away
  useEffect(() => {
    setLow(window.innerWidth < 800 || (navigator.hardwareConcurrency ?? 8) <= 4);
    if (started.current) return;
    if (initialD) {
      try {
        const j = JSON.parse(initialD);
        const v: DocketValue = { from: j.f, to: j.t, mode: j.m ?? "auto", cargo: String(j.c ?? "") };
        if (v.from?.id && v.to?.id) {
          started.current = true;
          setDocket(v);
          runDocket(v);
          return;
        }
      } catch {
        /* fall through to the sentence path */
      }
    }
    if (initialQ) {
      started.current = true;
      run(initialQ);
    }
  }, [initialD, initialQ, run, runDocket]);

  /* ---- derived ---- */
  const preview = useRoutePreview(docket, !plan);
  const legVerdict = useMemo(() => {
    const m: Record<string, LegVerdict> = {};
    answer?.legs.forEach((l) => (m[l.legId] = l));
    return m;
  }, [answer]);
  const itineraries: Itinerary[] = plan?.itineraries ?? preview.itineraries;
  const activeItin = itineraries.find((i) => i.id === itin) ?? (plan ? itineraries.find((i) => i.id === plan.primary) : preview.primary) ?? itineraries[0] ?? null;

  const globeRoute: GlobeRoute | null = useMemo(() => {
    if (!activeItin) return null;
    const o = parsed?.origin ?? preview.parsed?.origin ?? docket.from;
    const d = parsed?.destination ?? preview.parsed?.destination ?? docket.to;
    if (!o || !d) return null;
    const legs = activeItin.legs.map((l) => ({ id: l.id, mode: l.mode, path: l.path as [number, number][], color: legVerdict[l.id] ? V_COLOR[legVerdict[l.id].verdict] : undefined }));
    const ghosts = itineraries.filter((i) => i.id !== activeItin.id).flatMap((i) => i.legs.map((l) => ({ id: "g" + l.id, mode: l.mode, path: l.path as [number, number][] })));
    return {
      key: `${activeItin.id}:${activeItin.legs.map((l) => l.id).join(",")}`,
      legs,
      ghosts,
      from: { name: o.name.split(" (")[0], code: docket.from?.code, lon: o.lon, lat: o.lat },
      to: { name: d.name.split(" (")[0], code: docket.to?.code, lon: d.lon, lat: d.lat },
    };
    // the route re-keys only when the geometry changes, not when verdict colours arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItin?.id, activeItin?.legs.map((l) => l.id).join(","), parsed, preview.parsed, docket.from, docket.to, itineraries.length, Object.keys(legVerdict).length]);

  const pins: GlobePin[] = useMemo(() => {
    const out: GlobePin[] = [];
    activeItin?.legs.forEach((l) => l.chokepoints?.forEach((c) => out.push({ id: `cp-${l.id}-${c.key}`, at: [c.lon, c.lat], color: "#ffefcf", label: c.name.replace(" Strait", "").replace(" Canal", "") })));
    signals
      .filter((s) => s.severity >= 1 && s.at && activeItin?.legs.some((l) => l.id === s.legId))
      .forEach((s) => out.push({ id: `sg-${s.id}`, at: s.at!, color: s.severity >= 3 ? "#ff5252" : s.severity === 2 ? "#ff8a3d" : "#ffab2e", label: pinLabel(s.title) }));
    return out;
  }, [activeItin, signals]);

  // bring the whole route into view whenever its geometry changes
  const routeKey = globeRoute?.key;
  useEffect(() => {
    if (!globeRoute) return;
    const f = frameOf(globeRoute.legs.flatMap((l) => l.path), 1.75, 3.9);
    flyTo({ ...f, ox: 0, oy: 0, layers: 0.1, air: 0, rail: 0 }, 2.2, reduce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, reduce]);

  const routes: MapRoute[] = useMemo(() => {
    const out: MapRoute[] = [];
    itineraries.forEach((it) => {
      const on = it.id === activeItin?.id;
      it.legs.forEach((l) => {
        const v = legVerdict[l.id]?.verdict;
        const col = on ? (v ? V_COLOR[v] : MODE_HEX[l.mode]) : "rgba(181,174,159,.45)";
        out.push({ id: `${it.id}:${l.id}`, path: l.path, color: col, width: on ? 2.6 : 1.3, dashed: l.mode === "air" || !on, glow: on, opacity: on ? 1 : 0.8, animate: on });
      });
    });
    return out.sort((a, b) => Number(a.width === 2.6) - Number(b.width === 2.6));
  }, [itineraries, activeItin, legVerdict]);
  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    const o = parsed?.origin ?? preview.parsed?.origin;
    const d = parsed?.destination ?? preview.parsed?.destination;
    if (o) m.push({ id: "o", at: [o.lon, o.lat], label: o.name.split(" (")[0], color: "#ffefcf", r: 5 });
    if (d) m.push({ id: "d", at: [d.lon, d.lat], label: d.name.split(" (")[0], color: "#ffefcf", r: 5 });
    pins.forEach((p) => m.push({ id: p.id, at: p.at, color: p.color, label: p.label, pulse: p.color !== "#ffefcf", r: p.color === "#ffefcf" ? 3.5 : 5, kind: p.color === "#ffefcf" ? "choke" : "hazard" }));
    return m;
  }, [parsed, preview.parsed, pins]);
  const fit = useMemo(() => activeItin?.legs.flatMap((l) => l.path), [activeItin]);

  const stageState = (n: number) => {
    const ev = trace.filter((e) => e.stage === n);
    if (!ev.length) return phase === "running" ? "pending" : "idle";
    if (ev.some((e) => e.status === "fail") && !ev.some((e) => e.status === "ok" || e.status === "done" || e.status === "warn")) return "fail";
    const ended = ev.filter((e) => e.status === "ok" || e.status === "done" || e.status === "warn" || e.status === "fail").length;
    const starts = ev.filter((e) => e.status === "start").length;
    if (phase !== "running" && ended >= 1) return ev.some((e) => e.status === "warn" || e.status === "fail") ? "warn" : "ok";
    if (starts > ended) return "run";
    return ev.some((e) => e.status === "warn" || e.status === "fail") ? "warn" : "ok";
  };

  const copy = async () => {
    if (!messages) return;
    try {
      await navigator.clipboard.writeText(messages[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1700);
    } catch {
      /* clipboard blocked */
    }
  };
  const copyLink = async () => {
    if (!docket.from || !docket.to) return;
    const ref = (p: NonNullable<DocketValue["from"]>) => ({ id: p.id, name: p.name, type: p.type, cc: p.cc, country: p.country, state: p.state, lon: p.lon, lat: p.lat, code: p.code });
    const url = `${window.location.origin}/desk?d=${encodeURIComponent(JSON.stringify({ f: ref(docket.from), t: ref(docket.to), m: docket.mode, c: docket.cargo }))}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinked(true);
      setTimeout(() => setLinked(false), 1700);
    } catch {
      /* clipboard blocked */
    }
  };

  const signalsByLeg = useMemo(() => {
    const m = new Map<string, Signal[]>();
    signals.forEach((s) => m.set(s.legId, [...(m.get(s.legId) ?? []), s]));
    m.forEach((v) => v.sort((a, b) => b.severity - a.severity));
    return m;
  }, [signals]);

  const itinVerdict = (it: Itinerary): Verdict | null => {
    const vs = it.legs.map((l) => legVerdict[l.id]?.verdict).filter(Boolean) as Verdict[];
    if (!vs.length) return null;
    const rank: Record<Verdict, number> = { abstain: 0, green: 1, amber: 2, red: 3 };
    return vs.reduce((a, b) => (rank[b] > rank[a] ? b : a));
  };

  const busy = phase === "running";
  const title = parsed ? `${parsed.origin.name.split(" (")[0]} to ${parsed.destination.name.split(" (")[0]}${parsed.cargo && parsed.cargo !== "general cargo" ? `, ${parsed.cargo}` : ""}` : docket.from && docket.to ? `${docket.from.name} to ${docket.to.name}` : "Route";

  return (
    <div className="desk">
      <header className="desk-bar">
        <Brand />
        <div className="desk-bar-r">
          <a href="/" className="label">Back to the globe</a>
          <span className="pill s live"><i />Live sources</span>
        </div>
      </header>

      <div style={{ padding: "22px var(--gutter) 0" }}>
        <Docket
          wide
          autoFocus={!initialD && !initialQ}
          value={docket}
          onChange={setDocket}
          onSubmit={() => runDocket(docket)}
          busy={busy}
          free={
            <>
              <textarea
                aria-label="Describe the shipment in a sentence"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    run(text);
                  }
                }}
                rows={2}
                placeholder="Solar inverters from Shenzhen to Mundra"
                lang="en"
              />
              <div className="chips" aria-label="Examples">
                {EXAMPLES.map((x) => (
                  <button key={x} type="button" className="chip" onClick={() => { setText(x); run(x); }}>{x}</button>
                ))}
              </div>
              <div>
                <button type="button" className="btn small" disabled={busy || !text.trim()} onClick={() => run(text)}>Check this sentence</button>
              </div>
            </>
          }
        />
      </div>

      <div className="desk-grid">
        {/* ───── left: what the agents are doing ───── */}
        <aside className="desk-left">
          <ol className="trace" aria-label="Agent trace" aria-live="polite">
            {STAGES.map((s) => {
              const st = stageState(s.n);
              const ev = trace.filter((e) => e.stage === s.n);
              return (
                <li key={s.n} className={`stage-row ${st}`}>
                  <div className="stage-head">
                    <span className="stage-ico" aria-hidden="true">
                      {st === "run" ? <LoaderCircle size={16} className="spin" /> : st === "ok" ? <Check size={16} /> : st === "warn" ? <AlertTriangle size={15} /> : st === "fail" ? <AlertTriangle size={15} /> : <CircleDashed size={16} />}
                    </span>
                    <div>
                      <div className="stage-title">{s.title}</div>
                      <div className="note">{s.who}</div>
                    </div>
                  </div>
                  {ev.length > 0 && (
                    <ul className="stage-ev">
                      {ev.map((e, k) => (
                        <li key={k} className={e.status}>
                          <span>{e.text}</span>
                          {e.source && (
                            <a href={e.source.url} target="_blank" rel="noreferrer" className="src-chip" title={e.source.url}>
                              {e.source.name} · {e.source.ok ? (e.source.observedAt ? `observed ${ageLabel(e.source.observedAt)}` : `fetched ${fmtTime(e.source.fetchedAt).slice(-9)}`) : e.source.note ?? "failed"} · {e.source.ms} ms
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </aside>

        {/* ───── right: the route, then the answer ───── */}
        <section className="desk-right" aria-live="polite">
          {error && (
            <div className="plate err">
              <AlertTriangle size={18} />
              <div>
                <p><strong>{error.message}</strong></p>
                {error.hint && <p className="body" style={{ marginTop: 6 }}>{error.hint}</p>}
              </div>
            </div>
          )}

          <div className="plate map-plate">
            <div className="plate-head" style={{ flexWrap: "wrap" }}>
              <span>{title}</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {itineraries.length > 1 && (
                  <div className="seg" role="tablist" aria-label="Itinerary">
                    {itineraries.map((it) => {
                      const v = itinVerdict(it);
                      return (
                        <button key={it.id} role="tab" type="button" aria-selected={it.id === activeItin?.id} className={it.id === activeItin?.id ? "on s0" : ""} onClick={() => setItin(it.id)}>
                          {v && <span className="dot" style={{ background: V_COLOR[v] }} />}{it.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="seg" role="tablist" aria-label="Map style">
                  <button role="tab" type="button" aria-selected={view === "globe"} className={view === "globe" ? "on s0" : ""} onClick={() => setView("globe")}>Globe</button>
                  <button role="tab" type="button" aria-selected={view === "map"} className={view === "map" ? "on s0" : ""} onClick={() => setView("map")}>Flat map</button>
                </div>
              </div>
            </div>
            {view === "globe" ? (
              <div className="stage-3d">
                <GlobeScene pulse={pulse} reduce={reduce} low={low} labels selected={null} onSelect={() => {}} onProgress={() => {}} onReady={() => {}} route={globeRoute} pins={pins} quiet />
                {!globeRoute && (
                  <div className="map-empty">
                    <p className="serif-i">{busy || preview.loading ? "Drawing the route…" : "Pick two places and the route is drawn here."}</p>
                    <p className="note">Nothing is drawn until the planner has real coordinates.</p>
                  </div>
                )}
              </div>
            ) : itineraries.length ? (
              <FlatMap routes={routes} markers={markers} fit={fit} height={460} detail="lo" label="Planned route with live hazards" />
            ) : (
              <div className="stage-3d">
                <div className="map-empty">
                  <p className="serif-i">Your route will be drawn here.</p>
                </div>
              </div>
            )}
            {activeItin && (
              <div className="legs">
                {activeItin.legs.map((l) => {
                  const v = legVerdict[l.id];
                  return (
                    <div key={l.id} className="leg">
                      <span className="mode-ico" style={{ ["--m" as string]: MODE_HEX[l.mode] }}>{MODE_ICON[l.mode]}</span>
                      <div>
                        <div><strong>{MODE_WORD[l.mode]}</strong> · {l.label}</div>
                        <div className="note">{Math.round(l.km).toLocaleString("en-IN")} km, about {l.days < 1 ? `${Math.round(l.days * 24)} hours` : `${l.days.toFixed(l.days < 10 ? 1 : 0)} days`}. {l.geometry}</div>
                      </div>
                      {v && <span className={`pill ${v.verdict === "green" ? "g" : v.verdict === "amber" ? "a" : v.verdict === "red" ? "r" : ""}`}><i />{V_WORD[v.verdict]} · {Math.round(v.confidence * 100)}%</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {answer && (
            <div className="plate verdict-plate" style={{ ["--vc" as string]: V_COLOR[answer.overall] }}>
              <div className="verdict-main">
                <div className="verdict-word" style={{ color: V_COLOR[answer.overall] }}>
                  <Flap text={V_WORD[answer.overall]} color={V_COLOR[answer.overall]} reduce={reduce} size="clamp(54px, 9vw, 104px)" />
                </div>
                <div>
                  <div className="verdict-sub">{V_SAYS[answer.overall]}</div>
                  <div className="label" style={{ marginTop: 10 }}>How sure: {Math.round(answer.confidence * 100)}%</div>
                  <div className="bar" style={{ width: 180, marginTop: 6 }}><i style={{ width: `${answer.confidence * 100}%`, background: V_COLOR[answer.overall] }} /></div>
                </div>
              </div>
              <h2 className="verdict-head">{answer.headline}</h2>
              <p className="body" style={{ maxWidth: "70ch" }}>{answer.summary}</p>
              <p className="note" style={{ marginTop: 12 }}>
                {answer.freshness.note} Written by {answer.narrativeBy === "model" ? "the language model from the facts above" : "a fixed template from the facts above"}; the verdict itself comes from code.
              </p>
              {answer.blindSpots.length > 0 && (
                <div className="blindspots">
                  <div className="label">What Dhruva cannot see</div>
                  <ul>{answer.blindSpots.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                {docket.from && docket.to && (
                  <button type="button" className="btn ghost small" onClick={copyLink}>{linked ? <Check size={14} /> : <Link2 size={14} />} {linked ? "Link copied" : "Copy a link to this check"}</button>
                )}
                {phase !== "running" && (docket.from && docket.to ? (
                  <button type="button" className="btn ghost small" onClick={() => runDocket(docket)}><RotateCcw size={14} /> Run again</button>
                ) : (
                  <button type="button" className="btn ghost small" onClick={() => run(text)}><RotateCcw size={14} /> Run again</button>
                ))}
              </div>
            </div>
          )}

          {signals.length > 0 && (
            <div className="plate">
              <div className="plate-head"><span>Evidence</span><span className="label">{signals.length} readings from independent sources</span></div>
              <div style={{ padding: "6px 18px 14px" }}>
                {(plan?.itineraries.flatMap((i) => i.legs) ?? []).filter((l, k, arr) => arr.findIndex((x) => x.id === l.id) === k && signalsByLeg.has(l.id)).map((l) => (
                  <div key={l.id} className="ev-group">
                    <div className="ev-leg label">{MODE_WORD[l.mode]} · {l.label}</div>
                    {signalsByLeg.get(l.id)!.map((s) => (
                      <div key={s.id} className="ev">
                        <span className={`sev s${s.severity}`}>{SEV_WORD[s.severity]}</span>
                        <div>
                          <div style={{ fontWeight: 600 }}>{s.title}</div>
                          <div className="body" style={{ fontSize: 14.5 }}>{s.detail}</div>
                          <div className="note" style={{ marginTop: 4 }}>
                            {s.sources.map((src, k) => (
                              <span key={k}>
                                {k > 0 && " · "}
                                <a href={src.url} target="_blank" rel="noreferrer">{src.name}</a>
                                {src.ok ? ` · ${src.observedAt ? `observed ${fmtTime(src.observedAt)} (${ageLabel(src.observedAt)})` : `fetched ${fmtTime(src.fetchedAt)}`}` : ` · ${src.note ?? "failed"}`}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Safer answer={answer} alts={alts} state={deepState} busy={busy} activeId={activeItin?.id} primaryId={plan?.primary} onFind={findSafer} onPick={setItin} />

          <Handover answer={answer} itinerary={activeItin} parsed={parsed} />

          {messages && (
            <div className="plate">
              <div className="plate-head" style={{ flexWrap: "wrap" }}>
                <span>Message to your supplier or forwarder</span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div className="seg" role="tablist" aria-label="Language">
                    {LANGS.map((l) => (
                      <button key={l.id} role="tab" type="button" aria-selected={lang === l.id} className={lang === l.id ? "on s0" : ""} onClick={() => setLang(l.id)} lang={l.id}>{l.native}</button>
                    ))}
                  </div>
                  <button type="button" className="btn small ghost" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</button>
                </div>
              </div>
              <pre className="msg" lang={lang}>{messages[lang]}</pre>
              <p className="note" style={{ padding: "0 20px 16px" }}>Draft only. Dhruva never sends messages. Review the text, then paste it into WhatsApp or email yourself.</p>
            </div>
          )}

          {took && (
            <p className="note">
              Finished in {(took.ms / 1000).toFixed(1)} s. Every reading above was fetched live for this request{took.llm ? "; a language model helped with parsing or wording." : "; no language model was needed this time."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
