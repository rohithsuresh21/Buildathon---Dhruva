import type { Itinerary, LegVerdict, Signal, TraceEvent, Verdict } from "./types";
import type { Lang } from "./compose";

export interface ParsedShipment {
  raw: string;
  cargo: string;
  origin: { id: string; name: string; type: string; country: string; cc: string; state?: string; lon: number; lat: number };
  destination: { id: string; name: string; type: string; country: string; cc: string; state?: string; lon: number; lat: number };
  modeHint: "auto" | "air" | "sea" | "road" | "rail";
  notes: string[];
  parsedBy: "rules" | "model+rules";
}

export interface Alternative {
  id: string;
  label: string;
  itinerary: Itinerary;
  verdict: Verdict;
  deltaKm: number;
  deltaDays: number;
  why: string;
  caveat: string;
  /** 0..100 safety score from today's live checks (100 = nothing flagged) */
  score: number;
  /** 0..1, how well the evidence covers this routing */
  confidence: number;
  /** 0..1, how sure Dhruva is that this routing is safer than the one you planned; 0 when it is not safer */
  switchConfidence: number;
  /** what is still flagged on this routing, strongest first */
  exposures: string[];
  tag?: "safest" | "tradeoff";
  /** what changes for the shipment, in plain words */
  change: string;
}

export interface FinalAnswer {
  overall: Verdict;
  confidence: number;
  /** 0..100 safety score of the planned routing */
  primaryScore: number;
  headline: string;
  summary: string;
  narrativeBy: "model" | "template";
  legs: LegVerdict[];
  action: "proceed" | "watch" | "reroute" | "hold";
  asOf: string;
  freshness: { oldestObservation?: string; newestObservation?: string; note: string };
  blindSpots: string[];
}

export type StreamEvent =
  | ({ type: "trace" } & Omit<TraceEvent, "type">)
  | { type: "parsed"; data: ParsedShipment }
  | { type: "plan"; data: { itineraries: Itinerary[]; primary: string } }
  | { type: "signals"; data: Signal[] }
  | { type: "verdict"; data: FinalAnswer }
  | { type: "alternatives"; data: Alternative[]; deep?: boolean }
  | { type: "messages"; data: Record<Lang, string> }
  | { type: "done"; data: { tookMs: number; llm: boolean } }
  | { type: "error"; message: string; hint?: string };
