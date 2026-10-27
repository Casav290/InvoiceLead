import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { extractText } from "unpdf";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { countryPack } from "@/countries";
import { forCountry } from "@/i18n/country";
import { isLocale, LOCALE_MENU, LOCALE_NAMES, LOCALES } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { accountName } from "@/lib/account-name";
import { defaultDocumentCurrency, regionCountry, regionDefaults } from "@/lib/region";
import { attachLeadIdentity } from "@/server/auth/attach";
import { pickLocale } from "@/server/auth/login-cookie";
import type { Invoice, InvoiceLine, PartySnapshot } from "@/server/db/schema";
import { documentLabels, kindNamespace } from "@/server/document-labels";
import { qrBillLanguage, renderInvoicePdf } from "@/server/invoice-pdf";
import { documentLanguage, INVOICE_LANGUAGES } from "@/server/invoices";
import { foreignWithoutPro } from "@/server/plans";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import it_ from "../../messages/it.json";
import { claims } from "../support/claims";
import { testDb } from "../support/db";

/**
 * Chantier « cinq langues partout » (27.10.2026) : allemand, français, anglais, italien et espagnol
 * dans l'interface, les documents et leurs PDF ; sélecteur de langue dans l'en-tête de l'espace ;
 * devise par défaut selon le pays de la personne qui ouvre l'entreprise.
 */

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, locale, ...rest }: Record<string, unknown>) =>
    createElement(
      "a",
      { ...rest, href: `/${String(locale ?? "fr")}${typeof href === "string" ? href : ""}` },
      children as never,
    ),
  usePathname: () => "/app/invoices/new",
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/fr/app/invoices/new",
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/[locale]/app/locale-actions", () => ({ chooseLocaleAction: async () => true }));

type Tree = { [key: string]: Node };
type Node = string | Node[] | Tree;
const MESSAGES = { de, fr, en, it: it_, es } as unknown as Record<string, Tree>;

describe("les cinq langues", () => {
  it("sont celles du routage, de l'interface et des documents", () => {
    expect([...LOCALES].sort()).toEqual(["de", "en", "es", "fr", "it"]);
    expect([...routing.locales]).toEqual([...LOCALES]);
    expect([...INVOICE_LANGUAGES]).toEqual([...LOCALES]);
    expect(LOCALE_MENU.map((l) => LOCALE_NAMES[l])).toEqual([
      "Français",
      "Deutsch",
      "English",
      "Italiano",
      "Español",
    ]);
    for (const l of LOCALES) {
      expect(isLocale(l)).toBe(true);
      expect(documentLanguage(l)).toBe(l);
      expect(pickLocale(l)).toBe(l);
    }
    expect(documentLanguage("pt")).toBe("de");
    expect(pickLocale("pt")).toBe("fr");
  });

  it("ont chacune leurs messages et leurs pages juridiques", () => {
    const files = readdirSync(join(__dirname, "../../messages"));
    const legal = readdirSync(join(__dirname, "../../content/legal"));
    for (const l of LOCALES) {
      expect(files).toContain(`${l}.json`);
      for (const doc of ["imprint", "privacy", "terms", "dpa"])
        expect(legal).toContain(`${doc}-${l}.md`);
    }
  });

  it("nomment les comptes des plans modèles en italien et en espagnol", () => {
    const bank = { nameDe: "Bank", nameFr: "Banque", nameEn: null };
    expect(accountName(bank, "it")).toBe("Banca");
    expect(accountName(bank, "es")).toBe("Banco");
    // Compte saisi par l'entreprise : son libellé tel quel.
    expect(accountName({ nameDe: "Atelier", nameFr: "Atelier" }, "it")).toBe("Atelier");
  });
});

// --- Sélecteur de langue ---------------------------------------------------------------------

describe("sélecteur de langue de l'espace connecté", () => {
  it("est dans l'en-tête de chaque page connectée, dans chaque langue", async () => {
    const { AppHeader } = await import("@/components/app/AppHeader");
    for (const locale of LOCALES) {
      const html = renderToStaticMarkup(
        createElement(
          NextIntlClientProvider,
          { locale, messages: MESSAGES[locale], timeZone: "Europe/Zurich" } as never,
          createElement(AppHeader, {
            locale,
            orgId: "org",
            orgName: "Atelier",
            orgs: [],
            user: { name: "Ada Muster", email: "ada@atelier.test" },
            planCode: "free",
            planName: "Gratuit",
            apps: [],
          }),
        ),
      );
      expect(html).toContain('data-testid="locale-menu"');
      // Bouton : la langue courante sous son nom natif, et son code sur téléphone.
      expect(html).toContain(LOCALE_NAMES[locale]);
      expect(html).toContain(`>${locale}</span>`);
    }
    // L'en-tête est celui du gabarit de toutes les pages de /app.
    const layout = await import("node:fs").then((fs) =>
      fs.readFileSync(join(__dirname, "../../src/app/[locale]/app/layout.tsx"), "utf8"),
    );
    expect(layout).toContain("<AppHeader");
  });
});

// --- Devise selon la région -------------------------------------------------------------------

describe("devise par défaut selon le pays de la personne", () => {
  it("lit d'abord le pays de l'IP (Vercel), puis la langue du navigateur, puis celle du compte", () => {
    expect(regionCountry({ ipCountry: "FR", acceptLanguage: "de-CH" })).toBe("FR");
    expect(regionCountry({ ipCountry: "XX", acceptLanguage: "es-ES,es;q=0.9" })).toBe("ES");
    expect(regionCountry({ acceptLanguage: "fr;q=0.9,en-US;q=0.8" })).toBe("US");
    expect(regionCountry({ acceptLanguage: "de", accountLocale: "it-CH" })).toBe("CH");
    expect(regionCountry({})).toBeUndefined();
  });

  it("CH/LI en CHF, zone euro en EUR, US en USD, GB en GBP", () => {
    expect(regionDefaults("CH")).toEqual({ country: "CH", currency: "CHF", regionCurrency: null });
    expect(regionDefaults("LI")).toEqual({ country: "CH", currency: "CHF", regionCurrency: null });
    expect(regionDefaults("FR")).toEqual({ country: "FR", currency: "EUR", regionCurrency: null });
    expect(regionDefaults("DE")).toEqual({ country: "DE", currency: "EUR", regionCurrency: null });
    expect(regionDefaults("US")).toEqual({ country: "US", currency: "USD", regionCurrency: null });
    expect(regionDefaults("GB")).toEqual({ country: "GB", currency: "GBP", regionCurrency: null });
    for (const c of ["IT", "ES", "AT", "BE", "NL", "PT"])
      expect(regionDefaults(c)).toEqual({ country: "CH", currency: "CHF", regionCurrency: "EUR" });
    expect(regionDefaults("JP")).toBeUndefined();
  });

  it("la devise du pays de la personne n'est jamais réservée à Pro, les autres oui", () => {
    const free = {
      leadPlan: "free",
      entitlements: null,
      entitlementsAt: null,
      billingPlan: null,
      billingPlanUntil: null,
    };
    const fr = { ...free, currency: "EUR", regionCurrency: null };
    expect(foreignWithoutPro(fr, "EUR")).toBe(false);
    expect(foreignWithoutPro(fr, "CHF")).toBe(true);
    const us = { ...free, currency: "USD", regionCurrency: null };
    expect(foreignWithoutPro(us, "USD")).toBe(false);
    expect(foreignWithoutPro(us, "EUR")).toBe(true);
    const italy = { ...free, currency: "CHF", regionCurrency: "EUR" };
    expect(foreignWithoutPro(italy, "EUR")).toBe(false);
    expect(foreignWithoutPro(italy, "CHF")).toBe(false);
    expect(foreignWithoutPro(italy, "USD")).toBe(true);
    expect(defaultDocumentCurrency(italy)).toBe("EUR");
    expect(defaultDocumentCurrency(fr)).toBe("EUR");
  });

  describe("à l'ouverture de l'entreprise", () => {
    const t = testDb();
    beforeAll(() => {
      process.env.APP_URL = "http://localhost:3000";
    });
    beforeEach(() => t.reset());
    afterAll(() => t.close());

    it("une personne française ouvre une entreprise française en euros", async () => {
      const { organization } = await attachLeadIdentity(t.database, claims(), "FR");
      expect(organization).toMatchObject({ country: "FR", currency: "EUR", regionCurrency: null });
    });

    it("une personne américaine en dollars, une suisse en francs, une britannique en livres", async () => {
      const us = await attachLeadIdentity(
        t.database,
        claims({ org: "org-us", sub: "s-us", email: "us@x.test" }),
        "US",
      );
      expect(us.organization).toMatchObject({ country: "US", currency: "USD" });
      const ch = await attachLeadIdentity(
        t.database,
        claims({ org: "org-ch", sub: "s-ch", email: "ch@x.test" }),
        "CH",
      );
      expect(ch.organization).toMatchObject({ country: "CH", currency: "CHF" });
      const gb = await attachLeadIdentity(
        t.database,
        claims({ org: "org-gb", sub: "s-gb", email: "gb@x.test" }),
        "GB",
      );
      expect(gb.organization).toMatchObject({ country: "GB", currency: "GBP" });
    });

    it("une personne italienne : l'euro par défaut, et sa langue gardée", async () => {
      const { organization, user } = await attachLeadIdentity(
        t.database,
        claims({ locale: "it-IT" }),
        "IT",
      );
      expect(organization).toMatchObject({ country: "CH", currency: "CHF", regionCurrency: "EUR" });
      expect(user.locale).toBe("it");
      expect(organization.defaultLocale).toBe("it");
    });

    it("une entreprise qui existe déjà ne change ni de pays ni de devise", async () => {
      await attachLeadIdentity(t.database, claims(), "FR");
      const again = await attachLeadIdentity(t.database, claims(), "US");
      expect(again.organization).toMatchObject({ country: "FR", currency: "EUR" });
    });
  });
});

// --- Documents et PDF dans les cinq langues ----------------------------------------------------

const PARTY: Record<"CH" | "FR" | "US", PartySnapshot> = {
  CH: {
    name: "Atelier Muster GmbH",
    street: "Bahnhofstrasse",
    buildingNumber: "1",
    postalCode: "8001",
    town: "Zürich",
    country: "CH",
    iban: "CH9300762011623852957",
    vatNumber: "CHE-123.456.788 MWST",
  } as PartySnapshot,
  FR: {
    name: "Atelier Dupont SARL",
    street: "Rue de Rivoli",
    buildingNumber: "12",
    postalCode: "75001",
    town: "Paris",
    country: "FR",
    iban: "FR1420041010050500013M02606",
    vatNumber: "TVA FR40303265045",
  } as PartySnapshot,
  US: {
    name: "Smith Studio LLC",
    street: "Main Street",
    buildingNumber: "100",
    postalCode: "10001",
    town: "New York",
    region: "NY",
    country: "US",
  } as PartySnapshot,
};
const RATE = { CH: 810, FR: 2000, US: 887 } as const;
type Kind = "invoice" | "credit_note" | "quote";

function fixture(country: keyof typeof RATE, language: string, kind: Kind) {
  const net = 100_000;
  const vat = Math.round((net * RATE[country]) / 10_000);
  const invoice = {
    id: `doc-${country}-${kind}`,
    organizationId: "org",
    contactId: "contact",
    kind,
    number: kind === "quote" ? "O-2026-0001" : kind === "credit_note" ? "G-2026-0001" : "2026-0001",
    status: "issued",
    sourceQuoteId: null,
    relatedInvoiceId: kind === "credit_note" ? "inv" : null,
    language,
    currency: countryPack(country).currency,
    fxRate: null,
    title: null,
    introText: null,
    footerText: null,
    issueDate: "2026-10-24",
    serviceDate: "2026-10-20",
    dueDate: "2026-11-23",
    vatRegistered: true,
    netCents: net,
    vatCents: vat,
    totalCents: net + vat,
    recipient: { ...PARTY[country], name: "Cliente SA", iban: null, vatNumber: null },
    sender: PARTY[country],
    paymentReference: null,
    deposit: false,
  } as unknown as Invoice;
  const lines = [
    {
      id: "l1",
      invoiceId: invoice.id,
      position: 1,
      productId: null,
      description: "Consulenza / Consultoría",
      quantityMilli: 10_000,
      unit: "hour",
      unitPriceCents: 10_000,
      vatCode: "normal",
      vatRateBp: RATE[country],
      netCents: net,
    },
  ] as unknown as InvoiceLine[];
  return { invoice, lines };
}

const tr = (language: string, namespace: string) =>
  createTranslator({
    locale: language,
    messages: MESSAGES[language] as never,
    namespace: namespace as never,
  }) as never;

function labelsOf(country: keyof typeof RATE, language: string, kind: Kind) {
  const { invoice, lines } = fixture(country, language, kind);
  return {
    lines,
    ...documentLabels({
      source: invoice,
      lines,
      related: kind === "credit_note" ? { number: "2026-0001" } : null,
      variant: null,
      t: tr(language, "app.invoices.document"),
      tk: tr(language, kindNamespace(kind)),
      tu: tr(language, "app.invoices.units"),
      poweredBy: false,
    }),
  };
}

async function pdfText(country: keyof typeof RATE, language: string, kind: Kind) {
  const { invoice, lines, labels } = labelsOf(country, language, kind);
  const pdf = await renderInvoicePdf(invoice, lines, labels);
  const { text } = await extractText(new Uint8Array(pdf), { mergePages: true });
  // Les en-têtes de colonnes sont imprimés en capitales : comparaison sans la casse.
  return text.replace(/\s+/g, " ").toLowerCase();
}

/** Textes fixes imprimés sur toute pièce, dans la langue donnée. */
function fixedTexts(country: keyof typeof RATE, language: string, kind: Kind): string[] {
  const { labels } = labelsOf(country, language, kind);
  const out = [
    labels.invoice,
    labels.issueDate,
    labels.description,
    labels.quantity,
    labels.unitPrice,
    labels.amount,
    labels.net,
    labels.total,
    labels.units.hour ?? "",
  ];
  if (kind === "credit_note" && labels.relatedLine) out.push(labels.relatedLine);
  return out.filter((s) => s.trim().length > 0).map((s) => s.replace(/\s+/g, " ").toLowerCase());
}

describe("factures, notes de crédit et devis dans les cinq langues", () => {
  for (const country of ["CH", "FR", "US"] as const)
    for (const kind of ["invoice", "credit_note", "quote"] as const)
      it(`${kind} ${country} : chaque texte fixe du PDF est dans la langue de la pièce`, async () => {
        for (const language of LOCALES) {
          const text = await pdfText(country, language, kind);
          for (const fixed of fixedTexts(country, language, kind))
            expect(text, `${language} : « ${fixed} »`).toContain(fixed);
          // Aucun texte fixe d'une autre langue quand il diffère de celui-ci (« Rechnung » sur une
          // facture italienne, « Invoice » sur une espagnole…).
          const own = new Set(fixedTexts(country, language, kind));
          // Section paiement de la QR-facture : textes de la norme SIX, en anglais pour l'espagnol.
          const body = text.split(/ (receipt|ricevuta|empfangsschein|récépissé) /)[0] ?? text;
          for (const other of LOCALES.filter((l) => l !== language))
            for (const foreign of fixedTexts(country, other, kind).filter(
              (s) => s.length > 5 && !own.has(s) && ![...own].some((o) => o.includes(s)),
            ))
              expect(body, `${language} contient « ${foreign} » (${other})`).not.toContain(foreign);
        }
      });

  it("QR-facture : section paiement en italien, en anglais pour l'espagnol (norme SIX)", async () => {
    expect(qrBillLanguage("it")).toBe("IT");
    expect(qrBillLanguage("es")).toBe("EN");
    expect(qrBillLanguage("fr")).toBe("FR");
    expect(qrBillLanguage("de")).toBe("DE");
    const italian = await pdfText("CH", "it", "invoice");
    expect(italian).toContain("sezione pagamento");
    expect(italian).toContain("ricevuta");
    const spanish = await pdfText("CH", "es", "invoice");
    expect(spanish).toContain("payment part");
    expect(spanish).toContain("factura");
  });

  it("e-mails au client (envoi, relances) dans les cinq langues, sans clé brute", () => {
    const values = {
      number: "2026-0001",
      company: "Atelier",
      amount: "1'081.00",
      currency: "CHF",
      due: "23.11.2026",
      link: "https://invoicelead.io/d/x",
      total: "1'081.00",
      open: "1'081.00",
      date: "24.10.2026",
      days: "3",
      fee: "20.00",
      interest: "5 %",
      charges: "",
    };
    const seen = new Map<string, string>();
    for (const language of LOCALES) {
      const email = forCountry(tr(language, "app.invoices.email"), "CH") as unknown as (
        k: string,
        v?: object,
      ) => string;
      const reminders = tr(language, "app.reminders.email") as unknown as (
        k: string,
        v?: object,
      ) => string;
      for (const kind of ["invoice", "quote", "credit_note"]) {
        const subject = email(`subjects.${kind}`, values);
        const body = email(`bodies.${kind}`, values);
        expect(subject).not.toMatch(/app\.|subjects\./);
        expect(body.length).toBeGreaterThan(20);
        const key = `${kind}:${subject}`;
        expect(seen.has(key), `${language} reprend l'objet ${seen.get(key)}`).toBe(false);
        seen.set(key, language);
      }
      for (const level of ["0", "1", "2", "3"]) {
        expect(reminders(`subject${level}`, values)).not.toMatch(/app\.|subject\d/);
        expect(reminders(`body${level}`, values).length).toBeGreaterThan(20);
      }
    }
  });
});
