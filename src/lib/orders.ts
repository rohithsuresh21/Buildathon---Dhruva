import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Hand-over bookings.
 *
 * Dhruva keeps no database. A booking is a small signed document: the order is encoded into the link itself and sealed
 * with an HMAC, so the link can be opened from any device, cannot be edited without breaking the seal, and costs
 * nothing to host. The trade-off is that a booking cannot be changed after it is made; a new booking replaces it.
 */

const clean = (max: number) => z.string().trim().max(max);

export const OrderInput = z.object({
  agency: z.object({
    id: clean(80),
    name: clean(120).min(1),
    address: clean(240).optional(),
    phone: clean(40).optional(),
    website: clean(200).optional(),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    source: z.enum(["osm", "google", "osm+google"]),
    rating: z.number().min(0).max(5).optional(),
    ratingCount: z.number().int().min(0).optional(),
    fitScore: z.number().min(0).max(100),
    fitNotes: z.array(clean(160)).max(8).default([]),
  }),
  handover: z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), windowMin: z.number().int().min(15).max(240).default(60) }),
  shipment: z.object({
    sentence: clean(240),
    cargo: clean(80).min(1),
    from: clean(80),
    to: clean(80),
    routing: clean(160),
    km: z.number().min(0),
    days: z.number().min(0),
    notes: clean(300).optional(),
  }),
  risk: z.object({
    verdict: z.enum(["green", "amber", "red", "abstain"]),
    confidence: z.number().min(0).max(1),
    safety: z.number().min(0).max(100).optional(),
    headline: clean(300),
    action: z.enum(["proceed", "watch", "reroute", "hold"]),
    asOf: clean(40),
  }),
  customer: z.object({
    name: clean(80).min(2),
    phone: clean(24).optional(),
    email: z.string().trim().email().max(120).optional().or(z.literal("").transform(() => undefined)),
  }),
  approved: z.literal(true),
});
export type OrderInput = z.infer<typeof OrderInput>;

export interface Order extends Omit<OrderInput, "approved"> {
  id: string;
  createdAt: string;
  /** the customer reviewed and approved every field before this was sealed */
  approvedByCustomer: true;
}

function secret(): string {
  const s = process.env.ORDER_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV !== "production") return "dhruva-local-development-secret";
  throw new Error("ORDER_SECRET is not configured");
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string) => createHmac("sha256", secret()).update(body).digest().subarray(0, 20);

export function newOrder(input: OrderInput): Order {
  const { approved: _a, ...rest } = input;
  return { ...rest, id: "DH-" + randomBytes(4).toString("hex").toUpperCase(), createdAt: new Date().toISOString(), approvedByCustomer: true };
}

export function seal(o: Order): string {
  const body = b64(JSON.stringify(o));
  return `${body}.${b64(mac(body))}`;
}

export function open(token: string): Order | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const want = mac(body);
    const got = Buffer.from(sig, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Order;
  } catch {
    return null;
  }
}

/** "2026-11-02T11:00" plus minutes, as a floating local time stamp for calendars. */
function icsTime(local: string, addMin = 0): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)!;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + addMin));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export function ics(o: Order): string {
  const stamp = o.createdAt.replace(/[-:]/g, "").slice(0, 15) + "Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dhruva//Hand-over//EN",
    "BEGIN:VEVENT",
    `UID:${o.id}@dhruva`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsTime(o.handover.at)}`,
    `DTEND:${icsTime(o.handover.at, o.handover.windowMin)}`,
    `SUMMARY:${esc(`Hand over parcel to ${o.agency.name}`)}`,
    `LOCATION:${esc([o.agency.name, o.agency.address].filter(Boolean).join(", "))}`,
    `GEO:${o.agency.lat};${o.agency.lon}`,
    `DESCRIPTION:${esc(`${o.shipment.cargo}, ${o.shipment.from} to ${o.shipment.to}. Booking ${o.id}. Dhruva read the route as ${o.risk.verdict.toUpperCase()} at ${new Date(o.risk.asOf).toUTCString()}; re-check before you go.`)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Parcel hand-over in one hour",
    "TRIGGER:-PT60M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function whenLabel(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return local;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });
}

const html = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Sends the confirmation through Resend when RESEND_API_KEY is set. Returns null when email is not configured. */
export async function sendConfirmation(o: Order, link: string): Promise<boolean | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !o.customer.email) return null;
  const when = whenLabel(o.handover.at);
  const text = `Your hand-over is booked.\n\n${o.shipment.cargo}, ${o.shipment.from} to ${o.shipment.to}\nHand over: ${when}\nAgency: ${o.agency.name}${o.agency.address ? ", " + o.agency.address : ""}\nBooking: ${o.id}\n\nOpen your slip: ${link}\n\nDhruva read this route as ${o.risk.verdict.toUpperCase()} when you booked. Conditions change; re-check before you go.`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "Dhruva <onboarding@resend.dev>",
        to: [o.customer.email],
        subject: `Hand-over booked: ${o.shipment.cargo} at ${o.agency.name}, ${when}`,
        text,
        html: `<p>Your hand-over is booked.</p><p><strong>${html(o.shipment.cargo)}</strong>, ${html(o.shipment.from)} to ${html(o.shipment.to)}<br>Hand over: ${html(when)}<br>Agency: ${html(o.agency.name)}${o.agency.address ? ", " + html(o.agency.address) : ""}<br>Booking: ${o.id}</p><p><a href="${html(link)}">Open your slip</a></p><p>Dhruva read this route as <strong>${o.risk.verdict.toUpperCase()}</strong> when you booked. Conditions change; re-check before you go.</p>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
