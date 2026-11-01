"use client";

import { useEffect, useRef, useState } from "react";

const SET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Departure-board text: each cell flips through random characters, left to right, then lands. */
export default function Flap({ text, color, reduce = false, size = "1em" }: { text: string; color?: string; reduce?: boolean; size?: string }) {
  const target = text.toUpperCase().split("");
  const [shown, setShown] = useState<string[]>(() => (reduce ? target : target.map((c) => (c === " " ? " " : "·"))));
  const [ticking, setTicking] = useState<boolean[]>(() => target.map(() => false));
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const goal = text.toUpperCase().split("");
    if (reduce) {
      setShown(goal);
      return;
    }
    let frame = 0;
    const id = window.setInterval(() => {
      frame++;
      const tk: boolean[] = [];
      const next = goal.map((c, i) => {
        if (c === " ") {
          tk.push(false);
          return " ";
        }
        const settleAt = 5 + i * 2;
        if (frame >= settleAt) {
          tk.push(frame === settleAt);
          return c;
        }
        tk.push(true);
        return SET[Math.floor(Math.random() * SET.length)];
      });
      setShown(next);
      setTicking(tk);
      if (frame > 5 + goal.length * 2 + 1) window.clearInterval(id);
    }, 48);
    return () => window.clearInterval(id);
  }, [text, reduce]);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  return (
    <span className="flap-row" role="text" aria-label={text} style={{ ["--fc" as string]: color, fontSize: size }}>
      {shown.map((c, i) => (
        <span key={i} aria-hidden="true" className={`flap ${c === " " ? "sp" : ""} ${ticking[i] ? "tick" : ""}`}>
          {c === " " ? "" : c}
        </span>
      ))}
    </span>
  );
}
