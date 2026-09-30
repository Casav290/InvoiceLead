import { useLocale, useTranslations } from "next-intl";
import { AppMark } from "@/components/brand/AppMark";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { formatAmount, formatMoney, vatOf } from "@/lib/money";

const FEATURES = ["quotes", "qr", "reminders", "accounting", "vat", "team"] as const;

export default function HomePage() {
  const locale = useLocale();
  const t = useTranslations("home");
  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="flex-1">
        <section className="border-b border-line-strong">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-8 md:grid-cols-[1.1fr_1fr] md:py-20">
            <div>
              <p className="mb-4 inline-block border border-accent-dark px-2 py-1 text-[11px] font-extrabold tracking-[0.08em] text-accent-dark uppercase">
                {t("kicker")}
              </p>
              <h1 className="text-[34px] leading-[1.08] sm:text-[46px]">{t("title")}</h1>
              <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">
                {t("subtitle")}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/signup">{t("ctaPrimary")}</Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <a href={`/${locale}#fonctions`}>{t("ctaSecondary")}</a>
                </Button>
              </div>
            </div>
            <InvoicePreview />
          </div>
        </section>

        <section id="fonctions" className="border-b border-line-strong">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
            <h2 className="max-w-2xl text-[28px] leading-tight sm:text-[34px]">
              {t("featuresTitle")}
            </h2>
            <div className="mt-8 grid border-t border-l border-line-strong bg-panel sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((key) => (
                <div key={key} className="border-r border-b border-line-strong p-6">
                  <h3 className="text-[16px]">{t(`features.${key}.title`)}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
                    {t(`features.${key}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="famille">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-8 md:grid-cols-2">
            <div>
              <h2 className="text-[28px] leading-tight sm:text-[34px]">{t("familyTitle")}</h2>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{t("familyBody")}</p>
            </div>
            <div className="grid grid-cols-3 self-center border-t border-l border-line-strong bg-panel">
              {[
                { mark: "SL", name: "Scanlead", color: "bg-scanlead" },
                { mark: "CL", name: "CRMlead", color: "bg-crmlead" },
                { mark: "IL", name: "InvoiceLead", color: "bg-accent" },
              ].map((app) => (
                <div
                  key={app.mark}
                  className="flex flex-col items-center gap-3 border-r border-b border-line-strong px-2 py-8"
                >
                  <AppMark label={app.mark} className={app.color} />
                  <span className="text-[13px] font-bold">{app.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

/** Aperçu d'une facture QR dessiné en traits : une illustration, pas une vraie pièce. */
function InvoicePreview() {
  const t = useTranslations("home.preview");
  const labels = t.raw("rows") as string[];
  const rows = [
    { label: labels[0], qty: `8 ${t("hours")}`, cents: 120_000 },
    { label: labels[1], qty: "1", cents: 90_000 },
    { label: labels[2], qty: "1", cents: 8_500 },
  ];
  const subtotal = rows.reduce((sum, r) => sum + r.cents, 0);
  const vat = vatOf(subtotal, 810);
  const total = subtotal + vat;
  return (
    <div aria-hidden="true" className="border border-line-strong bg-paper text-[12px]">
      <div className="flex items-center justify-between border-b border-line-strong px-5 py-4">
        <span className="font-extrabold">Muster Atelier GmbH</span>
        <span className="text-ink-muted">RE-2026-0042</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] border-b border-line bg-head px-5 py-2 text-[10px] font-extrabold tracking-[0.08em] text-ink-muted uppercase">
        <span>{t("position")}</span>
        <span className="w-14 text-right">{t("qty")}</span>
        <span className="w-20 text-right">CHF</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[1fr_auto_auto] border-b border-line-soft px-5 py-2"
        >
          <span>{row.label}</span>
          <span className="w-14 text-right text-ink-muted">{row.qty}</span>
          <span className="w-20 text-right tabular-nums">{formatAmount(row.cents)}</span>
        </div>
      ))}
      <div className="flex justify-between px-5 pt-3 text-ink-muted">
        <span>{t("subtotal")}</span>
        <span className="tabular-nums">{formatAmount(subtotal)}</span>
      </div>
      <div className="flex justify-between px-5 pt-1 pb-3 text-ink-muted">
        <span>{t("vat")}</span>
        <span className="tabular-nums">{formatAmount(vat)}</span>
      </div>
      <div className="flex justify-between border-t border-line-strong px-5 py-3 font-bold">
        <span>{t("total")}</span>
        <span className="tabular-nums">{formatMoney(total)}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-4 border-t border-dashed border-ink-3 px-5 py-4">
        <QrMock />
        <div className="space-y-1 text-[11px]">
          <p className="font-extrabold">{t("payment")}</p>
          <p className="text-ink-muted">CH93 0076 2011 6238 5295 7</p>
          <p className="text-ink-muted">RF18 5390 0754 7034</p>
          <p className="font-bold">CHF {formatAmount(total).replaceAll("'", " ")}</p>
        </div>
      </div>
    </div>
  );
}

/** Code QR d'illustration : trois repères d'angle, modules pseudo-aléatoires stables, croix suisse au centre. */
function QrMock() {
  const n = 21;
  const finder = (r: number, c: number) => {
    for (const [or, oc] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const) {
      const y = r - or;
      const x = c - oc;
      if (y >= 0 && y < 7 && x >= 0 && x < 7) {
        return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
      }
      if (y >= -1 && y <= 7 && x >= -1 && x <= 7) return false;
    }
    return null;
  };
  const cells = Array.from({ length: n * n }, (_, i) => {
    const r = Math.floor(i / n);
    const c = i % n;
    const f = finder(r, c);
    if (f !== null) return f;
    if (r >= 8 && r <= 12 && c >= 8 && c <= 12) return false;
    return ((r * 31 + c * 17 + r * c * 7) % 11) % 3 === 0;
  });
  return (
    <div className="relative h-[92px] w-[92px] shrink-0 border border-line p-1">
      <div className="grid h-full w-full" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {cells.map((on, i) => (
          <span key={i} className={on ? "bg-ink" : ""} />
        ))}
      </div>
      <span className="absolute top-1/2 left-1/2 flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center border-2 border-white bg-ink">
        <span className="relative block h-[9px] w-[9px]">
          <span className="absolute top-[3px] left-0 h-[3px] w-[9px] bg-white" />
          <span className="absolute top-0 left-[3px] h-[9px] w-[3px] bg-white" />
        </span>
      </span>
    </div>
  );
}
