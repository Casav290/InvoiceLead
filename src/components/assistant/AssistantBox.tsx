"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef } from "react";
import { type AssistantState, askAction } from "@/app/[locale]/app/assistant/actions";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const LINKS: Record<string, string> = {
  invoices: "/app/invoices",
  reminders: "/app/invoices/reminders",
  bank: "/app/accounting/bank",
  review: "/app/accounting/review",
  bills: "/app/accounting/bills",
  reports: "/app/accounting/reports",
  vat: "/app/accounting/vat",
  time: "/app/time/projects",
};

/** Question en langage naturel sur sa comptabilité, réponse tirée des chiffres des livres. */
export function AssistantBox({ locale, suggestions }: { locale: string; suggestions: string[] }) {
  const t = useTranslations("app.assistant");
  const [state, action, pending] = useActionState<AssistantState, FormData>(askAction, {
    round: 0,
  });
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="mt-6 space-y-4">
      <form
        action={action}
        className="border border-line-strong bg-panel p-5"
        data-testid="assistant-form"
      >
        <input type="hidden" name="locale" value={locale} />
        <label htmlFor="assistant-question" className="mb-1 block text-[13px] font-semibold">
          {t("question")}
        </label>
        <textarea
          ref={input}
          id="assistant-question"
          name="question"
          rows={2}
          maxLength={500}
          required
          defaultValue={state.question}
          className="w-full border border-line-strong bg-panel px-3 py-2 text-[14px]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending} data-testid="assistant-ask">
            {pending ? t("thinking") : t("ask")}
          </Button>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="border border-line-strong px-2.5 py-1 text-[12px] text-ink-2 hover:bg-rowhover"
              onClick={() => {
                if (input.current) input.current.value = s;
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </form>
      {state.error ? (
        <p
          role="alert"
          className="border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {state.result ? (
        <section
          className="border border-line-strong bg-panel"
          data-testid="assistant-answer"
          aria-live="polite"
        >
          <p className="px-5 py-4 text-[14px] whitespace-pre-line">{state.result.answer}</p>
          {state.result.links.length > 0 ? (
            <div className="flex flex-wrap gap-3 border-t border-line px-5 py-3 text-[13px]">
              {state.result.links.map((l) => (
                <Link
                  key={l}
                  href={LINKS[l] ?? "/app"}
                  className="font-semibold text-accent-dark hover:underline"
                >
                  {t(`links.${l}`)}
                </Link>
              ))}
            </div>
          ) : null}
          <p className="border-t border-line px-5 py-2 text-[11px] text-ink-muted">
            {t("disclaimer")}
          </p>
        </section>
      ) : null}
    </div>
  );
}
