import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Button } from "@/components/ui/button";
import { leadLoginHref } from "@/lib/lead-login";
import { cn } from "@/lib/utils";

type Params = { params: Promise<{ locale: string }> };

/** Prix de la famille Lead, identiques à Scanlead (hors TVA, encaissés en euros). Annuel = 10 mois. */
const PLANS = [
  { key: "free", monthly: "0 €", yearly: null, highlighted: false },
  { key: "pro", monthly: "19 €", yearly: "190 €", highlighted: false },
  { key: "proPlus", monthly: "39 €", yearly: "390 €", highlighted: true },
] as const;

/**
 * Lignes sans étiquette « Bientôt » : fonctions déjà disponibles, ou limites de la formule
 * (Gratuit : 1 utilisateur, mention « Créé avec InvoiceLead »). Toutes les autres sont à venir.
 */
const AVAILABLE: Record<string, number[]> = { free: [0, 5], pro: [], proPlus: [] };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("pricing") };
}

export default async function PricingPage({ params }: Params) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing" });
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto w-full max-w-[1000px] flex-1 px-4 py-12 sm:px-8">
        <div className="text-center">
          <h1 className="text-[30px] leading-tight sm:text-[38px]">{t("title")}</h1>
          <p className="mt-3 text-[15px] text-ink-muted">{t("subtitle")}</p>
        </div>
        <p className="mx-auto mt-6 max-w-2xl border border-line-strong bg-panel px-4 py-3 text-center text-[13px] text-ink-2">
          {t("notice")}
        </p>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PLANS.map((plan) => {
            const features = t.raw(`plans.${plan.key}.features`) as string[];
            const name = t(`plans.${plan.key}.name`);
            return (
              <section
                key={plan.key}
                data-testid={`plan-${plan.key}`}
                className={cn(
                  "flex flex-col gap-6 bg-paper p-6",
                  plan.highlighted ? "border-2 border-accent" : "border border-line-strong",
                )}
              >
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-[18px] font-bold tracking-normal">{name}</h2>
                    {plan.highlighted ? (
                      <span className="bg-accent-pale px-2 py-0.5 text-[11px] font-semibold text-accent-dark">
                        {t("popular")}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[13px] text-ink-muted">{t(`plans.${plan.key}.tagline`)}</p>
                  <p className="mt-4">
                    <span className="text-[30px] font-bold">{plan.monthly}</span>
                    <span className="ml-1.5 text-[13px] text-ink-muted">{t("monthly")}</span>
                  </p>
                  {plan.yearly ? (
                    <p className="text-[12px] text-ink-muted">
                      {t("yearly", { price: plan.yearly })}
                    </p>
                  ) : null}
                </div>
                <ul className="flex-1 space-y-2.5">
                  {features.map((feature, i) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[14px]">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-2 w-2 shrink-0 border border-accent-dark bg-accent-pale"
                      />
                      <span>
                        {feature}
                        {AVAILABLE[plan.key]?.includes(i) ? null : (
                          <span className="ml-2 text-[11px] font-semibold text-ink-muted uppercase">
                            {t("soon")}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button asChild variant={plan.highlighted ? "primary" : "secondary"}>
                  <a href={leadLoginHref(locale, true)}>
                    {plan.key === "free" ? t("cta.free") : t("cta.paid", { plan: name })}
                  </a>
                </Button>
              </section>
            );
          })}
        </div>
        <p className="mt-8 text-center text-[13px] text-ink-muted">{t("footer")}</p>
      </main>
      <PublicFooter />
    </div>
  );
}
