import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OrgSwitcher } from "@/components/app/OrgSwitcher";
import { LocaleMenu } from "@/components/LocaleMenu";
import { Button, buttonVariants } from "@/components/ui/button";
import { accessProblem, appPage, requireSession } from "@/server/auth/guard";
import { getSession } from "@/server/auth/session";
import { billingConfigured, GRANTING, portalConfigured } from "@/server/billing/stripe";
import { subscriptionOf } from "@/server/billing/subscriptions";
import { getSessionCountryTranslations } from "@/server/country-translations";
import { db } from "@/server/db";
import { offerAbove, PLANS, seatsOf, tierOf } from "@/server/plans";
import {
  FORMULE_SEATS,
  type Formule,
  formuleOf,
  LEAD_ACCOUNT_URL,
  plansPath,
  seatAdvice,
  switchAccountPath,
} from "@/server/refusal";
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

type Search = {
  next?: string | string[];
  raison?: string | string[];
  formule?: string | string[];
};

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const BODY: Record<Formule, "seatBodyFree" | "seatBodyPro" | "seatBodyPlus"> = {
  free: "seatBodyFree",
  pro: "seatBodyPro",
  proplus: "seatBodyPlus",
};

/**
 * Écran « sans accès ». Refus « places » (billing-followups-design.md, § 4.1 et 6a) : adressable
 * (/xx/no-access?raison=places&formule=free|pro|proplus) et servi aussi sans session, la formule lue
 * dans l'adresse ; avec une session, celle de l'entreprise de la session prime. Toujours « Changer de
 * compte » (nouvelle identification au Compte Lead, prompt=login) et le Compte ERPlead ; le conseil
 * suit la formule : Pro+ plein, libérer une place, aucune offre ; Gratuit ou Pro, Pro+ pris ici par
 * l'administrateur (jamais une formule déjà acquise), « Voir les formules » pour les autres. Jamais de
 * « Réessayer » qui ramènerait au même refus. Les autres raisons (formule retirée, bêta, accès retiré,
 * fiduciaire suspendue) restent réservées aux sessions.
 */
export default async function NoAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  const q = await searchParams;
  // Page demandée avant cet écran (requireAppSession) : une page de l'application dans cette langue,
  // rien d'autre. Changer d'entreprise d'ici y ramène.
  const next = appPage(locale, one(q.next));
  const places = one(q.raison) === "places";
  // Vocabulaire du pays de l'entreprise de la session (Steuerberatung hors de Suisse).
  const t = await getSessionCountryTranslations({ locale, namespace: "app.noAccess" });
  // Sans session : le refus « places » se lit tel quel (lien gardé, autre navigateur, arrivée refusée
  // sans session) ; toute autre raison repasse par le Compte Lead.
  const session =
    (await getSession()) ??
    (places ? null : await requireSession(locale, next ? { next } : undefined));

  const links = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-6 py-4 text-[13px]">
      <a
        href={LEAD_ACCOUNT_URL}
        className="font-semibold text-accent-dark underline"
        data-testid="no-access-lead-account"
      >
        {t("leadAccount")}
      </a>
    </div>
  );
  const switchAccount = (
    <a
      href={switchAccountPath(locale)}
      className={buttonVariants({ variant: "secondary" })}
      data-switch-account=""
      data-testid="no-access-switch"
    >
      {t("switchAccount")}
    </a>
  );
  const seePlans = (
    <a
      href={plansPath(locale)}
      className={buttonVariants({ variant: "primary" })}
      data-upgrade=""
      data-testid="no-access-plans"
    >
      {t("seePlans")}
    </a>
  );

  if (!session) {
    const formule = formuleOf(one(q.formule));
    const org = t("yourCompany");
    const seats = formule ? FORMULE_SEATS[formule] : null;
    const { advice, offer } = formule
      ? seatAdvice({ formule, admin: false, canCheckout: false, canPortal: false })
      : { advice: "anyAsk" as const, offer: "plans" as const };
    return (
      <main className="flex min-h-screen items-start justify-center px-4 py-20">
        <div className="fixed top-3 right-3 z-40">
          <LocaleMenu keepSearch />
        </div>
        <div className="fixed top-3 right-3 z-40">
          <LocaleMenu keepSearch />
        </div>
        <div
          className="w-full max-w-[480px] border border-line-strong bg-panel"
          data-testid="no-access"
          data-reason="seat"
          data-formule={formule ?? undefined}
        >
          <div className="border-b border-line px-6 py-5">
            <h1 className="text-[22px] leading-tight">{t("seatTitle")}</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
              {formule ? t(BODY[formule], { org, seats: seats ?? 1 }) : t("seatBodyAny", { org })}
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
              {advice === "anyAsk"
                ? t("anyAsk", { org })
                : advice === "freeUp"
                  ? t("freeUp", { org })
                  : t("upgradeAsk", { org, plus: PLANS.proplus.seats })}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 px-6 py-5">
            {offer === "plans" ? seePlans : null}
            {switchAccount}
          </div>
          {links}
        </div>
      </main>
    );
  }

  const { organization } = session;
  const problem = await accessProblem(session);
  if (!problem) redirect(next ?? `/${locale}/app`);
  const orgs = await listUserOrganizations(db(), session.user.id);
  const admin = session.membership.role === "admin";
  // Places toutes prises : la formule de l'entreprise de la session (jamais celle de l'adresse). Pro+
  // se prend ici même (cet écran, et non la page Formule, que la personne sans place ne peut pas
  // ouvrir), par l'administrateur seulement, et seulement s'il n'est pas déjà acquis ; déjà abonné ici,
  // le passage à Pro+ se fait dans le portail Stripe d'InvoiceLead.
  const formule: Formule | null = problem === "seat" ? tierOf(organization) : null;
  const upgradable = formule !== null && formule !== "proplus" && admin;
  const sub = upgradable ? await subscriptionOf(db(), organization.id) : null;
  const subscribed = !!sub && (GRANTING as readonly string[]).includes(sub.status);
  const seat = formule
    ? seatAdvice({
        formule,
        admin,
        canCheckout:
          upgradable && billingConfigured() && !subscribed && offerAbove(organization, "pro_plus"),
        canPortal: upgradable && subscribed && portalConfigured(),
      })
    : null;
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
  const org = organization.name;
  const body =
    problem === "beta"
      ? t("betaBody", { org })
      : problem === "blocked"
        ? t("blockedBody", { org })
        : problem === "fiduciary"
          ? t("fiduciaryBody", { org })
          : formule
            ? t(BODY[formule], { org, seats: seatsOf(organization) })
            : t("body", { org });
  const advice = !seat
    ? null
    : seat.advice === "upgradeAdmin"
      ? t("upgradeAdmin", { plus: PLANS.proplus.seats })
      : seat.advice === "upgradeAsk"
        ? t("upgradeAsk", { org, plus: PLANS.proplus.seats })
        : seat.advice === "freeUpAdmin"
          ? t("freeUpAdmin")
          : t("freeUp", { org });
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-20">
      <div className="fixed top-3 right-3 z-40">
        <LocaleMenu keepSearch />
      </div>
      <div
        className="w-full max-w-[480px] border border-line-strong bg-panel"
        data-testid="no-access"
        data-reason={problem}
        data-formule={formule ?? undefined}
      >
        <div className="border-b border-line px-6 py-5">
          <h1 className="text-[22px] leading-tight">{title}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{body}</p>
          {advice ? (
            <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{advice}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3 px-6 py-5">
          {seat?.offer === "checkout"
            ? (["month", "year"] as const).map((interval) => (
                <form key={interval} action="/api/billing/checkout" method="post">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="plan" value="pro_plus" />
                  <input type="hidden" name="interval" value={interval} />
                  <Button
                    type="submit"
                    variant={interval === "month" ? "primary" : "secondary"}
                    data-testid={`no-access-checkout-${interval}`}
                    data-upgrade=""
                    data-plan-offer="pro_plus"
                  >
                    {t(interval === "month" ? "upgradeMonthly" : "upgradeYearly")}
                  </Button>
                </form>
              ))
            : null}
          {seat?.offer === "portal" ? (
            <form action="/api/billing/portal" method="post">
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" data-testid="no-access-portal" data-upgrade="">
                {t("manage")}
              </Button>
            </form>
          ) : null}
          {seat?.offer === "plans" ? seePlans : null}
          {switchAccount}
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
        {links}
      </div>
    </main>
  );
}
