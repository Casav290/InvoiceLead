import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/fiscal-year";
import type { FiscalYear } from "@/server/db/schema";

/** Choix de l'exercice affiché (formulaire GET, sans JavaScript). */
export async function YearPicker({
  locale,
  years,
  selected,
}: {
  locale: string;
  years: FiscalYear[];
  selected?: string;
}) {
  if (years.length < 2) return null;
  const t = await getTranslations({ locale, namespace: "app.accountingHome" });
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
            {formatDate(y.startDate)} – {formatDate(y.endDate)}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" size="sm">
        {t("show")}
      </Button>
    </form>
  );
}
