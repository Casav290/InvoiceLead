"use client";

import { type ReactNode, useCallback, useMemo } from "react";
import { markTourSeenAction } from "@/app/[locale]/app/tour-actions";
import { useCountryTranslations } from "@/components/app/CountryContext";
import { invoiceLeadSteps } from "@/tour/steps.invoicelead";
import { TourProvider } from "@/tour/TourProvider";

/**
 * La visite guidée d'InvoiceLead (04.11.2026), montée dans la mise en page connectée : elle s'ouvre
 * seule au premier passage (`due` : users.tour_pending), puis à la demande par « Revoir la visite »
 * (menu de la personne, UserMenu). Textes : `app.tour.*`, avec les variantes du pays de l'entreprise.
 */
export function AppTour({
  children,
  userId,
  due,
  assistant,
  locale,
}: {
  children: ReactNode;
  userId: string;
  due: boolean;
  /** La bulle de l'Assistant IA est affichée (clé côté serveur). */
  assistant: boolean;
  locale: string;
}) {
  const tc = useCountryTranslations("app");
  const t = useCallback(
    (key: string, vars?: Record<string, unknown>) =>
      tc(key, vars as Record<string, string | number> | undefined),
    [tc],
  );
  const steps = useMemo(() => invoiceLeadSteps({ assistant }), [assistant]);
  const markSeen = useCallback(() => markTourSeenAction(locale), [locale]);
  return (
    <TourProvider userId={userId} due={due} steps={steps} t={t} markSeen={markSeen}>
      {children}
    </TourProvider>
  );
}
