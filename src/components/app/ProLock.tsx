import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Verrou de formule prêt à afficher, calculé côté serveur (planLock) et transmis tel quel aux
 * composants client : marque de la formule qui ouvre la fonction, raison écrite, lien de mise à
 * niveau. `tier` vaut null quand aucune formule ne va plus loin (allocation Pro+ épuisée).
 */
export type Lock = {
  tier: "pro" | "proplus" | null;
  reason: string;
  upgrade: { label: string; href: string } | null;
};

/** Petite marque carrée « Pro » ou « Pro+ », à côté d'une fonction réservée. */
export function ProBadge({ tier, className }: { tier: "pro" | "proplus"; className?: string }) {
  return (
    <span
      data-testid="pro-badge"
      data-tier={tier}
      className={cn(
        "inline-flex shrink-0 items-center border border-accent bg-accent-veil px-1.5 text-[11px] leading-[18px] font-extrabold text-accent-dark",
        className,
      )}
    >
      {tier === "pro" ? "Pro" : "Pro+"}
    </span>
  );
}

/** Ligne qui dit pourquoi la fonction est grisée, avec sa marque et le lien pour passer au-dessus. */
export function LockNote({
  lock,
  id,
  className,
  testId = "lock-note",
}: {
  lock: Lock;
  id?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      id={id}
      data-testid={testId}
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2",
        className,
      )}
    >
      {lock.tier ? <ProBadge tier={lock.tier} /> : null}
      <span className="min-w-0 [overflow-wrap:anywhere]">{lock.reason}</span>
      {lock.upgrade ? (
        <a
          href={lock.upgrade.href}
          rel="noopener"
          className="font-semibold text-accent-dark underline"
          data-testid="upgrade-link"
        >
          {lock.upgrade.label}
        </a>
      ) : null}
    </p>
  );
}

/**
 * Fonction grisée : les champs et boutons restent visibles à leur place mais sont désactivés
 * (fieldset disabled, aria-disabled), en gris lisible ; la raison et le lien de mise à niveau
 * suivent, hors du bloc désactivé, donc atteignables au clavier. Le cadre est celui du verrou : le
 * bloc enveloppé perd sa propre bordure, pour un seul trait (Trait net).
 */
export function ProLock({
  lock,
  children,
  testId,
  className,
}: {
  lock: Lock;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const noteId = testId ? `${testId}-reason` : undefined;
  return (
    <div
      className={cn("border border-line-strong bg-muted", className)}
      data-testid={testId}
      data-locked={lock.tier ?? "limit"}
    >
      <fieldset
        disabled
        aria-disabled="true"
        aria-describedby={noteId}
        className="m-0 min-w-0 border-0 p-0 text-ink-muted grayscale [&>*]:border-0"
      >
        {children}
      </fieldset>
      <LockNote lock={lock} id={noteId} className="border-t border-line-strong px-5 py-3" />
    </div>
  );
}
