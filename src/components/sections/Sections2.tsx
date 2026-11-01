"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { flyTo } from "../globe/camera";
import FlatMap from "../FlatMap";
import { judge, FAMILY_LABEL, type Reading } from "@/lib/judge";
import { compose, LANGS, type Lang } from "@/lib/compose";
import { shortestSea, buildRoute, CHOKEPOINT_LIST } from "@/lib/seagraph";
import { BY_ID, lonlat } from "@/lib/gazetteer";
import { smoothPath } from "@/lib/lanes";
import { fmtTime, ageLabel, useMagnetic } from "@/lib/hooks";
import type { Family, Severity } from "@/lib/types";
import { Mark } from "../Logo";
import "@/app/agents.css";

/* ───────── modes ───────── */
const MODE_TABS = [
  {
    id: "sea",
    name: "Sea",
    agent: "Maritime agent",
    pose: { lon: 62, lat: 14, dist: 2.7, layers: 1, air: 0, rail: 0 },
    reads: [
      ["IMF PortWatch", "Daily vessel transits at 28 chokepoints, compared with each chokepoint's own trailing median."],
      ["Open-Meteo Marine", "Forecast wave height at sea waypoints along the planned route."],
    ],
    flags: ["Transit count far below its normal range", "Forecast waves above a safe working height on the route"],
    blind: "Individual ships. There is no free global ship-tracking feed, so Dhruva never claims to follow your vessel.",
  },
  {
    id: "air",
    name: "Air",
    agent: "Aviation agent",
    pose: { lon: 60, lat: 28, dist: 3.4, layers: 0.3, air: 1, rail: 0 },
    reads: [
      ["AviationWeather.gov", "METAR and TAF at origin and destination airports, plus international SIGMETs crossing the flight path."],
      ["FAA NAS Status", "Ground stops and delay programmes at US airports for US-bound lanes."],
    ],
    flags: ["Visibility under 800 m, thunderstorms, volcanic ash", "A SIGMET polygon on the great-circle path"],
    blind: "NOTAMs and airspace closures for India. No free machine-readable source exists, so the desk says “not monitored”, never “clear”.",
  },
  {
    id: "surface",
    name: "Rail and road",
    agent: "Surface agent",
    pose: { lon: 78, lat: 22, dist: 1.7, layers: 0.4, air: 0, rail: 1 },
    reads: [
      ["OSRM and OpenStreetMap", "Real road geometry between your port, depot and factory."],
      ["Open-Meteo forecast and flood", "Rainfall and gusts sampled along the corridor, and river flow at major crossings."],
      ["NDMA Sachet", "Official multilingual alerts for the states the corridor crosses."],
    ],
    flags: ["Heavy rain or river flow far above normal on the corridor", "An active flood, cyclone or heavy-rain alert in a state on the route"],
    blind: "Live train positions and live traffic. Neither has a free public feed, so this is hazard exposure along the corridor, not congestion.",
  },
] as const;

export function Modes() {
  const [tab, setTab] = useState<(typeof MODE_TABS)[number]["id"]>("sea");
  const cur = MODE_TABS.find((t) => t.id === tab)!;
  useEffect(() => {
    flyTo({ ...cur.pose, ox: window.innerWidth < 800 ? 0 : 0.2, oy: window.innerWidth < 800 ? 0.22 : 0 }, 2, false);
  }, [cur]);
  return (
    <section id="modes" className="section" data-chapter="modes" aria-labelledby="modes-h">
      <div className="wrap split">
        <div>
          <h2 id="modes-h" className="h2" data-reveal>
            Cargo changes mode. The watch should not stop.
          </h2>
          <p className="body" style={{ marginTop: 26 }} data-reveal>
            A container leaves China by sea, reaches Mundra, then rides a train or truck to Jaipur. A pallet of electronics might fly. Dhruva plans each leg and gives each one its own specialist, reading only sources that genuinely cover that mode.
          </p>
          <div role="tablist" aria-label="Transport modes" style={{ display: "grid", gap: 6, marginTop: 30 }} data-reveal>
            {MODE_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`row-btn tab ${tab === t.id ? "sel" : ""}`} onClick={() => setTab(t.id)}>
                <span className="h3" style={{ fontSize: 26 }}>
                  {t.name}
                </span>
                <span className="label">{t.agent}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="plate" role="tabpanel" data-reveal>
          <i className="tick-bl" />
          <i className="tick-br" />
          <div className="plate-head">
            <span>{cur.agent}</span>
            <span className="pill s">
              <i />
              reads live sources
            </span>
          </div>
          <div style={{ padding: "20px 20px 24px", display: "grid", gap: 22 }}>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>
                Reads
              </div>
              <ul className="plain">
                {cur.reads.map(([n, d]) => (
                  <li key={n}>
                    <strong>{n}.</strong> <span className="body">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>
                Raises a flag when
              </div>
              <ul className="plain">
                {cur.flags.map((f) => (
                  <li key={f} className="body">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="blind">
              <div className="label" style={{ marginBottom: 6 }}>
                What it cannot see
              </div>
              <p className="body" style={{ fontSize: 15 }}>
                {cur.blind}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────── agents ───────── */
const STAGES = [
  {
    name: "Understand",
    note: "your request in, a plan out",
    agents: [
      ["Intake", "Reads your text or document photo"],
      ["Planner", "Builds sea, air, rail and road routings"],
    ],
  },
  {
    name: "Watch",
    note: "six specialists, all at once",
    agents: [
      ["Maritime", "Chokepoint traffic, sea state"],
      ["Storm", "Cyclones, floods, quakes"],
      ["Aviation", "Airport weather, SIGMETs"],
      ["Surface", "Rail and road corridors"],
      ["Alerts", "Official Indian alerts"],
      ["News", "Strikes and closures"],
    ],
  },
  {
    name: "Decide",
    note: "plain code, not a language model",
    agents: [["Corroborator", "Do independent, fresh sources agree?"]],
  },
  {
    name: "Act",
    note: "the model explains and drafts",
    agents: [
      ["Strategist", "Works out the next-best route"],
      ["Comms", "Drafts the supplier message"],
    ],
  },
] as const;

export function Agents() {
  const [tick, setTick] = useState(-1);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setTick(0);
    const id = setInterval(() => setTick((t) => (t + 1) % STAGES.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <section id="agents" className="section" data-chapter="agents" aria-labelledby="agents-h">
      <div className="wrap">
        <h2 id="agents-h" className="h2" style={{ maxWidth: "16ch" }} data-reveal>
          Eleven agents. One answer you can check.
        </h2>
        <p className="lede" style={{ marginTop: 26 }} data-reveal>
          Each agent owns one question. A separate corroborator decides whether the evidence agrees, and it is plain code. The model never invents a number.
        </p>
        <div style={{ marginTop: 44, maxWidth: 780 }}>
          <div className="plate" data-reveal>
            <ol className="pipe" aria-label="How a check runs, in order">
              {STAGES.map((st, i) => (
                <li key={st.name} className={`pipe-st ${tick === i ? "on" : ""}`}>
                  <span className="pipe-dot" aria-hidden="true" />
                  <div className="pipe-head">
                    <span className="h3">{st.name}</span>
                    <span className="note">{st.note}</span>
                  </div>
                  <ul className="pipe-ag">
                    {st.agents.map(([n, j]) => (
                      <li key={n}>
                        <strong>{n}</strong>
                        <span>{j}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <p className="note pipe-foot">
              Every signal carries its source, when we fetched it and the time of its newest observation. If a source is down, the trace says so and confidence drops. Nothing is filled in.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────── verdict explorer ───────── */
const FAMS: Family[] = ["traffic", "hazard", "official", "weather", "news"];
const SEV_LABEL = ["Normal", "Mild", "Strong", "Severe"];

export function VerdictExplorer() {
  const [sev, setSev] = useState<Record<Family, Severity>>({ traffic: 2, hazard: 0, official: 0, weather: 1, news: 0 });
  const [off, setOff] = useState<Record<Family, boolean>>({ traffic: false, hazard: false, official: false, weather: false, news: true });
  const readings: Reading[] = FAMS.filter((f) => !off[f]).map((f) => ({ family: f, severity: sev[f], confidence: 0.8, fresh: true, label: FAMILY_LABEL[f] }));
  const j = useMemo(() => judge(readings, FAMS), [sev, off]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = j.verdict === "red" ? "var(--flare)" : j.verdict === "amber" ? "var(--sodium)" : j.verdict === "green" ? "var(--kelp)" : "var(--mist)";
  const word = j.verdict === "abstain" ? "We can't tell" : j.verdict[0].toUpperCase() + j.verdict.slice(1);
  return (
    <section id="verdict" className="section" data-chapter="verdict" aria-labelledby="verdict-h">
      <div className="wrap split">
        <div>
          <h2 id="verdict-h" className="h2" data-reveal>
            Red needs two witnesses. And when we can&apos;t tell, we say so.
          </h2>
          <p className="body" style={{ marginTop: 26 }} data-reveal>
            One odd traffic count is a rumour. A traffic drop plus a cyclone alert on the same lane is a case. Dhruva only turns red when independent kinds of evidence agree, or when an official source reports a severe condition. If nothing answered with fresh data, it abstains.
          </p>
          <p className="note" style={{ marginTop: 18 }} data-reveal>
            This explorer runs the same decision code the desk uses, on inputs you set. It is a what-if tool, not live data.
          </p>
        </div>
        <div className="plate" data-reveal>
          <i className="tick-bl" />
          <i className="tick-br" />
          <div className="plate-head">
            <span>Evidence on one leg</span>
            <span className="label">what-if</span>
          </div>
          <div style={{ padding: "8px 18px 6px" }}>
            {FAMS.map((f) => (
              <div key={f} className="fam-row">
                <span style={{ opacity: off[f] ? 0.45 : 1 }}>{FAMILY_LABEL[f]}</span>
                <div className="seg" role="group" aria-label={`${FAMILY_LABEL[f]} severity`}>
                  {([0, 1, 2, 3] as Severity[]).map((s) => (
                    <button key={s} type="button" disabled={off[f]} aria-pressed={sev[f] === s && !off[f]} className={sev[f] === s && !off[f] ? `on s${s}` : ""} onClick={() => setSev((p) => ({ ...p, [f]: s }))}>
                      {SEV_LABEL[s]}
                    </button>
                  ))}
                  <button type="button" aria-pressed={off[f]} className={off[f] ? "on off" : ""} onClick={() => setOff((p) => ({ ...p, [f]: !p[f] }))} title="Source did not answer or was stale">
                    No data
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "18px 20px 22px", borderTop: "1px solid var(--rule)", display: "grid", gap: 10 }} aria-live="polite">
            <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
              <span className="serif-i" style={{ fontSize: "clamp(44px,6vw,72px)", color, lineHeight: 1, transition: "color .3s" }}>
                {word}
              </span>
              <span className="label">confidence {Math.round(j.confidence * 100)}%</span>
            </div>
            <div className="bar">
              <i style={{ width: `${j.confidence * 100}%`, background: color }} />
            </div>
            <ul className="plain">
              {j.reasons.map((r) => (
                <li key={r} className="body" style={{ fontSize: 15 }}>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────── reroute ───────── */
const REROUTES = [
  { id: "mundra-rtm", from: "mundra", to: "rotterdam", avoid: "babelmandeb" },
  { id: "jnpt-ham", from: "jnpt", to: "hamburg", avoid: "suez" },
  { id: "shz-mundra", from: "shenzhen", to: "mundra", avoid: "malacca" },
  { id: "chennai-pir", from: "chennai_port", to: "piraeus", avoid: "babelmandeb" },
];

export function Reroute() {
  const [i, setI] = useState(0);
  const [closed, setClosed] = useState(true);
  const r = REROUTES[i];
  const calc = useMemo(() => {
    const a = BY_ID[r.from];
    const b = BY_ID[r.to];
    const base = shortestSea(a.seaNode!, b.seaNode!);
    if (!base) return null;
    const cp = CHOKEPOINT_LIST.find((c) => c.key === r.avoid);
    const avoidNodes = new Set(cp ? [cp.node] : []);
    const alt = shortestSea(a.seaNode!, b.seaNode!, avoidNodes);
    const mk = (rt: ReturnType<typeof shortestSea>) => (rt ? buildRoute(rt.nodes, { start: lonlat(a), end: lonlat(b) }) : null);
    return { a, b, base: mk(base)!, alt: mk(alt), cp };
  }, [r]);
  if (!calc) return null;
  const { base, alt, cp, a, b } = calc;
  const baseUsesCp = cp ? base.chokepoints.some((c) => c.key === cp.key) : false;
  const showAlt = closed && alt && baseUsesCp;
  const routes = [
    { id: "base", path: smoothPath(base.path), color: showAlt ? "rgba(181,174,159,.55)" : "#ffd99a", width: showAlt ? 1.6 : 2.4, dashed: !!showAlt, glow: !showAlt },
    ...(showAlt ? [{ id: "alt", path: smoothPath(alt!.path), color: "#ffb547", width: 2.6, glow: true, animate: true }] : []),
  ];
  const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
  return (
    <section id="reroute" className="section" data-chapter="reroute" aria-labelledby="reroute-h">
      <div className="wrap">
        <div className="split" style={{ alignItems: "end" }}>
          <h2 id="reroute-h" className="h2" data-reveal>
            When a lane closes, the next-best route is already worked out.
          </h2>
          <p className="body" data-reveal>
            The strategist removes the troubled chokepoint from the route graph and solves again. You get the real distance and an estimated transit change at a 14-knot service speed. Pick a lane and close its chokepoint.
          </p>
        </div>
        <div className="plate" style={{ marginTop: 44 }} data-reveal>
          <i className="tick-bl" />
          <i className="tick-br" />
          <div className="plate-head" style={{ flexWrap: "wrap" }}>
            <div className="seg" role="group" aria-label="Lane">
              {REROUTES.map((x, k) => (
                <button key={x.id} type="button" aria-pressed={k === i} className={k === i ? "on s0" : ""} onClick={() => setI(k)}>
                  {BY_ID[x.from].name.split(" (")[0]} to {BY_ID[x.to].name.split(" (")[0]}
                </button>
              ))}
            </div>
            <button type="button" className={`btn small ${closed ? "" : "ghost"}`} aria-pressed={closed} onClick={() => setClosed((c) => !c)}>
              {closed ? "Reopen" : "Close"} {cp?.name}
            </button>
          </div>
          <FlatMap
            routes={routes}
            markers={[
              { id: "a", at: lonlat(a), label: a.name.split(" (")[0], kind: "port", color: "#f4efe6" },
              { id: "b", at: lonlat(b), label: b.name.split(" (")[0], kind: "port", color: "#f4efe6" },
              ...(cp ? [{ id: "cp", at: [cp.lon, cp.lat] as [number, number], label: cp.name, color: closed && baseUsesCp ? "#ff5252" : "#ffd99a", kind: "choke" as const, pulse: true, r: 5 }] : []),
            ]}
            height={420}
            label="Base and alternative sea routes"
          />
          <div className="stats-row">
            <div>
              <div className="label">Current route</div>
              <div className="serif-i big">{fmt(base.nm)} nm</div>
              <div className="note">about {base.days.toFixed(0)} days at 14 kn</div>
            </div>
            <div>
              <div className="label">{showAlt ? "Alternative" : baseUsesCp ? "Alternative (close the chokepoint)" : "This lane does not use it"}</div>
              <div className="serif-i big amb">{showAlt ? `${fmt(alt!.nm)} nm` : "—"}</div>
              <div className="note">{showAlt ? `about ${alt!.days.toFixed(0)} days at 14 kn` : ""}</div>
            </div>
            <div>
              <div className="label">Difference</div>
              <div className="serif-i big">{showAlt ? `+${fmt(alt!.nm - base.nm)} nm` : "—"}</div>
              <div className="note">{showAlt ? `about +${(alt!.days - base.days).toFixed(0)} days; more bunker fuel and cost` : "no change"}</div>
            </div>
          </div>
          <p className="note" style={{ padding: "0 20px 18px" }}>
            Distances come from a curated waypoint graph of the main deep-sea lanes, an estimate for planning rather than a navigation chart. Port congestion and schedules are not included.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ───────── languages ───────── */
export function Languages() {
  const [lang, setLang] = useState<Lang>("hi");
  const [copied, setCopied] = useState(false);
  const text = compose(lang, {
    cargo: "solar inverters (4 pallets)",
    from: "Shenzhen",
    to: "Mundra",
    verdict: "amber",
    where: "the Malacca Strait approach",
    asOf: "sample time",
    evidence: "transit count below its normal range, with no independent confirmation yet",
    action: "watch",
  });
  const mag = useMagnetic<HTMLButtonElement>();
  return (
    <section id="languages" className="section" data-chapter="languages" aria-labelledby="lang-h">
      <div className="wrap split">
        <div>
          <h2 id="lang-h" className="h2" data-reveal>
            Your supplier doesn&apos;t read English first.
          </h2>
          <p className="body" style={{ marginTop: 26 }} data-reveal>
            Dhruva accepts your request in English, Hindi, Gujarati or Tamil text, and drafts the message to your supplier or forwarder in the language you choose. Copy it, paste it into WhatsApp or email, and send it yourself. Dhruva never sends anything on your behalf.
          </p>
          <p className="note" style={{ marginTop: 18 }} data-reveal>
            The sample on the right is built from a sample verdict, not a live lane. Ask the desk for the real one.
          </p>
        </div>
        <div className="plate" data-reveal>
          <i className="tick-bl" />
          <i className="tick-br" />
          <div className="plate-head" style={{ flexWrap: "wrap" }}>
            <div className="seg" role="tablist" aria-label="Language">
              {LANGS.map((l) => (
                <button key={l.id} role="tab" type="button" aria-selected={lang === l.id} className={lang === l.id ? "on s0" : ""} onClick={() => setLang(l.id)} lang={l.id}>
                  {l.native}
                </button>
              ))}
            </div>
            <button
              ref={mag}
              type="button"
              className="btn small ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                } catch {
                  /* clipboard unavailable */
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="msg" lang={lang}>
            {text}
          </pre>
        </div>
      </div>
    </section>
  );
}

/* ───────── sources ───────── */
interface HealthRow {
  id: string;
  name: string;
  covers: string;
  ok: boolean;
  ms: number;
  observedAt?: string;
  fetchedAt: string;
  note?: string;
  url: string;
  terms: string;
}

export function Sources() {
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<string>("");
  useEffect(() => {
    let dead = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => {
        if (!dead) {
          setRows(j.sources);
          setAt(j.generatedAt);
        }
      })
      .catch((e) => !dead && setErr(String(e)));
    return () => {
      dead = true;
    };
  }, []);
  return (
    <section id="sources" className="section" data-chapter="sources" aria-labelledby="src-h">
      <div className="wrap">
        <div className="split" style={{ alignItems: "end" }}>
          <h2 id="src-h" className="h2" data-reveal>
            Every number carries its receipt.
          </h2>
          <p className="body" data-reveal>
            No mock data and no recordings. This table is a live check of every source the agents use, made from our server when you loaded the page. If a feed is down you see it here, and the desk lowers its confidence instead of improvising.
          </p>
        </div>
        <div className="plate" style={{ marginTop: 44, overflowX: "auto" }} data-reveal>
          <i className="tick-bl" />
          <i className="tick-br" />
          <table className="src-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>What it gives us</th>
                <th>Status</th>
                <th>Newest observation</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={r.url.split("?")[0]} target="_blank" rel="noreferrer">
                      {r.name}
                    </a>
                    <div className="note">{r.terms}</div>
                  </td>
                  <td className="body" style={{ fontSize: 14.5 }}>
                    {r.covers}
                  </td>
                  <td>
                    <span className={`pill ${r.ok ? "g" : "r"}`}>
                      <i />
                      {r.ok ? "live" : "unreachable"}
                    </span>
                    {!r.ok && r.note && <div className="note">{r.note}</div>}
                  </td>
                  <td className="num">
                    {r.observedAt ? (
                      <>
                        {fmtTime(r.observedAt)}
                        <div className="note">{ageLabel(r.observedAt, at ? Date.parse(at) : Date.now())}</div>
                      </>
                    ) : (
                      <span className="note">n/a</span>
                    )}
                  </td>
                  <td className="num">{r.ms} ms</td>
                </tr>
              ))}
              {!rows && (
                <tr>
                  <td colSpan={5} className="note" style={{ padding: 28 }}>
                    {err ? `Could not run the live check: ${err}` : "Checking every source now…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {at && (
          <p className="note" style={{ marginTop: 14 }}>
            Checked {fmtTime(at)}. Terms are summarised from each provider&apos;s own documentation; commercial use needs each provider&apos;s approval.
          </p>
        )}
      </div>
    </section>
  );
}

/* ───────── final CTA + footer ───────── */
export function FinalCta() {
  const [q, setQ] = useState("");
  const mag = useMagnetic<HTMLButtonElement>();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <section id="cta" className="section" data-chapter="cta" aria-labelledby="cta-h" style={{ textAlign: "center" }}>
      <div className="wrap" style={{ display: "grid", justifyItems: "center", gap: 30 }}>
        <h2 id="cta-h" className="display" style={{ fontSize: "clamp(44px,7.4vw,112px)" }} data-reveal>
          Check your own shipment.
        </h2>
        <p className="lede" data-reveal>
          Name the cargo, where it starts and where it needs to land. Dhruva does the watching.
        </p>
        <form
          ref={ref}
          className="hero-ask"
          style={{ width: "min(680px,100%)" }}
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = `/desk?q=${encodeURIComponent(q.trim() || "Solar inverters from Shenzhen to Mundra")}`;
          }}
        >
          <label htmlFor="cta-q" className="sr-only">
            Describe your shipment
          </label>
          <input id="cta-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cotton yarn from Tiruppur to Hamburg" autoComplete="off" />
          <button ref={mag} className="btn" type="submit">
            Open the desk <ArrowRight size={16} />
          </button>
        </form>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap" style={{ display: "grid", gap: 36 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 32, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 14, maxWidth: 420 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Mark size={34} />
              <span className="brand-word" style={{ fontSize: 32 }}>
                Dhruva
              </span>
            </div>
            <p className="body" style={{ fontSize: 15 }}>
              A supply-chain intelligence desk for Indian importers, exporters and the forwarders who serve them. Built for the Forge Gen AI Buildathon, Theme 2: Climate, Resource Infrastructure and Global Supply Resilience.
            </p>
          </div>
          <div style={{ display: "grid", gap: 8, alignContent: "start", fontSize: 15 }}>
            <a href="/desk">The desk</a>
            <a href="#network">Live pulse</a>
            <a href="#sources">Sources and freshness</a>
            <a href="#verdict">How verdicts work</a>
          </div>
        </div>
        <p className="note" style={{ maxWidth: "88ch" }}>
          Live signals from IMF PortWatch, GDACS, India NDMA Sachet, Open-Meteo, USGS, NOAA Aviation Weather Center, FAA, OpenStreetMap contributors and OSRM. Place directory: NGA World Port Index (US Government, public domain) via seaport-data-js (CC BY 4.0), UN/LOCODE (UNECE) for Indian ports and inland depots, OurAirports (public domain) with route counts from OpenFlights (ODbL), Indian rail data from datameet/railways (CC0). Globe imagery: NASA Blue Marble and Earth Observatory night lights, via three-globe. Coastlines: Natural Earth. Dhruva is advisory only. It is not a freight guarantee, insurance, customs or legal advice, and it never sends a message for you.
        </p>
      </div>
    </footer>
  );
}
