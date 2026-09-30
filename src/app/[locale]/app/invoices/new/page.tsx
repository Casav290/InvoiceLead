import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { Link } from "@/i18n/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { invoiceOptions } from "@/server/invoice-options";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ contact?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  return { title: t("new"), robots: { index: false } };
}

export default async function NewInvoicePage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const { contact } = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.invoices" });
  const options = await invoiceOptions(db(), organization.id);
  const chosen = options.contacts.find((c) => c.id === contact);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("new")}</h1>
      {options.contacts.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-6 text-[14px] text-ink-2">
          {t("noCustomers")}{" "}
          <Link href="/app/contacts/new" className="font-semibold text-accent-dark underline">
            {t("addCustomer")}
          </Link>
        </p>
      ) : (
        <InvoiceForm
          locale={locale}
          contacts={options.contacts}
          products={options.products}
          vatRegistered={organization.vatRegistered}
          initial={{
            contactId: chosen?.id ?? "",
            language:
              chosen && (chosen.language === "de" || chosen.language === "fr")
                ? chosen.language
                : locale,
            issueDate: today,
            serviceDate: today,
          }}
        />
      )}
    </div>
  );
}
