import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/app/PlanNotice";
import { Button } from "@/components/ui/button";
import { formatQuantity } from "@/lib/invoice-math";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { decodeHandoff, handoffTotalCents } from "@/server/crmlead";
import { upgradeUrl } from "@/server/plans";
import { can } from "@/server/roles";
import { importCrmleadAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ d?: string; error?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.crmImport" });
  return { title: t("title"), robots: { index: false } };
}

/** Relecture d'un lead gagné transmis par CRMlead, avant création du brouillon. */
export default async function CrmImportPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, membership } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.crmImport" });
  const tu = await getTranslations({ locale, namespace: "app.invoices.units" });
  const handoff = decodeHandoff(q.d);
  const allowed = can(membership, "billing");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {!handoff || q.error === "invalid" ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("invalid")}
        </p>
      ) : (
        <>
          {q.error === "contactLimit" ? (
            <PlanNotice
              locale={locale}
              message={t("contactLimit")}
              href={upgradeUrl(organization)}
            />
          ) : null}
          <section className="mt-6 border border-line-strong bg-panel" data-testid="crm-import">
            <div className="border-b border-line px-5 py-4">
              <p className="text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                {t(handoff.kind)}
              </p>
              <p className="mt-1 text-[18px] font-semibold [overflow-wrap:anywhere]">
                {handoff.lead.title || handoff.contact.name}
              </p>
              <p className="mt-1 text-[13px] text-ink-2 [overflow-wrap:anywhere]">
                {[
                  handoff.contact.name,
                  handoff.contact.contactPerson,
                  handoff.contact.email,
                  [handoff.contact.postalCode, handoff.contact.town].filter(Boolean).join(" "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <table className="w-full text-left text-[13px]">
              <tbody>
                {handoff.lines.map((l, i) => (
                  <tr key={`${i}-${l.description}`} className="border-b border-line-soft">
                    <td className="px-5 py-2 [overflow-wrap:anywhere]">{l.description}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                      {formatQuantity(Math.round(l.quantity * 1000))} {tu(l.unit)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums">
                      {formatAmount(Math.round(l.quantity * l.unitPriceCents))}
                    </td>
                  </tr>
                ))}
                <tr className="font-extrabold">
                  <td className="px-5 py-2" colSpan={2}>
                    {t("net")}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums" data-testid="crm-total">
                    {formatAmount(handoffTotalCents(handoff))}
                  </td>
                </tr>
              </tbody>
            </table>
            <form
              action={importCrmleadAction}
              className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4"
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="d" value={q.d} />
              <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                {allowed ? t("hint") : t("forbidden")}
              </p>
              <Button type="submit" disabled={!allowed} data-testid="crm-import-confirm">
                {t(handoff.kind === "quote" ? "createQuote" : "createInvoice")}
              </Button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
