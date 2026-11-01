import type { Family, Severity, Verdict } from "./types";

export interface Reading {
  family: Family;
  severity: Severity;
  /** 0..1 */
  confidence: number;
  fresh: boolean;
  label: string;
}

export interface Judgement {
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  flaggedFamilies: Family[];
  respondingFamilies: Family[];
}

export const FAMILY_LABEL: Record<Family, string> = {
  traffic: "Traffic anomaly",
  hazard: "Hazard event",
  official: "Official alert",
  weather: "Weather forecast",
  news: "News reports",
};

/**
 * Corroboration rules. Deterministic code, no model involved.
 *  red    : two independent signal families at severity >= 2, or one official source at severity 3
 *  amber  : one family at severity >= 2, or two families at severity >= 1
 *  green  : nothing flagged by sources that answered
 *  abstain: no source answered with fresh data
 */
export function judge(readings: Reading[], relevantFamilies: Family[]): Judgement {
  const usable = readings.filter((r) => r.fresh && r.confidence >= 0.25);
  const responding = [...new Set(usable.map((r) => r.family))];
  if (!responding.length) {
    return {
      verdict: "abstain",
      confidence: 0,
      reasons: ["No source returned fresh data for this leg, so Dhruva will not guess."],
      flaggedFamilies: [],
      respondingFamilies: [],
    };
  }
  const maxByFamily = new Map<Family, Reading>();
  for (const r of usable) {
    const cur = maxByFamily.get(r.family);
    if (!cur || r.severity > cur.severity || (r.severity === cur.severity && r.confidence > cur.confidence)) maxByFamily.set(r.family, r);
  }
  const f2 = [...maxByFamily.values()].filter((r) => r.severity >= 2);
  const f1 = [...maxByFamily.values()].filter((r) => r.severity >= 1);
  const officialRed = [...maxByFamily.values()].some((r) => r.family === "official" && r.severity >= 3);

  let verdict: Verdict = "green";
  const reasons: string[] = [];
  if (f2.length >= 2 || officialRed) {
    verdict = "red";
    if (officialRed) reasons.push("An official source reports a severe condition on this leg.");
    if (f2.length >= 2) reasons.push(`${f2.length} independent kinds of evidence agree: ${f2.map((r) => FAMILY_LABEL[r.family].toLowerCase()).join(" and ")}.`);
  } else if (f2.length === 1 || f1.length >= 2) {
    verdict = "amber";
    if (f2.length === 1) reasons.push(`One kind of evidence is strong (${FAMILY_LABEL[f2[0].family].toLowerCase()}) but nothing independent confirms it yet.`);
    if (f1.length >= 2) reasons.push("Several weaker signals point the same way.");
  } else {
    reasons.push("Nothing flagged by the sources that answered.");
  }

  const coverage = Math.min(1, responding.length / Math.max(1, Math.min(relevantFamilies.length, 4)));
  const avgConf = usable.reduce((s, r) => s + r.confidence, 0) / usable.length;
  let confidence = 0.25 + 0.5 * coverage + 0.25 * avgConf;
  if (verdict === "red" && f2.length >= 2) confidence = Math.min(0.97, confidence + 0.1);
  if (verdict === "amber" && f2.length === 1) {
    confidence = Math.min(confidence, 0.62);
    const silent = responding.filter((f) => !maxByFamily.get(f) || maxByFamily.get(f)!.severity === 0 ? f !== f2[0].family : false);
    if (silent.length >= 2) {
      confidence *= 0.85;
      reasons.push(`${silent.length} other sources see nothing unusual, so treat this as unconfirmed.`);
    }
  }
  if (coverage < 0.5) reasons.push("Only part of the expected evidence was available.");
  return {
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
    flaggedFamilies: f1.map((r) => r.family),
    respondingFamilies: responding,
  };
}

export const VERDICT_RANK: Record<Verdict, number> = { abstain: 0, green: 1, amber: 2, red: 3 };
