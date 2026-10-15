"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { euros } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export type PlanCard = {
  key: "free" | "pro" | "proPlus";
  /** Formule Stripe du bouton, null pour Gratuit. */
  plan: "pro" | "pro_plus" | null;
  name: string;
  tagline: string;
  features: string[];
  monthly: number;
  yearly: number | null;
  current: boolean;
  preselected: boolean;
  /**
   * Libellé du bouton « Passer à … » ; absent : pas de bouton sur cette carte (formule égale ou
   * inférieure à la formule acquise, personne qui n'administre pas, abonnement déjà pris ici).
   */
  action: string | null;
};

type Labels = {
  interval: string;
  monthly: string;
  yearly: string;
  perMonth: string;
  perYear: string;
  current: string;
};

/**
 * Les trois formules avec la bascule mensuel / annuel ; « Passer à Pro / Pro+ » envoie le formulaire
 * vers /api/billing/checkout (sans JavaScript, la période mensuelle part par défaut).
 */
export function PlanChooser({
  locale,
  cards,
  labels,
}: {
  locale: string;
  cards: PlanCard[];
  labels: Labels;
}) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  return (
    <div data-testid="plan-chooser">
      <fieldset className="mt-8 flex flex-wrap items-center gap-3">
        <legend className="sr-only">{labels.interval}</legend>
        {(["month", "year"] as const).map((value) => (
          <label
            key={value}
            className={cn(
              "inline-flex cursor-pointer items-center gap-2 border px-3 py-1.5 text-[13px] font-semibold",
              interval === value
                ? "border-accent bg-accent-pale text-accent-dark"
                : "border-line-strong bg-panel text-ink-2 hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name="plan-interval"
              value={value}
              checked={interval === value}
              onChange={() => setInterval(value)}
              className="accent-accent"
              data-testid={`plan-interval-${value}`}
            />
            {value === "month" ? labels.monthly : labels.yearly}
          </label>
        ))}
      </fieldset>
      <div className="mt-6 grid gap-5 md:grid-cols-3">
        {cards.map((card) => {
          const yearly = interval === "year" && card.yearly !== null;
          return (
            <section
              key={card.key}
              data-testid={`plan-card-${card.key}`}
              data-current={card.current ? "true" : undefined}
              className={cn(
                "flex flex-col gap-5 bg-paper p-5",
                card.preselected || card.current
                  ? "border-2 border-accent"
                  : "border border-line-strong",
              )}
            >
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-[17px] font-bold tracking-normal">{card.name}</h2>
                  {card.current ? (
                    <span className="bg-accent-pale px-2 py-0.5 text-[11px] font-semibold text-accent-dark">
                      {labels.current}
                    </span>
                  ) : null}
                </div>
                <p className="text-[13px] text-ink-muted">{card.tagline}</p>
                <p className="mt-3">
                  <span className="text-[26px] font-bold">
                    {euros(yearly && card.yearly !== null ? card.yearly : card.monthly)}
                  </span>
                  <span className="ml-1.5 text-[13px] text-ink-muted">
                    {yearly ? labels.perYear : labels.perMonth}
                  </span>
                </p>
              </div>
              <ul className="flex-1 space-y-2 text-[13px]">
                {card.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 border border-accent-dark bg-accent-pale"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {card.action && card.plan ? (
                <form method="post" action="/api/billing/checkout">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="plan" value={card.plan} />
                  <input type="hidden" name="interval" value={interval} />
                  <Button
                    type="submit"
                    className="w-full"
                    variant={card.key === "proPlus" ? "primary" : "secondary"}
                    data-testid={`plan-checkout-${card.plan}`}
                    data-plan-offer={card.plan}
                  >
                    {card.action}
                  </Button>
                </form>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
