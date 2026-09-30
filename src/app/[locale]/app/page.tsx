import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/server/auth/session";

const NEXT_STEPS = ["company", "contacts", "invoice"] as const;

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSession();
  const t = await getTranslations({ locale, namespace: "app.dashboard" });
  const firstName = (session?.user.name || session?.user.email || "").split(/\s+/)[0] ?? "";
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
      <h1 className="text-[28px] leading-tight" data-testid="dashboard-title">
        {t("title", { name: firstName })}
      </h1>
      <p className="mt-2 text-[15px] text-ink-muted">
        {t("subtitle", { org: session?.organization.name ?? "" })}
      </p>
      <section className="mt-8 border border-line-strong bg-panel">
        <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
          {t("nextTitle")}
        </h2>
        <ol>
          {NEXT_STEPS.map((step, i) => (
            <li
              key={step}
              className="flex items-center gap-4 border-b border-line-soft px-5 py-4 last:border-b-0"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-line-strong text-[12px] font-extrabold text-ink-3">
                {i + 1}
              </span>
              <span className="text-[14px]">{t(`next.${step}`)}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-4 text-[13px] text-ink-muted">{t("soon")}</p>
    </div>
  );
}
