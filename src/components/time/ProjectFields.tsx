import { getSessionCountryTranslations } from "@/server/country-translations";

const field = "h-10 w-full border border-line-strong bg-panel px-3 text-[14px]";

/** Champs d'un projet : client, nom, tarif horaire, budget. */
export async function ProjectFields({
  locale,
  customers,
  currency,
  country,
  values = {},
}: {
  locale: string;
  customers: { id: string; name: string }[];
  currency: string;
  /** Pays de l'entreprise : sales tax aux États-Unis, USt en Allemagne dans le libellé du tarif. */
  country?: string;
  values?: { contactId?: string; name?: string; hourlyRate?: string; budgetHours?: string };
}) {
  const t = await getSessionCountryTranslations({ locale, namespace: "app.time" });
  return (
    <>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t("projectName")}</span>
        <input name="name" required maxLength={120} defaultValue={values.name} className={field} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t("customer")}</span>
        <select name="contactId" required defaultValue={values.contactId} className={field}>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">
          {t(country === "US" ? "hourlyRateUs" : country === "DE" ? "hourlyRateDe" : "hourlyRate", {
            currency,
          })}
        </span>
        <input
          name="hourlyRate"
          inputMode="decimal"
          defaultValue={values.hourlyRate}
          className={field}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t("budgetHours")}</span>
        <input
          name="budgetHours"
          inputMode="decimal"
          defaultValue={values.budgetHours}
          className={field}
        />
      </label>
    </>
  );
}
