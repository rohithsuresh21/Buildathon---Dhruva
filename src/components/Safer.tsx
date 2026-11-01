"use client";

import { AlertTriangle, LoaderCircle, ShieldCheck } from "lucide-react";
import type { Alternative, FinalAnswer } from "@/lib/analysis-types";
import { scoreWord } from "@/lib/safety";
import type { Verdict } from "@/lib/types";

export type DeepState = "idle" | "running" | "done";

const V_COLOR: Record<Verdict, string> = { green: "#58e6a6", amber: "#ffab2e", red: "#ff5252", abstain: "#b5ae9f" };
const V_WORD: Record<Verdict, string> = { green: "Green", amber: "Amber", red: "Red", abstain: "Unsure" };

function scoreColor(n: number) {
  return n >= 85 ? V_COLOR.green : n >= 65 ? "#d9d36a" : n >= 40 ? V_COLOR.amber : V_COLOR.red;
}

function Meter({ value, color, label, big }: { value: number; color: string; label: string; big?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: big ? 44 : 30, lineHeight: 1, color }}>{Math.round(value)}</span>
        <span className="note" style={{ margin: 0 }}>/ 100</span>
      </div>
      <div className="bar" style={{ width: "100%", maxWidth: 160, marginTop: 6 }}><i style={{ width: `${Math.max(2, value)}%`, background: color }} /></div>
      <div className="label" style={{ marginTop: 6 }}>{label}</div>
    </div>
  );
}

export default function Safer({
  answer,
  alts,
  state,
  busy,
  activeId,
  primaryId,
  onFind,
  onPick,
}: {
  answer: FinalAnswer | null;
  alts: Alternative[];
  state: DeepState;
  busy: boolean;
  activeId?: string;
  primaryId?: string;
  onFind: () => void;
  onPick: (id: string) => void;
}) {
  const warn = !!answer && answer.overall !== "green";
  if (!warn && !alts.length) return null;
  const pScore = answer?.primaryScore;
  const ranked = [...alts].sort((a, b) => b.score - a.score || a.deltaDays - b.deltaDays);
  const saferCount = ranked.filter((a) => a.verdict !== "abstain" && a.switchConfidence > 0).length;
  const col = answer ? V_COLOR[answer.overall] : "var(--lamp)";

  return (
    <div className="plate" style={warn ? { borderColor: col } : undefined}>
      <div className="plate-head">
        <span>{warn ? "Find a safer route" : "Other routings"}</span>
        <span className="label">scored on the same live sources</span>
      </div>

      {warn && answer && (
        <div style={{ padding: "16px 20px 6px", display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ color: col, marginTop: 3 }}><AlertTriangle size={20} /></span>
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <p style={{ fontWeight: 600 }}>
                {answer.overall === "red" ? "Red alert on your planned route." : answer.overall === "amber" ? "Warning on your planned route." : "Dhruva could not verify your planned route."}
              </p>
              <p className="body" style={{ fontSize: 14.5, marginTop: 4 }}>
                {state === "done"
                  ? saferCount
                    ? `${saferCount} of ${ranked.length} routings checked score safer than your plan. Pick one to see it on the globe.`
                    : `Dhruva searched ${ranked.length} other routings and none scores safer than your plan on today's evidence.`
                  : "Dhruva can search wider for a safer way: other ports within reach, every chokepoint avoided, and air. Each option runs through the same live checks and gets a safety score and a confidence."}
              </p>
            </div>
            {answer.overall !== "abstain" && <Meter value={pScore ?? 0} color={scoreColor(pScore ?? 0)} label={`Your plan · ${scoreWord(pScore ?? 0)}`} big />}
          </div>
          {state !== "done" && (
            <div>
              <button type="button" className="btn" disabled={state === "running" || busy} onClick={onFind}>
                {state === "running" ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />} {state === "running" ? "Checking every option live…" : "Find safer routes"}
              </button>
              {state === "running" && <p className="note" style={{ marginTop: 8 }}>This takes about half a minute, because each extra routing is checked against live data.</p>}
            </div>
          )}
        </div>
      )}

      {ranked.length > 0 && (
        <div className="alts">
          {ranked.map((a) => {
            const better = a.verdict !== "abstain" && a.switchConfidence > 0;
            const sc = scoreColor(a.score);
            return (
              <button key={a.id} type="button" className={`alt ${a.itinerary.id === activeId ? "sel" : ""}`} onClick={() => onPick(a.itinerary.id)} aria-pressed={a.itinerary.id === activeId}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span className="h3" style={{ fontSize: 24 }}>{a.label}</span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {a.tag === "safest" && <span className="pill g"><i />Safest</span>}
                    {a.tag === "tradeoff" && <span className="pill s"><i />Best trade-off</span>}
                    <span className={`pill ${a.verdict === "green" ? "g" : a.verdict === "amber" ? "a" : a.verdict === "red" ? "r" : ""}`}><i />{V_WORD[a.verdict]}</span>
                  </span>
                </div>
                {a.verdict === "abstain" ? (
                  <p className="body" style={{ fontSize: 14.5, margin: "4px 0 2px" }}>No source returned fresh data for this routing, so Dhruva will not score it.</p>
                ) : (
                  <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-end", margin: "4px 0 2px" }}>
                    <Meter value={a.score} color={sc} label={`Safety · ${scoreWord(a.score)}`} />
                    <div>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 30, lineHeight: 1, color: better ? V_COLOR.green : "var(--mist)" }}>
                        {better ? `${Math.round(a.switchConfidence * 100)}%` : "–"}
                      </div>
                      <div className="label" style={{ marginTop: 6 }}>{better ? "Sure it is safer" : "Not safer than your plan"}</div>
                    </div>
                  </div>
                )}
                <div className="note">{a.change}. Evidence coverage {Math.round(a.confidence * 100)}%.</div>
                {a.exposures.length > 0 && <p className="body" style={{ fontSize: 14 }}>Still flagged: {a.exposures.join("; ")}.</p>}
                {a.exposures.length === 0 && a.verdict !== "abstain" && <p className="body" style={{ fontSize: 14 }}>Nothing flagged by the sources that answered.</p>}
                <p className="note">{a.caveat}</p>
              </button>
            );
          })}
        </div>
      )}
      {ranked.length > 0 && (
        <p className="note" style={{ padding: "0 20px 16px" }}>
          Safety score: 100 minus points for each kind of evidence flagged on any leg (mild 6, strong 18, severe 34, scaled by how fresh and complete the reading is). &ldquo;Sure it is safer&rdquo; grows with the safety gap and is capped by how well the evidence covers both routings. Cost, capacity and carrier schedules are not checked.
        </p>
      )}
    </div>
  );
}
