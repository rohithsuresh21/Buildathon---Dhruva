import type { LonLat } from "./geo";

export type Mode = "sea" | "air" | "rail" | "road";
export type Family = "traffic" | "hazard" | "official" | "weather" | "news";
export type Severity = 0 | 1 | 2 | 3;

/** Provenance for every number we show: where it came from and when we read it. */
export interface SourceStamp {
  id: string;
  name: string;
  url: string;
  fetchedAt: string;
  /** newest observation or record timestamp inside the response */
  observedAt?: string;
  ok: boolean;
  ms: number;
  note?: string;
}

export interface Signal {
  id: string;
  agent: string;
  legId: string;
  mode: Mode;
  family: Family;
  severity: Severity;
  /** 0..1, how much this single reading is worth given freshness and coverage */
  confidence: number;
  title: string;
  detail: string;
  at?: LonLat;
  /** optional geometry for map display */
  line?: LonLat[];
  sources: SourceStamp[];
  data?: Record<string, unknown>;
}

export interface Leg {
  id: string;
  mode: Mode;
  label: string;
  from: { id: string; name: string; lon: number; lat: number };
  to: { id: string; name: string; lon: number; lat: number };
  path: LonLat[];
  km: number;
  days: number;
  /** extra info like chokepoints on this leg */
  chokepoints?: { key: string; name: string; lon: number; lat: number }[];
  /** how the geometry was produced */
  geometry: string;
}

export interface Itinerary {
  id: string;
  label: string;
  legs: Leg[];
  km: number;
  days: number;
  note?: string;
}

export type Verdict = "green" | "amber" | "red" | "abstain";

export interface LegVerdict {
  legId: string;
  verdict: Verdict;
  confidence: number;
  reasons: string[];
  families: Family[];
}

export type AgentId =
  | "orchestrator"
  | "intake"
  | "planner"
  | "maritime"
  | "storm"
  | "aviation"
  | "surface"
  | "alerts"
  | "news"
  | "corroborator"
  | "strategist"
  | "comms";

export type TraceStage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface TraceEvent {
  t: number;
  type: "trace";
  agent: AgentId;
  stage: TraceStage;
  status: "start" | "progress" | "ok" | "warn" | "fail" | "done";
  text: string;
  source?: SourceStamp;
}
