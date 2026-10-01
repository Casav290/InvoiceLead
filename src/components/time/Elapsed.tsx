"use client";

import { useEffect, useState } from "react";

/** Durée écoulée d'un chrono, mise à jour chaque seconde (« 1:05:09 »). */
export function Elapsed({ since }: { since: string }) {
  const start = Date.parse(since);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - start) / 1000));
  const text = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <span
      className="font-extrabold tabular-nums"
      data-testid="timer-elapsed"
      suppressHydrationWarning
    >
      {text}
    </span>
  );
}
