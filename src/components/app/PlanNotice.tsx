import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

/** Encart « réservé à Pro » : ce que la formule gratuite ne permet pas, et le lien pour passer à Pro. */
export async function PlanNotice({
  locale,
  message,
  href,
}: {
  locale: string;
  message: string;
  href: string;
}) {
  const t = await getTranslations({ locale, namespace: "app.plan" });
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-3 border border-accent bg-accent-veil px-5 py-4"
      data-testid="plan-notice"
    >
      <p className="min-w-0 flex-1 text-[14px] text-ink">{message}</p>
      <Button asChild size="sm">
        <a href={href} rel="noopener">
          {t("upgrade")}
        </a>
      </Button>
    </div>
  );
}
