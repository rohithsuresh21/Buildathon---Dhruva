import type { Family, Itinerary, LegVerdict, Signal } from "./types";

/**
 * Safety score for a routing, 0..100 (100 = nothing flagged on any source that answered).
 *
 * Deterministic, no model. Each leg loses points for the strongest reading in each family of evidence:
 *   mild -6, strong -18, severe -34, scaled by how much that single reading is worth (freshness, coverage).
 * A leg the corroborator rates amber or red loses a further 5 or 15 points. A leg that no source could answer for
 * loses 15, and the score of a routing is capped by how much of it was actually checked (Dhruva will not vouch
 * for what it could not see).
 */
const SEV_PENALTY = [0, 6, 18, 34] as const;
const VERDICT_PENALTY = { green: 0, amber: 5, red: 15, abstain: 15 } as const;

export interface Exposure {
  legId: string;
  family: Family;
  severity: number;
  title: string;
}

export interface Safety {
  /** 0..100 */
  score: number;
  /** 0..1, how well the evidence covers this routing */
  confidence: number;
  exposures: Exposure[];
}

export function safetyOf(it: Itinerary, legVerdicts: LegVerdict[], signals: Signal[]): Safety {
  let penalty = 0;
  const exposures: Exposure[] = [];
  const confs: number[] = [];
  let live = 0;
  for (const leg of it.legs) {
    const lv = legVerdicts.find((v) => v.legId === leg.id);
    const mine = signals.filter((s) => s.legId === leg.id && s.severity > 0 && (s.data as any)?.fresh !== false);
    const byFamily = new Map<Family, Signal>();
    for (const s of mine) {
      const cur = byFamily.get(s.family);
      if (!cur || s.severity > cur.severity || (s.severity === cur.severity && s.confidence > cur.confidence)) byFamily.set(s.family, s);
    }
    let legPenalty = 0;
    for (const s of byFamily.values()) {
      legPenalty += SEV_PENALTY[s.severity] * (0.5 + 0.5 * Math.max(0, Math.min(1, s.confidence)));
      exposures.push({ legId: leg.id, family: s.family, severity: s.severity, title: s.title });
    }
    legPenalty = Math.min(70, legPenalty);
    if (lv) {
      legPenalty += VERDICT_PENALTY[lv.verdict];
      if (lv.verdict !== "abstain") {
        live += 1;
        confs.push(lv.confidence);
      }
    } else legPenalty += VERDICT_PENALTY.abstain;
    penalty += legPenalty;
  }
  const coverage = it.legs.length ? live / it.legs.length : 0;
  const cap = 100 - 60 * (1 - coverage);
  const score = Math.max(0, Math.min(cap, Math.round(100 - penalty)));
  const mean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const weakest = confs.length ? Math.min(...confs) : 0;
  const confidence = Math.round((0.5 * weakest + 0.5 * mean) * coverage * 100) / 100;
  exposures.sort((a, b) => b.severity - a.severity);
  return { score, confidence, exposures };
}

/**
 * How sure Dhruva is that switching beats staying, 0..1.
 * Grows with the safety gap (full credit at 30 points) and is capped by the weaker of the two evidence confidences,
 * so a big gap built on thin evidence still reads as low confidence. Zero when the alternative is not meaningfully safer (under 5 points).
 */
/** Smaller safety gaps than this are noise, not a reason to change a booking. */
export const MIN_GAP = 5;

export function switchConfidence(altScore: number, altConf: number, primaryScore: number, primaryConf: number): number {
  const gap = altScore - primaryScore;
  if (gap < MIN_GAP) return 0;
  const gapFactor = Math.min(1, gap / 30);
  const evidence = Math.min(altConf, primaryConf);
  const v = (0.2 + 0.8 * gapFactor) * (0.35 + 0.65 * evidence);
  return Math.round(Math.min(0.97, v) * 100) / 100;
}

export function scoreWord(score: number): string {
  if (score >= 85) return "Clear";
  if (score >= 65) return "Some risk";
  if (score >= 40) return "Risky";
  return "Avoid";
}
