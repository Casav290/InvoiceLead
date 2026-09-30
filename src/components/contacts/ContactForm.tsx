"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type ContactFormState, saveContact } from "@/app/[locale]/app/contacts/actions";
import { FormSection, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

const KINDS = ["company", "person"];
const LANGUAGES = ["de", "fr", "it", "en"];
const COUNTRIES = ["CH", "LI", "DE", "FR", "IT", "AT", "GB", "US"];

export function ContactForm({
  locale,
  id,
  initial,
}: {
  locale: string;
  id?: string;
  initial: Record<string, string>;
}) {
  const t = useTranslations("app.contacts");
  const [state, action, pending] = useActionState<ContactFormState, FormData>(saveContact, {
    status: "idle",
    round: 0,
  });
  const values = state.values ?? initial;
  const err = (name: string) => {
    const code = state.errors?.[name as keyof typeof state.errors];
    return code ? t(`errors.${code}`) : undefined;
  };
  const text = (
    name: string,
    extra: { type?: string; wide?: boolean; autoComplete?: string; multiline?: boolean } = {},
  ) => (
    <TextField
      id={`contact-${name}`}
      name={name}
      label={t(`fields.${name}`)}
      hint={t.has(`hints.${name}`) ? t(`hints.${name}`) : undefined}
      error={err(name)}
      defaultValue={values[name] ?? ""}
      {...extra}
    />
  );

  return (
    <form key={state.round} action={action} className="mt-8 space-y-6" data-testid="contact-form">
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
      {state.status === "planLimit" ? (
        <p
          role="alert"
          className="border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
          data-testid="plan-limit"
        >
          {t("planLimit")}
        </p>
      ) : null}

      <FormSection title={t("sections.identity")}>
        <SelectField
          id="contact-kind"
          name="kind"
          label={t("fields.kind")}
          defaultValue={values.kind}
          error={err("kind")}
          options={KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
        />
        {text("name", { autoComplete: "organization" })}
        {text("contactPerson")}
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-[13px] font-semibold">{t("fields.role")}</legend>
          <div className="flex flex-wrap gap-5">
            {(["isCustomer", "isSupplier"] as const).map((r) => (
              <label key={r} className="flex items-center gap-2 text-[14px]">
                <input
                  type="checkbox"
                  name={r}
                  defaultChecked={values[r] === "on"}
                  className="h-4 w-4 accent-accent"
                />
                {t(`fields.${r}`)}
              </label>
            ))}
          </div>
          {err("isCustomer") ? (
            <span className="mt-1 block text-[12px] font-semibold text-hot-fg">
              {err("isCustomer")}
            </span>
          ) : null}
        </fieldset>
        {text("uid")}
        {text("email", { type: "email", autoComplete: "email" })}
        {text("phone", { type: "tel", autoComplete: "tel" })}
      </FormSection>

      <FormSection title={t("sections.address")}>
        {text("street", { autoComplete: "address-line1" })}
        {text("buildingNumber")}
        {text("postalCode", { autoComplete: "postal-code" })}
        {text("town", { autoComplete: "address-level2" })}
        {text("region", { autoComplete: "address-level1" })}
        <SelectField
          id="contact-country"
          name="country"
          label={t("fields.country")}
          defaultValue={values.country}
          error={err("country")}
          options={COUNTRIES.map((c) => ({ value: c, label: t(`countries.${c}`) }))}
        />
      </FormSection>

      <FormSection title={t("sections.billing")}>
        <SelectField
          id="contact-language"
          name="language"
          label={t("fields.language")}
          defaultValue={values.language}
          error={err("language")}
          options={LANGUAGES.map((l) => ({ value: l, label: t(`languages.${l}`) }))}
        />
        {text("paymentTermDays", { type: "number" })}
        {text("notes", { wide: true, multiline: true })}
      </FormSection>

      <Button type="submit" disabled={pending} data-testid="contact-save">
        {t("save")}
      </Button>
    </form>
  );
}
