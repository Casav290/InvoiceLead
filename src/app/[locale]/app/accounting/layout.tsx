import { AccountingUnavailable } from "@/components/accounting/AccountingUnavailable";
import { countryPack } from "@/countries";
import { requireAppSession } from "@/server/auth/guard";
import { getSessionCountryTranslations } from "@/server/country-translations";

/** La comptabilité suit le pack pays : sans lui, un avis remplace les écrans. */
export default async function AccountingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  if (countryPack(organization.country).accounting) return children;
  const t = await getSessionCountryTranslations({ locale, namespace: "app.company.countries" });
  return <AccountingUnavailable country={t(countryPack(organization.country).code)} />;
}
