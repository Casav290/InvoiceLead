import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OrgSwitcher } from "@/components/app/OrgSwitcher";
import { Button } from "@/components/ui/button";
import { accessProblem, appPage, requireSession } from "@/server/auth/guard";
import { billingConfigured, GRANTING, portalConfigured } from "@/server/billing/stripe";
import { subscriptionOf } from "@/server/billing/subscriptions";
import { db } from "@/server/db";
import { seatsOf } from "@/server/plans";
import { listUserOrganizations } from "@/server/team";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.noAccess" });
  return { title: t("title"), robots: { index: false } };
}

export default async function NoAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { locale } = await params;
  // Page demandée avant cet écran (requireAppSession) : une page de l'application dans cette langue,
  // rien d'autre. Changer d'entreprise d'ici y ramène.
  const raw = (await searchParams).next;
  const next = appPage(locale, typeof raw === "string" ? raw : undefined);
  const session = await requireSession(locale, next ? { next } : undefined);
  const { organization } = session;
  const problem = await accessProblem(session);
  if (!problem) redirect(next ?? `/${locale}/app`);
  const t = await getTranslations({ locale, namespace: "app.noAccess" });
  const orgs = await listUserOrganizations(db(), session.user.id);
  // Places toutes prises : Pro+ se prend ici même (cet écran, et non la page Formule, que la
  // personne sans place ne peut pas ouvrir), par l'administrateur seulement. Déjà abonné : le
  // passage à Pro+ se fait dans le portail Stripe d'InvoiceLead.
  const admin = session.membership.role === "admin";
  const sub = problem === "seat" && admin ? await subscriptionOf(db(), organization.id) : null;
  const subscribed = !!sub && (GRANTING as readonly string[]).includes(sub.status);
  const buy = problem === "seat" && admin && billingConfigured() && !subscribed;
  const portal = problem === "seat" && admin && subscribed && portalConfigured();
  const title =
    problem === "blocked"
      ? t("blockedTitle")
      : problem === "fiduciary"
        ? t("fiduciaryTitle")
        : problem === "seat"
          ? t("seatTitle")
          : problem === "beta"
            ? t("betaTitle")
            : t("title");
  const body =
    problem === "beta"
      ? t("betaBody", { org: organization.name })
      : problem === "blocked"
        ? t("blockedBody", { org: organization.name })
        : problem === "fiduciary"
          ? t("fiduciaryBody", { org: organization.name })
          : problem === "seat"
            ? t("seatBody", { org: organization.name, seats: seatsOf(organization) })
            : t("body", { org: organization.name });
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-20">
      <div
        className="w-full max-w-[480px] border border-line-strong bg-panel"
        data-testid="no-access"
        data-reason={problem}
      >
        <div className="border-b border-line px-6 py-5">
          <h1 className="text-[22px] leading-tight">{title}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{body}</p>
          {problem === "seat" && !admin ? (
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
              {t("seatAsk", { org: organization.name })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 px-6 py-5">
          {buy
            ? (["month", "year"] as const).map((interval) => (
                <form key={interval} action="/api/billing/checkout" method="post">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="plan" value="pro_plus" />
                  <input type="hidden" name="interval" value={interval} />
                  <Button
                    type="submit"
                    variant={interval === "month" ? "primary" : "secondary"}
                    data-testid={`no-access-checkout-${interval}`}
                  >
                    {t(interval === "month" ? "upgradeMonthly" : "upgradeYearly")}
                  </Button>
                </form>
              ))
            : null}
          {portal ? (
            <form action="/api/billing/portal" method="post">
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" data-testid="no-access-portal">
                {t("manage")}
              </Button>
            </form>
          ) : null}
          <form action="/auth/lead/logout" method="post">
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="secondary">
              {t("logout")}
            </Button>
          </form>
        </div>
        {orgs.length > 1 ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-4 text-[13px]">
            <span className="text-ink-2">{t("otherOrgs")}</span>
            <OrgSwitcher
              locale={locale}
              current={{ id: organization.id, name: organization.name }}
              orgs={orgs}
              next={next}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
