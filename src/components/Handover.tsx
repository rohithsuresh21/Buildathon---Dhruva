"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, LocateFixed, MapPin, Search, Star } from "lucide-react";
import FlatMap, { type MapMarker } from "./FlatMap";
import { useProfile } from "@/lib/profile";
import { scoreAgency, rank } from "@/lib/agencies/score";
import { slotFromLocal } from "@/lib/agencies/hours";
import type { Agency, Need } from "@/lib/agencies/types";
import type { FinalAnswer, ParsedShipment } from "@/lib/analysis-types";
import type { Itinerary } from "@/lib/types";
import "@/app/handover.css";

type Where = { lat: number; lon: number; label: string };
type Found = { lon: number; lat: number; name: string; country: string; type?: string };

const OPINION: Record<FinalAnswer["action"], { tone: string; line: string }> = {
  proceed: { tone: "g", line: "Dhruva sees nothing on the route that should stop you. Hand it over as planned." },
  watch: { tone: "a", line: "Dhruva sees watch-items on the route. You can hand it over, then keep checking." },
  reroute: { tone: "a", line: "Dhruva found a safer routing. Pick it above before you hand the parcel over." },
  hold: { tone: "r", line: "Dhruva advises holding this parcel until the route clears. You can still book, at your own call." },
};

const pad = (n: number) => String(n).padStart(2, "0");
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
function defaultSlot() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return local(d);
}

/**
 * The customer side of the desk. Finds nearby hand-over agencies from live OpenStreetMap data, ranks them for this
 * shipment, and lets the customer approve one and place a signed booking.
 */
export default function Handover({
  answer,
  itinerary,
  parsed,
}: {
  answer: FinalAnswer | null;
  itinerary: Itinerary | null;
  parsed: ParsedShipment | null;
}) {
  const { profile } = useProfile();
  const [where, setWhere] = useState<Where | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Found[]>([]);
  const [status, setStatus] = useState<"idle" | "locating" | "loading" | "ready" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<Agency[]>([]);
  const [ratings, setRatings] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [freight, setFreight] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [slot, setSlot] = useState(defaultSlot);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState("");
  const [okay, setOkay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const touched = useRef({ name: false, phone: false, email: false, cargo: false });

  // Pre-fill from the saved profile and the parsed shipment, but never over something the customer typed.
  useEffect(() => {
    if (!touched.current.name && profile.name) setName(profile.name);
    if (!touched.current.phone && profile.phone) setPhone(profile.phone);
    if (!touched.current.email && profile.email) setEmail(profile.email);
  }, [profile]);
  useEffect(() => {
    if (!touched.current.cargo && parsed?.cargo) setCargo(parsed.cargo);
  }, [parsed?.cargo]);

  const need: Need = useMemo(
    () => ({
      international: !!parsed && parsed.origin.cc !== parsed.destination.cc,
      air: !!itinerary?.legs.some((l) => l.mode === "air"),
      freight,
    }),
    [parsed, itinerary, freight],
  );

  // The server ranks without a hand-over time; re-ranking here lets the customer move the slot and see opening hours react.
  const list = useMemo(() => {
    if (!where) return [];
    const s = slotFromLocal(slot);
    return rank(raw.map((a) => scoreAgency(a, [where.lon, where.lat], need, s)));
  }, [raw, where, need, slot]);
  const chosen = list.find((a) => a.id === sel) ?? null;

  useEffect(() => {
    if (!q.trim() || q.trim().length < 3) {
      setHits([]);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/places?q=${encodeURIComponent(q.trim())}`);
        const j = (await r.json()) as { results: Found[] };
        setHits(j.results.slice(0, 5));
      } catch {
        setHits([]);
      }
    }, 280);
    return () => clearTimeout(id);
  }, [q]);

  async function find(w: Where) {
    setWhere(w);
    setSel(null);
    setStatus("loading");
    setErr(null);
    try {
      const r = await fetch(`/api/agencies?lat=${w.lat.toFixed(5)}&lon=${w.lon.toFixed(5)}&intl=${need.international ? 1 : 0}&air=${need.air ? 1 : 0}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `The finder returned ${r.status}`);
      setRaw(j.agencies as Agency[]);
      setRatings(!!j.ratings);
      setNotes((j.notes as string[]) ?? []);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setErr(e instanceof Error ? e.message : "The agency finder could not be reached");
    }
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setErr("This browser cannot share a location. Search for your area instead.");
      return;
    }
    setStatus("locating");
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      (p) => find({ lat: p.coords.latitude, lon: p.coords.longitude, label: "Your location" }),
      (e) => {
        setStatus("error");
        setErr(e.code === 1 ? "Location was blocked. Search for your area instead." : "Your location could not be read. Search for your area instead.");
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 },
    );
  }

  const markers: MapMarker[] = useMemo(() => {
    if (!where) return [];
    const m: MapMarker[] = [{ id: "me", at: [where.lon, where.lat], label: where.label, color: "#ffefcf", kind: "city", r: 5, pulse: true }];
    list.slice(0, 12).forEach((a, i) =>
      m.push({
        id: a.id,
        at: [a.lon, a.lat],
        label: a.id === sel ? a.name : String(i + 1),
        color: a.id === sel ? "#f0b45a" : "#e8e2d4",
        r: a.id === sel ? 6 : 4,
        pulse: a.id === sel,
        onClick: () => setSel(a.id),
      }),
    );
    return m;
  }, [where, list, sel]);

  if (!answer) return null;
  const op = OPINION[answer.action];
  const slotOk = !!slotFromLocal(slot);
  const canBook = !!chosen && okay && name.trim().length >= 2 && cargo.trim().length > 0 && slotOk && !busy;

  async function book() {
    if (!chosen || !answer || !parsed || !itinerary) return;
    setBusy(true);
    setFail(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agency: {
            id: chosen.id,
            name: chosen.name,
            address: chosen.address,
            phone: chosen.phone,
            website: chosen.website,
            lat: chosen.lat,
            lon: chosen.lon,
            source: chosen.source,
            rating: chosen.rating,
            ratingCount: chosen.ratingCount,
            fitScore: chosen.fit.score,
            fitNotes: [...chosen.fit.parts.filter((p) => p.known).map((p) => `${p.label}: ${p.note}`), ...chosen.fit.flags].slice(0, 8),
          },
          handover: { at: slot, windowMin: 60 },
          shipment: {
            sentence: parsed.raw,
            cargo: cargo.trim(),
            from: parsed.origin.name,
            to: parsed.destination.name,
            routing: itinerary.label,
            km: itinerary.km,
            days: itinerary.days,
          },
          risk: {
            verdict: answer.overall,
            confidence: answer.confidence,
            safety: answer.primaryScore,
            headline: answer.headline,
            action: answer.action,
            asOf: answer.asOf,
          },
          customer: { name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined },
          approved: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `The booking was refused (${res.status})`);
      window.location.assign(j.url as string);
    } catch (e) {
      setFail(e instanceof Error ? e.message : "The booking could not be placed");
      setBusy(false);
    }
  }

  return (
    <section className="plate ho" id="handover">
      <div className="plate-head">
        <span>Hand it over</span>
        <span className="note" style={{ margin: 0 }}>Find a nearby agency, check it, book a time</span>
      </div>

      <div className={`ho-opinion ${op.tone}`}>
        <b>Dhruva's opinion</b>
        <span>{op.line}</span>
      </div>

      <div className="ho-find">
        <button type="button" className="btn small" onClick={locate} disabled={status === "locating" || status === "loading"}>
          <LocateFixed size={15} /> {status === "locating" ? "Reading location…" : "Use my location"}
        </button>
        {parsed && (
          <button type="button" className="btn small ghost" onClick={() => find({ lat: parsed.origin.lat, lon: parsed.origin.lon, label: parsed.origin.name })} disabled={status === "loading"}>
            <MapPin size={15} /> Near {parsed.origin.name}
          </button>
        )}
        <div className="ho-search">
          <Search size={15} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Or search your area or city" aria-label="Search your area" />
          {hits.length > 0 && (
            <ul role="listbox">
              {hits.map((h) => (
                <li key={`${h.name}${h.lon}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setQ("");
                      setHits([]);
                      find({ lat: h.lat, lon: h.lon, label: h.name });
                    }}
                  >
                    {h.name}
                    <span>{h.country}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="ho-check">
          <input type="checkbox" checked={freight} onChange={(e) => setFreight(e.target.checked)} /> Pallets or a full load, not a parcel
        </label>
      </div>
      {err && <p className="ho-err" role="alert">{err}</p>}
      {status === "loading" && <p className="note">Searching OpenStreetMap near {where?.label}…</p>}

      {status === "ready" && where && (
        <>
          <p className="note">
            {list.length ? `${list.length} places near ${where.label}, ranked for this shipment.` : `No courier or post-office listing was found near ${where.label}. Try a larger town nearby.`}{" "}
            {!ratings && "Ratings are off: this deployment has no Google Places key, so reputation is left out of the score instead of guessed."}
          </p>
          {notes.map((n) => (
            <p key={n} className="note">{n}</p>
          ))}

          {list.length > 0 && (
            <div className="ho-split">
              <ol className="ho-list">
                {list.slice(0, 12).map((a, i) => (
                  <li key={a.id}>
                    <button type="button" className={a.id === sel ? "on" : ""} onClick={() => setSel(a.id)} aria-pressed={a.id === sel}>
                      <span className="n">{i + 1}</span>
                      <span className="t">
                        <b>{a.name}</b>
                        <em>{a.fit.parts.find((p) => p.key === "distance")?.note}{a.address ? ` · ${a.address}` : ""}</em>
                        {a.rating !== undefined ? (
                          <em className="rt"><Star size={12} aria-hidden /> {a.rating.toFixed(1)} from {(a.ratingCount ?? 0).toLocaleString("en-IN")} reviews</em>
                        ) : (
                          <em className="rt dim">No rating on file</em>
                        )}
                      </span>
                      <span className="s" title={`Evidence behind this score: ${Math.round(a.fit.coverage * 100)}%`}>
                        {Math.round(a.fit.score)}
                        <small>fit</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="ho-map">
                <FlatMap routes={[]} markers={markers} fit={markers.map((m) => m.at)} height={380} detail="hi" projection="mercator" label="Agencies near you" />
              </div>
            </div>
          )}

          {chosen && (
            <div className="ho-review">
              <div className="ho-why">
                <div className="label">Why {chosen.name}</div>
                <ul className="plain">
                  {chosen.fit.parts.map((p) => (
                    <li key={p.key} className={p.known ? "" : "dim"}>
                      <span>{p.label}</span>
                      <span>{p.known ? `${p.points}/${p.max}` : "not judged"}</span>
                      <em>{p.note}</em>
                    </li>
                  ))}
                </ul>
                {chosen.fit.flags.map((f) => (
                  <p key={f} className="note ho-flag"><Crosshair size={13} aria-hidden /> {f}</p>
                ))}
                <p className="note">Cost and queue length are not judged: no free source publishes them.</p>
              </div>

              <form
                className="ho-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canBook) book();
                }}
              >
                <div className="label">Review and confirm</div>
                <label>Cargo<input value={cargo} onChange={(e) => { touched.current.cargo = true; setCargo(e.target.value); }} maxLength={80} required /></label>
                <label>Hand-over time
                  <input type="datetime-local" value={slot} min={local(new Date())} onChange={(e) => setSlot(e.target.value)} required />
                </label>
                <div className="ho-two">
                  <label>Your name<input value={name} onChange={(e) => { touched.current.name = true; setName(e.target.value); }} autoComplete="name" required /></label>
                  <label>Phone<input type="tel" value={phone} onChange={(e) => { touched.current.phone = true; setPhone(e.target.value); }} autoComplete="tel" /></label>
                </div>
                <label>Email, for the confirmation (optional)<input type="email" value={email} onChange={(e) => { touched.current.email = true; setEmail(e.target.value); }} autoComplete="email" /></label>
                <p className="note">
                  {parsed?.origin.name} to {parsed?.destination.name} by {itinerary?.label}. Payment is made at the counter; the agency quotes the price when it weighs the parcel.
                </p>
                <label className="ho-check">
                  <input type="checkbox" checked={okay} onChange={(e) => setOkay(e.target.checked)} />
                  I reviewed Dhruva's opinion, this agency and these details, and I approve the booking.
                </label>
                {fail && <p className="ho-err" role="alert">{fail}</p>}
                <button className="btn" type="submit" disabled={!canBook}>{busy ? "Placing booking…" : "Place booking"}</button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
