import { useTranslations } from "next-intl";

/** Comptabilité pas encore disponible pour le pays de l'entreprise (pack pays sans comptabilité). */
export function AccountingUnavailable({ country }: { country: string }) {
  const t = useTranslations("app.accountingHome");
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <div
        className="border border-line-strong bg-panel px-5 py-5 text-[14px] text-ink-2"
        data-testid="accounting-unavailable"
      >
        <h1 className="text-[22px] leading-tight text-ink">{t("unavailableTitle")}</h1>
        <p className="mt-2">{t("unavailableBody", { country })}</p>
      </div>
    </div>
  );
}
