import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { requireAppSession } from "@/server/auth/guard";
import { can } from "@/server/roles";
import { stripeConfigured } from "@/server/stripe";
import { disconnectStripeAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ connected?: string; disconnected?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.onlinePayments" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = ["state", "denied", "failed"];

/** Paiement en ligne : relier le compte Stripe de l'entreprise. */
export default async function PaymentsSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.onlinePayments" });
  const editable = can(membership, "company");
  const account = organization.stripeAccountId;
  const notice = q.connected ? t("connected") : q.disconnected ? t("disconnected") : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {notice}
        </p>
      ) : null}
      {q.error && ERRORS.includes(q.error) ? (
        <p className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg">
          {t(`errors.${q.error}`)}
        </p>
      ) : null}
      <section
        className="mt-6 border border-line-strong bg-panel px-5 py-5 text-[14px]"
        data-testid="online-payments"
      >
        {!stripeConfigured() ? (
          <p className="text-ink-2">{t("notConfigured")}</p>
        ) : account ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-ink-2" data-testid="stripe-account">
              {t("linked", { account })}
            </p>
            {editable ? (
              <form action={disconnectStripeAction}>
                <input type="hidden" name="locale" value={locale} />
                <Button type="submit" variant="secondary" data-testid="stripe-disconnect">
                  {t("disconnect")}
                </Button>
              </form>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-ink-2">{t("notLinked")}</p>
            {editable ? (
              <Button asChild>
                <a href={`/api/stripe/connect?locale=${locale}`} data-testid="stripe-connect">
                  {t("connect")}
                </a>
              </Button>
            ) : null}
          </div>
        )}
        <p className="mt-4 text-[13px] text-ink-muted">{t("howItWorks")}</p>
      </section>
    </div>
  );
}
