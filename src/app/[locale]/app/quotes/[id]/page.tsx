import type { Metadata } from "next";
import { DocumentDetailPage, documentMetadata } from "@/components/invoices/DocumentPages";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; issued?: string; error?: string; converted?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return documentMetadata((await params).locale, "quote", "edit");
}

export default async function Page({ params, searchParams }: Props) {
  const { locale, id } = await params;
  return <DocumentDetailPage locale={locale} kind="quote" id={id} query={await searchParams} />;
}
