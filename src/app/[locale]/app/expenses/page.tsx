import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ScanTicket } from "@/components/app/ScanTicket";
import { Button } from "@/components/ui/button";
import { VAT_CODES } from "@/countries/ch/vat";
import { accountName } from "@/lib/account-name";
import { formatDate } from "@/lib/fiscal-year";
import { formatAmount } from "@/lib/money";
import { listAccounts } from "@/server/accounting";
import { requireAppSession } from "@/server/auth/guard";
import { db } from "@/server/db";
import {
  lastClaimIban,
  listClaims,
  MILEAGE_RATE_CENTS,
  scannedTicket,
  travelAccountId,
} from "@/server/expenses";
import { createClaimAction, deleteClaimAction, scanTicketAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; added?: string; scan?: string; unread?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.expenses" });
  return { title: t("title"), robots: { index: false } };
}

const field = "h-10 w-full border border-line-strong bg-panel px-3 text-[14px]";
const ERRORS = [
  "date",
  "required",
  "iban",
  "amount",
  "km",
  "type",
  "size",
  "duplicate",
  "role",
  "quota",
];

/** Notes de frais et indemnités kilométriques de la personne connectée. */
export default async function ExpensesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization, user } = await requireAppSession(locale);
  const q = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.expenses" });
  const tb = await getTranslations({ locale, namespace: "app.bills" });
  const tv = await getTranslations({ locale, namespace: "app.bank.vat" });
  const today = new Date().toISOString().slice(0, 10);
  const [claims, iban, chart, travel, ticket] = await Promise.all([
    listClaims(db(), organization.id, user.id),
    lastClaimIban(db(), organization.id, user.id),
    listAccounts(db(), organization.id),
    travelAccountId(db(), organization.id, organization.country),
    q.scan
      ? scannedTicket(db(), { organizationId: organization.id, userId: user.id }, q.scan)
      : null,
  ]);
  const expenseAccounts = chart.filter((a) => a.type === "expense" && a.active);
  // Ticket scanné : la note de frais s'ouvre remplie avec ce que l'IA a lu.
  const read = ticket?.extraction ?? null;
  const sameCurrency = !read?.currency || read.currency === organization.currency;
  const prefill = {
    date: read?.date ?? today,
    description: [read?.supplier, read?.description].filter(Boolean).join(" · ").slice(0, 200),
    amount: read?.totalCents != null && sameCurrency ? formatAmount(read.totalCents) : "",
    vatCode: read ? (read.vatCode ?? "") : "normal",
    accountId:
      (read?.accountNumber && expenseAccounts.find((a) => a.number === read.accountNumber)?.id) ||
      travel ||
      "",
  };
  const rate = MILEAGE_RATE_CENTS[organization.country] ?? 70;
  const hidden = <input type="hidden" name="locale" value={locale} />;
  const who = (
    <>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t("fields.claimant")}</span>
        <input name="claimantName" defaultValue={user.name} required className={field} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[13px] font-semibold">{t("fields.iban")}</span>
        <input name="iban" defaultValue={iban ?? ""} className={field} />
        <span className="mt-1 block text-[12px] text-ink-muted">{t("hints.iban")}</span>
      </label>
    </>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight">{t("title")}</h1>
      <p className="mt-2 text-[15px] text-ink-muted">{t("subtitle")}</p>
      {q.error ? (
        <p
          role="alert"
          className="mt-6 border border-hot-fg bg-hot-bg px-4 py-3 text-[13px] text-hot-fg"
        >
          {t(`errors.${ERRORS.includes(q.error) ? q.error : "invalid"}`)}
        </p>
      ) : null}
      {q.added ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("added")}
        </p>
      ) : null}

      <section
        className="mt-8 border border-accent bg-accent-veil px-5 py-5"
        data-testid="scan-ticket"
      >
        <h2 className="text-[18px]">{t("scan.title")}</h2>
        <p className="mt-1 mb-4 text-[14px] text-ink-2">{t("scan.subtitle")}</p>
        <form action={scanTicketAction}>
          {hidden}
          <ScanTicket label={t("scan.button")} reading={t("scan.reading")} hint={t("scan.hint")} />
        </form>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section
          id="ticket"
          className={`border bg-panel ${ticket ? "border-accent" : "border-line-strong"}`}
          data-testid="claim-expense"
        >
          <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
            {t("expense")}
          </h2>
          <form key={ticket?.id ?? "manual"} action={createClaimAction} className="grid gap-4 p-5">
            {hidden}
            <input type="hidden" name="kind" value="expense" />
            {ticket ? (
              <>
                <input type="hidden" name="receiptId" value={ticket.id} />
                <div
                  role="status"
                  data-testid="scan-result"
                  className={`flex gap-4 border px-4 py-3 text-[13px] ${read ? "border-ok-fg bg-ok-bg text-ok-fg" : "border-warm-fg bg-warm-bg text-warm-fg"}`}
                >
                  {ticket.contentType.startsWith("image/") ? (
                    // biome-ignore lint/performance/noImgElement: aperçu du ticket, servi par l'application
                    <img
                      src={`/${locale}/app/accounting/receipts/${ticket.id}/file`}
                      alt={t("scan.preview")}
                      className="h-20 w-16 shrink-0 border border-line-strong object-cover"
                    />
                  ) : null}
                  <span>
                    {read && !q.unread ? t("scan.read") : t("scan.unread")}
                    {read && !sameCurrency
                      ? ` ${t("scan.currency", { currency: read.currency ?? "", home: organization.currency })}`
                      : ""}
                  </span>
                </div>
              </>
            ) : null}
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold">{t("fields.date")}</span>
              <input
                type="date"
                name="date"
                defaultValue={prefill.date}
                required
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold">
                {t("fields.description")}
              </span>
              <input
                name="description"
                defaultValue={prefill.description}
                required
                maxLength={200}
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold">
                {t("fields.amount", { currency: organization.currency })}
              </span>
              <input
                name="amount"
                inputMode="decimal"
                defaultValue={prefill.amount}
                required
                className={field}
              />
            </label>
            {organization.vatRegistered ? (
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("fields.vat")}</span>
                <select name="vatCode" defaultValue={prefill.vatCode} className={field}>
                  <option value="">{tb("noVat")}</option>
                  {VAT_CODES.map((c) => (
                    <option key={c} value={c}>
                      {tv(c)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {expenseAccounts.length > 0 ? (
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("fields.account")}</span>
                <select name="accountId" defaultValue={prefill.accountId} className={field}>
                  <option value="">{tb("choose")}</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.number} {accountName(a, locale)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {ticket ? null : (
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("fields.receipt")}</span>
                <input
                  type="file"
                  name="receipt"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="block w-full text-[13px]"
                />
              </label>
            )}
            {who}
            <div>
              <Button type="submit" data-testid="claim-expense-save">
                {t("submit")}
              </Button>
            </div>
          </form>
        </section>

        <section className="border border-line-strong bg-panel" data-testid="claim-mileage">
          <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
            {t("mileage")}
          </h2>
          <form action={createClaimAction} className="grid gap-4 p-5">
            {hidden}
            <input type="hidden" name="kind" value="mileage" />
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold">{t("fields.date")}</span>
              <input type="date" name="date" defaultValue={today} required className={field} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold">{t("fields.trip")}</span>
              <input name="description" required maxLength={150} className={field} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">{t("fields.km")}</span>
                <input name="km" inputMode="decimal" required className={field} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold">
                  {t("fields.rate", { currency: organization.currency })}
                </span>
                <input
                  name="rate"
                  inputMode="decimal"
                  defaultValue={formatAmount(rate)}
                  required
                  className={field}
                />
              </label>
            </div>
            <p className="text-[12px] text-ink-muted">{t(`hints.rate.${organization.country}`)}</p>
            {who}
            <div>
              <Button type="submit" data-testid="claim-mileage-save">
                {t("submit")}
              </Button>
            </div>
          </form>
        </section>
      </div>

      <h2 className="mt-10 text-[18px]">{t("mine")}</h2>
      {claims.length === 0 ? (
        <p className="mt-4 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line border border-line-strong bg-panel">
          {claims.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3"
              data-testid="claim-row"
            >
              <span className="text-[13px] text-ink-2 tabular-nums">{formatDate(c.issueDate)}</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{c.description}</span>
              <span className="text-[12px] text-ink-muted">
                {tb(`status.${c.status as "draft" | "approved" | "scheduled" | "paid"}`)}
              </span>
              <span className="font-semibold tabular-nums">
                {c.currency} {formatAmount(c.totalCents)}
              </span>
              {c.status === "draft" ? (
                <form action={deleteClaimAction}>
                  {hidden}
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("delete")}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
