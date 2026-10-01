import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { recordElsewhere } from "@/components/app/RecordElsewhere";
import { ContactForm } from "@/components/contacts/ContactForm";
import { Button } from "@/components/ui/button";
import { formatUid } from "@/lib/swiss-ids";
import { requireAppSession } from "@/server/auth/guard";
import { getContact } from "@/server/contacts";
import { db } from "@/server/db";
import { archiveContactAction } from "../actions";

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.contacts" });
  return { title: t("edit"), robots: { index: false } };
}

export default async function ContactPage({ params }: Props) {
  const { locale, id } = await params;
  const { organization, user } = await requireAppSession(locale);
  const contact = await getContact(db(), organization.id, id);
  if (!contact) {
    // Fiche d'une autre entreprise de la personne (fiduciaire) : proposer d'y passer, puis la même fiche.
    const elsewhere = await recordElsewhere({
      locale,
      userId: user.id,
      organizationId: organization.id,
      kind: "contact",
      id,
      next: `/${locale}/app/contacts/${id}`,
    });
    if (elsewhere) return elsewhere;
  }
  if (!contact || contact.archivedAt) notFound();
  const t = await getTranslations({ locale, namespace: "app.contacts" });
  const initial: Record<string, string> = {
    kind: contact.kind,
    isCustomer: contact.isCustomer ? "on" : "",
    isSupplier: contact.isSupplier ? "on" : "",
    name: contact.name,
    contactPerson: contact.contactPerson ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    street: contact.street ?? "",
    buildingNumber: contact.buildingNumber ?? "",
    postalCode: contact.postalCode ?? "",
    town: contact.town ?? "",
    country: contact.country,
    language: contact.language,
    uid: contact.uid ? (contact.uid.startsWith("CHE") ? formatUid(contact.uid) : contact.uid) : "",
    region: contact.region ?? "",
    paymentTermDays: String(contact.paymentTermDays),
    notes: contact.notes ?? "",
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{contact.name}</h1>
      <ContactForm locale={locale} id={contact.id} initial={initial} />
      <form action={archiveContactAction} className="mt-6">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="id" value={contact.id} />
        <Button type="submit" variant="ghost" data-testid="contact-archive">
          {t("archive")}
        </Button>
      </form>
    </div>
  );
}
