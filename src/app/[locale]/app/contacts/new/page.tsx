import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProLock } from "@/components/app/ProLock";
import { ContactForm } from "@/components/contacts/ContactForm";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import { lockFor } from "@/server/plan-lock";
import { quotaAccess } from "@/server/plans";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.contacts" });
  return { title: t("new"), robots: { index: false } };
}

export default async function NewContactPage({ params }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const t = await getTranslations({ locale, namespace: "app.contacts" });
  // Formule gratuite, 50 contacts atteints : le formulaire reste visible, grisé, avec la raison et
  // le lien de mise à niveau (adresse directe, favori, retour arrière).
  const live = await quotaAccess(db(), organization, "contacts");
  const lock = await lockFor(locale, organization, live, t("planLimit", { limit: live.limit }));
  const form = (
    <ContactForm
      locale={locale}
      initial={{
        kind: "company",
        isCustomer: "on",
        country: "CH",
        language: organization.defaultLocale,
        paymentTermDays: "30",
      }}
    />
  );
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("new")}</h1>
      {lock ? (
        <ProLock lock={lock} testId="contact-new-lock" className="mt-8">
          <div className="px-5 pb-6">{form}</div>
        </ProLock>
      ) : (
        form
      )}
    </div>
  );
}
