import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/** Écran commun de connexion et d'inscription : un seul bouton, vers le Compte Lead (LEAD-ID.md, étape 6). */
export function LeadLoginPanel({
  mode,
  locale,
  error,
  next,
  invite,
}: {
  mode: "login" | "signup";
  locale: string;
  error?: "lead" | "session";
  /** Page demandée avant la connexion : « Réessayer » y ramène. */
  next?: string;
  /** Invitation de fiduciaire en cours : « Réessayer » y ramène, avant toute autre page. */
  invite?: string;
}) {
  const t = useTranslations("auth");
  const back: Record<string, string> = invite ? { invite } : next ? { next } : {};
  return (
    <div className="mx-auto w-full max-w-[440px] border border-line-strong bg-panel">
      <div className="border-b border-line px-6 py-5">
        <h1 className="text-[24px] leading-tight">
          {mode === "login" ? t("loginTitle") : t("signupTitle")}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
          {mode === "login" ? t("loginSubtitle") : t("signupSubtitle")}
        </p>
      </div>
      <div className="space-y-4 px-6 py-6">
        {error ? (
          <p
            role="alert"
            className="border border-hot-fg bg-hot-bg px-3 py-2 text-[13px] text-hot-fg"
          >
            {t(`errors.${error}`)}
          </p>
        ) : null}
        <Button
          asChild
          variant="lead"
          size="lg"
          className="h-auto min-h-12 w-full px-4 py-3 text-center whitespace-normal sm:px-6"
        >
          <a
            href={`/auth/lead/start?${new URLSearchParams({ locale, ...(mode === "signup" ? { signup: "1" } : {}), ...back })}`}
            data-testid="lead-login"
          >
            {t("leadButton")}
          </a>
        </Button>
        {mode === "login" ? (
          <p className="text-[13px] text-ink-muted">{t("noAccountYet")}</p>
        ) : null}
      </div>
    </div>
  );
}
