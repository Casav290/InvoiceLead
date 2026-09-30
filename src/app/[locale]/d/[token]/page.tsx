import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppMark } from "@/components/brand/AppMark";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { organizations } from "@/server/db/schema";
import { invoiceBalance } from "@/server/payments";
import { findSharedDocument } from "@/server/sharing";
import { stripeConfigured } from "@/server/stripe";

type Props = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ paid?: string; payError?: string }>;
};

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Consultation en ligne d'une pièce envoyée, sans compte : le lien suffit. */
export default async function SharedDocumentPage({ params, searchParams }: Props) {
  const { locale, token } = await params;
  const q = await searchParams;
  const found = await findSharedDocument(db(), token);
  if (!found) notFound();
  const t = await getTranslations({ locale, namespace: "shared" });
  // Paiement en ligne : Stripe configuré, compte relié, facture avec un solde ouvert.
  const [org] = await db()
    .select({ account: organizations.stripeAccountId })
    .from(organizations)
    .where(eq(organizations.id, found.invoice.organizationId));
  const open =
    found.invoice.kind === "invoice"
      ? (await invoiceBalance(db(), found.invoice.id, found.invoice.totalCents)).openCents
      : 0;
  const payable = stripeConfigured() && !!org?.account && open > 0;
  return (
    <div className="flex min-h-screen flex-col bg-app">
      <header className="border-b border-line-strong bg-panel">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-8">
          <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold">
            {found.invoice.sender?.name}
          </span>
          {payable ? (
            <form action={`/${locale}/d/${token}/pay`} method="post">
              <Button type="submit" size="sm" data-testid="shared-pay">
                {t("pay")}
              </Button>
            </form>
          ) : null}
          <Button asChild size="sm" variant={payable ? "secondary" : "primary"}>
            <a href={`/${locale}/d/${token}/pdf`} data-testid="shared-pdf">
              {t("download")}
            </a>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
        {q.paid ? (
          <p
            role="status"
            className="mb-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
            data-testid="shared-paid"
          >
            {t("paid")}
          </p>
        ) : null}
        {q.payError ? (
          <p className="mb-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg">
            {t("payError")}
          </p>
        ) : null}
        <InvoiceDocument
          invoice={found.invoice}
          lines={found.lines}
          relatedNumber={found.related?.number}
        />
      </main>
      <footer className="flex items-center justify-center gap-2 py-6 text-[12px] text-ink-muted">
        <AppMark label="IL" />
        {t("poweredBy")}
      </footer>
    </div>
  );
}
