import type { SourceStamp } from "./types";

export type Status = "green" | "amber" | "red" | "na";

export interface PulseChoke {
  key: string;
  name: string;
  lon: number;
  lat: number;
  status: Status;
  /** robust z-score of the latest daily transit count against the trailing baseline */
  z: number | null;
  latest: number | null;
  baseline: number | null;
  date: string | null;
  series?: { d: string; n: number }[];
}

export interface PulseCyclone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alert: string;
  country?: string;
  fromdate?: string;
  track?: [number, number][];
}

export interface PulseEvent {
  id: string;
  type: string;
  name: string;
  alert: string;
  country?: string;
  lat?: number;
  lon?: number;
  fromdate?: string;
}

export interface PulseData {
  generatedAt: string;
  chokepoints: PulseChoke[];
  cyclones: PulseCyclone[];
  events: PulseEvent[];
  sources: SourceStamp[];
  /** newest PortWatch record date across chokepoints */
  newestRecord: string | null;
}
