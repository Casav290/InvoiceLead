"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type InviteState, inviteFiduciaryAction } from "@/app/[locale]/app/settings/team/actions";
import { fieldClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

/** Invitation d'une fiduciaire : e-mail envoyé si possible, lien affiché une fois pour le transmettre. */
export function FiduciaryInvite({ locale, days }: { locale: string; days: number }) {
  const t = useTranslations("app.team");
  const [state, invite, pending] = useActionState<InviteState, FormData>(inviteFiduciaryAction, {
    round: 0,
  });
  return (
    <div className="border-t border-line px-5 py-4">
      <form action={invite} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="locale" value={locale} />
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[12px] font-semibold text-ink-2">
            {t("fiduciaryEmail")}
          </span>
          <input
            key={state.round}
            name="email"
            type="email"
            required
            autoComplete="off"
            className={fieldClass}
          />
        </label>
        <Button type="submit" disabled={pending} data-testid="fiduciary-invite">
          {t("invite")}
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="mt-3 text-[13px] text-hot-fg">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      {state.status === "invited" ? (
        <p role="status" className="mt-3 text-[13px] text-ok-fg">
          {t("invited", { email: state.email ?? "" })}
        </p>
      ) : null}
      {state.link ? (
        <div className="mt-3">
          <p className="text-[13px] text-ink-2">
            {t("inviteLink", { email: state.email ?? "", days })}
          </p>
          <input
            readOnly
            value={state.link}
            data-testid="invite-link"
            className={`${fieldClass} mt-1 font-mono text-[12px]`}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      ) : null}
    </div>
  );
}
