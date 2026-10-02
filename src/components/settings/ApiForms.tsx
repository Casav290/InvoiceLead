"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  createApiKeyAction,
  createWebhookAction,
  type SecretState,
} from "@/app/[locale]/app/settings/api/actions";
import { Button } from "@/components/ui/button";

const fieldClass =
  "h-10 w-full border border-line-strong bg-panel px-3 text-[14px] text-ink aria-[invalid=true]:border-hot-fg";

/** Secret montré une seule fois après sa création. */
export function Revealed({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div
      role="status"
      className="border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg sm:col-span-2"
    >
      <p className="font-semibold">{label}</p>
      <span
        className="mt-2 block border border-line bg-panel px-3 py-2 text-[12px] break-all text-ink tabular-nums"
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}

export function ApiKeyForm({ locale }: { locale: string }) {
  const t = useTranslations("app.apiSettings");
  const [state, action, pending] = useActionState<SecretState, FormData>(createApiKeyAction, {
    round: 0,
  });
  return (
    <form action={action} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="locale" value={locale} />
      {state.secret ? (
        <Revealed label={t("keys.created")} value={state.secret} testId="api-key-secret" />
      ) : null}
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t("keys.name")}</span>
        <input
          key={state.round}
          name="name"
          maxLength={60}
          required
          aria-invalid={state.error ? true : undefined}
          className={fieldClass}
        />
        {state.error ? (
          <span className="mt-1 block text-[12px] font-semibold text-hot-fg">
            {t(`errors.${state.error}`)}
          </span>
        ) : null}
      </label>
      <Button type="submit" disabled={pending} data-testid="api-key-create">
        {t("keys.create")}
      </Button>
    </form>
  );
}

export function WebhookForm({ locale, events }: { locale: string; events: readonly string[] }) {
  const t = useTranslations("app.apiSettings");
  const [state, action, pending] = useActionState<SecretState, FormData>(createWebhookAction, {
    round: 0,
  });
  return (
    <form key={state.round} action={action} className="grid gap-3 p-5 sm:grid-cols-2">
      <input type="hidden" name="locale" value={locale} />
      {state.secret ? (
        <Revealed label={t("webhooks.created")} value={state.secret} testId="webhook-secret" />
      ) : null}
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-[13px] font-semibold">{t("webhooks.url")}</span>
        <input
          name="url"
          type="url"
          required
          placeholder="https://"
          aria-invalid={state.error ? true : undefined}
          className={fieldClass}
        />
        {state.error ? (
          <span className="mt-1 block text-[12px] font-semibold text-hot-fg">
            {t(`errors.${state.error}`)}
          </span>
        ) : null}
      </label>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-[13px] font-semibold">{t("webhooks.events")}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {events.map((e) => (
            <label key={e} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="events"
                value={e}
                defaultChecked
                className="h-4 w-4 accent-accent"
              />
              <span className="text-[12px]">{e}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending} data-testid="webhook-create">
          {t("webhooks.create")}
        </Button>
      </div>
    </form>
  );
}
