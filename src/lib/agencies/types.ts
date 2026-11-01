/** Shared types for the agency finder. Everything here is plain data so it can cross the API boundary unchanged. */

export type AgencyKind = "courier" | "post_office" | "logistics";

/** What the shipment needs from a handover point. Derived from the routing the customer picked. */
export interface Need {
  /** origin and destination are in different countries */
  international: boolean;
  /** the chosen routing includes an air leg */
  air: boolean;
  /** bulky, palletised or full-load cargo rather than a parcel */
  freight: boolean;
}

/** A moment in the agency's own local time. Opening hours are matched against it without time-zone maths. */
export interface Slot {
  /** 0 = Sunday ... 6 = Saturday */
  day: number;
  /** minutes after local midnight */
  minutes: number;
}

export interface FitPart {
  key: "distance" | "service" | "details" | "hours" | "reputation";
  label: string;
  points: number;
  max: number;
  /** false when there was no evidence, in which case the part is left out of the score instead of guessed */
  known: boolean;
  note: string;
}

export interface Fit {
  /** 0..100, earned points over the points that could be judged */
  score: number;
  /** 0..1, share of the full 100 points that rested on evidence */
  coverage: number;
  parts: FitPart[];
  /** things the customer should know before choosing this agency */
  flags: string[];
}

export interface Agency {
  id: string;
  name: string;
  /** known carrier id from the catalog, when the name or brand matched one */
  carrier?: string;
  kind: AgencyKind;
  lat: number;
  lon: number;
  distanceKm: number;
  address?: string;
  phone?: string;
  website?: string;
  /** raw OpenStreetMap opening_hours value */
  hours?: string;
  source: "osm" | "google" | "osm+google";
  osmUrl?: string;
  mapsUrl?: string;
  /** Google rating out of 5, only when a Google Places key is configured */
  rating?: number;
  ratingCount?: number;
  fit: Fit;
}

/** An agency before it has been scored. */
export type RawAgency = Omit<Agency, "fit" | "distanceKm">;
