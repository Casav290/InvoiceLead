"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type AccountFormState, saveAccount } from "@/app/[locale]/app/settings/accounts/actions";
import { FormSection, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

const TYPES = ["asset", "liability", "equity", "revenue", "expense", "closing"];
const VAT_CODES = ["normal", "reduced", "lodging", "exempt", "export"];

export function AccountForm({
  locale,
  id,
  initial,
  system = false,
}: {
  locale: string;
  id?: string;
  initial: Record<string, string>;
  system?: boolean;
}) {
  const t = useTranslations("app.accounts");
  const [state, action, pending] = useActionState<AccountFormState, FormData>(saveAccount, {
    status: "idle",
    round: 0,
  });
  const values = state.values ?? initial;
  const err = (name: string) => {
    const code = state.errors?.[name as keyof typeof state.errors];
    return code ? t(`errors.${code}`) : undefined;
  };
  const activeError = err("active");
  return (
    <form key={state.round} action={action} className="mt-8 space-y-6" data-testid="account-form">
      <input type="hidden" name="locale" value={locale} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {state.status === "invalid" ? (
        <p
          role="alert"
          className="border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("invalid")}
        </p>
      ) : null}
      {state.status === "forbidden" ? (
        <p
          role="alert"
          className="border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("readOnly")}
        </p>
      ) : null}
      <FormSection title={t("sections.account")}>
        <TextField
          id="account-number"
          name="number"
          label={t("fields.number")}
          hint={t("hints.number")}
          defaultValue={values.number}
          error={err("number")}
        />
        <SelectField
          id="account-type"
          name="type"
          label={t("fields.type")}
          defaultValue={values.type}
          error={err("type")}
          placeholder=""
          options={TYPES.map((v) => ({ value: v, label: t(`types.${v}`) }))}
        />
        <TextField
          id="account-name-de"
          name="nameDe"
          label={t("fields.nameDe")}
          hint={t("hints.nameDe")}
          defaultValue={values.nameDe}
          error={err("nameDe")}
          wide
        />
        <TextField
          id="account-name-fr"
          name="nameFr"
          label={t("fields.nameFr")}
          defaultValue={values.nameFr}
          error={err("nameFr")}
          wide
        />
        <TextField
          id="account-name-en"
          name="nameEn"
          label={t("fields.nameEn")}
          defaultValue={values.nameEn}
          error={err("nameEn")}
          wide
        />
      </FormSection>
      <FormSection title={t("sections.options")}>
        <SelectField
          id="account-vat"
          name="vatCode"
          label={t("fields.vatCode")}
          defaultValue={values.vatCode}
          error={err("vatCode")}
          placeholder={t("noVat")}
          options={VAT_CODES.map((v) => ({ value: v, label: t(`vatCodes.${v}`) }))}
        />
        <div className="self-end">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              name="active"
              defaultChecked={values.active === "on"}
              disabled={system}
              aria-describedby={activeError ? "account-active-error" : undefined}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-[14px] font-semibold">{t("fields.active")}</span>
          </label>
          {/* Une case désactivée n'est pas envoyée : un compte système reste coché côté serveur. */}
          {system ? <input type="hidden" name="active" value="on" /> : null}
          {activeError ? (
            <span
              id="account-active-error"
              className="mt-1 block text-[12px] font-semibold text-hot-fg"
            >
              {activeError}
            </span>
          ) : null}
        </div>
      </FormSection>
      <Button type="submit" disabled={pending} data-testid="account-save">
        {t("save")}
      </Button>
    </form>
  );
}
