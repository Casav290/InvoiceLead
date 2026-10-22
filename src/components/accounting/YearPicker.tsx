import { Button } from "@/components/ui/button";
import { type DateStyle, formatDate } from "@/lib/fiscal-year";
import { getSessionCountryTranslations } from "@/server/country-translations";
import type { FiscalYear } from "@/server/db/schema";

/** Choix de l'exercice affiché (formulaire GET, sans JavaScript). */
export async function YearPicker({
  locale,
  years,
  selected,
  dates,
}: {
  locale: string;
  years: FiscalYear[];
  selected?: string;
  /** Format des dates du pays de l'entreprise. */
  dates: DateStyle;
}) {
  if (years.length < 2) return null;
  const t = await getSessionCountryTranslations({ locale, namespace: "app.accountingHome" });
  return (
    <form className="flex max-w-full flex-wrap items-center gap-2">
      <label htmlFor="report-year" className="text-[13px] font-semibold">
        {t("year")}
      </label>
      <select
        id="report-year"
        name="year"
        defaultValue={selected}
        className="h-9 max-w-full min-w-0 border border-line-strong bg-panel px-2 text-[13px]"
      >
        {years.map((y) => (
          <option key={y.id} value={y.id}>
            {formatDate(y.startDate, dates)} – {formatDate(y.endDate, dates)}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" size="sm">
        {t("show")}
      </Button>
    </form>
  );
}
