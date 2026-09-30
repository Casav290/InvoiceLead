import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppMark } from "@/components/brand/AppMark";
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { findSharedDocument } from "@/server/sharing";

type Props = { params: Promise<{ locale: string; token: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Consultation en ligne d'une pièce envoyée, sans compte : le lien suffit. */
export default async function SharedDocumentPage({ params }: Props) {
  const { locale, token } = await params;
  const found = await findSharedDocument(db(), token);
  if (!found) notFound();
  const t = await getTranslations({ locale, namespace: "shared" });
  return (
    <div className="flex min-h-screen flex-col bg-app">
      <header className="border-b border-line-strong bg-panel">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-8">
          <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold">
            {found.invoice.sender?.name}
          </span>
          <Button asChild size="sm">
            <a href={`/${locale}/d/${token}/pdf`} data-testid="shared-pdf">
              {t("download")}
            </a>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
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
