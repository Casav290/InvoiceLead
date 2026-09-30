import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatQuantity } from "@/lib/invoice-math";
import { formatAmount } from "@/lib/money";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { invoiceOptions } from "@/server/invoice-options";
import { getInvoice } from "@/server/invoices";
import { deleteDraftAction, issueInvoiceAction } from "../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; issued?: string; error?: string }>;
};

const ERRORS = ["companyIncomplete", "vatChanged", "notDraft", "notFound"];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  return { title: t("edit"), robots: { index: false } };
}

export default async function InvoicePage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  const { organization } = await requireAppSession(locale);
  const { saved, issued, error } = await searchParams;
  const found = await getInvoice(db(), organization.id, id);
  if (!found) notFound();
  const { invoice, lines } = found;
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  const draft = invoice.status === "draft";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <p className="text-[13px]">
        <Link href="/app/invoices" className="font-semibold text-accent-dark hover:underline">
          {t("back")}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] leading-tight">
          {draft ? t("draftTitle") : t("issuedTitle", { number: invoice.number ?? "" })}
        </h1>
        <span
          data-testid="invoice-status"
          className="border border-line-strong px-2 py-0.5 text-[12px] font-semibold text-ink-2"
        >
          {t(`status.${invoice.status}`)}
        </span>
      </div>
      {saved || issued ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {issued ? t("issued") : t("saved")}
        </p>
      ) : null}
      {error && ERRORS.includes(error) ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`issueErrors.${error}`)}
          {error === "companyIncomplete" ? (
            <>
              {" "}
              <Link href="/app/settings/company" className="font-semibold underline">
                {t("completeCompany")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {draft ? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3 border border-line-strong bg-panel px-5 py-4">
            <form action={issueInvoiceAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="id" value={invoice.id} />
              <Button type="submit" data-testid="invoice-issue">
                {t("issue")}
              </Button>
            </form>
            <p className="flex-1 text-[13px] text-ink-muted">{t("issueHint")}</p>
          </div>
          <InvoiceForm
            locale={locale}
            id={invoice.id}
            vatRegistered={organization.vatRegistered}
            {...(await invoiceOptions(db(), organization.id))}
            initial={{
              contactId: invoice.contactId,
              language: invoice.language,
              title: invoice.title ?? "",
              introText: invoice.introText ?? "",
              footerText: invoice.footerText ?? "",
              issueDate: invoice.issueDate,
              serviceDate: invoice.serviceDate,
              dueDate: invoice.dueDate,
              "line.productId": lines.map((l) => l.productId ?? ""),
              "line.description": lines.map((l) => l.description),
              "line.quantity": lines.map((l) => formatQuantity(l.quantityMilli)),
              "line.unit": lines.map((l) => l.unit),
              "line.unitPrice": lines.map((l) => formatAmount(l.unitPriceCents)),
              "line.vatCode": lines.map((l) => l.vatCode ?? "normal"),
            }}
          />
          <form action={deleteDraftAction} className="mt-6">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={invoice.id} />
            <Button type="submit" variant="ghost" data-testid="invoice-delete">
              {t("deleteDraft")}
            </Button>
          </form>
        </>
      ) : (
        <div className="mt-6">
          <p className="mb-4">
            <Button asChild>
              <a href={`/${locale}/app/invoices/${invoice.id}/pdf`} data-testid="invoice-pdf">
                {t("download")}
              </a>
            </Button>
          </p>
          <InvoiceDocument invoice={invoice} lines={lines} />
        </div>
      )}
    </div>
  );
}
