import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { LIMITS, tierOf, upgradeUrl, usage } from "@/server/plans";

const NEXT_STEPS = ["company", "contacts", "invoice"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.nav" });
  return { title: t("dashboard"), robots: { index: false } };
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { user, organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.dashboard" });
  const tp = await getTranslations({ locale, namespace: "app.plan" });
  const tier = tierOf(organization);
  const used = await usage(db(), organization.id, new Date().toISOString().slice(0, 10));
  const firstName = (user.name || user.email).split(/\s+/)[0] ?? "";
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight" data-testid="dashboard-title">
        {t("title", { name: firstName })}
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle", { org: organization.name })}</p>
      <p className="mt-3 text-[13px] text-ink-2" data-testid="plan-usage">
        {tp("usage", {
          plan: tp(tier),
          hasLimit: tier === "free" ? "yes" : "no",
          invoices: used.invoices,
          invoiceLimit: LIMITS.free.invoicesPerMonth,
          contacts: used.contacts,
          contactLimit: LIMITS.free.contacts,
        })}{" "}
        {tier === "free" ? (
          <a
            href={upgradeUrl(organization)}
            className="font-semibold text-accent-dark underline"
            rel="noopener"
          >
            {tp("upgrade")}
          </a>
        ) : null}
      </p>
      <section className="mt-8 border border-line-strong bg-panel">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("nextTitle")}
        </h2>
        <ol>
          {NEXT_STEPS.map((step, i) => (
            <li
              key={step}
              className="flex items-center gap-4 border-b border-line-soft px-5 py-4 last:border-b-0"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-line-strong text-[12px] font-extrabold text-ink-3">
                {i + 1}
              </span>
              <span className="flex-1 text-[14px]">{t(`next.${step}`)}</span>
              {step === "company" ? (
                organization.settingsCompletedAt ? (
                  <span className="text-[12px] font-semibold text-ok-fg">{t("done")}</span>
                ) : (
                  <Link
                    href="/app/settings/company"
                    className="text-[13px] font-semibold text-accent-dark underline"
                  >
                    {t("complete")}
                  </Link>
                )
              ) : step === "invoice" ? (
                <Link
                  href="/app/invoices/new"
                  className="text-[13px] font-semibold text-accent-dark underline"
                >
                  {t("start")}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-4 text-[13px] text-ink-muted">{t("soon")}</p>
    </div>
  );
}
