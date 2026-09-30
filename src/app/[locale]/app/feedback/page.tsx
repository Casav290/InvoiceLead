import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { fieldClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { requireAppSession } from "@/server/auth/guard";
import { FEEDBACK_KINDS } from "@/server/feedback";
import { sendFeedbackAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; error?: string; from?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.feedback" });
  return { title: t("title"), robots: { index: false } };
}

export default async function FeedbackPage({ params, searchParams }: Props) {
  const { locale } = await params;
  await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.feedback" });
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {q.sent ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("sent")}
        </p>
      ) : null}
      {q.error ? (
        <p className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg">
          {t("invalid")}
        </p>
      ) : null}
      <form
        action={sendFeedbackAction}
        className="mt-6 space-y-4 border border-line-strong bg-panel px-5 py-5"
      >
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="page" value={q.from ?? ""} />
        <fieldset>
          <legend className="mb-2 text-[12px] font-semibold text-ink-2">{t("kind")}</legend>
          <div className="flex flex-wrap gap-4">
            {FEEDBACK_KINDS.map((k, i) => (
              <label key={k} className="flex items-center gap-2 text-[14px]">
                <input type="radio" name="kind" value={k} defaultChecked={i === 0} />
                {t(`kinds.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink-2">{t("message")}</span>
          <textarea
            name="message"
            required
            minLength={3}
            maxLength={5000}
            rows={6}
            className={`${fieldClass} h-auto py-2`}
          />
        </label>
        <Button type="submit" data-testid="feedback-send">
          {t("send")}
        </Button>
      </form>
    </div>
  );
}
