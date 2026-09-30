"use client";

import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { type InvoiceFormState, saveInvoice } from "@/app/[locale]/app/invoices/actions";
import { FormSection, fieldClass, SelectField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { countryPack } from "@/countries";
import { formatRate, type VatCode } from "@/countries/ch/vat";
import { parseAmountToCents } from "@/lib/amount-input";
import { computeTotals, parseQuantityToMilli } from "@/lib/invoice-math";
import { formatAmount } from "@/lib/money";

const UNITS = ["hour", "day", "piece", "flat", "km", "month"];
const VAT_CODES = ["normal", "reduced", "lodging", "exempt", "export"];

export type ContactOption = { id: string; name: string; language: string };
export type ProductOption = {
  id: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: string;
  vatCode: string;
};

type Row = {
  key: number;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatCode: string;
};

const emptyRow = (key: number): Row => ({
  key,
  productId: "",
  description: "",
  quantity: "1",
  unit: "hour",
  unitPrice: "",
  vatCode: "normal",
});

function rowsFrom(values: Record<string, string | string[]>): Row[] {
  const list = (k: string) => {
    const v = values[`line.${k}`];
    return Array.isArray(v) ? v : [];
  };
  const rows = list("description").map((description, i) => ({
    key: i,
    productId: list("productId")[i] ?? "",
    description,
    quantity: list("quantity")[i] ?? "1",
    unit: list("unit")[i] ?? "hour",
    unitPrice: list("unitPrice")[i] ?? "",
    vatCode: list("vatCode")[i] ?? "normal",
  }));
  return rows.length > 0 ? rows : [emptyRow(0)];
}

export function InvoiceForm({
  locale,
  kind = "invoice",
  id,
  initial,
  contacts,
  products,
  vatRegistered,
  country = "CH",
}: {
  locale: string;
  country?: string;
  kind?: "invoice" | "quote" | "credit_note";
  id?: string;
  initial: Record<string, string | string[]>;
  contacts: ContactOption[];
  products: ProductOption[];
  vatRegistered: boolean;
}) {
  const t = useTranslations("app.invoices");
  const tk = useTranslations(kind === "quote" ? "app.quotes" : "app.invoices");
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(saveInvoice, {
    status: "idle",
    round: 0,
  });
  const values = state.values ?? initial;
  return (
    <InvoiceFormBody
      key={state.round}
      locale={locale}
      kind={kind}
      dueLabel={tk("dueLabel")}
      dueHint={tk("dueHint")}
      id={id}
      values={values}
      errors={state.errors ?? {}}
      status={state.status}
      action={action}
      pending={pending}
      contacts={contacts}
      products={products}
      vatRegistered={vatRegistered}
      country={country}
      t={t}
    />
  );
}

function InvoiceFormBody({
  locale,
  kind,
  dueLabel,
  dueHint,
  id,
  values,
  errors,
  status,
  action,
  pending,
  contacts,
  products,
  vatRegistered,
  country,
  t,
}: {
  locale: string;
  kind: "invoice" | "quote" | "credit_note";
  dueLabel: string;
  dueHint: string;
  id?: string;
  values: Record<string, string | string[]>;
  errors: Record<string, string>;
  status: InvoiceFormState["status"];
  action: (form: FormData) => void;
  pending: boolean;
  contacts: ContactOption[];
  products: ProductOption[];
  vatRegistered: boolean;
  country: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const pack = countryPack(country);
  const v = (k: string) => {
    const x = values[k];
    return typeof x === "string" ? x : "";
  };
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(values));
  const [nextKey, setNextKey] = useState(() => rows.length);
  const [serviceDate, setServiceDate] = useState(v("serviceDate"));
  const [issueDate, setIssueDate] = useState(v("issueDate"));
  const [language, setLanguage] = useState(v("language") || locale);
  const uid = useId();
  const err = (name: string) => (errors[name] ? t(`errors.${errors[name]}`) : undefined);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    setRows((rs) => [...rs, emptyRow(nextKey)]);
    setNextKey((k) => k + 1);
  };
  const removeRow = (key: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow(nextKey)]));
  const pickProduct = (key: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return update(key, { productId: "" });
    update(key, {
      productId: p.id,
      description: p.description ? `${p.name}\n${p.description}` : p.name,
      unit: p.unit,
      unitPrice: p.unitPrice,
      vatCode: p.vatCode,
    });
  };

  // Aperçu des montants, recalculé par le serveur à l'enregistrement.
  const rateDate = serviceDate || issueDate;
  const rateOf = (code: string) => {
    if (!vatRegistered) return 0;
    try {
      return pack.vatRateBp(code as VatCode, rateDate);
    } catch {
      return 0;
    }
  };
  const totals = computeTotals(
    rows.map((r) => ({
      quantityMilli: parseQuantityToMilli(r.quantity || "1") ?? 0,
      unitPriceCents: parseAmountToCents(r.unitPrice) ?? 0,
      vatRateBp: rateOf(r.vatCode),
    })),
  );

  // Les lignes sont numérotées dans l'ordre des lignes non vides, comme côté serveur.
  let filled = -1;
  const lineIndex = rows.map((r) => {
    const empty = !r.description && !r.unitPrice && (!r.quantity || r.quantity === "1");
    if (!empty) filled += 1;
    return empty ? -1 : filled;
  });

  return (
    <form action={action} className="mt-8 space-y-6" data-testid="invoice-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="kind" value={kind} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {status === "invalid" ? (
        <p
          role="alert"
          className="border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("invalid")}
        </p>
      ) : null}
      {status === "notFound" ? (
        <p
          role="alert"
          className="border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t("notEditable")}
        </p>
      ) : null}

      <FormSection title={t("sections.customer")}>
        {kind === "credit_note" ? (
          <input type="hidden" name="contactId" value={v("contactId")} />
        ) : null}
        <SelectField
          id="invoice-contact"
          name="contactId"
          label={t("fields.contact")}
          defaultValue={v("contactId")}
          error={err("contactId")}
          placeholder={t("choose")}
          options={contacts.map((c) => ({ value: c.id, label: c.name }))}
          wide
          disabled={kind === "credit_note"}
        />
        <div>
          <label htmlFor="invoice-language" className="mb-1 block text-[13px] font-semibold">
            {t("fields.language")}
          </label>
          <select
            id="invoice-language"
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={fieldClass}
          >
            <option value="de">{t("languages.de")}</option>
            <option value="fr">{t("languages.fr")}</option>
            <option value="en">{t("languages.en")}</option>
          </select>
        </div>
        <TextField
          id="invoice-title"
          name="title"
          label={t("fields.title")}
          defaultValue={v("title")}
        />
      </FormSection>

      <FormSection title={t("sections.dates")}>
        <div>
          <label htmlFor="invoice-issue" className="mb-1 block text-[13px] font-semibold">
            {t("fields.issueDate")}
          </label>
          <input
            id="invoice-issue"
            name="issueDate"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            aria-invalid={errors.issueDate ? true : undefined}
            className={fieldClass}
          />
          {err("issueDate") ? (
            <span className="mt-1 block text-[12px] font-semibold text-hot-fg">
              {err("issueDate")}
            </span>
          ) : null}
        </div>
        <div>
          <label htmlFor="invoice-service" className="mb-1 block text-[13px] font-semibold">
            {t("fields.serviceDate")}
          </label>
          <input
            id="invoice-service"
            name="serviceDate"
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            aria-invalid={errors.serviceDate ? true : undefined}
            aria-describedby={`${uid}-service-hint`}
            className={fieldClass}
          />
          <span id={`${uid}-service-hint`} className="mt-1 block text-[12px] text-ink-muted">
            {t("hints.serviceDate")}
          </span>
          {err("serviceDate") ? (
            <span className="mt-1 block text-[12px] font-semibold text-hot-fg">
              {err("serviceDate")}
            </span>
          ) : null}
        </div>
        {kind === "credit_note" ? null : (
          <TextField
            id="invoice-due"
            name="dueDate"
            type="date"
            label={dueLabel}
            hint={dueHint}
            defaultValue={v("dueDate")}
            error={err("dueDate")}
          />
        )}
      </FormSection>

      <section className="border border-line-strong bg-panel" data-testid="invoice-lines">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("sections.lines")}
        </h2>
        {errors.lines ? (
          <p role="alert" className="px-5 pt-4 text-[12px] font-semibold text-hot-fg">
            {t(`errors.${errors.lines}`)}
          </p>
        ) : null}
        <ol>
          {rows.map((r, i) => {
            const n = lineIndex[i] ?? -1;
            const le = (f: string) =>
              n >= 0 && errors[`lines.${n}.${f}`]
                ? t(`errors.${errors[`lines.${n}.${f}`]}`)
                : undefined;
            const base = `${uid}-line-${r.key}`;
            const lineNet = totals.lines[i] ?? 0;
            return (
              <li
                key={r.key}
                data-testid={`invoice-line-${i}`}
                className="grid grid-cols-2 gap-3 border-b border-line-soft px-5 py-4 sm:grid-cols-6"
              >
                <input type="hidden" name="line.productId" value={r.productId} />
                {products.length > 0 ? (
                  <div className="col-span-2 sm:col-span-6">
                    <label
                      htmlFor={`${base}-product`}
                      className="mb-1 block text-[12px] font-semibold"
                    >
                      {t("fields.product")}
                    </label>
                    <select
                      id={`${base}-product`}
                      value={r.productId}
                      onChange={(e) => pickProduct(r.key, e.target.value)}
                      className={fieldClass}
                    >
                      <option value="">{t("freeLine")}</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="col-span-2 sm:col-span-6">
                  <label
                    htmlFor={`${base}-description`}
                    className="mb-1 block text-[12px] font-semibold"
                  >
                    {t("fields.description")}
                  </label>
                  <textarea
                    id={`${base}-description`}
                    name="line.description"
                    rows={2}
                    value={r.description}
                    onChange={(e) => update(r.key, { description: e.target.value })}
                    aria-invalid={le("description") ? true : undefined}
                    className={`${fieldClass} h-auto py-2`}
                  />
                  <LineError text={le("description")} />
                </div>
                <div>
                  <label
                    htmlFor={`${base}-quantity`}
                    className="mb-1 block text-[12px] font-semibold"
                  >
                    {t("fields.quantity")}
                  </label>
                  <input
                    id={`${base}-quantity`}
                    name="line.quantity"
                    inputMode="decimal"
                    value={r.quantity}
                    onChange={(e) => update(r.key, { quantity: e.target.value })}
                    aria-invalid={le("quantity") ? true : undefined}
                    className={fieldClass}
                  />
                  <LineError text={le("quantity")} />
                </div>
                <div>
                  <label htmlFor={`${base}-unit`} className="mb-1 block text-[12px] font-semibold">
                    {t("fields.unit")}
                  </label>
                  <select
                    id={`${base}-unit`}
                    name="line.unit"
                    value={r.unit}
                    onChange={(e) => update(r.key, { unit: e.target.value })}
                    className={fieldClass}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {t(`units.${u}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`${base}-price`} className="mb-1 block text-[12px] font-semibold">
                    {t("fields.unitPrice")}
                  </label>
                  <input
                    id={`${base}-price`}
                    name="line.unitPrice"
                    inputMode="decimal"
                    value={r.unitPrice}
                    onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                    aria-invalid={le("unitPrice") ? true : undefined}
                    className={fieldClass}
                  />
                  <LineError text={le("unitPrice")} />
                </div>
                {vatRegistered ? (
                  <div className="sm:col-span-2">
                    <label htmlFor={`${base}-vat`} className="mb-1 block text-[12px] font-semibold">
                      {t("fields.vatCode")}
                    </label>
                    <select
                      id={`${base}-vat`}
                      name="line.vatCode"
                      value={r.vatCode}
                      onChange={(e) => update(r.key, { vatCode: e.target.value })}
                      className={fieldClass}
                    >
                      {VAT_CODES.map((c) => (
                        <option key={c} value={c}>
                          {t(`vatCodes.${c}`)} ({formatRate(rateOf(c), locale)})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input type="hidden" name="line.vatCode" value="" />
                )}
                <div className="col-span-2 flex items-end justify-between gap-3 sm:col-span-6">
                  <span className="text-[13px] text-ink-2">
                    {t("lineTotal")}{" "}
                    <span className="font-semibold tabular-nums text-ink">
                      {formatAmount(lineNet, pack.amounts)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(r.key)}
                    data-testid={`invoice-line-remove-${i}`}
                  >
                    {t("removeLine")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="px-5 py-4">
          <Button type="button" variant="secondary" onClick={addRow} data-testid="invoice-line-add">
            {t("addLine")}
          </Button>
        </div>
        <dl
          className="border-t border-line-strong px-5 py-4 text-[14px]"
          data-testid="invoice-totals"
        >
          <div className="flex justify-between gap-4">
            <dt>{vatRegistered ? t("net") : t("total")}</dt>
            <dd className="tabular-nums">{formatAmount(totals.netCents, pack.amounts)}</dd>
          </div>
          {vatRegistered
            ? totals.vat
                .filter((x) => x.rateBp > 0)
                .map((x) => (
                  <div key={x.rateBp} className="flex justify-between gap-4 text-ink-2">
                    <dt>
                      {t("vatLine", {
                        rate: formatRate(x.rateBp, locale),
                        base: formatAmount(x.netCents, pack.amounts),
                      })}
                    </dt>
                    <dd className="tabular-nums">{formatAmount(x.vatCents, pack.amounts)}</dd>
                  </div>
                ))
            : null}
          {vatRegistered ? (
            <div className="mt-2 flex justify-between gap-4 border-t border-line pt-2 font-extrabold">
              <dt>{t("totalWithVat")}</dt>
              <dd className="tabular-nums">
                {pack.currency} {formatAmount(totals.totalCents, pack.amounts)}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <FormSection title={t("sections.texts")}>
        <TextField
          id="invoice-intro"
          name="introText"
          label={t("fields.introText")}
          defaultValue={v("introText")}
          wide
          multiline
        />
        <TextField
          id="invoice-footer"
          name="footerText"
          label={t("fields.footerText")}
          defaultValue={v("footerText")}
          wide
          multiline
        />
      </FormSection>

      <Button type="submit" disabled={pending} data-testid="invoice-save">
        {t("saveDraft")}
      </Button>
    </form>
  );
}

function LineError({ text }: { text?: string }) {
  return text ? (
    <span className="mt-1 block text-[12px] font-semibold text-hot-fg">{text}</span>
  ) : null;
}
