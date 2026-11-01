import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Brand } from "@/components/Logo";
import OrderActions from "@/components/OrderActions";
import { open, whenLabel } from "@/lib/orders";
import "@/app/handover.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hand-over slip — Dhruva", robots: { index: false, follow: false } };

const V = { green: "Green", amber: "Amber", red: "Red", abstain: "Unsure" } as const;
const ACTION = {
  proceed: "Hand over as planned.",
  watch: "Hand over, then keep watching the route.",
  reroute: "Dhruva advised switching to a safer routing before hand-over.",
  hold: "Dhruva advised holding the parcel until the route clears.",
} as const;

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = decodeURIComponent(token);
  const o = open(raw);
  if (!o) notFound();
  const { agency: a, shipment: s, risk: r, customer: c } = o;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}`;
  const osm = `https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lon}#map=17/${a.lat}/${a.lon}`;
  const share = `Hand-over ${o.id}: ${s.cargo}, ${s.from} to ${s.to}. ${a.name}, ${whenLabel(o.handover.at)}.`;
  return (
    <div className="desk">
      <header className="desk-bar">
        <Brand />
        <div className="desk-bar-r no-print">
          <a href="/desk" className="label">Check another shipment</a>
        </div>
      </header>
      <main className="ho-slip">
        <p className="ho-kicker">Booking {o.id}</p>
        <h1 className="ho-title">Hand over at {a.name}<br />on {whenLabel(o.handover.at)}.</h1>
        <p className="body" style={{ maxWidth: "60ch" }}>
          You reviewed and approved this plan{c.name ? `, ${c.name}` : ""}. Keep the parcel packed and ready, and arrive any time in the {o.handover.windowMin} minutes from the time above. Show this slip at the counter.
        </p>
        <OrderActions token={raw} text={share} />

        <section className="plate ho-grid">
          <div>
            <div className="label">Where</div>
            <p className="ho-strong">{a.name}</p>
            {a.address && <p className="body">{a.address}</p>}
            <p className="note">
              {a.phone ? <a href={`tel:${a.phone.replace(/\s+/g, "")}`}>{a.phone}</a> : "No phone listed"}
              {a.website && <> · <a href={a.website} target="_blank" rel="noreferrer">Website</a></>}
            </p>
            <p className="note no-print">
              <a href={dir} target="_blank" rel="noreferrer">Directions</a> · <a href={osm} target="_blank" rel="noreferrer">OpenStreetMap</a>
            </p>
          </div>
          <div>
            <div className="label">Consignment</div>
            <p className="ho-strong">{s.cargo}</p>
            <p className="body">{s.from} to {s.to}</p>
            <p className="note">{s.routing}. About {Math.round(s.km).toLocaleString("en-IN")} km, {s.days.toFixed(s.days < 10 ? 1 : 0)} days.</p>
            {s.notes && <p className="note">Note: {s.notes}</p>}
          </div>
          <div>
            <div className="label">Sender</div>
            <p className="ho-strong">{c.name}</p>
            <p className="note">{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details given"}</p>
            <div className="label" style={{ marginTop: 14 }}>Payment</div>
            <p className="note">Paid at the counter. The agency quotes the price when it weighs the parcel.</p>
          </div>
        </section>

        <section className="plate ho-risk" style={{ ["--vc" as string]: r.verdict === "green" ? "var(--ok)" : r.verdict === "amber" ? "var(--watch)" : r.verdict === "red" ? "var(--stop)" : "var(--mist)" }}>
          <div className="label">What Dhruva saw when you booked</div>
          <p className="ho-strong">{V[r.verdict]} at {Math.round(r.confidence * 100)}% confidence{r.safety !== undefined ? `, safety ${Math.round(r.safety)}/100` : ""}</p>
          <p className="body">{r.headline}</p>
          <p className="note">{ACTION[r.action]} Read {new Date(r.asOf).toUTCString()}. Conditions change, so re-check before you leave.</p>
          <a className="btn small ghost no-print" href={`/desk?q=${encodeURIComponent(s.sentence)}`}>Re-check this route now</a>
        </section>

        <section className="plate ho-grid ho-why">
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="label">Why this agency · fit {Math.round(a.fitScore)}/100</div>
            <ul className="plain">
              {a.fitNotes.map((n) => <li key={n} className="body" style={{ fontSize: 14.5 }}>{n}</li>)}
              {a.rating !== undefined && <li className="body" style={{ fontSize: 14.5 }}>Google rating {a.rating.toFixed(1)} from {(a.ratingCount ?? 0).toLocaleString("en-IN")} reviews</li>}
            </ul>
          </div>
        </section>

        <p className="note ho-fine">
          Dhruva does not have a system link to this agency. This slip records the plan you approved; the agency learns of it when you show up or share the link. Dhruva keeps no copy of this booking: it lives in this link, so save it.
        </p>
      </main>
    </div>
  );
}
