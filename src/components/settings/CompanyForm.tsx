"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type CompanyFormState, saveCompany } from "@/app/[locale]/app/settings/company/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LEGAL_FORMS = ["sole_proprietorship", "gmbh", "ag", "partnership", "association", "other"];
const VAT_METHODS = ["effective", "net_tax_rate"];
const VAT_SETTLEMENTS = ["agreed", "received"];
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));

const fieldClass =
  "h-10 w-full border border-line-strong bg-panel px-3 text-[14px] text-ink disabled:bg-muted disabled:text-ink-muted aria-[invalid=true]:border-hot-fg";

export function CompanyForm({
  locale,
  initial,
  editable,
}: {
  locale: string;
  initial: Record<string, string>;
  editable: boolean;
}) {
  const t = useTranslations("app.company");
  const [state, action, pending] = useActionState<CompanyFormState, FormData>(saveCompany, {
    status: "idle",
    round: 0,
  });
  const values = state.values ?? initial;
  const error = (name: string) => state.errors?.[name as keyof typeof state.errors];

  const field = ({
    name,
    type = "text",
    wide = false,
    autoComplete,
  }: {
    name: string;
    type?: string;
    wide?: boolean;
    autoComplete?: string;
  }) => {
    const code = error(name);
    const hint = t.has(`hints.${name}`);
    const describedBy = [hint ? `${name}-hint` : null, code ? `${name}-error` : null]
      .filter(Boolean)
      .join(" ");
    return (
      <div className={cn("block", wide && "sm:col-span-2")}>
        <label htmlFor={`company-${name}`} className="mb-1 block text-[13px] font-semibold">
          {t(`fields.${name}`)}
        </label>
        <input
          id={`company-${name}`}
          name={name}
          type={type}
          autoComplete={autoComplete}
          defaultValue={values[name] ?? ""}
          disabled={!editable}
          aria-invalid={code ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={fieldClass}
        />
        {hint ? (
          <span id={`${name}-hint`} className="mt-1 block text-[12px] text-ink-muted">
            {t(`hints.${name}`)}
          </span>
        ) : null}
        {code ? (
          <span id={`${name}-error`} className="mt-1 block text-[12px] font-semibold text-hot-fg">
            {t(`errors.${code}`)}
          </span>
        ) : null}
      </div>
    );
  };

  const select = ({
    name,
    options,
    prefix,
  }: {
    name: string;
    options: string[];
    prefix: string;
  }) => {
    const code = error(name);
    return (
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t(`fields.${name}`)}</span>
        <select
          name={name}
          defaultValue={values[name] ?? ""}
          disabled={!editable}
          aria-invalid={code ? true : undefined}
          className={fieldClass}
        >
          <option value="">{t("choose")}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {t(`${prefix}.${o}`)}
            </option>
          ))}
        </select>
        {code ? (
          <span className="mt-1 block text-[12px] font-semibold text-hot-fg">
            {t(`errors.${code}`)}
          </span>
        ) : null}
      </label>
    );
  };

  const section = (title: string, children: React.ReactNode) => (
    <section className="border border-line-strong bg-panel">
      <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
        {title}
      </h2>
      <div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div>
    </section>
  );

  return (
    <form key={state.round} action={action} className="mt-8 space-y-6" data-testid="company-form">
      <input type="hidden" name="locale" value={locale} />
      {state.status === "saved" ? (
        <p role="status" className="border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg">
          {t("saved")}
        </p>
      ) : null}
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

      {section(
        t("sections.identity"),
        <>
          {field({ name: "legalName", wide: true, autoComplete: "organization" })}
          {select({ name: "legalForm", options: LEGAL_FORMS, prefix: "legalForms" })}
          {field({ name: "uid" })}
        </>,
      )}

      {section(
        t("sections.address"),
        <>
          {field({ name: "street", autoComplete: "address-line1" })}
          {field({ name: "buildingNumber" })}
          {field({ name: "postalCode", autoComplete: "postal-code" })}
          {field({ name: "town", autoComplete: "address-level2" })}
          {field({ name: "email", type: "email", autoComplete: "email" })}
          {field({ name: "phone", type: "tel", autoComplete: "tel" })}
          {field({ name: "website", type: "url", wide: true, autoComplete: "url" })}
        </>,
      )}

      {section(
        t("sections.vat"),
        <>
          <label className="flex items-center gap-3 sm:col-span-2">
            <input
              type="checkbox"
              name="vatRegistered"
              defaultChecked={values.vatRegistered === "on"}
              disabled={!editable}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-[14px] font-semibold">{t("fields.vatRegistered")}</span>
          </label>
          {select({ name: "vatMethod", options: VAT_METHODS, prefix: "vatMethods" })}
          {select({ name: "vatSettlement", options: VAT_SETTLEMENTS, prefix: "vatSettlements" })}
        </>,
      )}

      {section(
        t("sections.bank"),
        <>
          {field({ name: "iban" })}
          {field({ name: "qrIban" })}
        </>,
      )}

      {section(
        t("sections.fiscalYear"),
        select({ name: "fiscalYearStartMonth", options: MONTHS, prefix: "months" }),
      )}

      {editable ? (
        <Button type="submit" disabled={pending} data-testid="company-save">
          {t("save")}
        </Button>
      ) : null}
    </form>
  );
}
