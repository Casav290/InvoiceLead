# Pays pris en charge

Chaque entreprise choisit son pays dans les réglages ; il fixe la devise, les taux, les contrôles des numéros, le plan comptable, la déclaration fiscale et le format des documents. Le pays ne change plus après la première pièce émise. L'interface existe en allemand, en français et en anglais, indépendamment du pays.

| | Suisse | Allemagne | France | Royaume-Uni | États-Unis |
|---|---|---|---|---|---|
| Devise | CHF | EUR | EUR | GBP | USD |
| Impôt | TVA 8,1 / 2,6 / 3,8 % | USt 19 / 7 % | TVA 20 / 10 / 5,5 % | VAT 20 / 5 % | Sales tax, taux combiné saisi par l'entreprise |
| Numéros contrôlés | IDE, IBAN, QR-IBAN | USt-IdNr., Steuernummer, IBAN | SIRET, TVA intracommunautaire, IBAN | VAT number, Companies House, IBAN | EIN, ZIP, code d'État |
| Bulletin de paiement | QR-facture | GiroCode (SEPA) | GiroCode (SEPA) | aucun | aucun (ACH dans le texte de fin) |
| Facture électronique | | ZUGFeRD, XRechnung | Factur-X | | |
| Plan comptable | PME suisse | SKR04 réduit | PCG réduit | nominal ledger | chart of accounts courant |
| Déclaration | Décompte AFC (effective, TDFN) | UStVA | CA3 | MTD, neuf cases | Relevé de sales tax |
| Papier, dates | A4, 30.09.2026 | A4, 30.09.2026 | A4, 30/09/2026 | A4, 30/09/2026 | Letter, 09/30/2026 |

## Ce qui reste à faire relire ou à brancher

Avant d'ouvrir un pays, un professionnel local relit le plan comptable, les correspondances vers le formulaire fiscal et les mentions des factures : fiduciaire en Suisse, Steuerberater en Allemagne, expert-comptable en France, accountant au Royaume-Uni, CPA aux États-Unis.

En France, la réception des factures électroniques passe par la plateforme agréée B2Brouter (docs/RECEPTION-FR.md) ; l'émission et l'e-reporting par plateforme ne sont pas encore branchés. Les dépôts électroniques ne sont pas branchés : le fichier eCH-0217 se télécharge depuis le décompte validé et se dépose à la main sur le portail de l'AFC, ELSTER pour l'UStVA, l'API Making Tax Digital de HMRC (InvoiceLead doit être enregistré comme logiciel reconnu), et les portails des États américains. Les chiffres sont prêts à reporter.

Limites connues : aux États-Unis, un seul taux de sales tax par entreprise (pas encore de taux par lieu de livraison ni de nexus multi-États) ; au Royaume-Uni, le taux zéro et l'exonération partagent le même code ; en France, les exportations sont regroupées en E2 et un rappel demande de les ventiler.

## Libellés selon le pays de l'entreprise

La langue de l'interface (de, fr, en) ne dit pas le pays : une entreprise allemande lit l'allemand d'Allemagne,
une entreprise américaine parle de sales tax. Chaque message de `app.*` est rédigé pour la Suisse et peut porter
des variantes suffixées, lues par `forCountry` (`src/i18n/country.ts`) : d'abord celle du pays (`netDe`, `netFr`,
`netGb`, `netUs`), puis `netIntl` pour toute entreprise hors de Suisse (Angebot, Ausgaben, USt, Steuerberatung,
Cent ; devis et expert-comptable en français). Hors de Suisse, les guillemets «…» de l'allemand deviennent „…“.
Une entreprise suisse lit toujours le message de base. Pages serveur : `getSessionCountryTranslations` ; composants
client : `useCountryTranslations` (pays fourni par la mise en page de l'application) ; PDF, e-mails et vue en
ligne d'une pièce : pays de l'expéditeur. Les taux proposés dans les listes sont ceux du pays
(`countryPack(pays).vatCodes`, `offeredVatCodes`). Contrôle : `tests/unit/country-labels.test.ts`.
