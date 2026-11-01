"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { markProfileSkipped, profileSkipped, useProfile } from "@/lib/profile";
import "@/app/handover.css";

/** First-visit prompt asking for an optional sender profile. Skipping costs nothing and it never asks twice. */
export default function ProfileGate() {
  const { save } = useProfile();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", email: "", phone: "" });

  useEffect(() => {
    if (profileSkipped()) return;
    const id = setTimeout(() => setOpen(true), 6500);
    return () => clearTimeout(id);
  }, []);
  if (!open) return null;

  const close = () => {
    markProfileSkipped();
    setOpen(false);
  };
  const ok = v.name.trim().length >= 2 || v.email.includes("@");
  return (
    <div className="ho-modal" role="dialog" aria-modal="false" aria-labelledby="pg-h">
      <div className="ho-modal-card">
        <button type="button" className="x" onClick={close} aria-label="Skip">
          <X size={16} />
        </button>
        <h2 id="pg-h" className="h3" style={{ fontSize: 26 }}>Fill in bookings for me?</h2>
        <p className="body" style={{ fontSize: 14.5, margin: "6px 0 14px" }}>
          Optional. Dhruva keeps these on this device only and uses them to pre-fill the hand-over slip and email you the confirmation. No account is created.
        </p>
        <form
          className="ho-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) return;
            save(v);
            markProfileSkipped();
            setOpen(false);
          }}
        >
          <label>Your name<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" /></label>
          <label>Email<input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="email" /></label>
          <label>Phone<input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} autoComplete="tel" /></label>
          <div className="ho-row">
            <button className="btn small" type="submit" disabled={!ok}>Save on this device</button>
            <button className="btn small ghost" type="button" onClick={close}>Skip</button>
          </div>
        </form>
      </div>
    </div>
  );
}
