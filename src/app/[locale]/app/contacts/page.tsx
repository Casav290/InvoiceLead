import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LockNote, ProBadge } from "@/components/app/ProLock";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { requireAppSession } from "@/server/auth/guard";
import { listContacts } from "@/server/contacts";
import { db } from "@/server/db";
import { lockFor } from "@/server/plan-lock";
import { quotaAccess } from "@/server/plans";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; saved?: string; archived?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.contacts" });
  return { title: t("title"), robots: { index: false } };
}

export default async function ContactsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { organization } = await requireAppSession(locale);
  const { q = "", saved, archived } = await searchParams;
  const t = await getTranslations({ locale, namespace: "app.contacts" });
  const rows = await listContacts(db(), organization.id, q.slice(0, 100));
  // Formule gratuite : 50 contacts ; ensuite « Nouveau contact » est grisé (les fiches restent).
  const live = await quotaAccess(db(), organization, "contacts");
  const lock = await lockFor(locale, organization, live, t("planLimit", { limit: live.limit }));
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[28px] leading-tight">{t("title")}</h1>
        {lock ? (
          <span className="inline-flex items-center gap-2">
            <Button disabled aria-disabled="true" aria-describedby="contacts-lock-reason">
              {t("new")}
            </Button>
            {lock.tier ? <ProBadge tier={lock.tier} /> : null}
          </span>
        ) : (
          <Button asChild>
            <Link href="/app/contacts/new" data-testid="contact-new">
              {t("new")}
            </Link>
          </Button>
        )}
      </div>
      {lock ? (
        <LockNote
          lock={lock}
          id="contacts-lock-reason"
          testId="contacts-lock"
          className="mt-4 border border-line-strong bg-muted px-4 py-3"
        />
      ) : null}
      {saved ? (
        <p
          role="status"
          className="mt-6 border border-ok-fg bg-ok-bg px-4 py-3 text-[13px] text-ok-fg"
        >
          {t("saved")}
        </p>
      ) : null}
      {archived ? (
        <p
          role="status"
          className="mt-6 border border-line-strong bg-panel px-4 py-3 text-[13px] text-ink-2"
        >
          {t("archived")}
        </p>
      ) : null}
      <form className="mt-6 flex gap-2" role="search">
        <label htmlFor="contacts-q" className="sr-only">
          {t("search")}
        </label>
        <input
          id="contacts-q"
          name="q"
          defaultValue={q}
          placeholder={t("search")}
          className="h-10 w-full max-w-sm border border-line-strong bg-panel px-3 text-[14px]"
        />
        <Button type="submit" variant="secondary">
          {t("searchButton")}
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="mt-8 border border-line-strong bg-panel px-5 py-8 text-center text-[14px] text-ink-muted">
          {q ? t("noResults") : t("empty")}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-line-strong bg-panel">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line-strong bg-head text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
                <th className="px-4 py-2.5">{t("columns.name")}</th>
                <th className="px-4 py-2.5">{t("columns.town")}</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">{t("columns.email")}</th>
                <th className="px-4 py-2.5">{t("columns.role")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-line-soft last:border-b-0 hover:bg-rowhover"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/app/contacts/${c.id}`}
                      className="font-semibold text-accent-dark hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-2">
                    {[c.postalCode, c.town].filter(Boolean).join(" ")}
                  </td>
                  <td className="hidden px-4 py-3 text-ink-2 sm:table-cell">{c.email}</td>
                  <td className="px-4 py-3 text-[12px] text-ink-muted">
                    {[
                      c.isCustomer ? t("roles.customer") : null,
                      c.isSupplier ? t("roles.supplier") : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
