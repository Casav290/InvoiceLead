"use client";

import { Sparkles, X } from "lucide-react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useCountry, useCountryTranslations } from "@/components/app/CountryContext";
import { countryPack } from "@/countries";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { pageLabel } from "@/lib/assistant-pages";
import { formatDate } from "@/lib/fiscal-year";
import { formatMoney } from "@/lib/money";
import { failureState } from "./confirm-state";
import { replyNodes } from "./reply-text";

/**
 * Bulle « Assistant IA » (cahier commun de la famille Lead, 24.10.2026) : en bas à droite de toutes
 * les pages de l'application, jamais sur les pages publiques. Le fil vit dans le sessionStorage de
 * l'onglet ; les écritures proposées s'affichent en cartes « À confirmer » et ne partent qu'au clic.
 */

type Field = {
  key: string;
  value: string;
  /** Modification : valeur actuelle, montrée « avant → après ». */
  before?: string;
  format?: "date" | "money" | "minutes" | "percent" | "enum" | "bool" | "month";
  currency?: string;
};

type Line = {
  description: string;
  quantity: string;
  unit: string;
  unitPriceCents: number;
  netCents: number;
};

type Totals = { currency: string; netCents: number; vatCents: number; totalCents: number };

type GroupItem = {
  action: string;
  label: string;
  detail?: string;
  /** Unité du prix (article) : « CHF 90.00 · Mois ». */
  unit?: string;
  amountCents?: number;
  currency?: string;
  lines?: Line[];
  totals?: Totals;
};

type Summary = {
  action: string;
  fields: Field[];
  lines?: Line[];
  totals?: Totals;
  notes?: string[];
  /** Lot : opérations groupées par action, premières lignes de chaque groupe. */
  groups?: { action: string; count: number; items: GroupItem[] }[];
  count?: number;
};

type Action =
  | { type: "navigate"; path: string; label?: string }
  | { type: "confirm"; token: string; summary: Summary };

type CardState =
  | "pending"
  | "saving"
  | "done"
  | "cancelled"
  | "expired"
  | "used"
  | "forbidden"
  | "gone"
  | "planLimit"
  | "failed"
  | "session"
  /** Réseau coupé pendant « Confirmer » : la carte reste à confirmer, avec un message. */
  | "network";

type Item =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "notice"; code: string }
  | { id: string; kind: "navigated"; path: string; label?: string }
  | {
      id: string;
      kind: "confirm";
      token: string;
      summary: Summary;
      state: CardState;
      result?: { path: string; label: string };
    };

type Stored = { history: unknown[]; items: Item[]; notes: string[] };

const EMPTY: Stored = { history: [], items: [], notes: [] };
const uid = () => Math.random().toString(36).slice(2);

function load(key: string): Stored {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Stored;
    return Array.isArray(parsed.history) && Array.isArray(parsed.items)
      ? { ...EMPTY, ...parsed }
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(key: string, value: Stored) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage plein ou refusé : le fil reste en mémoire jusqu'au rechargement.
  }
}

/** 90 → « 1:30 ». */
const hoursMinutes = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${String(Math.round(minutes) % 60).padStart(2, "0")}`;

/** Chemin sans la requête, pour savoir si la page du résultat est déjà ouverte. */
const pathOnly = (path: string) => path.split("?")[0] ?? path;

/**
 * Présentation par défaut selon la clé : les cartes du 24.10.2026 (sans « format ») restent lisibles
 * dans un fil ouvert au moment d'une mise à jour.
 */
const KEY_FORMATS: Record<string, Field["format"]> = {
  issueDate: "date",
  dueDate: "date",
  kind: "enum",
  documentKind: "enum",
  status: "enum",
};

/** Champs dont les valeurs ont déjà leurs libellés sur un écran de l'application (messages app.*). */
const ENUM_SOURCES: Record<string, string> = {
  unit: "products.units",
  vatCode: "accounts.vatCodes",
  type: "accounts.types",
  chartTemplate: "accounts.templates",
  receiptStatus: "receipts.status",
  waitingReason: "accountingHome.reasons",
  quoteStatus: "quotes.status",
  "company.legalForm": "company.legalForms",
  "company.vatMethod": "company.vatMethods",
  "company.vatSettlement": "company.vatSettlements",
};

/** Libellé du numéro de TVA et du numéro fiscal selon le pays, comme l'écran des réglages. */
const COMPANY_LABELS: Record<string, Record<string, string>> = {
  uid: { DE: "ustId", FR: "frVatId", GB: "gbVat" },
  taxNumber: { FR: "siret", GB: "companyNumber", US: "ein" },
};

/** Champ dont relève le « détail » d'une ligne de lot, pour le traduire. */
const DETAIL_KEYS: Record<string, string> = {
  install_chart: "chartTemplate",
  set_quote_outcome: "quoteStatus",
  create_expense_claim: "claimKind",
};

const ERROR_BY_STATUS: Record<number, string> = {
  400: "invalid",
  401: "session",
  403: "forbidden",
  503: "unavailable",
  504: "timeout",
};

/** Messages d'état du fil propres à une carte refusée (B7), avec leur texte traduit. */
const CARD_ERRORS = ["expired", "used", "forbidden", "gone", "planLimit", "failed", "network"];

export function AssistantBubble({ storageKey }: { storageKey: string }) {
  const t = useCountryTranslations("app.aiBubble");
  const tc = useCountryTranslations("app.aiBubble.confirm");
  const ta = useCountryTranslations("app");
  const locale = useLocale();
  const country = useCountry();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<Stored>(EMPTY);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const noteId = useId();
  /** Le panneau a été ouvert : à sa fermeture, le focus revient à la bulle. */
  const wasOpen = useRef(false);

  useEffect(() => setData(load(storageKey)), [storageKey]);

  const update = useCallback(
    (fn: (prev: Stored) => Stored) =>
      setData((prev) => {
        const next = fn(prev);
        save(storageKey, next);
        return next;
      }),
    [storageKey],
  );

  const close = useCallback(() => setOpen(false), []);

  // B8 : focus dans le champ dès l'ouverture (sans délai), rendu à la bulle à la fermeture ; Échap
  // ferme où que soit le focus.
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) bubbleRef.current?.focus();
      return;
    }
    wasOpen.current = true;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Le fil défile jusqu'au dernier message à chaque ajout.
  const count = data.items.length;
  useEffect(() => {
    if (open && count >= 0) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [open, count]);

  useEffect(() => {
    if (!busy && open) inputRef.current?.focus();
  }, [busy, open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const content = data.notes.length
      ? [...data.notes.map((n) => ({ type: "text", text: n })), { type: "text", text: question }]
      : question;
    const messages = [...data.history, { role: "user", content }];
    update((prev) => ({
      ...prev,
      items: [...prev.items, { id: uid(), kind: "user", text: question }],
    }));
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, page: pathname, locale }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        messages?: unknown[];
        reply?: string;
        actions?: Action[];
        notice?: string | null;
        error?: string;
        scope?: string;
      };
      if (!res.ok) {
        const code =
          res.status === 429
            ? body.scope === "org"
              ? "quotaOrg"
              : "quotaUser"
            : body.error === "history"
              ? "history"
              : (ERROR_BY_STATUS[res.status] ?? "unavailable");
        update((prev) => ({
          ...prev,
          items: [...prev.items, { id: uid(), kind: "notice", code }],
        }));
        return;
      }
      const added: Item[] = [];
      if (body.reply) added.push({ id: uid(), kind: "assistant", text: body.reply });
      if (body.notice) added.push({ id: uid(), kind: "notice", code: body.notice });
      let target: string | null = null;
      for (const a of body.actions ?? []) {
        if (a.type === "confirm")
          added.push({
            id: uid(),
            kind: "confirm",
            token: a.token,
            summary: a.summary,
            state: "pending",
          });
        if (a.type === "navigate") {
          target = a.path;
          added.push({ id: uid(), kind: "navigated", path: a.path, label: a.label });
        }
      }
      update((prev) => ({
        history: Array.isArray(body.messages) ? body.messages : prev.history,
        items: [...prev.items, ...added],
        notes: [],
      }));
      if (target) router.push(target);
    } catch {
      update((prev) => ({
        ...prev,
        items: [...prev.items, { id: uid(), kind: "notice", code: "network" }],
      }));
    } finally {
      setBusy(false);
    }
  }

  const setCard = (id: string, patch: Partial<Extract<Item, { kind: "confirm" }>>, note?: string) =>
    update((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it.id === id && it.kind === "confirm" ? { ...it, ...patch } : it,
      ),
      notes: note ? [...prev.notes, note].slice(-5) : prev.notes,
    }));

  async function confirm(item: Extract<Item, { kind: "confirm" }>) {
    setCard(item.id, { state: "saving" });
    try {
      const res = await fetch("/api/assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: item.token, locale }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        result?: {
          id: string;
          path: string;
          label: string;
          action: string;
          locale?: string;
          items?: { action: string; id: string; path: string }[];
        };
        error?: string;
      };
      if (res.ok && body.result) {
        const r = body.result;
        const saved = r.items
          ? `batch of ${r.items.length} operations saved: ${r.items
              .slice(0, 20)
              .map((i) => `${i.action} (id ${i.id})`)
              .join(", ")}${r.items.length > 20 ? ", …" : ""}`
          : `${r.action} saved (id ${r.id}, page ${r.path})`;
        setCard(
          item.id,
          { state: "done", result: { path: r.path, label: r.label }, token: "" },
          `[The user clicked Confirm: ${saved}.]`,
        );
        // La page montre le résultat sans rechargement : celle de ce qui a été écrit, ou la page
        // ouverte rafraîchie si c'est déjà elle ; une autre langue d'interface rouvre la même page
        // dans cette langue, comme le sélecteur.
        if (r.locale && r.locale !== locale)
          router.replace(`${pathname}${window.location.search}`, { locale: r.locale });
        else if (r.path && pathOnly(r.path) !== pathname) router.push(r.path);
        else router.refresh();
        return;
      }
      setCard(
        item.id,
        { state: failureState(res.status, body.error) },
        `[Confirming ${item.summary.action} failed: ${body.error ?? res.status}.]`,
      );
    } catch {
      // Réseau coupé : rien n'est sûr, la carte reste à confirmer avec un message (B7).
      setCard(item.id, { state: "network" });
    }
  }

  function cancel(item: Extract<Item, { kind: "confirm" }>) {
    setCard(
      item.id,
      { state: "cancelled", token: "" },
      `[The user clicked Cancel: the proposed ${item.summary.action} was not saved.]`,
    );
  }

  function reset() {
    update(() => EMPTY);
    setDraft("");
    inputRef.current?.focus();
  }

  const style = countryPack(country).amounts;
  const money = (cents: number, currency: string) => formatMoney(cents, currency, style);
  const dates = countryPack(country).dates;
  const names = (type: "language" | "region", code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  /**
   * Valeur d'une liste : d'abord celle propre au champ (« values.claimKind.expense »), puis les
   * libellés des écrans de l'application (unités, codes TVA, types de comptes…), enfin la liste
   * commune de la bulle.
   */
  const enumValue = (value: string, key?: string) => {
    if (key && tc.has(`values.${key}.${value}`)) return tc(`values.${key}.${value}`);
    const source = key ? ENUM_SOURCES[key] : undefined;
    if (source && ta.has(`${source}.${value}`)) return ta(`${source}.${value}`);
    return tc.has(`values.${value}`) ? tc(`values.${value}`) : value;
  };
  // Français : espace fine insécable ; anglais : collé ; autres langues : espace.
  const percent = (value: string) =>
    locale === "fr" ? `${value}\u202f%` : locale === "en" ? `${value}%` : `${value} %`;
  /** Valeur d'un champ du résumé, selon sa présentation ; vide : « (vide) ». */
  const shownValue = (f: Field, value: string) => {
    if (value === "") return tc("values.empty");
    if (f.key === "role" || f.key.endsWith(".role"))
      return value
        .split("+")
        .map((v) => enumValue(v))
        .join(", ");
    switch (f.format ?? KEY_FORMATS[f.key]) {
      case "date":
        return formatDate(value, dates);
      case "money":
        return money(Number(value), f.currency ?? "");
      case "minutes":
        return tc("values.hours", { time: hoursMinutes(Number(value)) });
      case "percent":
        return percent(value);
      case "bool":
        return tc(value === "true" ? "values.yes" : "values.no");
      case "month":
        return tc("values.everyMonths", { count: Number(value) });
      case "enum":
        return enumValue(value, f.key);
    }
    if (f.key === "language" || f.key.endsWith(".language")) return names("language", value);
    if (f.key === "country" || f.key.endsWith(".country")) return names("region", value);
    return value;
  };
  const fieldLabel = (key: string) => {
    if (tc.has(`fields.${key}`)) return tc(`fields.${key}`);
    // Réglages de l'entreprise : les libellés de l'écran, selon le pays (USt-IdNr., SIRET, EIN…).
    if (key.startsWith("company.")) {
      const name = key.slice("company.".length);
      const label = COMPANY_LABELS[name]?.[country] ?? name;
      if (ta.has(`company.fields.${label}`)) return ta(`company.fields.${label}`);
    }
    return key;
  };
  const title = (action: string) => (tc.has(`titles.${action}`) ? tc(`titles.${action}`) : action);
  /** Nom de l'écran ouvert par la bulle (B5), jamais son chemin. */
  const screenName = (it: Extract<Item, { kind: "navigated" }>) =>
    pageLabel(it.path, (key) => ta(key)) ?? it.label ?? ta("nav.dashboard");
  /** Ligne « Enregistré : … » d'un lot : chaque groupe et son nombre. */
  const batchLabel = (s: Summary) =>
    (s.groups ?? []).map((g) => `${title(g.action)} (${g.count})`).join(", ");

  const linesTable = (lines: Line[], currency: string) => (
    <table className="w-full table-fixed border-t border-line text-[12px]">
      <thead className="bg-head text-ink-muted">
        <tr>
          <th className="px-3 py-1 text-left font-semibold">{tc("columns.description")}</th>
          <th className="w-12 px-1 py-1 text-right font-semibold">{tc("columns.quantity")}</th>
          <th className="w-28 px-3 py-1 text-right font-semibold">{tc("columns.amount")}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={`${i}-${l.description}`} className="border-t border-line-cell">
            <td className="break-words px-3 py-1">{l.description}</td>
            <td className="px-1 py-1 text-right">{l.quantity}</td>
            <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">
              {money(l.netCents, currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const totalsList = (totals: Totals) => (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-line px-3 py-2 text-[13px] tabular-nums">
      <dt className="text-ink-muted">{tc("net")}</dt>
      <dd className="text-right">{money(totals.netCents, totals.currency)}</dd>
      {totals.vatCents !== 0 && (
        <>
          <dt className="text-ink-muted">{tc("tax")}</dt>
          <dd className="text-right">{money(totals.vatCents, totals.currency)}</dd>
        </>
      )}
      <dt className="font-bold">{tc("total")}</dt>
      <dd className="text-right font-bold">{money(totals.totalCents, totals.currency)}</dd>
    </dl>
  );

  return (
    <>
      {!open && (
        <button
          ref={bubbleRef}
          type="button"
          data-testid="assistant-bubble"
          aria-label={t("open")}
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center border-2 border-white bg-accent text-white outline-offset-2 hover:bg-accent-dark focus-visible:outline-2 focus-visible:outline-accent print:hidden sm:right-6 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))]"
          style={{ borderRadius: "50%" }}
        >
          <Sparkles aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          data-testid="assistant-panel"
          // B9 : plein écran jusqu'à 640 px compris, jamais imprimé.
          className="fixed inset-0 z-[60] flex flex-col border-line-strong bg-panel text-ink print:hidden min-[641px]:inset-auto min-[641px]:right-6 min-[641px]:bottom-6 min-[641px]:z-40 min-[641px]:h-[600px] min-[641px]:max-h-[calc(100dvh-3rem)] min-[641px]:w-[400px] min-[641px]:max-w-[calc(100vw-3rem)] min-[641px]:border"
        >
          <header className="flex items-center gap-2 border-b border-line-strong bg-accent px-4 py-3 text-white">
            <Sparkles aria-hidden="true" className="h-5 w-5 shrink-0" />
            <h2 id={titleId} className="flex-1 text-[15px] font-extrabold tracking-[-0.01em]">
              {t("title")}
            </h2>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              data-testid="assistant-new"
              className="border border-white/70 px-2 py-1 text-[12px] font-semibold hover:bg-accent-dark disabled:opacity-60"
            >
              {t("newConversation")}
            </button>
            <button
              type="button"
              onClick={close}
              aria-label={t("close")}
              data-testid="assistant-close"
              className="flex h-8 w-8 items-center justify-center hover:bg-accent-dark"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </header>

          <div
            ref={threadRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[14px] leading-[1.5]"
            aria-live="polite"
            data-testid="assistant-thread"
          >
            {data.items.length === 0 && (
              <div className="space-y-3">
                <p className="text-ink-2">{t("intro")}</p>
                <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  {t("suggestionsLabel")}
                </p>
                <ul className="space-y-2">
                  {(["overdue", "draft", "collected"] as const).map((k) => (
                    <li key={k}>
                      <button
                        type="button"
                        data-testid={`assistant-suggestion-${k}`}
                        onClick={() => send(t(`suggestions.${k}`))}
                        disabled={busy}
                        className="w-full border border-line-strong bg-paper px-3 py-2 text-left hover:border-accent hover:bg-accent-veil"
                      >
                        {t(`suggestions.${k}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.items.map((it) => {
              if (it.kind === "user")
                return (
                  <div
                    key={it.id}
                    className="ml-8 border border-accent-pale bg-accent-veil px-3 py-2"
                  >
                    <span className="sr-only">{t("you")}: </span>
                    <p className="whitespace-pre-wrap break-words">{it.text}</p>
                  </div>
                );
              if (it.kind === "assistant")
                return (
                  <div
                    key={it.id}
                    className="mr-4 border-l-2 border-accent px-3 py-1"
                    data-testid="assistant-reply"
                  >
                    <span className="sr-only">{t("assistant")}: </span>
                    <p className="whitespace-pre-wrap break-words">{replyNodes(it.text, locale)}</p>
                  </div>
                );
              if (it.kind === "notice")
                return (
                  <div
                    key={it.id}
                    role="alert"
                    data-testid="assistant-notice"
                    data-code={it.code}
                    className="border border-hot-bg bg-hot-bg px-3 py-2 text-hot-fg"
                  >
                    <p>
                      {t.has(`errors.${it.code}`)
                        ? t(`errors.${it.code}`)
                        : t("errors.unavailable")}
                    </p>
                    {/* B3 : un fil refusé ne peut pas continuer ; le bouton est dans le message. */}
                    {it.code === "history" && (
                      <button
                        type="button"
                        onClick={reset}
                        disabled={busy}
                        data-testid="assistant-reset-inline"
                        className="mt-2 border border-hot-fg px-2 py-1 text-[12px] font-semibold hover:bg-white disabled:opacity-60"
                      >
                        {t("newConversation")}
                      </button>
                    )}
                  </div>
                );
              if (it.kind === "navigated")
                return (
                  <p
                    key={it.id}
                    className="text-[12px] text-ink-muted"
                    data-testid="assistant-navigated"
                  >
                    {t("opened", { label: screenName(it) })}
                  </p>
                );
              const s = it.summary;
              return (
                <div
                  key={it.id}
                  className="border border-line-strong bg-paper"
                  data-testid="assistant-confirm-card"
                  data-state={it.state}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                    <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                      {tc("heading")}
                    </span>
                    <span className="text-right text-[13px] font-bold">
                      {s.groups ? tc("batchTitle", { count: s.count ?? 0 }) : title(s.action)}
                    </span>
                  </div>
                  {s.fields.length > 0 && (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                      {s.fields.map((f) => (
                        <div key={f.key} className="contents">
                          <dt className="text-ink-muted">{fieldLabel(f.key)}</dt>
                          <dd className="break-words font-medium" data-testid="assistant-field">
                            {f.before !== undefined && (
                              <>
                                <span className="font-normal text-ink-muted line-through">
                                  {shownValue(f, f.before)}
                                </span>{" "}
                                <span aria-hidden="true">→</span>{" "}
                                <span className="sr-only">{tc("becomes")} </span>
                              </>
                            )}
                            {shownValue(f, f.value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {s.groups && (
                    <div className="px-3 py-2 text-[13px]" data-testid="assistant-batch">
                      {s.groups.map((g) => (
                        <section key={g.action} className="py-1">
                          <h3 className="text-[12px] font-bold">
                            {title(g.action)} ({g.count})
                          </h3>
                          <ul className="mt-1 space-y-1">
                            {g.items.map((item, i) => (
                              <li
                                key={`${g.action}-${i}-${item.label}`}
                                className="border-l-2 border-line pl-2"
                              >
                                <span className="break-words">
                                  {[
                                    item.detail
                                      ? enumValue(item.detail, DETAIL_KEYS[item.action])
                                      : "",
                                    item.label,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                                {item.amountCents !== undefined && !item.totals && (
                                  <span className="ml-2 whitespace-nowrap tabular-nums text-ink-muted">
                                    {money(item.amountCents, item.currency ?? "")}
                                    {item.unit ? ` · ${enumValue(item.unit, "unit")}` : ""}
                                  </span>
                                )}
                                {item.lines && item.lines.length > 0 && (
                                  <div className="mt-1 border border-line">
                                    {linesTable(item.lines, item.totals?.currency ?? "")}
                                    {item.totals && totalsList(item.totals)}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                          {g.count > g.items.length && (
                            <p className="mt-1 text-[12px] text-ink-muted">
                              {tc("more", { count: g.count - g.items.length })}
                            </p>
                          )}
                        </section>
                      ))}
                    </div>
                  )}
                  {s.lines && s.lines.length > 0 && linesTable(s.lines, s.totals?.currency ?? "")}
                  {s.totals && totalsList(s.totals)}
                  {s.notes && s.notes.length > 0 && (
                    <ul className="space-y-1 border-t border-line px-3 py-2 text-[12px] text-ink-2">
                      {s.notes.map((n) => (
                        <li key={n}>{tc.has(`notes.${n}`) ? tc(`notes.${n}`) : n}</li>
                      ))}
                    </ul>
                  )}
                  <div className="border-t border-line px-3 py-2">
                    {(it.state === "pending" ||
                      it.state === "saving" ||
                      it.state === "network") && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid="assistant-confirm"
                          onClick={() => confirm(it)}
                          disabled={it.state === "saving"}
                          className="bg-accent px-3 py-1.5 text-[13px] font-bold text-white hover:bg-accent-dark disabled:opacity-60"
                        >
                          {it.state === "saving" ? tc("saving") : tc("confirm")}
                        </button>
                        <button
                          type="button"
                          data-testid="assistant-cancel"
                          onClick={() => cancel(it)}
                          disabled={it.state === "saving"}
                          className="border border-line-strong px-3 py-1.5 text-[13px] font-semibold hover:border-ink-3"
                        >
                          {tc("cancel")}
                        </button>
                      </div>
                    )}
                    {it.state === "done" && it.result && (
                      <p
                        className="flex flex-wrap items-center gap-2 text-[13px]"
                        data-testid="assistant-done"
                      >
                        <span className="font-semibold text-ink">
                          {tc("done", {
                            label: s.groups ? batchLabel(s) : it.result.label || title(s.action),
                          })}
                        </span>
                        <Link href={it.result.path} className="font-bold text-accent underline">
                          {tc("open")}
                        </Link>
                      </p>
                    )}
                    {it.state === "cancelled" && (
                      <p className="text-[13px] text-ink-muted">{tc("cancelled")}</p>
                    )}
                    {CARD_ERRORS.includes(it.state) && (
                      <p
                        role="alert"
                        data-testid="assistant-card-error"
                        className={`text-[13px] text-hot-fg${it.state === "network" ? " mt-2" : ""}`}
                      >
                        {tc(it.state)}
                      </p>
                    )}
                    {it.state === "session" && (
                      <p role="alert" className="text-[13px] text-hot-fg">
                        {t("errors.session")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {busy && (
              <p
                className="text-[13px] font-semibold text-ink-3"
                data-testid="assistant-working"
                role="status"
              >
                {t("working")}
              </p>
            )}
          </div>

          <form
            className="flex flex-wrap items-end gap-2 border-t border-line-strong bg-panel p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <label htmlFor={`${panelId}-input`} className="sr-only">
              {t("inputLabel")}
            </label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              data-testid="assistant-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              disabled={busy}
              rows={2}
              maxLength={4000}
              placeholder={t("placeholder")}
              aria-describedby={noteId}
              // B9 : 16 px au téléphone, sinon iOS agrandit la page à la saisie.
              className="max-h-40 min-h-[44px] flex-1 resize-none border border-line-strong bg-white px-3 py-2 text-[16px] text-ink outline-none focus:border-accent disabled:bg-muted min-[641px]:text-[14px]"
            />
            <button
              type="submit"
              data-testid="assistant-send"
              disabled={busy || !draft.trim()}
              className="h-[44px] bg-accent px-4 text-[14px] font-bold text-white hover:bg-accent-dark disabled:opacity-50"
            >
              {t("send")}
            </button>
            {/* B11 : mention de prudence sous le champ. */}
            <p
              id={noteId}
              data-testid="assistant-disclaimer"
              className="w-full text-[12px] leading-[1.4] text-ink-muted"
            >
              {t("disclaimer")}
            </p>
          </form>
        </section>
      )}
    </>
  );
}
