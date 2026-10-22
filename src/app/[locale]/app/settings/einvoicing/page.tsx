import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { isValidSiret, normalizeSiret } from "@/countries/fr/vat";
import { Link } from "@/i18n/navigation";
import { formatDate } from "@/lib/fiscal-year";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { b2brouterFromEnv } from "@/server/einvoicing/b2brouter";
import { getConnection, receptionState } from "@/server/einvoicing/reception";
import { can } from "@/server/roles";
import { registerReceptionAction, syncReceptionAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ registered?: string; received?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.einvoicing" });
  return { title: t("title"), robots: { index: false } };
}

/** Date (aaaa-mm-jj) ou heure (hh:mm) à l'heure de Paris. */
function paris(at: Date, part: "date" | "time"): string {
  return part === "date"
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(at)
    : new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
      }).format(at);
}

const ERRORS = [
  "consent",
  "unavailable",
  "notFrance",
  "siret",
  "alreadyElsewhere",
  "failed",
  "sync",
];

/**
 * Factures électroniques reçues (France) : inscription du SIREN à l'annuaire par la plateforme
 * agréée B2Brouter, puis état de la réception et dernier relevé.
 */
export default async function EinvoicingSettingsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.einvoicing" });
  const dates = countryPack(organization.country).dates;
  const today = new Date().toISOString().slice(0, 10);
  const editable = can(membership, "company");
  const available = b2brouterFromEnv() !== null;
  const connection = await getConnection(db(), organization.id);
  const state = receptionState(connection, today);
  const siret = normalizeSiret(organization.taxNumber ?? "");
  const siren = isValidSiret(siret) ? siret.slice(0, 9) : null;
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const heading =
    "border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase";
  const notice = q.registered
    ? t("registeredNotice")
    : q.received !== undefined && !q.error
      ? t("receivedNotice", { count: Number(q.received) || 0 })
      : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-3 text-[15px] text-ink-2">{t("subtitle")}</p>
      {notice ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {notice}
        </p>
      ) : null}
      {q.error && ERRORS.includes(q.error) ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
          data-testid="einvoicing-error"
        >
          {t(`errors.${q.error}`)}
        </p>
      ) : null}

      <section className="mt-8 border border-line-strong bg-panel" data-testid="einvoicing">
        <h2 className={heading}>{t("reception")}</h2>
        {organization.country !== "FR" ? (
          <p className="px-5 py-4 text-[13px] text-ink-2">{t("notFrance")}</p>
        ) : state === "active" || state === "scheduled" ? (
          <div className="px-5 py-4 text-[13px] text-ink-2" data-testid="einvoicing-state">
            <p className="font-semibold text-ink">
              {state === "active"
                ? t("active", { date: formatDate(connection?.startDate ?? today, dates) })
                : t("scheduled", { date: formatDate(connection?.startDate ?? today, dates) })}
            </p>
            <p className="mt-2">{t("how", { siren: connection?.siren ?? "" })}</p>
            <p className="mt-2 text-ink-muted">
              {connection?.lastSyncAt
                ? t("lastSync", {
                    date: formatDate(paris(connection.lastSyncAt, "date"), dates),
                    time: paris(connection.lastSyncAt, "time"),
                  })
                : t("neverSynced")}
              {connection?.lastError ? ` ${t("syncTrouble")}` : ""}
            </p>
            {state === "active" && available ? (
              <form action={syncReceptionAction} className="mt-4">
                {hidden}
                <Button type="submit" variant="secondary" data-testid="einvoicing-sync">
                  {t("syncNow")}
                </Button>
              </form>
            ) : null}
            <p className="mt-4">
              <Link
                href="/app/accounting/bills"
                className="font-semibold text-accent-dark underline"
              >
                {t("openBills")}
              </Link>
            </p>
          </div>
        ) : !available ? (
          <p className="px-5 py-4 text-[13px] text-ink-2" data-testid="einvoicing-soon">
            {t("soon")}
          </p>
        ) : !editable ? (
          <p className="px-5 py-4 text-[13px] text-ink-muted">{t("adminOnly")}</p>
        ) : !siren ? (
          <p className="px-5 py-4 text-[13px] text-ink-2">
            {t("needSiret")}{" "}
            <Link href="/app/settings/company" className="font-semibold text-accent-dark underline">
              {t("openCompany")}
            </Link>
          </p>
        ) : (
          <form action={registerReceptionAction} className="space-y-4 px-5 py-4 text-[13px]">
            {hidden}
            <ol className="list-decimal space-y-1 pl-5 text-ink-2">
              <li>{t("steps.register", { siren })}</li>
              <li>{t("steps.next")}</li>
              <li>{t("steps.bills")}</li>
            </ol>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="consent" required className="mt-0.5" />
              <span>{t("consent", { siren })}</span>
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">{t("migrationCode")}</span>
              <input
                name="migrationCode"
                maxLength={100}
                className="h-10 w-full max-w-xs border border-line-strong bg-panel px-3 text-[14px]"
              />
              <span className="mt-1 block text-[12px] text-ink-muted">{t("migrationHint")}</span>
            </label>
            <Button type="submit" data-testid="einvoicing-register">
              {state === "notRegistered" ? t("retry") : t("register")}
            </Button>
          </form>
        )}
      </section>
      <p className="mt-6 text-[12px] text-ink-muted">{t("footnote")}</p>
    </div>
  );
}
