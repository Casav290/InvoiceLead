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

Les dépôts électroniques ne sont pas branchés : eCH-0217 pour l'AFC (schéma à fournir), ELSTER pour l'UStVA, une plateforme agréée (PDP) pour la France, l'API Making Tax Digital de HMRC (InvoiceLead doit être enregistré comme logiciel reconnu), et les portails des États américains. Les chiffres sont prêts à reporter.

Limites connues : aux États-Unis, un seul taux de sales tax par entreprise (pas encore de taux par lieu de livraison ni de nexus multi-États) ; au Royaume-Uni, le taux zéro et l'exonération partagent le même code ; en France, les exportations sont regroupées en E2 et un rappel demande de les ventiler.
