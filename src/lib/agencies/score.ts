import { haversineKm } from "../geo";
import { CARRIERS } from "./catalog";
import { isOpenAt } from "./hours";
import type { Agency, Fit, FitPart, Need, RawAgency, Slot } from "./types";

/**
 * How well an agency fits this shipment, 0..100. Deterministic, no model.
 *
 *   distance    30  linear from 30 points at the customer's door to 0 at 20 km
 *   service     25  share of what the shipment needs (international, air, freight) that the carrier is known to offer;
 *                   an unbranded agency scores 10 because its services are unverified
 *   details     20  four points each for a phone, opening hours, a website and a street address, plus four for the name
 *   hours       10  open at the hand-over time the customer chose (judged only when the hours can be read)
 *   reputation  15  Google rating pulled toward 3.8 by a prior of ten reviews, judged only when a rating exists
 *
 * A part with no evidence is dropped from both sides of the fraction instead of being scored as zero or guessed, and
 * `coverage` says how much of the 100 points the result actually stood on. Cost and capacity are never judged:
 * no free source publishes them.
 */

const MAX_KM = 20;

export function scoreAgency(a: RawAgency, from: [number, number], need: Need, slot: Slot | null): Agency {
  const km = haversineKm(from, [a.lon, a.lat]);
  const parts: FitPart[] = [];
  const flags: string[] = [];

  parts.push({
    key: "distance",
    label: "Distance",
    points: Math.round(30 * Math.max(0, 1 - km / MAX_KM) * 10) / 10,
    max: 30,
    known: true,
    note: `${km < 10 ? km.toFixed(1) : Math.round(km)} km from you`,
  });

  const carrier = a.carrier ? CARRIERS.find((c) => c.id === a.carrier) : undefined;
  if (carrier) {
    const wants: [boolean, boolean, string][] = [];
    if (need.international) wants.push([true, carrier.cap.international, "international"]);
    if (need.air) wants.push([true, carrier.cap.air, "air"]);
    if (need.freight) wants.push([true, carrier.cap.freight, "freight"]);
    if (!wants.length) wants.push([true, carrier.cap.domestic, "domestic"]);
    const met = wants.filter((w) => w[1]).length;
    const missing = wants.filter((w) => !w[1]).map((w) => w[2]);
    parts.push({
      key: "service",
      label: "Service fit",
      points: Math.round((25 * met) / wants.length * 10) / 10,
      max: 25,
      known: true,
      note: missing.length ? `${carrier.label} is not known to offer ${missing.join(" or ")} here` : `${carrier.label} is known to offer ${wants.map((w) => w[2]).join(", ")}`,
    });
    if (missing.length) flags.push(`Ask whether they can do ${missing.join(" and ")} shipments`);
  } else {
    parts.push({ key: "service", label: "Service fit", points: 10, max: 25, known: true, note: "Independent agency, services unverified" });
    flags.push("Services unverified. Ask before you go");
  }

  const present = [a.phone, a.hours, a.website, a.address].filter(Boolean).length;
  parts.push({
    key: "details",
    label: "Verifiable details",
    points: 4 + present * 4,
    max: 20,
    known: true,
    note: present === 4 ? "Phone, hours, website and address are all listed" : `${present} of 4 contact details are listed`,
  });
  if (!a.phone) flags.push("No phone number listed");

  const open = slot ? isOpenAt(a.hours, slot) : null;
  parts.push({
    key: "hours",
    label: "Open at your time",
    points: open ? 10 : 0,
    max: 10,
    known: open !== null,
    note: open === null ? (a.hours ? "Hours listed but not machine-readable" : "No hours listed") : open ? "Open at the hand-over time" : "Closed at the hand-over time",
  });
  if (open === false) flags.push("Closed at your hand-over time");
  if (open === null) flags.push("Opening hours unknown. Call to confirm");

  if (a.rating !== undefined && a.ratingCount !== undefined) {
    const n = a.ratingCount;
    const adj = (a.rating * n + 3.8 * 10) / (n + 10);
    const pts = Math.round(15 * Math.min(1, Math.max(0, (adj - 3) / 2)) * 10) / 10;
    parts.push({ key: "reputation", label: "Google rating", points: pts, max: 15, known: true, note: `${a.rating.toFixed(1)} from ${n.toLocaleString("en-IN")} reviews` });
    if (a.rating < 3.3 && n >= 10) flags.push("Low Google rating");
  } else {
    parts.push({ key: "reputation", label: "Google rating", points: 0, max: 15, known: false, note: "No rating available" });
  }

  const judged = parts.filter((p) => p.known);
  const earned = judged.reduce((s, p) => s + p.points, 0);
  const possible = judged.reduce((s, p) => s + p.max, 0);
  const fit: Fit = {
    score: possible ? Math.round((earned / possible) * 100) : 0,
    coverage: Math.round((possible / 100) * 100) / 100,
    parts,
    flags,
  };
  return { ...a, distanceKm: Math.round(km * 10) / 10, fit };
}

export function rank(list: Agency[]): Agency[] {
  return [...list].sort((a, b) => b.fit.score - a.fit.score || a.distanceKm - b.distanceKm);
}
