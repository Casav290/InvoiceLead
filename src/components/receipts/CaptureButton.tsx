"use client";

import { useRef, useState } from "react";

/**
 * Gros bouton « Photographier » : ouvre l'appareil photo du téléphone (ou le choix de fichier sur
 * ordinateur) et envoie la photo dès qu'elle est prise, sans second clic.
 */
export function CaptureButton({
  label,
  sending,
  disabled = false,
}: {
  label: string;
  sending: string;
  /** Lectures du mois utilisées : le bouton reste à sa place, grisé, sans appareil photo. */
  disabled?: boolean;
}) {
  const form = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (disabled)
    return (
      <div
        className="flex min-h-40 w-full flex-col items-center justify-center gap-2 border-2 border-line-strong bg-panel px-6 py-10 text-center text-[18px] font-extrabold text-ink-muted"
        aria-disabled="true"
        data-testid="capture-label"
      >
        <span>{label}</span>
      </div>
    );
  return (
    <label
      className="flex min-h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 border-2 border-accent bg-panel px-6 py-10 text-center text-[18px] font-extrabold text-accent-dark aria-disabled:opacity-60"
      aria-disabled={busy}
      data-testid="capture-label"
    >
      <span>{busy ? sending : label}</span>
      <input
        ref={form}
        type="file"
        name="files"
        accept="image/*,application/pdf"
        capture="environment"
        className="sr-only"
        data-testid="capture-input"
        onChange={(e) => {
          if (!e.currentTarget.files?.length) return;
          setBusy(true);
          e.currentTarget.form?.requestSubmit();
        }}
      />
    </label>
  );
}
