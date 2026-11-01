"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { ArrowRight } from "lucide-react";
import { Brand } from "./Logo";
import { camNow, camTarget, drag, flyTo, frameOf, updateSun } from "./globe/camera";
import Docket, { emptyDocket, useRoutePreview, type DocketValue } from "./Docket";
import { fmtDate, usePlateLight, usePulse, useReducedMotion } from "@/lib/hooks";
import { CHOKEPOINT_LIST } from "@/lib/seagraph";
import type { PulseChoke } from "@/lib/pulse-types";
import { Modes, Agents, VerdictExplorer, Reroute, Languages, Sources, FinalCta, Footer } from "./sections/Sections2";

gsap.registerPlugin(ScrollTrigger);

const GlobeScene = dynamic(() => import("./globe/GlobeScene"), { ssr: false });

type Pose = Partial<typeof camTarget> & { labels?: boolean; drag?: boolean };

function poses(narrow: boolean): Record<string, Pose> {
  return {
    hero: { lon: 68, lat: 19, dist: narrow ? 3.6 : 3.25, ox: narrow ? 0 : 0.25, oy: narrow ? 0.24 : 0, layers: 0.75, air: 0, rail: 0 },
    problem: { lon: 43, lat: 16, dist: narrow ? 3.2 : 2.25, ox: narrow ? 0 : -0.2, oy: narrow ? 0.22 : 0, layers: 0.5, air: 0, rail: 0 },
    network: { lon: 62, lat: 18, dist: narrow ? 3.4 : 2.95, ox: narrow ? 0 : 0.17, oy: narrow ? 0.2 : 0, layers: 1, air: 0, rail: 0, labels: true, drag: true },
    modes: { lon: 74, lat: 22, dist: narrow ? 3.0 : 2.0, ox: narrow ? 0 : 0.2, oy: narrow ? 0.22 : 0, layers: 0.8, air: 1, rail: 1, labels: false },
    agents: { lon: 100, lat: 8, dist: narrow ? 4.2 : 3.6, ox: narrow ? 0 : 0.34, oy: narrow ? 0.3 : 0, layers: 0.5, air: 0.5, rail: 0.3 },
    verdict: { lon: 40, lat: 20, dist: narrow ? 4.0 : 3.3, ox: narrow ? 0 : -0.3, oy: narrow ? 0.3 : 0, layers: 0.35, air: 0, rail: 0 },
    reroute: { lon: 38, lat: 14, dist: narrow ? 3.8 : 3.0, ox: narrow ? 0 : 0.32, oy: narrow ? 0.3 : 0, layers: 0.4, air: 0, rail: 0 },
    languages: { lon: 78, lat: 18, dist: narrow ? 3.8 : 3.3, ox: narrow ? 0 : -0.32, oy: narrow ? 0.3 : 0, layers: 0.3, air: 0.3, rail: 0 },
    sources: { lon: 20, lat: 30, dist: narrow ? 4.0 : 3.6, ox: narrow ? 0 : 0.34, oy: narrow ? 0.3 : 0, layers: 0.3, air: 0, rail: 0 },
    cta: { lon: 70, lat: 20, dist: narrow ? 3.6 : 2.6, ox: 0, oy: narrow ? 0.2 : 0.05, layers: 0.8, air: 0.4, rail: 0.3 },
  };
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function Landing() {
  const reduce = useReducedMotion();
  const { data: pulse } = usePulse();
  const [gl, setGl] = useState<boolean | null>(null);
  const [low, setLow] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [labels, setLabels] = useState(false);
  const [dragOn, setDragOn] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [docket, setDocket] = useState<DocketValue>(emptyDocket);
  const [inHero, setInHero] = useState(true);
  const preview = useRoutePreview(docket);
  const rootRef = useRef<HTMLDivElement>(null);
  const introDone = useRef(false);

  usePlateLight();

  useEffect(() => {
    setGl(hasWebGL());
    const narrow = window.innerWidth < 800;
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    setLow(narrow || weak);
    updateSun();
  }, []);

  // smooth scroll + chapter camera
  useEffect(() => {
    if (!ready) return;
    const root = rootRef.current!;
    const lenis = reduce ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 0.95 });
    const tick = (t: number) => lenis?.raf(t * 1000);
    if (lenis) {
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }
    const narrow = () => window.innerWidth < 800;
    const ctx = gsap.context(() => {
      const secs = gsap.utils.toArray<HTMLElement>("[data-chapter]");
      secs.forEach((el) => {
        const key = el.dataset.chapter!;
        const apply = () => {
          const p = poses(narrow())[key];
          if (!p) return;
          const { labels: lb, drag: dr, ...cam } = p;
          flyTo(cam, 2.2, reduce);
          setLabels(!!lb);
          setDragOn(!!dr);
          setInHero(key === "hero");
        };
        ScrollTrigger.create({ trigger: el, start: "top 55%", end: "bottom 45%", onEnter: apply, onEnterBack: apply });
      });
      ScrollTrigger.create({ start: 40, end: "max", onUpdate: (s) => setScrolled(s.scroll() > 40) });
      if (!reduce) {
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, { y: 26, opacity: 0, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
        });
      }
    }, root);
    return () => {
      ctx.revert();
      if (lenis) {
        gsap.ticker.remove(tick);
        lenis.destroy();
      }
    };
  }, [ready, reduce]);

  // intro: begin close to the ocean, pull back to reveal the Earth
  useEffect(() => {
    if (!ready || introDone.current) return;
    introDone.current = true;
    const html = document.documentElement;
    const narrow = window.innerWidth < 800;
    const p = poses(narrow).hero;
    const { labels: _l, drag: _d, ...cam } = p;
    if (reduce) {
      Object.assign(camTarget, cam);
      Object.assign(camNow, cam);
      html.classList.add("is-ready");
      return;
    }
    html.classList.add("anim");
    gsap.to(camTarget, { ...cam, duration: 4.2, ease: "power3.inOut", delay: 0.3 });
    gsap.to(".line-mask > span", { y: 0, duration: 1.4, ease: "power4.out", stagger: 0.14, delay: 1.5 });
    gsap.from(".hero-fade", { opacity: 0, y: 18, duration: 1.2, ease: "power3.out", stagger: 0.12, delay: 2.4 });
  }, [ready, reduce]);

  // when a route is drawn, bring both ends into view
  useEffect(() => {
    if (!preview.route || !inHero) return;
    const pts = preview.route.legs.flatMap((l) => l.path);
    const f = frameOf(pts);
    const narrow = window.innerWidth < 800;
    flyTo({ ...f, dist: Math.min(5.2, f.dist * (narrow ? 1.12 : 1.32)), ox: narrow ? 0 : 0.2, oy: narrow ? 0.2 : 0, layers: 0.3 }, 2.4, reduce);
  }, [preview.route, inHero, reduce]);

  const submit = () => {
    if (!docket.from || !docket.to) return;
    const ref = (p: NonNullable<DocketValue["from"]>) => ({ id: p.id, name: p.name, type: p.type, cc: p.cc, country: p.country, state: p.state, lon: p.lon, lat: p.lat, code: p.code });
    const d = { f: ref(docket.from), t: ref(docket.to), m: docket.mode, c: docket.cargo };
    window.location.href = `/desk?d=${encodeURIComponent(JSON.stringify(d))}`;
  };

  const onSelect = useCallback((key: string) => {
    setSelected(key);
    const c = CHOKEPOINT_LIST.find((x) => x.key === key);
    if (c) flyTo({ lon: c.lon - 4, lat: c.lat * 0.85, dist: 1.85, layers: 1, ox: window.innerWidth < 800 ? 0 : 0.17 }, 1.6, reduce);
  }, [reduce]);

  // globe drag zone
  const onPointerDown = (e: React.PointerEvent) => {
    drag.active = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.active) return;
    const k = 0.2 * (camNow.dist / 3);
    drag.dLon -= e.movementX * k;
    drag.dLat += e.movementY * k;
    drag.dLat = Math.max(-45, Math.min(45, drag.dLat));
  };
  const onPointerUp = () => {
    drag.active = false;
  };

  const fallbackProgress = gl === false;
  useEffect(() => {
    if (fallbackProgress) setReady(true);
  }, [fallbackProgress]);

  return (
    <div ref={rootRef}>
      <div className={`loader ${ready ? "done" : ""}`} aria-hidden={ready}>
        <div style={{ textAlign: "center" }}>
          <Brand href="#" />
          <div className="loader-bar" style={{ ["--p" as string]: String(Math.min(1, progress)) }}>
            <i />
          </div>
          <p className="note" style={{ marginTop: 14 }}>
            Finding tonight&apos;s terminator
          </p>
        </div>
      </div>

      <header className={`nav ${scrolled ? "scrolled" : ""}`}>
        <Brand />
        <nav className="nav-links" aria-label="Primary">
          <a href="#network">Live pulse</a>
          <a href="#modes">Sea, air, rail, road</a>
          <a href="#agents">Agents</a>
          <a href="#verdict">Verdicts</a>
          <a href="#languages">Languages</a>
          <a href="#sources">Sources</a>
        </nav>
        <a className="btn small" href="/desk">
          Open the desk <ArrowRight size={15} />
        </a>
      </header>

      <div className="stage" aria-hidden="true">
        {gl ? (
          <GlobeScene
            pulse={pulse}
            reduce={reduce}
            low={low}
            labels={labels}
            selected={selected}
            onSelect={onSelect}
            route={inHero ? preview.route : null}
            onProgress={(p) => {
              setProgress(p);
            }}
            onReady={() => {
              setTimeout(() => setReady(true), 900);
            }}
          />
        ) : gl === false ? (
          <div className="globe-fallback" />
        ) : null}
      </div>
      <div className="vignette" />

      <main className="layer">
        <Hero pulse={pulse} docket={docket} setDocket={setDocket} preview={preview} onSubmit={submit} />
        <Problem pulse={pulse} />
        <Network
          pulse={pulse}
          selected={selected}
          onSelect={onSelect}
          dragOn={dragOn}
          handlers={{ onPointerDown, onPointerMove, onPointerUp }}
        />
        <Modes />
        <Agents />
        <VerdictExplorer />
        <Reroute />
        <Languages />
        <Sources />
        <FinalCta />
        <Footer />
      </main>
    </div>
  );
}

/* ───────── hero ───────── */
const DAYS = (d: number) => (d < 1 ? `${Math.max(1, Math.round(d * 24))} hours` : `${d.toFixed(d < 10 ? 1 : 0)} days`);
const MODE_WORD = { sea: "sea", air: "air", rail: "rail", road: "road" } as const;

function Hero({
  pulse,
  docket,
  setDocket,
  preview,
  onSubmit,
}: {
  pulse: ReturnType<typeof usePulse>["data"];
  docket: DocketValue;
  setDocket: (v: DocketValue) => void;
  preview: ReturnType<typeof useRoutePreview>;
  onSubmit: () => void;
}) {
  const flagged = pulse?.chokepoints.filter((c) => c.status === "amber" || c.status === "red").length ?? 0;
  const live = pulse?.chokepoints.filter((c) => c.status !== "na").length ?? 0;
  const p = preview.primary;
  return (
    <section className="hero" data-chapter="hero" aria-labelledby="hero-h">
      <div className="wrap">
        <div className="hero-inner">
          <h1 id="hero-h" className="display">
            <span className="line-mask"><span>Know before</span></span>
            <span className="line-mask"><span>it lands.</span></span>
          </h1>
          <p className="lede hero-fade">
            Tell Dhruva where a shipment starts and where it must arrive. A team of agents checks the sea lanes, air corridors, rail lines and roads in between against live traffic, storm, alert and weather data, and says whether to go, watch or reroute.
          </p>
          <div className="hero-fade">
            <Docket value={docket} onChange={setDocket} onSubmit={onSubmit} cta="Check this shipment" />
          </div>
          <div className="ribbon hero-fade" aria-live="polite">
            {preview.loading ? (
              <span>Drawing the route…</span>
            ) : preview.error ? (
              <span style={{ color: "var(--watch)" }}>{preview.error}</span>
            ) : p ? (
              <span>
                <strong style={{ color: "var(--lamp)" }}>{p.label}</strong>: {Math.round(p.km).toLocaleString("en-IN")} km, about {DAYS(p.days)}
                {p.legs.length > 1 ? `, ${p.legs.map((l) => MODE_WORD[l.mode]).join(" then ")}` : ""}. The agents look for trouble along exactly this line.
              </span>
            ) : (
              <>
                <span className="pill s live"><i /> Live</span>
                {pulse ? (
                  <>
                    <span>{live ? `${live} of ${pulse.chokepoints.length} chokepoints read just now` : "chokepoint feed not answering right now"}</span>
                    <span>{live ? (flagged ? `${flagged} outside their usual traffic` : "all within usual traffic") : "Dhruva will say so in every verdict"}</span>
                    <span>{pulse.cyclones.length ? `${pulse.cyclones.length} active tropical cyclone${pulse.cyclones.length > 1 ? "s" : ""}` : "no active cyclone alerts"}</span>
                  </>
                ) : (
                  <span>reading IMF PortWatch and GDACS</span>
                )}
              </>
            )}
          </div>
          <a className="scroll-cue hero-fade" href="#problem">
            <span /> Scroll to see what we watch
          </a>
        </div>
      </div>
    </section>
  );
}

/* ───────── problem ───────── */
const pctVs = (latest: number | null, base: number | null) => (latest !== null && base ? Math.round(((latest - base) / base) * 100) : null);
const STATUS_WORD = { green: "Normal", amber: "Watch", red: "Alert", na: "No data" } as const;
const STATUS_CLS = { green: "g", amber: "a", red: "r", na: "n" } as const;

function Problem({ pulse }: { pulse: ReturnType<typeof usePulse>["data"] }) {
  const rows = useMemo<PulseChoke[]>(() => {
    if (!pulse) return [];
    const rank = { red: 0, amber: 1, green: 2, na: 3 } as const;
    return [...pulse.chokepoints]
      .filter((c) => c.latest !== null && c.baseline)
      .sort((a, b) => rank[a.status] - rank[b.status] || Math.abs(pctVs(b.latest, b.baseline) ?? 0) - Math.abs(pctVs(a.latest, a.baseline) ?? 0))
      .slice(0, 6);
  }, [pulse]);
  return (
    <section id="problem" className="section" data-chapter="problem" aria-labelledby="problem-h">
      <div className="wrap split">
        <div>
          <h2 id="problem-h" className="h2" data-reveal>
            The signal exists. It never reaches a small shipper.
          </h2>
          <p className="body" style={{ marginTop: 28 }} data-reveal>
            A cyclone track is public. So is every chokepoint&apos;s daily vessel count, and every Indian disaster alert. But they sit in separate feeds, in different formats and languages, and none of them says what it means for one consignment. A large forwarder has analysts for that. A firm shipping solar inverters from Shenzhen to Mundra has a phone.
          </p>
          <p className="body" style={{ marginTop: 18 }} data-reveal>
            Dhruva reads those feeds for you, compares them with each other, and only raises its voice when independent evidence agrees.
          </p>
        </div>
        <div className="plate" data-reveal>
          <div className="plate-head">
            <span>Chokepoints today, against their own usual</span>
            <span className="note">IMF PortWatch</span>
          </div>
          {rows.length ? (
            <div className="board">
              {rows.map((c) => {
                const pct = pctVs(c.latest, c.baseline);
                return (
                  <div key={c.key} className="board-row">
                    <div>
                      <div className="nm">{c.name}</div>
                      <div className="fine">
                        {Math.round(c.latest!)} ships a day, usual {Math.round(c.baseline!)}
                        {pct !== null && pct !== 0 ? `, ${Math.abs(pct)}% ${pct < 0 ? "fewer" : "more"}` : ""}
                      </div>
                    </div>
                    <span className="fine fine-col">{fmtDate(c.date)}</span>
                    <span className={`st ${STATUS_CLS[c.status]}`}>{STATUS_WORD[c.status]}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="note" style={{ padding: "34px 18px" }}>
              {pulse ? "The transit feed is not answering right now. Dhruva says so in every verdict instead of guessing." : "Waiting for the live feed. Nothing is drawn until real data arrives."}
            </p>
          )}
          <p className="note" style={{ padding: "12px 18px 16px", borderTop: "1px solid var(--rule)" }}>
            Real counts read by our server just now. The newest record is a few days behind real time, and every verdict says so.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ───────── network ───────── */
function Network({
  pulse,
  selected,
  onSelect,
  dragOn,
  handlers,
}: {
  pulse: ReturnType<typeof usePulse>["data"];
  selected: string | null;
  onSelect: (k: string) => void;
  dragOn: boolean;
  handlers: { onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: () => void };
}) {
  const used = CHOKEPOINT_LIST.map((c) => ({ ...c, live: pulse?.chokepoints.find((x) => x.key === c.key) }));
  const sel = used.find((c) => c.key === selected);
  const pill = (live: PulseChoke | undefined) => {
    if (!live) return "reading";
    const pct = pctVs(live.latest, live.baseline);
    if (pct === null) return "no baseline";
    return pct === 0 ? "as usual" : `${Math.abs(pct)}% ${pct < 0 ? "below" : "above"} usual`;
  };
  return (
    <section id="network" className="section" data-chapter="network" style={{ minHeight: "120svh" }} aria-labelledby="net-h">
      <div className="wrap split">
        <div>
          <h2 id="net-h" className="h2" data-reveal>
            {CHOKEPOINT_LIST.length} chokepoints, one live pulse.
          </h2>
          <p className="body" style={{ marginTop: 26 }} data-reveal>
            Each ring on the globe is a chokepoint where today&apos;s vessel count is compared with its own recent past. Green is ordinary. Amber and red mean the latest count sits well outside its range. Drag the globe and pick a ring.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "30px 0 0", display: "grid", gap: 6 }} data-reveal>
            {used.map((c) => (
              <li key={c.key}>
                <button type="button" onClick={() => onSelect(c.key)} className={`row-btn ${selected === c.key ? "sel" : ""}`} aria-pressed={selected === c.key}>
                  <span>{c.name}</span>
                  <span className={`pill ${c.live?.status === "red" ? "r" : c.live?.status === "amber" ? "a" : c.live?.status === "green" ? "g" : ""}`}>
                    <i />
                    {pill(c.live)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="note" style={{ marginTop: 18, maxWidth: 52 + "ch" }}>
            Moving dots on the lines show typical routing, not live ships. Only the rings carry live data.
          </p>
        </div>
        <div style={{ position: "relative", minHeight: 520 }}>
          <div
            className="drag-zone"
            style={{ pointerEvents: dragOn ? "auto" : "none" }}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerUp}
            role="presentation"
          />
          {sel && (
            <div className="plate choke-card" role="dialog" aria-label={`${sel.name} details`}>
              <div className="plate-head">
                <span>{sel.name}</span>
                <button type="button" className="x" onClick={() => onSelect("")} aria-label="Close">
                  ×
                </button>
              </div>
              <div style={{ padding: 16, display: "grid", gap: 10 }}>
                {sel.live && sel.live.latest !== null && sel.live.baseline ? (
                  <>
                    <div className="serif-i" style={{ fontSize: 46 }}>
                      {Math.round(sel.live.latest)} <span style={{ fontSize: 22, color: "var(--mist)" }}>ships a day</span>
                    </div>
                    <p className="body" style={{ fontSize: 15.5 }}>
                      Usual for this chokepoint is about {Math.round(sel.live.baseline)}. {pill(sel.live)}, so Dhruva rates it{" "}
                      <strong style={{ color: sel.live.status === "red" ? "var(--stop)" : sel.live.status === "amber" ? "var(--watch)" : "var(--ok)" }}>{STATUS_WORD[sel.live.status].toLowerCase()}</strong>.
                    </p>
                    <p className="note">Record date {fmtDate(sel.live.date)}. Source: IMF PortWatch daily chokepoint transits.</p>
                  </>
                ) : (
                  <p className="note">Live data for this chokepoint has not arrived yet, or the feed is not answering. Nothing is estimated.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
