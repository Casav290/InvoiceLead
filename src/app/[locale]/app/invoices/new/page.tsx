import type { Metadata } from "next";
import { documentMetadata, NewDocumentPage } from "@/components/invoices/DocumentPages";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ contact?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return documentMetadata((await params).locale, "invoice", "new");
}

export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  const { contact } = await searchParams;
  return <NewDocumentPage locale={locale} kind="invoice" contact={contact} />;
}
