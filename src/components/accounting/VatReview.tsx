"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type ReviewState, reviewVatAction } from "@/app/[locale]/app/accounting/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Relecture du décompte par l'assistant, à la demande. */
export function VatReview({
  locale,
  start,
  end,
  className = "mt-6",
}: {
  locale: string;
  start: string;
  end: string;
  className?: string;
}) {
  const t = useTranslations("app.vat");
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewVatAction, {
    round: 0,
  });
  return (
    <section
      className={cn("border border-line-strong bg-panel px-5 py-4", className)}
      data-testid="vat-review"
    >
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="start" value={start} />
        <input type="hidden" name="end" value={end} />
        <p className="min-w-0 flex-1 text-[14px]">{t("reviewIntro")}</p>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={pending}
          data-testid="vat-review-run"
        >
          {pending ? t("reviewing") : t("review")}
        </Button>
      </form>
      {state.failed ? <p className="mt-3 text-[13px] text-hot-fg">{t("reviewFailed")}</p> : null}
      {state.plan ? <p className="mt-3 text-[13px] text-hot-fg">{t("errors.plan")}</p> : null}
      {state.points ? (
        state.points.length === 0 ? (
          <p className="mt-3 text-[13px] text-ok-fg" data-testid="vat-review-result">
            {t("reviewNothing")}
          </p>
        ) : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px]" data-testid="vat-review-result">
            {state.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
