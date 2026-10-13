import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { type PlanCard, PlanChooser } from "@/components/settings/PlanChooser";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/fiscal-year";
import { AVAILABLE, PRICE_CARDS } from "@/lib/pricing";
import { requireAppSession } from "@/server/auth/guard";
import {
  BillingError,
  billingConfigured,
  GRANTING,
  portalConfigured,
} from "@/server/billing/stripe";
import { subscriptionOf, syncCheckoutSession } from "@/server/billing/subscriptions";
import { db } from "@/server/db";
import { billingTier, tierOf } from "@/server/plans";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    plan?: string;
    checkout?: string;
    session_id?: string;
    error?: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.billing" });
  return { title: t("title"), robots: { index: false } };
}

const ERRORS = ["admin", "unavailable", "invalid", "already", "stripe", "noCustomer"];
const day = (d: Date | string) => formatDate(new Date(d).toISOString().slice(0, 10));

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
 */
export default async function PlanSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const q = await searchParams;
  const { organization, membership } = await requireAppSession(locale);
  const isAdmin = membership.role === "admin";

  // Retour du paiement : l'abonnement est relu chez Stripe et enregistré tout de suite, sans
  // attendre le webhook ; puis la page se recharge (en-tête compris) sur la formule à jour.
  if (q.checkout === "success" && q.session_id && billingConfigured()) {
    const result = await syncCheckoutSession(db(), organization.id, q.session_id).catch((e) => {
      console.error("[billing] retour du paiement", e instanceof BillingError ? e.code : e);
      return "pending" as const;
    });
    redirect(
      `/${locale}/app/settings/plan?checkout=${result === "applied" || result === "duplicate" ? "done" : "pending"}`,
    );
  }

  const t = await getTranslations({ locale, namespace: "app.billing" });
  const tp = await getTranslations({ locale, namespace: "pricing" });
  const tPlan = await getTranslations({ locale, namespace: "app.plan" });
  const tier = tierOf(organization);
  const own = billingTier(organization);
  const sub = await subscriptionOf(db(), organization.id);
  const open = !!sub && (GRANTING as readonly string[]).includes(sub.status);
  const inherited = own === "free" ? inheritedOf(organization.entitlements) : null;
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
      action:
        canBuy && card.plan ? tPlan(card.plan === "pro_plus" ? "upgradePlus" : "upgrade") : null,
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
          {t(`errors.${q.error}`)}
        </p>
      ) : null}

      <section
        className="mt-6 border border-line-strong bg-panel px-5 py-5 text-[14px]"
        data-testid="plan-current"
        data-tier={tier}
        data-source={open ? "own" : inherited ? "family" : tier === "free" ? "free" : "lead"}
      >
        <p className="text-[16px] font-bold">{t("current", { plan: tierName })}</p>
        {status ? <p className="mt-1 text-ink-2">{status}</p> : null}
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
