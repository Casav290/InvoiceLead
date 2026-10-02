"use client";

import { useRef, useState } from "react";

/**
 * « Scanner un ticket » (notes de frais) ou « Prendre en photo » (factures fournisseurs) : sur un
 * téléphone, ouvre l'appareil photo ; ailleurs, le choix d'un fichier. La photo part dès qu'elle est
 * prise, sans second bouton, et l'écran dit qu'elle est en lecture.
 */
export function ScanTicket({
  label,
  reading,
  hint,
  name = "ticket",
  testId = "scan-ticket",
  disabled = false,
}: {
  label: string;
  reading: string;
  hint: string;
  /** Nom du champ fichier envoyé à l'action. */
  name?: string;
  /** Préfixe des data-testid : `<testId>-input`, `<testId>-disabled`. */
  testId?: string;
  /**
   * Lectures du mois utilisées : le bouton reste visible, grisé, sans choix de fichier ; `hint` dit
   * alors comment saisir la dépense sans lecture.
   */
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (disabled)
    return (
      <div>
        <span
          className="inline-flex min-h-12 items-center justify-center border border-line-strong bg-muted px-6 text-[15px] font-bold text-ink-muted"
          aria-disabled="true"
          data-testid={`${testId}-disabled`}
        >
          {label}
        </span>
        <p className="mt-2 text-[13px] text-ink-muted">{hint}</p>
      </div>
    );
  return (
    <div>
      <label
        className={`inline-flex min-h-12 cursor-pointer items-center justify-center bg-accent px-6 text-[15px] font-bold text-white hover:bg-accent-dark ${busy ? "pointer-events-none opacity-70" : ""}`}
      >
        {busy ? reading : label}
        <input
          ref={input}
          type="file"
          name={name}
          accept="image/jpeg,image/png,image/webp,application/pdf"
          capture="environment"
          className="sr-only"
          data-testid={`${testId}-input`}
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
