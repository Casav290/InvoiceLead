"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { addPaymentAction, type PaymentFormState } from "@/app/[locale]/app/invoices/actions";
import { SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

/** Saisie d'un paiement reçu ; montant proposé : le solde ouvert. */
export function PaymentForm({
  locale,
  invoiceId,
  initial,
  currency = "CHF",
  home = currency,
}: {
  locale: string;
  invoiceId: string;
  currency?: string;
  /** Monnaie de l'entreprise : une facture dans une autre devise demande le cours du jour. */
  home?: string;
  initial: Record<string, string>;
}) {
  const t = useTranslations("app.invoices.payments");
  const [state, action, pending] = useActionState<PaymentFormState, FormData>(addPaymentAction, {
    status: "idle",
    round: 0,
  });
  const values = state.values ?? initial;
  const err = (name: string) =>
    state.errors?.[name] ? t(`errors.${state.errors[name]}`) : undefined;
  return (
    <form
      key={state.round}
      action={action}
      className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-2"
      data-testid="payment-form"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={invoiceId} />
      {state.status === "tooHigh" ? (
        <p role="alert" className="text-[12px] font-semibold text-hot-fg sm:col-span-2">
          {t("tooHigh")}
        </p>
      ) : null}
      <TextField
        id="payment-date"
        name="paidOn"
        type="date"
        label={t("date")}
        defaultValue={values.paidOn}
        error={err("paidOn")}
      />
      <TextField
        id="payment-amount"
        name="amount"
        label={t("amount", { currency })}
        defaultValue={values.amount}
        error={err("amount")}
      />
      <SelectField
        id="payment-method"
        name="method"
        label={t("method")}
        defaultValue={values.method ?? "bank"}
        options={["bank", "cash", "other"].map((m) => ({ value: m, label: t(`methods.${m}`) }))}
      />
      <TextField
        id="payment-note"
        name="note"
        label={t("note")}
        defaultValue={values.note}
        error={err("note")}
      />
      {currency !== home ? (
        <TextField
          id="payment-fx"
          name="fxRate"
          label={t("fxRate", { currency, home })}
          hint={t("fxHint")}
          defaultValue={values.fxRate}
          error={err("fxRate")}
          wide
        />
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending} data-testid="payment-save">
          {t("add")}
        </Button>
      </div>
    </form>
  );
}
