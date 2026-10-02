"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { SecretState } from "@/app/[locale]/app/settings/api/actions";
import { createProjectLeadKeyAction } from "@/app/[locale]/app/settings/projectlead/actions";
import { Button } from "@/components/ui/button";
import { Revealed } from "./ApiForms";

/** « Créer la clé ProjectLead » : un clic, la clé s'affiche une seule fois, prête à coller. */
export function ProjectLeadKeyForm({ locale }: { locale: string }) {
  const t = useTranslations("app.projectLead");
  const [state, action, pending] = useActionState<SecretState, FormData>(
    createProjectLeadKeyAction,
    { round: 0 },
  );
  return (
    <form action={action} className="grid gap-3 p-5">
      <input type="hidden" name="locale" value={locale} />
      {state.secret ? (
        <Revealed label={t("key.created")} value={state.secret} testId="projectlead-key-secret" />
      ) : null}
      {state.error ? (
        <p role="alert" className="text-[13px] font-semibold text-hot-fg">
          {t(`key.errors.${state.error === "tooMany" ? "tooMany" : "invalid"}`)}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} data-testid="projectlead-key-create">
          {t("key.create")}
        </Button>
      </div>
    </form>
  );
}
