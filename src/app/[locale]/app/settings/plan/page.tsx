import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { type PlanCard, PlanChooser } from "@/components/settings/PlanChooser";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/fiscal-year";
import { AVAILABLE, PRICE_CARDS } from "@/lib/pricing";
import { requireAppSession } from "@/server/auth/guard";
import { billingConfigured, GRANTING, portalConfigured } from "@/server/billing/stripe";
import { subscriptionOf } from "@/server/billing/subscriptions";
import { db } from "@/server/db";
import {
  acquiredTier,
  billingTier,
  leadOwnPlan,
  offerAbove,
  planCode,
  type Tier,
  tierOf,
} from "@/server/plans";
import { LEAD_ACCOUNT_URL } from "@/server/refusal";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ plan?: string; checkout?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.billing" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = ["admin", "unavailable", "invalid", "already", "stripe", "noCustomer"];
const day = (d: Date | string) => formatDate(new Date(d).toISOString().slice(0, 10));
const RANK: Record<Tier, number> = { free: 0, pro: 1, proplus: 2 };

type Inherited = { app: string; until: string };

/**
 * Abonnement hérité que le Compte Lead accorde encore (abonnement payé ailleurs avant le
 * 13.10.2026, jusqu'à la fin de sa période déjà payée) : l'application et la date de fin.
 */
function inheritedOf(entitlements: unknown): Inherited | null {
  const e = entitlements as {
    plan?: { source?: string; valid_until?: string | null };
    apps?: Record<string, { name?: string }>;
    subscriptions?: { app?: string; inherited?: boolean; family_until?: string | null }[];
  } | null;
  if (e?.plan?.source !== "family" || !e.plan.valid_until) return null;
  const row = e.subscriptions?.find((s) => s.inherited);
  const code = row?.app ?? "";
  return { app: e.apps?.[code]?.name ?? code, until: e.plan.valid_until };
}

/**
 * Formule InvoiceLead : la formule actuelle et d'où elle vient, les trois formules avec leurs prix,
 * « Passer à Pro / Pro+ » (Stripe Checkout) et « Gérer l'abonnement » (portail Stripe) pour
 * l'administrateur. Un abonnement pris ici ne vaut que pour InvoiceLead.
 *
 * Seules les formules STRICTEMENT au-dessus de la formule acquise sont offertes (acquiredTier :
 * abonnement pris ici et formule propre du Compte Lead, jamais l'héritage) ; une formule propre du
 * Compte Lead est dite avec son origine et sa date de fin. Contrat de page (banc check-offers.mjs) :
 * data-plan-current (formule appliquée) et data-plan-acquired sur la formule actuelle, data-plan-offer
 * sur chaque bouton d'achat.
 */
export default async function PlanSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const q = await searchParams;
  const { organization, membership } = await requireAppSession(locale);
  const isAdmin = membership.role === "admin";

  // Retour du paiement : /api/billing/return a déjà enregistré l'abonnement (checkout=done).
  const t = await getTranslations({ locale, namespace: "app.billing" });
  const tp = await getTranslations({ locale, namespace: "pricing" });
  const tPlan = await getTranslations({ locale, namespace: "app.plan" });
  const tier = tierOf(organization);
  const own = billingTier(organization);
  const acquired = acquiredTier(organization);
  const sub = await subscriptionOf(db(), organization.id);
  const open = !!sub && (GRANTING as readonly string[]).includes(sub.status);
  const inherited = own === "free" ? inheritedOf(organization.entitlements) : null;
  // Formule propre du Compte Lead au-dessus de l'abonnement pris ici : elle se gère dans ERPlead.
  const lead = leadOwnPlan(organization);
  const fromLead = !open && lead && RANK[lead.tier] > RANK[own] ? lead : null;
  const tierName = tPlan(tier);
  const canBuy = isAdmin && billingConfigured() && !open;
  const wanted = q.plan === "pro" || q.plan === "pro_plus" ? q.plan : null;

  const cards: PlanCard[] = PRICE_CARDS.map((card) => {
    const features = tp.raw(`plans.${card.key}.features`) as string[];
    const cardTier = card.key === "proPlus" ? "proplus" : card.key;
    return {
      key: card.key,
      plan: card.plan,
      name: tp(`plans.${card.key}.name`),
      tagline: tp(`plans.${card.key}.tagline`),
      features: features.filter((_, i) => AVAILABLE[card.key].includes(i)),
      monthly: card.monthly,
      yearly: card.yearly,
      current: cardTier === tier,
      preselected: card.plan !== null && card.plan === wanted,
      // Jamais une formule égale ou inférieure à la formule acquise (le serveur refuse de même).
      action:
        canBuy && card.plan && offerAbove(organization, card.plan)
          ? tPlan(card.plan === "pro_plus" ? "upgradePlus" : "upgrade")
          : null,
    };
  });

  const notice =
    q.checkout === "done"
      ? t("notices.done", { plan: tierName })
      : q.checkout === "pending"
        ? t("notices.pending")
        : q.checkout === "cancel"
          ? t("notices.cancel")
          : null;
  // Résilié dans le portail : fin programmée (cancel_at), ou fin de période.
  const endsAt = sub?.cancelAt ?? (sub?.cancelAtPeriodEnd ? sub.currentPeriodEnd : null);
  const status = open
    ? sub.status === "past_due"
      ? t("status.pastDue", { plan: tierName })
      : endsAt
        ? t("status.ends", { plan: tierName, date: day(endsAt) })
        : sub.currentPeriodEnd
          ? t("status.renews", { interval: sub.interval, date: day(sub.currentPeriodEnd) })
          : null
    : fromLead
      ? fromLead.until
        ? t("status.lead", { plan: tPlan(fromLead.tier), date: day(fromLead.until) })
        : t("status.leadOpen", { plan: tPlan(fromLead.tier) })
      : inherited
        ? t("status.inherited", { app: inherited.app, plan: tierName, date: day(inherited.until) })
        : tier === "free"
          ? t("status.free")
          : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="max-w-3xl">
        <SettingsNav />
      </div>
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 max-w-3xl text-[15px] text-ink-muted">{t("subtitle")}</p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
          data-testid="plan-notice-status"
        >
          {notice}
        </p>
      ) : null}
      {q.error && ERRORS.includes(q.error) ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {/* Refus d'une formule déjà acquise sans abonnement pris ici (formule du Compte Lead) :
              rien à gérer au portail, la formule est simplement déjà là. */}
          {q.error === "already" && !open && acquired !== "free"
            ? t("errors.alreadyPlan", { plan: tPlan(acquired) })
            : t(`errors.${q.error}`)}
        </p>
      ) : null}

      <section
        className="mt-6 border border-line-strong bg-panel px-5 py-5 text-[14px]"
        data-testid="plan-current"
        data-tier={tier}
        data-source={open ? "own" : inherited ? "family" : tier === "free" ? "free" : "lead"}
        data-plan-current={planCode(tier)}
        data-plan-acquired={planCode(acquired)}
      >
        <p className="text-[16px] font-bold">{t("current", { plan: tierName })}</p>
        {status ? <p className="mt-1 text-ink-2">{status}</p> : null}
        {fromLead ? (
          <a
            href={LEAD_ACCOUNT_URL}
            className="mt-2 inline-block font-semibold text-accent-dark underline"
            data-testid="plan-lead-account"
          >
            {t("leadAccount")}
          </a>
        ) : null}
        {open && isAdmin && portalConfigured() ? (
          <form method="post" action="/api/billing/portal" className="mt-4">
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="secondary" data-testid="plan-portal">
              {t("manage")}
            </Button>
            <p className="mt-2 text-[12px] text-ink-muted">{t("manageHint")}</p>
          </form>
        ) : null}
        {!isAdmin ? (
          <p className="mt-3 text-[13px] text-ink-muted" data-testid="plan-admin-only">
            {t("adminOnly", { org: organization.name })}
          </p>
        ) : !billingConfigured() ? (
          <p className="mt-3 text-[13px] text-ink-muted" data-testid="plan-unavailable">
            {t("unavailable")}
          </p>
        ) : null}
      </section>

      <PlanChooser
        locale={locale}
        cards={cards}
        labels={{
          interval: t("interval"),
          monthly: t("monthly"),
          yearly: t("yearly"),
          perMonth: tp("monthly"),
          perYear: t("perYear"),
          current: t("currentBadge"),
        }}
      />
      <p className="mt-6 max-w-3xl text-[12px] text-ink-muted">{t("footer")}</p>
    </div>
  );
}
