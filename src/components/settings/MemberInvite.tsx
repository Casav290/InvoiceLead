"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  inviteMemberAction,
  type MemberInviteState,
} from "@/app/[locale]/app/settings/team/actions";
import { fieldClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

/** Ajout d'une personne à l'entreprise : le Compte Lead lui envoie l'invitation au nom d'InvoiceLead. */
export function MemberInvite({ locale }: { locale: string }) {
  const t = useTranslations("app.team.memberInvite");
  const [state, invite, pending] = useActionState<MemberInviteState, FormData>(inviteMemberAction, {
    round: 0,
  });
  return (
    <div className="border-t border-line px-5 py-4" data-testid="member-invite">
      <p className="text-[13px] font-semibold text-ink">{t("title")}</p>
      <p className="mt-1 text-[13px] text-ink-muted">{t("hint")}</p>
      <form action={invite} className="mt-3 flex flex-wrap items-end gap-3">
        <input type="hidden" name="locale" value={locale} />
        <label className="min-w-0 flex-1 basis-48">
          <span className="mb-1 block text-[12px] font-semibold text-ink-2">{t("name")}</span>
          <input
            key={`n${state.round}`}
            name="name"
            required
            maxLength={120}
            autoComplete="off"
            defaultValue={state.error ? state.name : ""}
            className={fieldClass}
          />
        </label>
        <label className="min-w-0 flex-1 basis-56">
          <span className="mb-1 block text-[12px] font-semibold text-ink-2">{t("email")}</span>
          <input
            key={`e${state.round}`}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="off"
            defaultValue={state.error ? state.email : ""}
            className={fieldClass}
          />
        </label>
        <Button type="submit" disabled={pending} data-testid="member-invite-submit">
          {t("submit")}
        </Button>
      </form>
      {state.error ? (
        <div role="alert" className="mt-3 text-[13px] text-hot-fg">
          <p>{t(`errors.${state.error}`)}</p>
          {state.error === "seatLimit" && state.upgrade ? (
            <a href={state.upgrade} rel="noopener" className="mt-1 inline-block underline">
              {t("upgrade")}
            </a>
          ) : null}
        </div>
      ) : null}
      {state.status ? (
        <p role="status" className="mt-3 text-[13px] text-ok-fg">
          {t(state.status === "resent" ? "resent" : "sent", { email: state.email ?? "" })}
        </p>
      ) : null}
    </div>
  );
}
