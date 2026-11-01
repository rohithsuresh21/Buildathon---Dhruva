"use client";

import { CalendarPlus, Link2, MessageCircle, Printer, Check } from "lucide-react";
import { useState } from "react";

/** Print, calendar, share and copy actions for a booking slip. */
export default function OrderActions({ token, text }: { token: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="ho-actions no-print">
      <a className="btn small" href={`/api/orders/${encodeURIComponent(token)}`}>
        <CalendarPlus size={15} /> Add to calendar
      </a>
      <button type="button" className="btn small ghost" onClick={() => window.print()}>
        <Printer size={15} /> Print the slip
      </button>
      <a className="btn small ghost" href={`https://wa.me/?text=${encodeURIComponent(text + "\n" + (typeof window !== "undefined" ? window.location.href : ""))}`} target="_blank" rel="noreferrer">
        <MessageCircle size={15} /> Share on WhatsApp
      </a>
      <button type="button" className="btn small ghost" onClick={copy}>
        {copied ? <Check size={15} /> : <Link2 size={15} />} {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}
