import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountingUnavailable } from "@/components/accounting/AccountingUnavailable";
import { fieldClass } from "@/components/forms/fields";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import {
  accountClass,
  CHART_TEMPLATES,
  templateForLegalForm,
} from "@/countries/ch/chart-of-accounts";
import { chartPack } from "@/countries/charts";
import { Link } from "@/i18n/navigation";
import { accountName } from "@/lib/account-name";
import { listAccounts } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { canSetUpAccounting } from "@/server/company";
import { db } from "@/server/db";
import type { Account } from "@/server/db/schema";
import { installChartAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; installed?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.accounts" });
  return { title: t("title"), robots: { index: false } };
}

export default async function AccountsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { user, organization } = await requireAppSession(locale);
  if (!countryPack(organization.country).accounting) {
    const tc = await getTranslations({ locale, namespace: "app.company.countries" });
    return (
      <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-8">
        <SettingsNav />
        <AccountingUnavailable country={tc(countryPack(organization.country).code)} />
      </div>
    );
  }
  const { saved, installed } = await searchParams;
  const editable = await canSetUpAccounting(db(), organization.id, user.id);
  const t = await getTranslations({ locale, namespace: "app.accounts" });
  const rows = await listAccounts(db(), organization.id);
  const byClass = new Map<string, Account[]>();
  for (const a of rows) {
    const c = accountClass(a.number);
    byClass.set(c, [...(byClass.get(c) ?? []), a]);
  }
  const name = (a: Account) => accountName(a, locale);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <SettingsNav />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        {editable && rows.length > 0 ? (
          <Button asChild>
            <Link href="/app/settings/accounts/new" data-testid="account-new">
              {t("new")}
            </Link>
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-[15px] text-ink-muted">
        {t(
          organization.country === "DE"
            ? "subtitleDe"
            : organization.country === "FR"
              ? "subtitleFr"
              : organization.country === "GB"
                ? "subtitleGb"
                : organization.country === "US"
                  ? "subtitleUs"
                  : "subtitle",
        )}
      </p>
      {saved || installed ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {installed ? t("installed") : t("saved")}
        </p>
      ) : null}
      {editable ? null : (
        <p className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2">
          {t("readOnly")}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="mt-8 border border-line-strong bg-panel px-5 py-6">
          <p className="text-[14px] text-ink-2">{t("empty")}</p>
          {editable ? (
            <form action={installChartAction} className="mt-5 flex flex-wrap items-end gap-3">
              <input type="hidden" name="locale" value={locale} />
              <div className="w-full max-w-md">
                <label htmlFor="chart-template" className="mb-1 block text-[13px] font-semibold">
                  {t("template")}
                </label>
                <select
                  id="chart-template"
                  name="template"
                  defaultValue={templateForLegalForm(organization.legalForm)}
                  className={fieldClass}
                >
                  {CHART_TEMPLATES.map((c) => (
                    <option key={c} value={c}>
                      {t(`templates.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" data-testid="chart-install">
                {t("install")}
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {[...byClass.entries()].map(([cls, list]) => (
            <section key={cls} className="border border-line-strong bg-panel">
              <h2 className="border-b border-line bg-head px-4 py-2.5 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                {t(`${chartPack(organization.country).classLabels}.${cls}`)}
              </h2>
              <table className="w-full table-fixed text-left text-[14px]">
                <thead className="sr-only">
                  <tr>
                    <th>{t("columns.number")}</th>
                    <th>{t("columns.name")}</th>
                    <th>{t("columns.type")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-line-soft last:border-b-0 hover:bg-rowhover"
                    >
                      <td className="w-16 px-4 py-2.5 align-top font-semibold tabular-nums">
                        {a.number}
                      </td>
                      <td className="px-2 py-2.5 align-top [overflow-wrap:anywhere]">
                        {editable ? (
                          <Link
                            href={`/app/settings/accounts/${a.id}`}
                            className="text-accent-dark hover:underline"
                          >
                            {name(a)}
                          </Link>
                        ) : (
                          name(a)
                        )}
                        {a.role ? (
                          <span className="ml-2 border border-line-strong px-1.5 text-[11px] font-semibold text-ink-muted">
                            {t("system")}
                          </span>
                        ) : null}
                        {a.active ? null : (
                          <span className="ml-2 border border-line-strong px-1.5 text-[11px] font-semibold text-ink-muted">
                            {t("inactive")}
                          </span>
                        )}
                      </td>
                      <td className="hidden w-36 px-4 py-2.5 align-top text-ink-2 sm:table-cell">
                        {t(`types.${a.type}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
