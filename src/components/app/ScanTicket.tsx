"use client";

import { useRef, useState } from "react";

/**
 * « Scanner un ticket » : sur un téléphone, ouvre l'appareil photo ; ailleurs, le choix d'un fichier.
 * La photo part dès qu'elle est prise, sans second bouton, et l'écran dit qu'elle est en lecture.
 */
export function ScanTicket({
  label,
  reading,
  hint,
}: {
  label: string;
  reading: string;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <label
        className={`inline-flex min-h-12 cursor-pointer items-center justify-center bg-accent px-6 text-[15px] font-bold text-white hover:bg-accent-dark ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        {busy ? reading : label}
        <input
          ref={input}
          type="file"
          name="ticket"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          className="sr-only"
          data-testid="scan-ticket-input"
          onChange={(e) => {
            if (!e.currentTarget.files?.length) return;
            setBusy(true);
            e.currentTarget.form?.requestSubmit();
          }}
        />
      </label>
      <p className="mt-2 text-[13px] text-ink-muted">{busy ? reading : hint}</p>
    </div>
  );
}
