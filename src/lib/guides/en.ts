import type { Guide } from "./types";

/** English keyword pages (US spelling). Facts from messages/en.json, docs/PAYS.md, docs/XRECHNUNG.md, src/server/plans.ts. */
export const GUIDES_EN: Guide[] = [
  {
    slug: "free-invoicing-software",
    lang: "en",
    group: "free",
    keyword: "free invoicing software",
    source: "Google Suggest en-US, 04.11.2026",
    title: "Free Invoicing Software for Europe and the US",
    description:
      "Free invoicing software with no credit card, no time limit: 5 invoices a month, unlimited quotes, AI receipt reading. US, UK, Germany, France, Switzerland.",
    eyebrow: "Free plan",
    h1: "Free invoicing software that follows your country's rules",
    lede: "InvoiceLead has a Free plan with no credit card and no time limit. You get real invoices for your country, unlimited quotes and accounting that fills in from your invoices.",
    linkLabel: "Free invoicing software",
    shot: "invoice-pdf",
    shotAlt: "Invoice PDF created in InvoiceLead, with line items, sales tax and the amount due",
    sections: [
      {
        h2: "What the Free plan includes, in numbers",
        paras: [
          "The Free plan costs €0. It is not a trial: there is no end date and no card to enter. The limits are monthly and they are written down, so you know exactly where you stand.",
        ],
        bullets: [
          "1 user and 1 company",
          "5 invoices a month, unlimited quotes",
          "50 contacts",
          "10 receipts and documents read by AI each month, e-invoices received without limit",
          "The AI assistant: the equivalent of 10 requests a month",
          "First reminder sent by hand, 5 a month",
          "1 active recurring invoice",
          "1 bank statement a month (one account, one month at most) with the autopilot",
          "A “Created with InvoiceLead” notice on your documents",
        ],
      },
      {
        h2: "Invoices for five countries, not one",
        paras: [
          "InvoiceLead serves companies in the United States, the United Kingdom, Germany, France and Switzerland. Your company's country sets the currency, the tax rates, the number checks and the layout of each document.",
          "In the US you get sales tax at the combined rate you enter, Letter paper and your EIN. In the UK, VAT at 20% and 5% with VAT and Companies House numbers checked. Germany gets USt at 19% and 7%, a GiroCode and XRechnung or ZUGFeRD e-invoices. France gets TVA at 20%, 10% and 5.5%, a checked SIRET, a GiroCode and Factur-X. Switzerland gets the SIX QR-bill and VAT at 8.1%, 2.6% and 3.8%.",
          "Documents can be written in German, French, English, Italian or Spanish, chosen per client.",
        ],
      },
      {
        h2: "Accounting is already in the Free plan",
        paras: [
          "Every invoice you send and every payment you record creates its entries in double-entry accounting, on a chart of accounts for your country: US and UK charts, SKR04 in Germany, PCG in France, the Swiss SME chart. The balance sheet and income statement are there too.",
          "The dashboard shows this month's and this year's revenue, what is outstanding, what is overdue, and your last twelve months in one chart.",
        ],
      },
      {
        h2: "The AI assistant works on your own books",
        paras: [
          "Ask the assistant a question and it answers from your invoices, quotes, customers and figures. It can also propose changes: a draft quote or invoice, contacts, items, time entries, expenses or supplier invoices.",
          "Each proposal appears on a “To confirm” card that shows everything that will be written. Nothing is saved until you click “Confirm”. One card can group up to 150 operations, applied in one click, all or nothing. The assistant never deletes anything, never pays anything and never sends anything outside: it opens the right screen for you instead.",
          "On the Free plan you get the equivalent of 10 requests a month. Pro has no limit.",
        ],
      },
      {
        h2: "Built for freelancers and small businesses",
        paras: [
          "The Free plan is designed for getting started as a freelancer: one person, one company, a few invoices a month. When you invoice every week, Pro removes the caps.",
          "Pro features stay visible in the app, greyed out with their Pro or Pro+ badge. You see what they do before you decide to pay for anything.",
        ],
      },
      {
        h2: "When you outgrow the free tier",
        paras: [
          "Pro costs €19 a month excluding VAT, or €190 a year. It adds unlimited invoices and contacts, free access for your accountant, 50 AI reads a month, an unlimited assistant, automatic reminders on three levels with fees and late interest, tax returns for your country, unlimited camt bank import and multi-currency in USD, EUR, GBP and CHF.",
          "Pro+ costs €39 a month for 5 users with roles, 300 AI reads a month, an API, an MCP server and webhooks. Plans are billed in euros by Quantum Liquid LLC and you can cancel at any time.",
        ],
      },
    ],
    faq: [
      {
        q: "Is the free invoicing software really free?",
        a: "Yes. The Free plan costs €0, asks for no credit card and has no time limit. Its limits are monthly: 5 invoices, 10 AI reads, about 10 assistant requests and 5 first reminders.",
      },
      {
        q: "Can I send quotes on the Free plan?",
        a: "Yes, quotes are unlimited. Only invoices are capped at 5 a month. An accepted quote turns into an invoice in one click.",
      },
      {
        q: "Does the Free plan file my tax return?",
        a: "No. Tax returns are part of Pro, and even then InvoiceLead prepares the figures: you submit the return on your tax authority's portal yourself.",
      },
      {
        q: "Where is my data stored?",
        a: "In the United States (Vercel and Neon, Ohio), encrypted in transit and at rest. You can export your data at any time, and for 30 days after you cancel.",
      },
      {
        q: "How do I sign in?",
        a: "With Google, Apple or your email address, through the free Lead account (ERPlead). The same login opens ScanLead, CRMlead, ProjectLead and Greetlead.",
      },
    ],
    related: [
      "invoicing-software-for-freelancers",
      "quote-and-invoice-software",
      "receipt-scanner-app",
      "quickbooks-alternative",
    ],
  },
  {
    slug: "invoicing-software-for-freelancers",
    lang: "en",
    group: "independent",
    keyword: "invoicing software for freelancers",
    source: "Google Suggest en-US, 04.11.2026",
    title: "Invoicing Software for Freelancers, Free to Start",
    description:
      "Invoicing software for freelancers: quotes, invoices, time tracking and receipts read by AI. Free plan, no card. US, UK, Germany, France, Switzerland.",
    eyebrow: "For freelancers",
    h1: "Invoicing software for freelancers who would rather do the work",
    lede: "Send a quote, turn it into an invoice, bill your hours and snap your receipts. InvoiceLead keeps your books in order while you work, and the Free plan has no time limit.",
    linkLabel: "Invoicing for freelancers",
    shot: "quote-desktop",
    shotAlt: "Open quote for a client in InvoiceLead, with its lines, total and validity date",
    sections: [
      {
        h2: "From quote to paid invoice, without retyping",
        paras: [
          "Your quotes are numbered and valid for 30 days. When the client accepts or declines, you record it with the date. An accepted quote becomes an invoice in one click, with nothing to type again.",
          "Each invoice carries the rates, numbers and required details of your country. Need to correct one? Issue a credit note.",
        ],
      },
      {
        h2: "Bill your hours in one click",
        paras: [
          "Track time with a timer or a quick entry, linked to a project. When the month ends, your billable hours become an invoice in one click. If you also use ProjectLead, the hours come from there.",
          "The dashboard tells you this month's revenue, what is outstanding and what is overdue, so you know who to follow up with before you open a list.",
        ],
      },
      {
        h2: "Receipts from your phone, no app to install",
        paras: [
          "Open InvoiceLead from your phone's home screen and take a photo of the receipt. The AI reads the amount, the date, the tax and the supplier, then suggests the account. You confirm, and the photo stays on file as the receipt.",
          "Supplier invoices work the same way, from a photo, a PDF or an e-invoice, with their due dates in view. Each one is booked in your accounts, so your accountant finds the expense next to its receipt.",
        ],
      },
      {
        h2: "The AI assistant: answers, and changes you confirm",
        paras: [
          "Ask “who still owes me money?” or “what did I invoice this quarter?” and the assistant answers from your own books. It can also propose changes: a draft quote or invoice, contacts, items, time entries, expenses or supplier invoices.",
          "Every proposal shows up on a “To confirm” card listing everything that will be written. Nothing is saved until you click “Confirm”. One card can hold up to 150 operations, applied in one click, all or nothing. The assistant does not delete, pay or send anything outside: it opens the screen for you instead.",
          "Free: the equivalent of 10 requests a month. Pro: no limit.",
        ],
      },
      {
        h2: "The Free plan fits a freelancer starting out",
        paras: [
          "The Free plan needs no credit card and has no time limit. It covers 1 user and 1 company, 5 invoices a month with unlimited quotes, 50 contacts, 10 receipts read by AI each month, 5 first reminders sent by hand, 1 active recurring invoice and 1 bank statement a month. Your documents carry a “Created with InvoiceLead” notice.",
          "Double-entry accounting is already included, fed by your invoices and payments.",
        ],
      },
      {
        h2: "Your country, your rules",
        paras: [
          "InvoiceLead works for freelancers and small businesses in the United States, the United Kingdom, Germany, France and Switzerland.",
        ],
        bullets: [
          "US: sales tax at your combined rate, Letter paper, EIN, sales tax report",
          "UK: VAT at 20% and 5%, 9-box MTD VAT return prepared",
          "Germany: Kleinunternehmer under § 19 UStG handled, XRechnung and ZUGFeRD",
          "France: VAT exemption “TVA non applicable, art. 293 B du CGI” handled, Factur-X",
          "Switzerland: SIX QR-bill, VAT return with eCH-0217 XML",
        ],
      },
    ],
    faq: [
      {
        q: "Is this invoicing software for freelancers free?",
        a: "The Free plan is: no card, no time limit, 5 invoices a month and unlimited quotes. Pro costs €19 a month excluding VAT when you need more.",
      },
      {
        q: "Can my accountant see my books?",
        a: "Yes, from the Pro plan on. Your accountant gets free access to your books and does not count as a paid user.",
      },
      {
        q: "Can I invoice clients abroad?",
        a: "Yes. Documents come in German, French, English, Italian or Spanish, chosen per client. Invoicing in another currency (USD, EUR, GBP, CHF) is part of Pro.",
      },
      {
        q: "Do late payment reminders go out on their own?",
        a: "On the Free plan you send the first reminder by hand, 5 a month. Pro sends reminders on three levels automatically every morning, with fees and late interest.",
      },
      {
        q: "Can I bill a monthly retainer automatically?",
        a: "Yes, with a recurring invoice. The Free plan includes 1 active recurring invoice, and Pro has no limit on recurring invoices.",
      },
    ],
    related: [
      "free-invoicing-software",
      "quote-and-invoice-software",
      "receipt-scanner-app",
      "invoice-reminder-software",
    ],
  },
  {
    slug: "receipt-scanner-app",
    lang: "en",
    group: "receipts",
    keyword: "receipt scanner app",
    source: 'Google Suggest en-US, 04.11.2026 (also "for business")',
    title: "Receipt Scanner App for Business, Read by AI",
    description:
      "A receipt scanner app for business with nothing to install: snap the receipt, AI reads amount, date and tax. 10 free reads a month, no card. US, UK and Europe.",
    eyebrow: "Expenses",
    h1: "A receipt scanner app that books the expense for you",
    lede: "Take a photo of the receipt from your phone's home screen. The AI reads it, suggests the account, and the expense is booked when you confirm.",
    linkLabel: "Receipt scanner app",
    shot: "capture-mobile",
    shotAlt: "Taking a photo of a receipt on a phone, with the amount, date and tax read by AI",
    sections: [
      {
        h2: "Three steps: snap it, AI reads it, confirm",
        paras: [
          "On site or at lunch, open InvoiceLead on your phone and photograph the receipt. You start it straight from your phone's home screen, with no app to install.",
          "The AI reads the amount, the date, the tax and the supplier in seconds, then suggests the account. One tap to confirm. The expense is booked and the photo stays attached to the entry as its receipt.",
        ],
      },
      {
        h2: "More than a scanner: the expense lands in your books",
        paras: [
          "A plain scanner gives you an image. Here, the receipt becomes an entry in double-entry accounting on your country's chart of accounts. The tax goes where it belongs, so the figures for your tax return are already in place.",
          "Supplier invoices are read too, from a photo, a PDF or an e-invoice. Their due dates stay in view, and you can create a pain.001 payment file for SEPA and Swiss banks.",
        ],
      },
      {
        h2: "Set up for five countries",
        paras: [
          "InvoiceLead works for businesses in the United States, the United Kingdom, Germany, France and Switzerland. Your company's country sets the tax: sales tax in the US, VAT in the UK, USt in Germany, TVA in France and Swiss VAT.",
          "With Pro, the tax return is prepared from your books: the sales tax report, the 9-box MTD VAT return, the UStVA, the CA3 or the Swiss VAT return. The figures are ready to copy across; you file the return yourself.",
        ],
      },
      {
        h2: "The AI assistant knows your expenses",
        paras: [
          "Ask the assistant what you spent with a supplier or which bills are due this week, and it answers from your books. It can also propose changes, such as expenses, supplier invoices, contacts, items, time entries or a draft invoice.",
          "Each proposal sits on a “To confirm” card that shows everything that will be written. Nothing is saved until you click “Confirm”. One card can group up to 150 operations, applied in one click, all or nothing. The assistant never deletes, never pays and never sends anything outside: it opens the right screen instead.",
          "Free plan: the equivalent of 10 requests a month. Pro: unlimited.",
        ],
      },
      {
        h2: "How many receipts you can scan for free",
        paras: [
          "The Free plan needs no credit card and has no time limit. It includes 10 receipts and documents read by AI each month, and e-invoices received without limit, since those are read without AI.",
          "Pro reads 50 documents a month for €19 a month excluding VAT. Pro+ reads 300 a month for €39 and adds 5 users with roles.",
        ],
        bullets: [
          "Free: 10 AI reads a month, 5 invoices, unlimited quotes, 50 contacts",
          "Pro: 50 AI reads a month, unlimited invoices, free accountant access",
          "Pro+: 300 AI reads a month, 5 users, API, MCP server and webhooks",
        ],
      },
      {
        h2: "For freelancers as much as small teams",
        paras: [
          "A freelancer with a handful of receipts a month can stay on the Free plan. A small business with more expenses moves to Pro, and its accountant gets free access to the books. Pro features stay visible in the app, greyed out with their badge, so nothing is hidden.",
        ],
      },
    ],
    faq: [
      {
        q: "Do I need to install a receipt scanner app?",
        a: "No. You open InvoiceLead from your phone's home screen and take the photo there. Nothing to download from an app store.",
      },
      {
        q: "What does the AI read on a receipt?",
        a: "The amount, the date, the tax and the supplier. It then suggests the account, and you confirm before anything is booked.",
      },
      {
        q: "Is the photo kept?",
        a: "Yes. The photo stays attached to the entry as its receipt, so you can show it to your accountant or the tax office.",
      },
      {
        q: "Can I scan supplier invoices too?",
        a: "Yes, from a photo or a PDF, and e-invoices are read without counting toward your AI reads. Due dates stay in view so you pay on time.",
      },
    ],
    related: [
      "free-invoicing-software",
      "invoicing-software-for-freelancers",
      "quickbooks-alternative",
    ],
  },
  {
    slug: "invoice-reminder-software",
    lang: "en",
    group: "reminders",
    keyword: "invoice reminder software",
    source: "Google Suggest en-US, 04.11.2026",
    title: "Invoice Reminder Software with 3 Levels",
    description:
      "Invoice reminder software that sorts overdue invoices and, with Pro, sends 3 levels each morning. Free plan, no card. US, UK, Germany, France, Switzerland.",
    eyebrow: "Payment reminders",
    h1: "Invoice reminder software that chases late payers for you",
    lede: "InvoiceLead sorts your overdue invoices by reminder level and tells you who to chase. With Pro, the reminders go out on their own every morning.",
    linkLabel: "Invoice reminders",
    shot: "reminders-desktop",
    shotAlt: "InvoiceLead reminders screen listing overdue invoices by reminder level",
    sections: [
      {
        h2: "Every overdue invoice, sorted by level",
        paras: [
          "The reminders screen lists the invoices past their due date and groups them by reminder level. You see at once which clients need a first nudge and which ones are already on their second or third reminder.",
          "The dashboard adds up what is outstanding and what is overdue, next to this month's revenue and a twelve-month chart.",
        ],
      },
      {
        h2: "Three levels, sent automatically with Pro",
        paras: [
          "With the Pro plan, reminders run on three levels, with reminder fees and late interest. They are sent automatically every morning, and their pace follows each client's payment profile.",
        ],
        bullets: [
          "Three reminder levels",
          "Reminder fees and late interest",
          "Sent each morning, without you opening the app",
          "Pace set by the client's payment profile",
        ],
      },
      {
        h2: "Required details already on the invoice",
        paras: [
          "Chasing is easier when the invoice is right in the first place. Each one carries the details of your company's country: sales tax and Letter paper in the US, VAT in the UK, a GiroCode in Germany and France, the QR-bill in Switzerland.",
          "In France, the PDF includes the late payment penalties and the €40 fixed recovery fee. In Germany, invoices also come as XRechnung and ZUGFeRD e-invoices.",
          "When a payment arrives on a camt.053 bank statement, each credit is matched to the right invoice and the autopilot books the safe cases, so paid invoices leave the reminder list.",
        ],
      },
      {
        h2: "Ask the AI assistant who owes you",
        paras: [
          "Ask “which invoices are more than 30 days late?” and the assistant answers from your own books. It can also propose changes, such as a draft invoice, contacts, items, time entries, expenses or supplier invoices.",
          "Each proposal appears on a “To confirm” card that shows everything that will be written, and nothing is saved until you click “Confirm”. One card can group up to 150 operations, applied in one click, all or nothing. The assistant never deletes, never pays and never sends anything outside, reminders included: it opens the reminders screen instead.",
          "Free: the equivalent of 10 requests a month. Pro: unlimited.",
        ],
      },
      {
        h2: "Reminders on the Free plan",
        paras: [
          "The Free plan has no credit card and no time limit. You send the first reminder by hand, up to 5 a month. The higher levels, fees, interest and automatic sending are visible in the app, greyed out with their Pro badge.",
          "The Free plan also includes 5 invoices a month, unlimited quotes, 50 contacts, 10 receipts read by AI, 1 active recurring invoice and 1 bank statement a month. Documents carry a “Created with InvoiceLead” notice.",
        ],
      },
      {
        h2: "For freelancers and small businesses",
        paras: [
          "A freelancer with a few clients can handle reminders by hand on the Free plan. When late payments start to cost you time, Pro at €19 a month excluding VAT (or €190 a year) runs them for you. Pro+ at €39 a month adds 5 users with roles, for a team that shares the follow-up. Plans are billed in euros by Quantum Liquid LLC and you can cancel at any time.",
        ],
      },
    ],
    faq: [
      {
        q: "Does the invoice reminder software send emails on its own?",
        a: "With Pro, yes: reminders on three levels go out automatically every morning. On the Free plan, you send the first reminder yourself, 5 a month.",
      },
      {
        q: "Can I add late fees and interest?",
        a: "Yes, with Pro. Reminder fees and late interest are added on the higher levels.",
      },
      {
        q: "How do I know an invoice has been paid?",
        a: "Record the payment, or import a camt.053 bank statement: each credit is matched to the right invoice and the autopilot books the safe cases.",
      },
      {
        q: "Which countries are supported?",
        a: "The United States, the United Kingdom, Germany, France and Switzerland, each with its own rates, numbers and required details.",
      },
      {
        q: "What does Pro cost?",
        a: "€19 a month excluding VAT, or €190 a year. It adds unlimited invoices and contacts, automatic reminders on three levels, tax returns, multi-currency and free access for your accountant.",
      },
    ],
    related: [
      "free-invoicing-software",
      "invoicing-software-for-freelancers",
      "quote-and-invoice-software",
    ],
  },
  {
    slug: "quote-and-invoice-software",
    lang: "en",
    group: "quotes",
    keyword: "quote and invoice software",
    source: "Google Suggest en-US, 04.11.2026",
    title: "Quote and Invoice Software, One Click Apart",
    description:
      "Quote and invoice software: an accepted quote becomes an invoice in one click. Unlimited quotes on the free plan, no card. US, UK, Germany, France, Switzerland.",
    eyebrow: "Quotes and invoices",
    h1: "Quote and invoice software with nothing to retype",
    lede: "Write the quote once. When the client accepts, InvoiceLead turns it into an invoice in one click, with the rates and required details of your country.",
    linkLabel: "Quotes and invoices",
    shot: "quote-desktop",
    shotAlt: "Open quote in InvoiceLead, ready to be turned into an invoice",
    sections: [
      {
        h2: "Quotes that are tracked, not forgotten",
        paras: [
          "Every quote gets a number and is valid for 30 days. When the client answers, you mark it accepted or declined, with the date. Open quotes stay in one list, so none slips through.",
          "On the Free plan, quotes are unlimited. You can write each quote in the client's language and, with Pro, in the client's currency.",
        ],
      },
      {
        h2: "Accepted quote, invoice in one click",
        paras: [
          "Turn an accepted quote into an invoice in one click. Lines, prices, tax and client details carry over, so there is nothing to type again. If something needs correcting after the invoice is sent, issue a credit note.",
          "Hours tracked on a project can be invoiced in one click as well, with a timer or quick entries linked to the project.",
        ],
      },
      {
        h2: "Invoices that follow your country's rules",
        paras: [
          "Your company's country sets the tax, the number checks and the format. Documents can be written in German, French, English, Italian or Spanish, chosen per client.",
        ],
        bullets: [
          "United States: sales tax at your combined rate, Letter paper, EIN",
          "United Kingdom: VAT at 20% and 5%, VAT and Companies House numbers checked",
          "Germany: USt at 19% and 7%, GiroCode, XRechnung 3.0 and ZUGFeRD",
          "France: TVA at 20%, 10% and 5.5%, SIRET checked, GiroCode, Factur-X",
          "Switzerland: SIX QR-bill, VAT at 8.1%, 2.6% and 3.8%",
        ],
      },
      {
        h2: "E-invoices checked against the official validator",
        paras: [
          "German invoices come as an XRechnung 3.0 XML file (CII syntax) and as a ZUGFeRD PDF (PDF/A-3b, EN 16931 profile). French invoices come as Factur-X, the same format. Sample files were run through the official KoSIT validator: 8 accepted, 0 rejected (30.9.2026).",
          "XRechnung needs your company's email and phone, the client's email and an IBAN. If one is missing, the page tells you which. A client with suitable software imports a ZUGFeRD or Factur-X file without retyping; others read it as an ordinary PDF.",
        ],
      },
      {
        h2: "Let the AI assistant draft it",
        paras: [
          "The assistant answers your questions from your own books: open quotes, unpaid invoices, your best clients. It can also propose changes, such as a draft quote or invoice, contacts, items, time entries, expenses or supplier invoices.",
          "Each proposal appears on a “To confirm” card that shows everything that will be written. Nothing is saved until you click “Confirm”. One card can group up to 150 operations, applied in one click, all or nothing. The assistant never deletes, pays or sends anything outside: to send a quote, it opens the screen and you send it.",
          "Free: the equivalent of 10 requests a month. Pro: unlimited.",
        ],
      },
      {
        h2: "Free for freelancers, Pro for busy weeks",
        paras: [
          "The Free plan asks for no credit card and has no time limit: 1 user, 5 invoices a month, unlimited quotes, 50 contacts, 10 AI reads, 1 active recurring invoice and a “Created with InvoiceLead” notice on documents. Accounting fed by your invoices is included.",
          "Pro, at €19 a month excluding VAT, removes the invoice and contact caps and adds automatic reminders, tax returns, multi-currency and free access for your accountant.",
          "You sign in with the free Lead account, which also opens ScanLead, CRMlead, ProjectLead and Greetlead, each with its own plan.",
        ],
      },
    ],
    faq: [
      {
        q: "How long is a quote valid?",
        a: "30 days. The quote shows its number and validity date, and you record whether it was accepted or declined.",
      },
      {
        q: "Are quotes limited on the Free plan?",
        a: "No. Quotes are unlimited. Invoices are capped at 5 a month on the Free plan and unlimited with Pro.",
      },
      {
        q: "Can I quote and invoice in another currency?",
        a: "Yes, with Pro: quotes and invoices in USD, EUR, GBP or CHF at the day's rate.",
      },
      {
        q: "Can a lead from my CRM become a client?",
        a: "Yes. A lead won in CRMlead arrives in InvoiceLead, with the client reused or created. Both apps open with the same Lead account.",
      },
      {
        q: "Can I correct an invoice after sending it?",
        a: "Issue a credit note. In Germany and France, credit notes also come as e-invoices, like the invoices themselves.",
      },
    ],
    related: [
      "invoicing-software-for-freelancers",
      "free-invoicing-software",
      "invoice-reminder-software",
    ],
  },
  {
    slug: "quickbooks-alternative",
    lang: "en",
    group: "alternative-quickbooks",
    keyword: "quickbooks alternative",
    source: "Google Suggest en-US, 04.11.2026",
    title: "QuickBooks Alternative for Europe and the US",
    description:
      "Looking for a QuickBooks alternative? InvoiceLead does invoices, receipts and accounting for the US, UK, Germany, France and Switzerland. Free plan, no card.",
    eyebrow: "Switching tools",
    h1: "A QuickBooks alternative for invoicing and bookkeeping",
    lede: "If you are weighing a QuickBooks alternative, here is what InvoiceLead does, what the Free plan covers, and what to check before you move your books.",
    linkLabel: "QuickBooks alternative",
    shot: "dashboard-desktop",
    shotAlt:
      "InvoiceLead dashboard with revenue, outstanding and overdue invoices and a twelve-month chart",
    sections: [
      {
        h2: "What InvoiceLead covers",
        paras: [
          "InvoiceLead runs the path from quote to money in the bank: quotes, invoices that follow your country's rules, payment reminders, receipts read from a photo, supplier invoices and double-entry accounting fed by all of it.",
          "The dashboard shows this month's and this year's revenue, what is outstanding, what is overdue, and twelve months in one chart.",
        ],
        bullets: [
          "Numbered quotes, turned into invoices in one click",
          "Receipts and supplier invoices read by AI",
          "camt.053 bank statements matched to your invoices",
          "Time tracking billed in one click",
          "Tax return prepared for your country (Pro)",
        ],
      },
      {
        h2: "Five countries, one app",
        paras: [
          "InvoiceLead serves companies in the United States, the United Kingdom, Germany, France and Switzerland. In the US: sales tax at your combined rate, Letter paper, EIN, a US chart of accounts and a sales tax report. In the UK: VAT at 20% and 5% and the 9-box MTD VAT return prepared. In Germany: SKR04, UStVA, XRechnung and ZUGFeRD. In France: PCG, CA3 and Factur-X. In Switzerland: the QR-bill, the SME chart and the VAT return with eCH-0217 XML.",
          "Tax figures are ready to copy across; you submit the return on the tax portal yourself.",
        ],
      },
      {
        h2: "What to check before you switch",
        paras: [
          "Changing accounting tools is easier with a short checklist. Go through it with your current setup before you move anything.",
        ],
        bullets: [
          "Export your customers, items and open invoices from your current tool",
          "Keep your old records: books must be kept for several years, up to ten depending on the country",
          "Decide where your invoice numbering continues",
          "Compare your chart of accounts with your country's chart in InvoiceLead",
          "Ask your accountant how they want to receive your books",
        ],
      },
      {
        h2: "An AI assistant that asks before it writes",
        paras: [
          "The assistant answers your questions from your own books. It can also propose changes: a draft quote or invoice, contacts, items, time entries, expenses or supplier invoices. Handy when you are setting up a new tool and have many clients or items to create.",
          "Each proposal appears on a “To confirm” card that shows everything that will be written. Nothing is saved until you click “Confirm”. One card can group up to 150 operations, applied in one click, all or nothing. It never deletes, never pays and never sends anything outside: it opens the right screen instead.",
          "Free: the equivalent of 10 requests a month. Pro: unlimited.",
        ],
      },
      {
        h2: "Try it on the Free plan first",
        paras: [
          "You can test InvoiceLead with real work before deciding. The Free plan needs no credit card and has no time limit: 1 user, 1 company, 5 invoices a month, unlimited quotes, 50 contacts, 10 AI reads, 5 first reminders by hand, 1 active recurring invoice and 1 bank statement a month. Documents carry a “Created with InvoiceLead” notice.",
          "Pro features stay visible, greyed out with their badge, so you know what you would get.",
        ],
      },
      {
        h2: "Pricing, plainly",
        paras: [
          "Pro costs €19 a month excluding VAT, or €190 a year, and suits freelancers and small businesses that invoice every week. Your accountant gets free access. Pro+ costs €39 a month for 5 users with roles, an API, an MCP server and webhooks.",
          "Plans are billed in euros by Quantum Liquid LLC and can be cancelled at any time. Data is hosted in the United States (Vercel and Neon, Ohio) and can be exported at any time.",
        ],
      },
    ],
    faq: [
      {
        q: "Is InvoiceLead a full QuickBooks alternative?",
        a: "It covers invoicing, receipts, supplier invoices, bank matching, time tracking and double-entry accounting with a balance sheet and income statement. Check that it fits the way you work on the Free plan before you switch.",
      },
      {
        q: "Can I export my data if I leave?",
        a: "Yes, at any time, and for 30 days after cancellation. The export is designed for the years you must keep your books.",
      },
      {
        q: "Does InvoiceLead file my sales tax or VAT return?",
        a: "It prepares the return with Pro. You file it with the tax authority yourself.",
      },
      {
        q: "Does it work for freelancers?",
        a: "Yes. The Free plan is designed for getting started as a freelancer, and Pro suits small businesses that invoice every week.",
      },
    ],
    related: [
      "free-invoicing-software",
      "receipt-scanner-app",
      "invoice-reminder-software",
      "quote-and-invoice-software",
    ],
  },
];
