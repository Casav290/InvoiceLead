import { GUIDES } from "@/lib/guides";
import { SITE } from "@/lib/seo";

export const dynamic = "force-static";

/** /llms.txt : résumé d'InvoiceLead pour les assistants IA (anglais), pages clés et guides. */
export function GET() {
  const guides = GUIDES.map((g) => `- [${g.h1}](${SITE}/${g.lang}/${g.slug}) (${g.lang})`);
  const body = `# InvoiceLead

> InvoiceLead is online invoicing and double-entry accounting software for freelancers and small businesses in the United States, the United Kingdom, Germany, France and Switzerland. Quotes, invoices that follow each country's rules, payment reminders, receipts read by AI from a photo, supplier bills, bank statement matching and prepared tax returns. Free plan with no time limit and no credit card. Published by Quantum Liquid LLC, 30 N Gould St, Sheridan, WY 82801, USA.

## Key facts

- Countries: United States (sales tax, Letter paper, EIN, sales tax report), United Kingdom (VAT 20% and 5%, VAT and Companies House numbers checked, 9-box MTD figures prepared), Germany (USt 19% and 7%, GiroCode, XRechnung and ZUGFeRD e-invoices, SKR04, UStVA, small business rule § 19 UStG), France (TVA 20/10/5.5%, SIRET checked, GiroCode, Factur-X, PCG, CA3, VAT franchise art. 293 B), Switzerland (Swiss QR-bill, VAT 8.1/2.6/3.8%, SME chart of accounts, AFC return with eCH-0217 XML).
- Documents in 5 languages: German, French, English, Italian, Spanish, chosen per client. Multi-currency (EUR, USD, GBP, CHF) with Pro.
- Free plan (EUR 0): 1 user, 1 company, 5 invoices per month, unlimited quotes, 50 contacts, 10 AI document reads per month, AI assistant (about 10 requests per month), 5 first-level reminders per month, 1 active recurring invoice, 1 bank statement per month, double-entry accounting.
- Pro (EUR 19 per month excl. VAT, or EUR 190 per year): unlimited invoices and contacts, free access for your accountant, 50 AI reads per month, unlimited assistant, automatic 3-level reminders with fees and late interest, tax returns, unlimited camt bank imports, multi-currency. Pro+ (EUR 39 per month): 5 users with roles, 300 AI reads, API, MCP server and webhooks.
- AI assistant: answers questions from your books and proposes changes (quote or invoice drafts, contacts, products, time, expenses, supplier bills) on a confirmation card that shows everything that will be written; nothing is saved until you click Confirm; one card can group up to 150 operations. It never deletes, pays or sends anything outside.
- Tax returns are prepared, ready to copy; filing with the tax authority stays with you.
- One Lead account (ERPlead) signs in with Google, Apple or email and also opens ScanLead, CRMlead, ProjectLead and Greetlead. Each app has its own subscription.
- Data hosted in the United States (Vercel and Neon, Ohio), encrypted in transit and at rest; export at any time and for 30 days after cancellation.

## Main pages

- [Home (English)](${SITE}/en)
- [Pricing](${SITE}/en/pricing)
- [FAQ](${SITE}/en/faq)
- [Startseite (Deutsch)](${SITE}/de)
- [Accueil (français)](${SITE}/fr)
- [Home (italiano)](${SITE}/it)
- [Inicio (español)](${SITE}/es)
- [Legal notice](${SITE}/en/legal/imprint)
- [Privacy policy](${SITE}/en/legal/privacy)
- [Terms](${SITE}/en/legal/terms)

## Guides

${guides.join("\n")}

## The Lead suite

- [ERPlead](https://erplead.io): the Lead account, one sign-in for every app
- [ScanLead](https://scanlead.io): trade show lead capture
- [CRMlead](https://crmlead.io): CRM that follows leads through to the sale
- [ProjectLead](https://projectlead.io): projects, tasks and time
- [Greetlead](https://greetlead.io): the card the whole team signs
- [VisitLead](https://visitlead.io): see which companies visit your website
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
