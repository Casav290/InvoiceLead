"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  type LinkState,
  type SendFormState,
  sendDocumentAction,
  shareLinkAction,
} from "@/app/[locale]/app/invoices/actions";
import { fieldClass, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

/** Envoi par e-mail d'une pièce émise, et lien de consultation à copier. */
export function SendPanel({
  locale,
  id,
  language,
  configured,
  sentInfo,
  defaults,
}: {
  locale: string;
  id: string;
  language: string;
  configured: boolean;
  sentInfo: string | null;
  defaults: { to: string; subject: string; message: string };
}) {
  const t = useTranslations("app.invoices.email");
  const [state, send, sending] = useActionState<SendFormState, FormData>(sendDocumentAction, {
    status: "idle",
    round: 0,
  });
  const [link, share, sharing] = useActionState<LinkState, FormData>(shareLinkAction, {
    round: 0,
  });
  const values = state.values ?? defaults;
  const err = (name: string) =>
    state.errors?.[name] ? t(`errors.${state.errors[name]}`) : undefined;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="language" value={language} />
    </>
  );
  return (
    <section className="mb-6 border border-line-strong bg-panel" data-testid="send-panel">
      <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
        {t("title")}
      </h2>
      {sentInfo ? (
        <p
          className="border-b border-line px-5 py-2 text-[13px] text-ink-2"
          data-testid="sent-info"
        >
          {sentInfo}
        </p>
      ) : null}
      {state.status === "sent" ? (
        <p
          role="status"
          className="mx-5 mt-4 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("sent")}
        </p>
      ) : null}
      {["notConfigured", "failed", "notFound"].includes(state.status) ? (
        <p
          role="alert"
          className="mx-5 mt-4 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`results.${state.status}`)}
        </p>
      ) : null}
      {configured ? (
        <form
          key={state.round}
          action={send}
          className="grid gap-4 px-5 py-4"
          data-testid="send-form"
        >
          {hidden}
          <TextField
            id="send-to"
            name="to"
            type="email"
            label={t("to")}
            defaultValue={values.to}
            error={err("to")}
          />
          <TextField
            id="send-subject"
            name="subject"
            label={t("subject")}
            defaultValue={values.subject}
            error={err("subject")}
          />
          <div>
            <label htmlFor="send-message" className="mb-1 block text-[13px] font-semibold">
              {t("message")}
            </label>
            <textarea
              id="send-message"
              name="message"
              rows={7}
              defaultValue={values.message}
              aria-describedby="send-message-hint"
              className={`${fieldClass} h-auto py-2`}
            />
            <span id="send-message-hint" className="mt-1 block text-[12px] text-ink-muted">
              {t("messageHint")}
            </span>
          </div>
          <div>
            <Button type="submit" disabled={sending} data-testid="send-submit">
              {t("send")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="px-5 py-4 text-[13px] text-ink-2">{t("notConfigured")}</p>
      )}
      <form
        action={share}
        className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4"
      >
        {hidden}
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={sharing}
          data-testid="share-link"
        >
          {t("link")}
        </Button>
        {link.url ? (
          <input
            readOnly
            value={link.url}
            aria-label={t("linkLabelField")}
            data-testid="share-url"
            onFocus={(e) => e.currentTarget.select()}
            className={`${fieldClass} min-w-0 flex-1`}
          />
        ) : (
          <span className="text-[12px] text-ink-muted">{t("linkHint")}</span>
        )}
      </form>
    </section>
  );
}
