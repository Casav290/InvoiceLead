import type { Metadata } from "next";
import { AssistantBox } from "@/components/assistant/AssistantBox";
import { budgetMonth } from "@/lib/assistant-budget";
import { requireAppSession } from "@/server/auth/guard";
import { getSessionCountryTranslations } from "@/server/country-translations";
import { db } from "@/server/db";
import { planLock } from "@/server/plan-lock";
import { assistantBudget, budgetView } from "@/server/plans";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getSessionCountryTranslations({ locale, namespace: "app.assistant" });
  return { title: t("title"), robots: { index: false } };
}

/**
 * Assistant : en formule gratuite, le budget de jetons de l'assistant IA (le même que la bulle,
 * l'équivalent de 10 demandes par mois), puis la boîte grisée avec la marque Pro.
 */
export default async function AssistantPage({ params }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const t = await getSessionCountryTranslations({ locale, namespace: "app.assistant" });
  const tp = await getSessionCountryTranslations({ locale, namespace: "app.plan" });
  const budget = await assistantBudget(db(), organization);
  // Verrou prêt pour le moment où le budget du mois est atteint.
  const lock = budget
    ? await planLock(
        locale,
        budget.upgradeTo,
        tp("used.assistant", { n: budget.requests, month: budgetMonth(budget.resetOn, locale) }),
      )
    : null;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      <AssistantBox
        locale={locale}
        budget={budgetView(budget)}
        lock={lock}
        suggestions={[
          t("suggestions.owed"),
          t("suggestions.result"),
          t("suggestions.toPay"),
          t("suggestions.unbilled"),
        ]}
      />
    </div>
  );
}
