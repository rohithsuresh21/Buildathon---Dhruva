/**
 * Known carriers and what they are generally able to move.
 *
 * This table is curated knowledge, not a live feed. It is used for one thing only: judging whether an agency can
 * plausibly handle the kind of shipment the customer has (international, air, freight). `false` means "not
 * established", never "cannot", and every result screen tells the customer to confirm the service with the agency.
 */

export interface Capability {
  domestic: boolean;
  international: boolean;
  air: boolean;
  freight: boolean;
}

export interface Carrier {
  id: string;
  label: string;
  match: RegExp;
  kind: "courier" | "post_office" | "logistics";
  cap: Capability;
}

const c = (domestic: boolean, international: boolean, air: boolean, freight: boolean): Capability => ({ domestic, international, air, freight });

export const CARRIERS: Carrier[] = [
  { id: "dhl", label: "DHL", match: /\bdhl\b/i, kind: "courier", cap: c(true, true, true, true) },
  { id: "fedex", label: "FedEx", match: /fed\s?ex|federal express/i, kind: "courier", cap: c(true, true, true, true) },
  { id: "ups", label: "UPS", match: /\bups\b|united parcel/i, kind: "courier", cap: c(false, true, true, true) },
  { id: "aramex", label: "Aramex", match: /aramex/i, kind: "courier", cap: c(false, true, true, false) },
  { id: "bluedart", label: "Blue Dart", match: /blue\s?dart/i, kind: "courier", cap: c(true, true, true, true) },
  { id: "dtdc", label: "DTDC", match: /\bdtdc\b/i, kind: "courier", cap: c(true, true, true, true) },
  { id: "delhivery", label: "Delhivery", match: /delhivery/i, kind: "logistics", cap: c(true, true, true, true) },
  { id: "indiapost", label: "India Post", match: /india\s?post|speed\s?post|department of posts|head post office|sub post office|\bpost office\b/i, kind: "post_office", cap: c(true, true, true, false) },
  { id: "professional", label: "The Professional Couriers", match: /professional\s?courier/i, kind: "courier", cap: c(true, true, true, false) },
  { id: "xpressbees", label: "XpressBees", match: /xpress\s?bees/i, kind: "courier", cap: c(true, false, false, false) },
  { id: "ecom", label: "Ecom Express", match: /ecom\s?express/i, kind: "courier", cap: c(true, false, false, false) },
  { id: "shadowfax", label: "Shadowfax", match: /shadowfax/i, kind: "courier", cap: c(true, false, false, false) },
  { id: "gati", label: "Gati", match: /\bgati\b/i, kind: "logistics", cap: c(true, false, false, true) },
  { id: "safexpress", label: "Safexpress", match: /safe\s?express/i, kind: "logistics", cap: c(true, false, false, true) },
  { id: "tci", label: "TCI Express", match: /\btci\b/i, kind: "logistics", cap: c(true, false, false, true) },
  { id: "vrl", label: "VRL Logistics", match: /\bvrl\b/i, kind: "logistics", cap: c(true, false, false, true) },
];

export function identify(...names: (string | undefined)[]): Carrier | undefined {
  const hay = names.filter(Boolean).join(" | ");
  if (!hay) return undefined;
  return CARRIERS.find((k) => k.match.test(hay));
}

/** Words that mark an unbranded business as a parcel or freight handler. */
export const SERVICE_WORDS = /courier|cargo|parcel|logistic|freight|packers|movers|express|forwarding|shipping|transport/i;
