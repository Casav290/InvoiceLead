import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AssistantBox } from "@/components/assistant/AssistantBox";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { planLock } from "@/server/plan-lock";
import { quotaAccess } from "@/server/plans";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.assistant" });
  return { title: t("title"), robots: { index: false } };
}

/** Assistant : formule gratuite 10 questions par mois, puis la boîte grisée avec la marque Pro. */
export default async function AssistantPage({ params }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.assistant" });
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  const access = await quotaAccess(db(), organization, "assistant");
  const limited = Number.isFinite(access.limit);
  // Verrou prêt pour le moment où la dernière question du mois est posée.
  const lock = limited
    ? await planLock(
        locale,
        organization,
        access.upgradeTo,
        tp("used.assistant", { limit: access.limit, plan: access.tier }),
      )
    : null;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      <AssistantBox
        locale={locale}
        quota={limited ? { used: access.used, limit: access.limit } : null}
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
