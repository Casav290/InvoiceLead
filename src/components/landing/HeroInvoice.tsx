"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { type AmountStyle, formatAmount, vatOf } from "@/lib/money";

export type HeroInvoiceCopy = {
  kind: string;
  number: string;
  date: string;
  client: string;
  clientAddress: string;
  item: string;
  qty: string;
  /** Devise écrite en tête de la colonne des montants. */
  currency: string;
  rows: { label: string; unit: string }[];
  subtotal: string;
  vat: string;
  total: string;
  /** Titre du bloc de paiement : virement SEPA (GiroCode) ou paiement en ligne (États-Unis). */
  payment: string;
  scan: string;
  beneficiary: string;
  account: string;
  reference: string;
  referenceValue: string;
  amount: string;
  /** États-Unis : échéance écrite sous le montant. */
  due?: string;
  dueValue?: string;
  draft: string;
  sent: string;
  paid: string;
  bank: string;
};

type Sample = {
  seller: string;
  sellerAddress: string;
  /** Initiales du logo. */
  mark: string;
  /** Montants des lignes, en centimes. */
  amounts: number[];
  /** Taux de la taxe, en points de base. */
  rateBp: number;
  style: AmountStyle;
  money: (amount: string) => string;
  /** GiroCode (virement SEPA, EPC) en Allemagne et en France ; paiement en ligne et ACH aux États-Unis. */
  slip: "epc" | "online";
  iban: string | null;
};

/**
 * Facture d'exemple de chaque langue, sur l'entreprise fictive de la démo du même pays :
 * en → Live Oak Woodworks LLC (Austin, sales tax 8,25 %), de → Albrecht Haustechnik GmbH
 * (Freiburg, USt 19 %), fr → Studio Confluence SARL (Lyon, TVA 20 %). Les IBAN sont ceux de la
 * démo, jamais un vrai compte.
 */
const SAMPLES: Record<string, Sample> = {
  en: {
    seller: "Live Oak Woodworks LLC",
    sellerAddress: "2209 Pecan Mill Rd, Austin, TX 78744",
    mark: "LO",
    amounts: [780_000, 325_000, 238_000, 45_000],
    rateBp: 825,
    style: "en",
    money: (a) => `$${a}`,
    slip: "online",
    iban: null,
  },
  de: {
    seller: "Albrecht Haustechnik GmbH",
    sellerAddress: "Hermann-Mitsch-Straße 26, 79108 Freiburg im Breisgau",
    mark: "AH",
    amounts: [1_485_000, 194_000, 109_200, 235_600],
    rateBp: 1900,
    style: "de",
    money: (a) => `${a} €`,
    slip: "epc",
    iban: "DE65 6805 0101 0012 4738 51",
  },
  fr: {
    seller: "Studio Confluence SARL",
    sellerAddress: "14 rue Casimir Périer, 69002 Lyon",
    mark: "SC",
    amounts: [320_000, 140_000, 522_000, 68_000],
    rateBp: 2000,
    style: "fr",
    money: (a) => `${a}\u00a0€`,
    slip: "epc",
    iban: "FR76 1009 6185 2300 0417 2651 840",
  },
};

/**
 * Exemple de chaque langue : l'italien et l'espagnol reprennent l'entreprise française (euro et
 * GiroCode), dont leurs textes (messages it/es) suivent l'exemple ; une langue inconnue, l'anglais.
 */
function sampleFor(locale: string): Sample {
  const key = locale === "it" || locale === "es" ? "fr" : locale;
  return SAMPLES[key] ?? (SAMPLES.en as Sample);
}

/** Un tour complet : la facture se remplit, part, est payée, reste affichée, puis recommence. */
const CYCLE_MS = 16_000;
const LEAVE_MS = 600;
/** Moments du tour, en secondes. */
const T = {
  rows: 0.7,
  step: 0.4,
  totals: 2.5,
  total: 2.9,
  slip: 3.9,
  qr: 4.4,
  sent: 5.4,
  paid: 7.8,
};

/** Montant avec sa devise, écrit comme dans le pays de l'exemple : $15,025.10, 24.083,22 €. */
function money(locale: string, cents: number): string {
  const sample = sampleFor(locale);
  return sample.money(formatAmount(cents, sample.style));
}

const at = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

/**
 * Facture d'exemple qui se construit sous les yeux : lignes, totaux, bloc de paiement (GiroCode en
 * Europe, paiement en ligne aux États-Unis), puis Brouillon, Envoyée, Payée et le paiement reçu. Les animations sont en CSS (landing.css) et
 * partent sans attendre JavaScript ; le composant ne fait que relancer le tour quand la facture est
 * à l'écran. Au repos (prefers-reduced-motion), la facture payée s'affiche telle quelle.
 */
export function HeroInvoice({ copy, locale }: { copy: HeroInvoiceCopy; locale: string }) {
  const sample = sampleFor(locale);
  const fmt = (cents: number) => formatAmount(cents, sample.style);
  const [cycle, setCycle] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    if (root.current) io.observe(root.current);
    let leaveTimer: number | undefined;
    const timer = window.setInterval(() => {
      if (!visible || document.hidden) return;
      setLeaving(true);
      leaveTimer = window.setTimeout(() => {
        setCycle((c) => c + 1);
        setLeaving(false);
      }, LEAVE_MS);
    }, CYCLE_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(leaveTimer);
      io.disconnect();
    };
  }, []);

  const subtotal = sample.amounts.reduce((sum, c) => sum + c, 0);
  const vat = vatOf(subtotal, sample.rateBp);
  const total = subtotal + vat;

  return (
    <div ref={root} aria-hidden="true" className="relative">
      <div
        key={cycle}
        className="lp-doc relative z-10 border border-line-strong bg-paper text-[12px] sm:text-[13px]"
        data-leaving={leaving}
      >
        {/* Émetteur et pièce */}
        <div
          className="lp-in grid grid-cols-[1fr_auto] border-b border-line-strong"
          style={at(0.1)}
        >
          <div className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center bg-ink text-[11px] font-extrabold text-white">
              {sample.mark}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-extrabold text-ink">{sample.seller}</span>
              <span className="block truncate text-[11px] text-ink-muted">
                {sample.sellerAddress}
              </span>
            </span>
          </div>
          <div className="flex flex-col justify-center border-l border-line px-4 py-3 text-right sm:px-5">
            <span className="text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
              {copy.kind}
            </span>
            <span className="font-bold whitespace-nowrap tabular-nums">{copy.number}</span>
          </div>
        </div>

        {/* Client, date, statut */}
        <div
          className="lp-in flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5"
          style={at(0.3)}
        >
          <div className="min-w-0">
            <p className="font-bold text-ink">{copy.client}</p>
            <p className="text-[11px] text-ink-muted">{copy.clientAddress}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div
              className="lp-status"
              style={
                {
                  "--d1": `${T.sent}s`,
                  "--d2": `${T.paid}s`,
                  "--span": `${T.paid - T.sent}s`,
                } as CSSProperties
              }
            >
              <Status tone="off" className="lp-st-draft">
                {copy.draft}
              </Status>
              <Status tone="cold" className="lp-st-sent">
                {copy.sent}
              </Status>
              <Status tone="ok" className="lp-st-paid">
                {copy.paid}
              </Status>
            </div>
            <span className="text-[11px] text-ink-muted tabular-nums">{copy.date}</span>
          </div>
        </div>

        {/* Lignes */}
        <div className="grid grid-cols-[1fr_auto] border-b border-line bg-head px-4 py-2 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase sm:grid-cols-[1fr_auto_auto] sm:px-5">
          <span>{copy.item}</span>
          <span className="hidden w-20 text-right sm:block">{copy.qty}</span>
          <span className="w-24 text-right">{copy.currency}</span>
        </div>
        {copy.rows.map((row, i) => (
          <div
            key={row.label}
            className="lp-row relative grid grid-cols-[1fr_auto] items-baseline gap-x-2 border-b border-line-soft px-4 py-2 sm:grid-cols-[1fr_auto_auto] sm:px-5"
            style={at(T.rows + i * T.step)}
          >
            <span className="min-w-0 text-ink">{row.label}</span>
            <span className="hidden w-20 text-right text-ink-muted sm:block">{row.unit}</span>
            <span className="w-24 text-right tabular-nums">{fmt(sample.amounts[i] ?? 0)}</span>
          </div>
        ))}

        {/* Totaux */}
        <div className="lp-in px-4 pt-3 text-ink-muted sm:px-5" style={at(T.totals)}>
          <div className="flex justify-between">
            <span>{copy.subtotal}</span>
            <span className="tabular-nums">{fmt(subtotal)}</span>
          </div>
          <div className="flex justify-between pt-1">
            <span>{copy.vat}</span>
            <span className="tabular-nums">{fmt(vat)}</span>
          </div>
        </div>
        <div
          className="lp-total mt-3 flex items-baseline justify-between border-t border-line-strong px-4 py-3 sm:px-5"
          style={at(T.total)}
        >
          <span className="font-bold text-ink">{copy.total}</span>
          <CountUp
            cents={total}
            locale={locale}
            delay={T.total}
            replay={cycle > 0}
            className="text-[20px] font-extrabold tracking-[-0.02em] text-ink tabular-nums sm:text-[24px]"
          />
        </div>

        {/* Bloc de paiement : GiroCode (virement SEPA) ou paiement en ligne et ACH. */}
        <div className="lp-slip border-t border-line-strong" style={at(T.slip)}>
          <div className="grid grid-cols-[auto_1fr] gap-4 px-4 py-3 sm:gap-5 sm:px-5">
            <div className="lp-qr" style={at(T.qr)}>
              {sample.slip === "epc" ? (
                <QrMock />
              ) : (
                <div className="flex h-[92px] w-[132px] flex-col justify-between border border-line-strong bg-panel p-2.5 sm:h-[104px] sm:w-[150px]">
                  <span className="text-[10.5px] font-extrabold tracking-[0.05em] text-ink-muted uppercase">
                    {copy.payment}
                  </span>
                  <span className="bg-accent px-2 py-1.5 text-center text-[12px] font-bold text-white tabular-nums">
                    {sample.money(fmt(total))}
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0 space-y-1 text-[11px]">
              <p className="font-extrabold text-ink">
                {sample.slip === "epc" ? copy.payment : copy.account}
              </p>
              {copy.scan ? <p className="text-ink-muted">{copy.scan}</p> : null}
              <p className="pt-1 font-bold text-ink-2">{copy.beneficiary}</p>
              <p className="truncate text-ink-muted">{sample.seller}</p>
              {sample.iban ? (
                <>
                  <p className="font-bold text-ink-2">{copy.account}</p>
                  <p className="break-words text-ink-muted">{sample.iban}</p>
                </>
              ) : null}
              <p className="font-bold text-ink-2">{copy.reference}</p>
              <p className="text-ink-muted">{copy.referenceValue}</p>
              {copy.due ? (
                <>
                  <p className="font-bold text-ink-2">{copy.due}</p>
                  <p className="text-ink-muted tabular-nums">{copy.dueValue}</p>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Le paiement arrive : la ligne du relevé bancaire glisse sous la facture. */}
      <div key={`bank-${cycle}`} className="overflow-hidden" data-leaving={leaving}>
        <div className="lp-doc" data-leaving={leaving}>
          <div
            className="lp-bank flex items-center justify-between gap-3 border border-t-0 border-line-strong bg-panel px-4 py-2.5 text-[12px] sm:px-5"
            style={at(T.paid)}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="h-5 w-[3px] shrink-0 bg-ok" />
              <span className="min-w-0 text-ink-2">{copy.bank}</span>
            </span>
            <span className="shrink-0 font-bold text-ok-fg tabular-nums">+{fmt(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Status({
  tone,
  className,
  children,
}: {
  tone: "off" | "cold" | "ok";
  className: string;
  children: React.ReactNode;
}) {
  const colors = {
    off: "border-ink-muted bg-muted text-ink-2",
    cold: "border-cold bg-cold-bg text-cold-fg",
    ok: "border-ok bg-ok-bg text-ok-fg",
  }[tone];
  return (
    <span
      className={`${className} justify-self-end border-l-[3px] px-2 py-[3px] text-[10.5px] font-extrabold tracking-[0.05em] whitespace-nowrap uppercase ${colors}`}
    >
      {children}
    </span>
  );
}

/**
 * Total qui défile de zéro à sa valeur au moment où il apparaît. Rendu côté serveur à sa valeur
 * finale ; au premier tour, il ne compte que si la page est encore avant ce moment.
 */
function CountUp({
  cents,
  locale,
  delay,
  replay,
  className,
}: {
  cents: number;
  locale: string;
  delay: number;
  replay: boolean;
  className: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const show = (value: number) => {
      el.textContent = money(locale, value);
    };
    const since = replay ? 0 : performance.now();
    const wait = delay * 1000 - since;
    if (wait < 0) return;
    let frame = 0;
    const duration = 900;
    show(0);
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - p) ** 3;
        show(p < 1 ? Math.round((cents * eased) / 5) * 5 : cents);
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, wait);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      show(cents);
    };
  }, [cents, locale, delay, replay]);
  return (
    <span ref={ref} className={className}>
      {money(locale, cents)}
    </span>
  );
}

/** GiroCode d'illustration (pas un vrai code de virement) : repères d'angle, modules stables. */
function QrMock() {
  const n = 25;
  const finder = (r: number, c: number): boolean | null => {
    for (const [or, oc] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ] as const) {
      const y = r - or;
      const x = c - oc;
      if (y >= 0 && y < 7 && x >= 0 && x < 7)
        return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
      if (y >= -1 && y <= 7 && x >= -1 && x <= 7) return false;
    }
    return null;
  };
  let d = "";
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const f = finder(r, c);
      const on = f ?? ((r * 31 + c * 17 + r * c * 7) % 11) % 3 === 0;
      if (on) d += `M${c} ${r}h1v1h-1z`;
    }
  return (
    <svg
      aria-hidden="true"
      viewBox="-1 -1 27 27"
      className="block h-[92px] w-[92px] sm:h-[104px] sm:w-[104px]"
      shapeRendering="crispEdges"
    >
      <path d={d} className="fill-ink" />
    </svg>
  );
}
