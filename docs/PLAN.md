# InvoiceLead, plan de développement

Version 2, 30.09.2026. Remplace la version 1 : elle intègre les réponses d'Ève, ce que font déjà Scanlead et CRMlead (visuel Trait net, Compte Lead) et une recherche vérifiée sur la comptabilité et la TVA suisses.

## 1. Vision

InvoiceLead fait les devis, les factures QR et la comptabilité des indépendants, des micro-entreprises et des petites PME suisses, à plusieurs utilisateurs. C'est l'équivalent de bexio pour ces trois fonctions, dans la famille Lead (Scanlead, CRMlead, ProjectLead), avec le même visuel et le même compte.

Marché de départ : la Suisse, en allemand (orthographe suisse, « ss ») et en français. L'architecture prévoit l'Allemagne, la France, le Royaume-Uni et les États-Unis sans refonte.

On reprend les fonctions et la logique de conversion de bexio, jamais ses textes, images, marque ni mise en page.

## 2. Décisions prises

| Sujet | Décision |
|---|---|
| Périmètre du MVP | Devis, facturation **et** comptabilité (partie double, TVA) |
| Cible | Indépendants, micro-entreprises et petites PME, plusieurs utilisateurs par entreprise |
| Offres | Gratuit (limité), Pro, Pro+, calquées sur Scanlead : 0, 19 et 39 par mois, 190 et 390 par an (dix mois payés) |
| Compte | Un compte unique pour la famille : le **Compte Lead** (OpenID Connect hébergé par CRMlead). InvoiceLead y figure déjà dans les applications reliées |
| Langues | Allemand et français au lancement |
| Domaine | invoicelead.io, déjà réservé chez Porkbun |
| Code et hébergement | GitHub `Casav290/InvoiceLead`, Vercel |
| Base | Neon, projet `tiny-shape-39858234` (« InvoiceLead »), branche `production`, région `aws-us-east-2` (Ohio), Postgres 18 ; fonctions Vercel en `cle1` (Cleveland), à côté |
| Visuel | Trait net v1, repris des jetons de CRMlead et de Scanlead (section 5) |

## 3. Ce qu'on reprend de bexio, et quand

| Fonction bexio | InvoiceLead | Lot |
|---|---|---|
| Assistant de configuration de l'entreprise | Réglages entreprise (IDE/UID, TVA, IBAN et QR-IBAN, logo, méthode TVA, exercice) | 2 |
| Contacts, articles et prestations | Contacts à adresse structurée, articles avec taux de TVA | 2 |
| Offre, confirmation, facture, avoir | Même chaîne, conversion sans ressaisie | 3 |
| QR-facture | PDF avec section paiement conforme SIX IG 2.3 | 3 |
| Envoi par e-mail, facture en ligne | E-mail et lien sécurisé | 3 |
| Écritures automatiques depuis factures et paiements | Moteur d'écritures en partie double | 3 et 4 |
| Journal, grand livre, balance, bilan, compte de résultat | Rapports comptables avec comparaison N-1 | 4 |
| Dépenses et impôt préalable | Saisie des dépenses avec pièce et code TVA | 4 |
| Rapprochement bancaire (camt.053/054) | Import de fichiers, lettrage par référence QR ou SCOR | 4 |
| Décompte TVA | Méthode effective et taux de la dette fiscale nette, export XML eCH-0217 | 5 |
| Relances à trois niveaux | Relances automatiques, frais, intérêt moratoire | 6 |
| Factures récurrentes | Abonnements clients | 6 |
| bexio pay, TWINT | Paiement en ligne sur la facture | 6 |
| Saisie des justificatifs par IA | Lecture automatique des pièces (quotas par offre) | 6 |
| Multi-utilisateurs, accès fiduciaire | Rôles, accès fiduciaire gratuit | 7 |
| eBill, connexion bancaire directe | Partenariats nécessaires (SIX, bLink) | plus tard |
| Salaires (Swissdec) | Hors périmètre | non prévu |

## 4. Pile technique

| Besoin | Choix | Remarques |
|---|---|---|
| Framework | Next.js 16.3 (App Router, `proxy.ts`), React 19, TypeScript strict | Rendu serveur pour le SEO, les PDF et la sécurité |
| Interface | Tailwind CSS v4, composants Radix, icônes Lucide | Thème Trait net ; arrondis, ombres et couleurs par défaut retirés du thème |
| Police | Archivo (variable), servie avec l'application | Aucune requête vers Google au chargement |
| Traductions | next-intl 4, adresses `/de/…` et `/fr/…` | |
| Base | Neon Postgres, pilote `pg` avec un pool par instance (Fluid compute) | |
| Accès aux données | Drizzle ORM, migrations SQL versionnées dans `drizzle/` | Appliquées par `vercel-build` en production seulement, par la connexion directe (`DATABASE_URL_UNPOOLED`) |
| Connexion | Compte Lead, kit `leadId.ts` de CRMlead copié tel quel | Session locale de 12 h, jeton stocké haché |
| Neon Auth | Activé à la création du projet (`neon.ts`), **pas utilisé** pour la connexion | Peut être retiré si le Compte Lead reste la seule entrée |
| Neon Functions | Fonction `api` déployée (exemple `hello.ts`) | Candidat pour les tâches planifiées (relances, récurrences) via les déclencheurs cron |
| PDF | PDFKit et `swissqrbill` v4 | Lot 3 |
| E-mails | Resend (SMTP aussi pour les e-mails transactionnels) | Lot 3 |
| Fichiers | Neon Object Storage ou Cloudflare R2 | Choix au lot 3 |
| Paiements | Stripe (carte, TWINT) | Lot 6 |
| Tests | Vitest (unitaires et intégration sur Postgres), Playwright (parcours et audit Trait net) | |
| CI | GitHub Actions : Biome, tsc, migrations, Vitest, build, Playwright | |

Point d'attention hébergement : l'offre Vercel Hobby interdit l'usage commercial, et une landing de SaaS payant compte déjà comme commercial. Il faudra passer sur Vercel Pro (environ 20 USD par mois) avant d'ouvrir au public.

## 5. Visuel « Trait net »

Jetons repris de CRMlead (`trait-net/tailwind-preset.cjs`, `src/index.css`) et de Scanlead (`PublicChrome.tsx`, `pricing.tsx`, `application-switcher.tsx`) :

| Élément | Valeur |
|---|---|
| Police | Archivo seule ; titres en 800, interlettrage −0,025 em |
| Fond d'application | `#eceae7` ; panneaux `#ffffff` ; cartes d'offre `#fffdf9` ; en-têtes de tableau `#f7f5f3` |
| Traits | marqué `#cfcac4`, cellule `#e7e4e0`, doux `#eeebe7` |
| Encres | `#1b1a19`, `#44403c`, `#57534e`, secondaire `#67625c` |
| Action InvoiceLead | `#2563eb` (survol `#1d4ed8`, pâle `#dbeafe`) |
| Compte Lead | bouton « Se connecter avec mon compte Lead » en `#0e6d6e` |
| Marques des applications | carrés 26 px : SL `#2563eb`, CL `#0f6e70`, IL couleur d'action |
| Formes | aucun arrondi, aucune ombre, aucun dégradé, pas de section sombre |
| En-tête public | cellules séparées par des traits, sélecteur de langue, Connexion, bouton d'appel |
| Application | sélecteur à 9 points qui ouvre `<app>/login` ; « Bientôt » pour les applications à venir |

Un test Playwright parcourt les pages publiques et l'application à 390, 820 et 1280 px et échoue sur toute police autre qu'Archivo, tout arrondi, toute ombre, tout dégradé et tout débordement horizontal.

## 6. Architecture

Un monolithe modulaire, un seul déploiement.

```
src/
  app/
    [locale]/            pages publiques, connexion, inscription
    [locale]/app/        application (vérifie la session et l'accès)
    auth/lead/           départ, retour et déconnexion Compte Lead
    api/                 santé, puis webhooks et API publique
  components/            Trait net : public, application, marque, ui
  i18n/                  routage et messages
  lib/                   montants, applications Lead, utilitaires
  server/
    auth/                rattachement, sessions, cookies signés
    db/                  schéma Drizzle et connexion
    lead-id/             kit Compte Lead (copie conforme)
    (à venir) documents/, accounting/, vat/, banking/, countries/ch/
drizzle/                 migrations SQL
tests/                   unitaires, bout en bout, faux Compte Lead
```

Principes :

Tout objet métier porte `organization_id` ; les lectures et écritures passent par une couche de service qui injecte l'organisation de la session. La sécurité au niveau des lignes de Postgres viendra en seconde barrière avant l'ouverture.

L'argent est en centimes entiers avec le code devise ; jamais de nombre à virgule. Affichage suisse identique dans les deux langues : « 2'361.99 », formaté sans `Intl` (dont les données changent selon la version de Node).

Un document émis est figé : coordonnées et taux copiés au moment de l'émission, PDF archivé, correction par avoir.

La comptabilité est en ajout seul : une écriture validée ne se modifie ni ne se supprime (déclencheur Postgres), elle s'extourne. Chaîne d'empreintes SHA-256 par organisation et exercice, périodes TVA verrouillées au dépôt, exercice verrouillé à la clôture (exigences GeBüV/Olico).

Les règles propres à un pays vivent dans un pack pays (`countries/ch`) : taux datés, chiffres du formulaire TVA, bulletin de paiement, formats de facture électronique, mentions obligatoires.

Les rôles comptables sont liés à des **rôles** (débiteurs, TVA due, impôt préalable, banque, arrondi, résultat…) et non à des numéros, pour permettre de renuméroter le plan comme dans bexio.

## 7. Modèle de données

Déjà en place (migration `0000_init`) :

| Table | Contenu |
|---|---|
| `users` | Personne ; `lead_sub` unique (identifiant du Compte Lead), email unique sans casse, nom, langue |
| `organizations` | Entreprise ; `lead_org` unique, pays, devise, langue, formule Lead, accès InvoiceLead, droits reçus |
| `memberships` | Personne × entreprise, rôle Lead (admin, manager, user) |
| `sessions` | Empreinte SHA-256 du jeton, échéance, jeton d'identité pour la déconnexion |
| `audit_log` | Actions sensibles |

À venir, dans l'ordre des lots :

| Lot | Tables |
|---|---|
| 2 | `company_settings`, `bank_accounts`, `contacts`, `contact_persons`, `products`, `vat_codes` et `vat_rates` datés, `accounts` (plan), `fiscal_years`, `number_sequences` |
| 3 | `documents`, `document_lines`, `payments`, `email_messages`, `files` |
| 4 | `journal_entries`, `journal_lines`, `open_items`, `open_item_allocations`, `expenses`, `bank_imports`, `bank_transactions` |
| 5 | `vat_periods`, `vat_returns` (chiffres calculés, XML produit, statut) |
| 6 | `reminder_levels`, `reminders`, `recurring_invoices`, `online_payments` |

## 8. Exigences suisses

QR-facture : norme SIX IG 2.3, en vigueur depuis le 21.11.2025 et valable jusqu'en novembre 2027 ; adresses structurées obligatoires ; IBAN avec référence SCOR, ou QR-IBAN avec référence QR (27 chiffres, modulo 10 récursif). Validation par l'outil SIX avant l'ouverture.

TVA, taux : 8,1 %, 2,6 % et 3,8 % depuis le 1.1.2024, stockés avec leurs dates de validité ; le taux dépend de la date de la prestation. Hausses en préparation, dates encore incertaines : financement de la 13e rente AVS (taux normal 8,5 %, probablement dès 2028, votation annoncée pour le 29.11.2026), hausse « armée » en débat (dès 2029 selon le Conseil des États), prolongation du taux hébergement au-delà de 2027. Veille à tenir, rien n'est codé en dur.

TVA, méthodes : effective, ou taux de la dette fiscale nette (TDFN) avec, depuis 2025, un taux par activité dépassant 10 % du chiffre d'affaires (plus de limite à deux taux) ; passage TDFN vers effective après une période, effective vers TDFN après trois ans.

TVA, décompte : formulaire par chiffres (200, 205, 220, 221, 225, 230, 235, 280, 289, 299, 303, 313, 343, 383, 399, 400, 405, 410, 415, 420, 479, 500/510, 900/910 ; 322/323… pour le taux de la dette fiscale nette). Dépôt électronique obligatoire depuis 2025 sur le portail AFC, par fichier XML **eCH-0217 V2.0.0** : pas d'API de dépôt direct, InvoiceLead produit le fichier et guide le dépôt. Périodes : trimestrielle (effective), semestrielle (TDFN), annuelle sur demande depuis 2025. Seuil d'assujettissement 100'000 CHF ; une entreprise non inscrite ne doit pas afficher de TVA (art. 27).

TVA, facture : mentions de l'art. 26 LTVA, numéro `CHE-123.456.789 MWST/TVA` selon la langue, contrôle modulo 11 du numéro, TVA calculée par taux sur le total, total arrondi à 5 centimes avec compte d'arrondi.

Comptabilité : partie double obligatoire pour les personnes morales et au-delà de 500'000 CHF de chiffre d'affaires (art. 957 CO) ; en dessous, une interface simplifiée au-dessus du même moteur. Plan comptable PME (Kontenrahmen KMU), deux modèles d'environ 80 comptes (raison individuelle ; SA/Sàrl), en allemand et en français. Conservation dix ans (art. 958f CO), archivage conforme à la GeBüV/Olico.

Rapprochement : camt.054 et camt.053 (ISO 20022), lettrage automatique par référence.

Validation : avant l'ouverture, faire relire les règles d'écriture et le décompte TVA par une fiduciaire ou un expert TVA (frais de rappel, TVA sur acomptes, écriture TDFN, durée du premier exercice).

## 9. Offres et limites

Les formules sont celles de la famille (Compte Lead) : un Pro payé dans une application ouvre les autres. Aujourd'hui seul Scanlead encaisse, et les boutons « Mettre à niveau » mènent à `scanlead.io/billing`.

Proposition, à valider (issue du relevé des concurrents suisses) :

| | Gratuit | Pro | Pro+ |
|---|---|---|---|
| Prix | 0 | 19 par mois, 190 par an | 39 par mois, 390 par an |
| Utilisateurs | 1 | 2, plus accès fiduciaire gratuit | 5, puis supplément par utilisateur |
| Factures | 10 par mois ; devis et avoirs illimités | illimitées | illimitées |
| Contacts | 50 | illimités | illimités |
| QR-facture, documents DE/FR/IT/EN, logo | oui | oui | oui |
| Mention « Créé avec InvoiceLead » | oui | non | non |
| Relances | 1 niveau, manuel | 3 niveaux automatiques, frais, intérêts | idem |
| Comptabilité (écritures automatiques, bilan, résultat) | oui, 20 dépenses par mois | complète, clôture annuelle | complète |
| Décompte TVA | non | oui (effective et TDFN) | oui |
| Import bancaire camt | non | oui | oui, plus connexion directe |
| Factures récurrentes, multidevise | non | oui | oui |
| Lecture automatique des pièces | non | 50 par mois | 300 par mois |
| Sociétés | 1 | 1 | jusqu'à 3 |
| API, webhooks, eBill | non | non | oui |

Principes : ne jamais faire payer la QR-facture, les devis ni les documents multilingues (tous les concurrents les donnent) ; faire du décompte TVA le principal déclencheur de passage au payant (l'assujettissement à 100'000 CHF signale une entreprise qui grandit). Prix affichés en CHF, « hors TVA », équivalent mensuel de l'annuel à côté (15.83 et 32.50).

Contexte : bexio coûte 35, 42, 69 et 119 CHF par mois depuis mars 2026 ; KLARA a supprimé son offre gratuite ; Swiss21, CashCtrl et smallinvoice ont des offres gratuites généreuses. Chiffres des concurrents à revérifier sur leurs sites avant toute comparaison publique.

## 10. Feuille de route

Règle d'Ève : une fonction à la fois, terminée et mise en ligne avant la suivante.

| Lot | Contenu | Terminé quand | État |
|---|---|---|---|
| 0. Fondations | Next.js 16, Trait net, de/fr, Drizzle, connexion Compte Lead, coquille de l'application, CI, audit Playwright | Connexion de bout en bout contre un faux Compte Lead, 76 contrôles verts (28 unitaires, 48 de bout en bout), revue adversariale appliquée | fait (PR #1) |
| 1. Mise en ligne | Vercel, domaine invoicelead.io, Compte Lead réel (client déclaré dans CRMlead), pages légales, tarifs, FAQ | Connexion réelle sur invoicelead.io | en ligne sur invoicelead.io ; pages légales, tarifs et FAQ faits ; reste la déclaration dans CRMlead |
| 2. Entreprise et référentiels | Réglages entreprise, contacts, articles, taux TVA datés, plan comptable (2 modèles), exercices | Une entreprise configurée avec son plan comptable | fait (réglages, contacts, articles, TVA datée, plan PME en 2 modèles, exercices) ; la clôture viendra au lot 4 |
| 3. Devis et factures | Devis, confirmation, facture, avoir, numérotation, PDF avec QR-facture, envoi, facture en ligne, paiements saisis, écritures automatiques | Une vraie facture QR payée dans une app bancaire, écritures justes | 3a fait : factures (brouillon, lignes, TVA datée par taux, émission numérotée sans trou, facture figée) ; 3b fait : PDF A4 avec QR-facture (référence QRR ou SCOR) ; 3c fait : devis (numéros O-, accepté/refusé, transformation en facture) ; 3d fait : paiements saisis, états de paiement, avoirs partiels ou complets (G-) ; 3e fait : envoi par e-mail (Resend, PDF joint) et consultation en ligne par lien |
| 4. Comptabilité | Journal en ajout seul, grand livre, balance, bilan, résultat, dépenses avec impôt préalable, postes ouverts, import camt et lettrage, clôture | Un exercice complet bouclé et contrôlé | 4a fait : journal en ajout seul chaîné par empreintes, comptabilisation automatique des factures, avoirs, paiements et extournes ; 4b fait : import de relevés camt.053, propositions (référence QR puis IA) à valider, écriture TVA comprise ; 4c fait : règles apprises des validations, proposées avant l'IA ; 4d fait : justificatifs lus par l'IA (PDF et photos), rattachés au paiement et joints à l'écriture ; 4e fait : compte de résultat, bilan, balance des comptes et grand livre par compte ; 4f fait : clôture (résultat au capital, ouverture de l'exercice suivant, exercice fermé) |
| 5. TVA | Décompte effective et TDFN, convenu et reçu, XML eCH-0217, clôture de période | Un décompte accepté par le portail AFC | 5a fait : décompte trimestriel méthode effective, convenu, contrôles bloquants, relecture IA, validation qui fige la période et vire la TVA sur 2201 ; 5b fait : méthode TDFN (semestres, taux net, écart porté en déduction sur ventes) ; restent le décompte selon les encaissements et le XML eCH-0217 (schéma officiel à récupérer) |
| 6. Encaissement | Relances automatiques, récurrentes, paiement en ligne (carte, TWINT), lecture des pièces | Une facture payée par TWINT se lettre toute seule | |
| 7. SaaS | Quotas par formule, équipe et rôles, accès fiduciaire, échange avec CRMlead (lead gagné vers facture), bêta privée | Premiers clients bêta | |
| 8. International | Packs pays DE, FR, UK, US | Premier pays hors Suisse | |

Packs pays prévus : Allemagne (EUR, USt 19/7 %, XRechnung et ZUGFeRD, e-facture B2B obligatoire à l'émission dès 2027 puis 2028), France (TVA 20/10/5,5/2,1 %, Factur-X, réception obligatoire depuis le 1.9.2026 et émission des PME au 1.9.2027 via plateforme agréée), Royaume-Uni (VAT, Making Tax Digital), États-Unis (sales tax par État).

## 11. Méthode de travail

Une branche et une PR par lot, CI verte avant fusion. Les règles d'écriture comptable sont des fonctions pures testées une à une (facture, paiement partiel, escompte, avoir, frais de rappel, intérêt moratoire, perte sur débiteur, frais bancaires, arrondi, change, clôture TVA). Aucun secret dans le dépôt.

## 12. Coûts

| Poste | Aujourd'hui | À l'ouverture |
|---|---|---|
| Neon | Gratuit (0,5 Go, 100 CU-heures par mois) | Payant à l'usage au-delà |
| Vercel | Gratuit (Hobby, non commercial) | Pro, environ 20 USD par mois |
| Domaine | Réservé (Porkbun) | Renouvellement annuel |
| E-mails, stockage, Stripe | Offres gratuites, commission Stripe par paiement | selon volume |

## 13. Risques

| Risque | Parade |
|---|---|
| Région de la base aux États-Unis (`aws-us-east-2`) pour des données comptables suisses | À mentionner dans la politique de confidentialité ; décision d'Ève (le projet est vide, c'est le seul moment où un changement ne coûte rien) |
| Erreurs comptables ou TVA | Règles testées, relecture par une fiduciaire avant l'ouverture |
| Hausse de TVA 2028/2029 | Taux et chiffres datés dès le lot 2 |
| Dépendance au Compte Lead (crmlead.io) | Session locale de 12 h ; message clair si le Compte Lead ne répond pas |
| TVA suisse de l'éditeur | Quantum Liquid LLC vend un service électronique en Suisse : vérifier son assujettissement (règle des prestataires étrangers) |
| Clause non commerciale de Vercel Hobby | Passage à Pro avant l'ouverture |

## 14. Questions ouvertes

1. Couleur d'action d'InvoiceLead : bleu `#2563eb` comme Scanlead (choix actuel), ou une couleur propre comme le vert de CRMlead ?
2. Déclarer InvoiceLead dans CRMlead (adresses de retour, secret) et lui donner l'accès dans la formule Gratuit : je peux préparer la migration CRMlead si le dépôt `Casav290/crmlead` est ajouté à la session.
3. Région de la base : garder `aws-us-east-2` ou recréer le projet à Francfort (`aws-eu-central-1`) tant qu'il est vide ?
4. Limites de l'offre Gratuit (section 9) : d'accord, ou autre équilibre ?
5. Neon Auth : le retirer puisque la connexion passe par le Compte Lead ?
