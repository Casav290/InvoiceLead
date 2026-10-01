import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/app/PlanNotice";
import { AssistantBox } from "@/components/assistant/AssistantBox";
import { requireAppSession } from "@/server/auth/guard";
import { hasFeature, upgradeUrl } from "@/server/plans";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.assistant" });
  return { title: t("title"), robots: { index: false } };
}

export default async function AssistantPage({ params }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.assistant" });
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {hasFeature(organization, "assistant") ? null : (
        <PlanNotice locale={locale} message={t("errors.plan")} href={upgradeUrl(organization)} />
      )}
      <AssistantBox
        locale={locale}
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
