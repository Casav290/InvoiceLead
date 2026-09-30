"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type ProductFormState, saveProduct } from "@/app/[locale]/app/products/actions";
import { FormSection, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

const UNITS = ["hour", "day", "piece", "flat", "km", "month"];
const VAT_CODES = ["normal", "reduced", "lodging", "exempt", "export"];

export function ProductForm({
  locale,
  id,
  initial,
}: {
  locale: string;
  id?: string;
  initial: Record<string, string>;
}) {
  const t = useTranslations("app.products");
  const [state, action, pending] = useActionState<ProductFormState, FormData>(saveProduct, {
    status: "idle",
    round: 0,
  });
  const values = state.values ?? initial;
  const err = (name: string) => {
    const code = state.errors?.[name as keyof typeof state.errors];
    return code ? t(`errors.${code}`) : undefined;
  };
  return (
    <form key={state.round} action={action} className="mt-8 space-y-6" data-testid="product-form">
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
      <FormSection title={t("sections.product")}>
        <TextField
          id="product-name"
          name="name"
          label={t("fields.name")}
          defaultValue={values.name}
          error={err("name")}
          wide
        />
        <TextField
          id="product-sku"
          name="sku"
          label={t("fields.sku")}
          defaultValue={values.sku}
          error={err("sku")}
        />
        <SelectField
          id="product-unit"
          name="unit"
          label={t("fields.unit")}
          defaultValue={values.unit}
          error={err("unit")}
          options={UNITS.map((u) => ({ value: u, label: t(`units.${u}`) }))}
        />
        <TextField
          id="product-description"
          name="description"
          label={t("fields.description")}
          defaultValue={values.description}
          wide
          multiline
        />
      </FormSection>
      <FormSection title={t("sections.price")}>
        <TextField
          id="product-price"
          name="unitPrice"
          label={t("fields.unitPrice")}
          hint={t("hints.unitPrice")}
          defaultValue={values.unitPrice}
          error={err("unitPriceCents")}
        />
        <SelectField
          id="product-vat"
          name="vatCode"
          label={t("fields.vatCode")}
          defaultValue={values.vatCode}
          error={err("vatCode")}
          options={VAT_CODES.map((v) => ({ value: v, label: t(`vatCodes.${v}`) }))}
        />
      </FormSection>
      <Button type="submit" disabled={pending} data-testid="product-save">
        {t("save")}
      </Button>
    </form>
  );
}
