"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type BillFormState, saveBillAction } from "@/app/[locale]/app/accounting/bills/actions";
import { FormSection, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { CURRENCIES } from "@/lib/currencies";

const VAT_CODES = ["normal", "reduced", "lodging", "exempt"];

/** Saisie ou correction d'une facture fournisseur en brouillon. */
export function BillForm({
  locale,
  id,
  initial,
  accounts,
  vatRegistered,
}: {
  locale: string;
  id?: string;
  initial: Record<string, string>;
  accounts: { id: string; label: string }[];
  vatRegistered: boolean;
}) {
  const t = useTranslations("app.bills");
  const tv = useTranslations("app.bank.vat");
  const [state, action, pending] = useActionState<BillFormState, FormData>(saveBillAction, {
    status: "idle",
    round: 0,
  });
  const v = state.values ?? initial;
  const err = (name: string) =>
    state.errors?.[name] ? t(`errors.${state.errors[name]}`) : undefined;
  return (
    <form key={state.round} action={action} className="mt-8 space-y-6" data-testid="bill-form">
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
      {state.status === "notFound" ? (
        <p
          role="alert"
          className="border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("notEditable")}
        </p>
      ) : null}
      <FormSection title={t("sections.supplier")}>
        <TextField
          id="bill-supplier"
          name="supplierName"
          label={t("fields.supplierName")}
          defaultValue={v.supplierName}
          error={err("supplierName")}
          wide
        />
        <TextField
          id="bill-street"
          name="supplierStreet"
          label={t("fields.supplierStreet")}
          defaultValue={v.supplierStreet}
        />
        <TextField
          id="bill-postal"
          name="supplierPostalCode"
          label={t("fields.supplierPostalCode")}
          defaultValue={v.supplierPostalCode}
        />
        <TextField
          id="bill-town"
          name="supplierTown"
          label={t("fields.supplierTown")}
          defaultValue={v.supplierTown}
        />
        <TextField
          id="bill-country"
          name="supplierCountry"
          label={t("fields.supplierCountry")}
          hint={t("hints.supplierCountry")}
          defaultValue={v.supplierCountry}
          error={err("supplierCountry")}
        />
      </FormSection>
      <FormSection title={t("sections.invoice")}>
        <TextField
          id="bill-number"
          name="number"
          label={t("fields.number")}
          defaultValue={v.number}
        />
        <TextField
          id="bill-issue"
          name="issueDate"
          type="date"
          label={t("fields.issueDate")}
          defaultValue={v.issueDate}
          error={err("issueDate")}
        />
        <TextField
          id="bill-due"
          name="dueDate"
          type="date"
          label={t("fields.dueDate")}
          hint={t("hints.dueDate")}
          defaultValue={v.dueDate}
          error={err("dueDate")}
        />
        <SelectField
          id="bill-currency"
          name="currency"
          label={t("fields.currency")}
          defaultValue={v.currency}
          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
        <TextField
          id="bill-total"
          name="total"
          label={t("fields.total")}
          hint={t("hints.total")}
          defaultValue={v.total}
          error={err("total")}
        />
        {vatRegistered ? (
          <SelectField
            id="bill-vat"
            name="vatCode"
            label={t("fields.vatCode")}
            defaultValue={v.vatCode}
            placeholder={t("noVat")}
            options={VAT_CODES.map((c) => ({ value: c, label: tv(c) }))}
          />
        ) : null}
        <SelectField
          id="bill-account"
          name="accountId"
          label={t("fields.account")}
          hint={t("hints.account")}
          defaultValue={v.accountId}
          placeholder={t("choose")}
          options={accounts.map((a) => ({ value: a.id, label: a.label }))}
          wide
        />
        <TextField
          id="bill-description"
          name="description"
          label={t("fields.description")}
          defaultValue={v.description}
          wide
        />
      </FormSection>
      <FormSection title={t("sections.payment")}>
        <TextField
          id="bill-iban"
          name="iban"
          label={t("fields.iban")}
          defaultValue={v.iban}
          error={err("iban")}
        />
        <TextField id="bill-bic" name="bic" label={t("fields.bic")} defaultValue={v.bic} />
        <TextField
          id="bill-reference"
          name="paymentReference"
          label={t("fields.paymentReference")}
          hint={t("hints.paymentReference")}
          defaultValue={v.paymentReference}
          wide
        />
      </FormSection>
      <Button type="submit" disabled={pending} data-testid="bill-save">
        {t("save")}
      </Button>
    </form>
  );
}
