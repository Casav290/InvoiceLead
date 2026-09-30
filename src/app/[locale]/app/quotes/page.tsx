import type { Metadata } from "next";
import { DocumentListPage, documentMetadata } from "@/components/invoices/DocumentPages";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ deleted?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return documentMetadata((await params).locale, "quote", "title");
}

export default async function Page({ params, searchParams }: Props) {
  const { locale } = await params;
  const { deleted } = await searchParams;
  return <DocumentListPage locale={locale} kind="quote" deleted={deleted} />;
}
