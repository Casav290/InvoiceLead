import { getTranslations } from "next-intl/server";
import { ProBadge } from "@/components/app/ProLock";
import { Button } from "@/components/ui/button";

/**
 * Encart d'une page réservée à une formule : ce que la formule actuelle ne permet pas, la marque de
 * la formule qui l'ouvre, et le lien pour y passer. Les commandes elles-mêmes restent visibles,
 * grisées (ProLock).
 */
export async function PlanNotice({
  locale,
  message,
  href,
  tier = "pro",
}: {
  locale: string;
  message: string;
  href: string;
  tier?: "pro" | "proplus";
}) {
  const t = await getTranslations({ locale, namespace: "app.plan" });
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-3 border border-accent bg-accent-veil px-5 py-4"
      data-testid="plan-notice"
    >
      <ProBadge tier={tier} />
      <p className="min-w-0 flex-1 text-[14px] text-ink">{message}</p>
      <Button asChild size="sm">
        <a href={href} rel="noopener">
          {t(tier === "proplus" ? "upgradePlus" : "upgrade")}
        </a>
      </Button>
    </div>
  );
}
