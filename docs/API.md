# API et webhooks (formule Pro+)

L'API REST relie InvoiceLead à une boutique en ligne, un outil de gestion ou une automatisation. Elle crée des contacts, des devis et des factures, les émet, enregistre des paiements et rend les PDF. Les webhooks préviennent un autre outil quand une facture est émise ou payée.

## Clés

Une clé se crée dans Réglages, API, par un administrateur ou un responsable de l'entreprise. Elle commence par `il_live_` et n'est affichée qu'une fois ; seule son empreinte SHA-256 est gardée. Elle agit au nom de la personne qui l'a créée, tant que cette personne peut facturer dans l'entreprise et que l'entreprise est en Pro+. Dix clés actives au plus, révocables à tout moment. Sous Pro+, la page reste visible : les formulaires sont grisés avec la marque Pro+, les clés et adresses existantes restent listées et révocables, et les webhooks en attente patientent jusqu'au retour à Pro+.

```
Authorization: Bearer il_live_…
```

Réponses d'erreur : `401 {"error":"unauthorized"}` (clé absente, inconnue ou révoquée), `403 {"error":"forbidden"}` (formule ou droits), `403 {"error":"plan_limit"}` (limite de la formule, les mêmes que dans l'application), `404 {"error":"not_found"}`, `422 {"error":"invalid","fields":{"lines":"noLines"}}` avec les mêmes codes que les formulaires, `409` pour un état qui ne permet pas l'action (`notDraft`, `companyIncomplete`, `fxRate`, `too_high`…).

Les montants saisis sont en unités (`"150.00"`), les montants rendus en centimes (`totalCents`), les dates au format `AAAA-MM-JJ`.

## Clé ProjectLead (toutes les formules)

ProjectLead crée chaque mois les brouillons de factures de ses projets dans InvoiceLead. Sa clé se crée dans Réglages, ProjectLead, dans toutes les formules, gratuite comprise, par un administrateur ou un responsable. Elle commence aussi par `il_live_`, n'est affichée qu'une fois, se révoque au même endroit (trois clés actives au plus) et porte le nom « ProjectLead ».

Sa portée (`scope = 'projectlead'` dans `api_keys`) n'ouvre que ce que ProjectLead appelle (`server/lib/invoicelead.ts` de ProjectLead) :

| Méthode | Chemin | |
|---|---|---|
| GET | `/api/v1/contacts?q=` | Recherche d'un client, et essai de la clé à l'enregistrement |
| POST | `/api/v1/contacts` | Client absent d'InvoiceLead |
| POST | `/api/v1/invoices` | Brouillon de facture seulement (`"kind":"quote"` refusé) |

Tout le reste répond `403 {"error":"forbidden"}` avant toute lecture : liste et lecture des pièces, émission, paiements, PDF, devis, serveur MCP. Elle n'enregistre pas de webhooks (Pro+) et ne fait partir aucun événement en dessous de Pro+. Les brouillons sont gratuits : en formule gratuite, une facture compte dans les 10 du mois seulement à son émission, dans InvoiceLead. Les contacts restent dans la limite de la formule (`403 {"error":"plan_limit"}` au-delà).

## Points d'accès

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/v1/contacts?q=` | Contacts, recherche facultative |
| POST | `/api/v1/contacts` | Nouveau contact (client par défaut) : `name`, `kind` (`company` ou `person`), `email`, `street`, `buildingNumber`, `postalCode`, `town`, `country`, `language`, `uid`, `paymentTermDays` |
| GET | `/api/v1/invoices?kind=invoice` | Pièces (`invoice`, `quote`, `credit_note`), solde ouvert compris |
| POST | `/api/v1/invoices` | Brouillon de facture, ou de devis avec `"kind":"quote"` : `contactId`, `language`, `issueDate`, `serviceDate`, `dueDate`, `currency`, `fxRate`, `title`, `introText`, `footerText`, `lines: [{ description, quantity, unit, unitPrice, vatCode, productId }]` |
| GET | `/api/v1/invoices/{id}` | Pièce, lignes et solde |
| POST | `/api/v1/invoices/{id}/issue` | Émission : numéro définitif, écritures, événement `invoice.issued` |
| POST | `/api/v1/invoices/{id}/payments` | Paiement reçu : `amount`, `paidOn`, `method` (`bank`, `cash`, `other`), `note`, `fxRate` |
| GET | `/api/v1/invoices/{id}/pdf` | PDF de la pièce émise (QR-facture, ZUGFeRD ou Factur-X selon le pays) |

La TVA est toujours calculée par InvoiceLead, au taux en vigueur à la date de prestation (`vatCode` : `normal`, `reduced`, `lodging`, `exempt`, `export`). Après chaque écriture, les pièces sont comptabilisées comme depuis l'application.

Exemple :

```
curl https://invoicelead.io/api/v1/invoices \
  -H "Authorization: Bearer il_live_…" \
  -H "Content-Type: application/json" \
  -d '{"contactId":"…","lines":[{"description":"Conseil","unit":"hour","quantity":"2","unitPrice":"150","vatCode":"normal"}]}'
```

## Webhooks

Cinq adresses au plus, en https vers un serveur public (les adresses locales, privées ou réservées sont refusées, à l'enregistrement et à chaque envoi). Événements :

| Événement | Quand |
|---|---|
| `invoice.issued` | Facture ou avoir émis (application, API, facture récurrente) |
| `payment.created` | Paiement enregistré (saisi, relevé bancaire, paiement en ligne, API) |
| `invoice.paid` | Paiement qui solde la facture |

Corps (POST JSON) :

```json
{ "id": "…", "type": "invoice.paid", "created": "2026-09-30T08:00:00.000Z",
  "data": { "invoice": { "id": "…", "number": "2026-0042", "currency": "CHF", "totalCents": 21620, "openCents": 0 } } }
```

Signature : l'en-tête `InvoiceLead-Signature: t=1790000000,v1=…` porte le HMAC-SHA256 hexadécimal de `t` + `.` + corps brut, avec le secret `whsec_…` affiché une fois à la création. Vérifier la signature et refuser un `t` trop ancien (cinq minutes). Les en-têtes `InvoiceLead-Event` et `InvoiceLead-Delivery` donnent le type et l'identifiant de l'envoi, à utiliser pour ignorer un doublon.

Un envoi qui ne reçoit pas de réponse 2xx en cinq secondes est rejoué après 1 minute, 5 minutes, 30 minutes, 2 heures puis 12 heures, puis abandonné. Les reprises partent avec le prochain événement de l'entreprise ou la tâche quotidienne. Les derniers envois et leur état s'affichent sous chaque adresse.

## Serveur MCP

Les assistants compatibles MCP (Model Context Protocol), comme Claude ou ChatGPT, se branchent sur `https://invoicelead.io/api/mcp` avec une clé d'API dans l'en-tête `Authorization: Bearer il_live_…`. Transport HTTP « streamable », réponses JSON, version de protocole 2025-06-18.

| Outil | Rôle |
|---|---|
| `get_books_summary` | Instantané des livres : résultat, banque, factures ouvertes et en retard, chiffre d'affaires par mois, clients, fournisseurs à payer, heures non facturées, travail à vérifier |
| `list_invoices`, `get_invoice` | Lecture des factures, devis et avoirs |
| `list_contacts`, `create_contact` | Clients et fournisseurs |
| `create_invoice_draft` | Brouillon de facture ou de devis, TVA calculée par InvoiceLead |
| `issue_invoice` | Émission, seulement à la demande explicite de la personne |
| `record_payment` | Paiement reçu |
| `list_supplier_bills` | Factures fournisseurs |
| `list_projects`, `log_time` | Projets et saisie du temps |

Les outils d'écriture portent `readOnlyHint: false`. Les mêmes règles que dans l'application s'appliquent (droits de la personne qui a créé la clé, formule Pro+, comptabilisation et webhooks après chaque écriture).
