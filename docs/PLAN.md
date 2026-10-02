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

Décidé par Ève le 1er octobre 2026 (sa demande : « il faut les griser pour que l'on sache qu'elles existent, et on peut autoriser de toutes petites variantes pour la version gratuite ») :

| | Gratuit | Pro | Pro+ |
|---|---|---|---|
| Prix (hors TVA) | 0 | 19 € par mois, 190 € par an | 39 € par mois, 390 € par an |
| Utilisateurs | 1 ; plus de places visibles avec la marque Pro | 2, plus accès fiduciaire gratuit | 5, puis supplément par utilisateur |
| Factures | 10 émises par mois ; devis et avoirs illimités | illimitées | illimitées |
| Contacts | 50 | illimités | illimités |
| QR-facture, documents DE/FR/IT/EN, logo | oui | oui | oui |
| Mention « Créé avec InvoiceLead » | oui | non | non |
| Comptabilité (écritures automatiques, bilan, résultat, clôture) | oui | oui | oui |
| Lecture des pièces par l'IA (tickets de notes de frais, justificatifs déposés ou relus ; un seul compteur) | 20 par mois | 50 par mois | 300 par mois |
| E-factures reçues (XRechnung, ZUGFeRD, Factur-X, UBL), lues sans IA | sans limite | sans limite | sans limite |
| Assistant (questions sur les livres) | 10 questions par mois | sans limite | sans limite |
| Relances | 1re relance à la main, 5 par mois ; 2e et 3e, envoi automatique, frais, intérêts et relances intelligentes visibles, grisés | 3 niveaux, envoi automatique, frais, intérêts, relances intelligentes | idem |
| Factures récurrentes | 1 active | illimitées | illimitées |
| Import bancaire camt | 1 relevé par mois (un fichier : un compte, 31 jours de dates au plus), pilote automatique compris | illimité | illimité, plus connexion directe |
| Récapitulatif du pilote par e-mail (le lundi) | non, grisé | oui | oui |
| Décompte TVA (TVA, UStVA, CA3, MTD, sales tax) | non : page et onglet visibles, structure et contrôles affichés, montants masqués (ils ne quittent pas le serveur), relecture et validation grisées ; un décompte validé en Pro reste lisible | oui : Suisse (effective et TDFN), UStVA, CA3, MTD et sales tax américaine | oui |
| Multidevise | non : devises étrangères grisées dans les listes ; un brouillon en devise (créé en Pro) reste modifiable, son émission est grisée jusqu'au retour à la monnaie de l'entreprise ; un devis en devise ne se facture pas et ne donne pas d'acompte (commandes grisées) ; un avoir reste permis ; une facture fournisseur en devise (justificatif, e-facture) reste modifiable, son approbation est grisée ; une facture en devise ne devient pas récurrente et sa récurrence d'avant attend ; le pays ne change pas tant qu'un brouillon garderait l'ancienne devise | oui | oui |
| Accès fiduciaire | non, grisé ; l'accès d'une fiduciaire déjà invitée est suspendu, rendu au retour à Pro | oui | oui |
| Sociétés | 1 | 1 | jusqu'à 3 |
| API, serveur MCP, webhooks | non, grisé (marque Pro+) | non, grisé (marque Pro+) | oui |
| eBill | non | non | oui |

Règle d'affichage : rien n'est caché à une formule. Une fonction d'une formule supérieure reste à sa place (onglet, bouton, option, formulaire, réglage), grisée, avec la marque « Pro » ou « Pro+ », une raison écrite et un lien de mise à niveau atteignable au clavier. Une allocation épuisée grise la commande avec la même marque et une phrase du type « Vos 20 lectures gratuites de ce mois sont utilisées. ».

Mise en œuvre : `src/server/plans.ts` porte la table des formules, `featureAccess` (fonctions réservées) et `quotaAccess`, `consumeQuota`, `refundQuota` (allocations). Les compteurs mensuels (lectures, questions, relances, relevés) sont dans `plan_usage`, par entreprise et par mois civil UTC : une unité est réservée en un seul ordre SQL avant l'action, refusée au-delà de la limite, rendue si l'IA ou l'envoi échoue. Les factures du mois, les contacts et les récurrences actives se comptent sur les données, sous un verrou par entreprise (`lockQuota`) dans la transaction qui crée : `issueInvoice` compte d'après le type du brouillon en base (« planLimit »), `createContactWithinPlan` pour le formulaire, l'API, le MCP et l'import CRMlead. Chaque action serveur, route d'API et tâche planifiée passe par ces fonctions ; l'écran grisé (`ProLock`, `ProBadge`, `PlanNotice`) n'est qu'un reflet. Les limites ne bloquent jamais les données existantes : une facture en devise reste modifiable, les clés d'API restent révocables, une récurrence au-delà de l'allocation attend sans être modifiée, comme les livraisons de webhooks d'une entreprise sortie de Pro+. Les tâches planifiées écartent ce qui attend dans la requête elle-même : une récurrence ou une livraison retenue ne prend jamais la place de celles qui tournent.

Formule à jour : elle est écrite à chaque connexion web. Plus vieille que 12 h, elle est relue au Compte Lead (`src/server/plan-refresh.ts`) par la tâche quotidienne avant les relances, les récurrences, les webhooks et le récapitulatif, par l'API et le MCP, et par les pages (fiduciaire d'une entreprise dont personne ne se connecte). Sans réponse du Compte Lead pendant 72 h, l'entreprise est traitée en formule gratuite jusqu'à la relecture suivante.

Principes : ne jamais faire payer la QR-facture, les devis ni les documents multilingues (tous les concurrents les donnent) ; faire du décompte TVA le principal déclencheur de passage au payant (l'assujettissement à 100'000 CHF signale une entreprise qui grandit) ; ne jamais faire payer la réception des e-factures (obligatoire en France depuis le 1er septembre 2026). Prix de la famille Lead, les mêmes que Scanlead, affichés en euros et hors TVA sur la page Tarifs : 19 € et 39 € par mois, 190 € et 390 € par an (deux mois offerts), facturés en euros par Quantum Liquid LLC.

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
| 5. TVA | Décompte effective et TDFN, convenu et reçu, XML eCH-0217, clôture de période | Un décompte accepté par le portail AFC | 5a fait : décompte trimestriel méthode effective, convenu, contrôles bloquants, relecture IA, validation qui fige la période et vire la TVA sur 2201 ; 5b fait : méthode TDFN (semestres, taux net, écart porté en déduction sur ventes) ; 5c fait : contre-prestations reçues (TVA due au prorata des paiements); 5d fait : XML eCH-0217 v1.0 du décompte validé (méthode effective et TDFN), validé contre le schéma officiel (docs/ech-0217) ; reste un dépôt d'essai sur l'ePortal de l'AFC |
| 6. Encaissement | Relances automatiques, récurrentes, paiement en ligne (carte, TWINT), lecture des pièces | Une facture payée par TWINT se lettre toute seule | 6a fait : relances à trois niveaux (10, 25, 40 jours), e-mail avec PDF et QR-facture ou relance notée ; lecture des pièces faite au lot 4d ; 6b fait : factures récurrentes (1, 3, 6 ou 12 mois), émises, comptabilisées et envoyées par une tâche quotidienne ; 6c fait : paiement en ligne par Stripe Connect (carte, TWINT, SEPA, ACH selon le compte de l'entreprise), bouton sur le lien de la facture, notification signée qui enregistre le paiement une seule fois et le comptabilise sur un compte d'attente, docs/STRIPE.md ; 6d fait : factures en devise (CHF, EUR, USD, GBP) en formule Pro, cours de référence BCE figé à l'émission ou saisi, journal tenu dans la monnaie de l'entreprise, différence de change comptabilisée au paiement (cours du jour, dernier paiement soldant la créance au centime), avoir au cours de sa facture, contre-valeur et TVA convertie sur le document, XRechnung et ZUGFeRD avec la TVA dans la monnaie de l'entreprise (BT-6, BT-111) acceptés par KoSIT ; une facture en devise se solde à la main, pas par le relevé bancaire ; 6e fait : relances Pro (2e et 3e niveaux, envoi automatique chaque matin sur option), frais de rappel dès la 2e relance et intérêt moratoire simple réglables, réclamés dans l'e-mail et le solde, comptabilisés en produit financier hors chiffre d'affaires, abandon possible par extourne ; la formule gratuite garde la première relance, sans frais |
| 7. SaaS | Quotas par formule, équipe et rôles, accès fiduciaire, échange avec CRMlead (lead gagné vers facture), bêta privée | Premiers clients bêta | 7a fait : limites par formule (Gratuit 10 factures par mois, 50 contacts ; banque, justificatifs, TVA et récurrence en Pro, révisé au lot 7f), encarts de mise à niveau, usage au tableau de bord, mention « Créé avec InvoiceLead » sur les PDF du plan Gratuit ; 7b fait : équipe et rôles (factures, comptabilité, lecture seule, sans accès ; places selon la formule), accès fiduciaire gratuit en Pro par invitation, avec changement d'entreprise ; 7c fait : passage d'un lead gagné de CRMlead vers un devis ou une facture en brouillon (lien relu puis confirmé, sans doublon, docs/CRMLEAD.md) ; 7d fait : bêta privée (liste d'accès BETA_ALLOWLIST par organisation, adresse ou domaine) et avis envoyés depuis le menu ; 7e fait : API REST et webhooks en Pro+ (clés à empreinte, contacts, devis, factures, émission, paiements, PDF ; événements invoice.issued, payment.created, invoice.paid signés HMAC, rejoués cinq fois, adresses privées refusées), docs/API.md ; 7f fait (1er octobre 2026) : fonctions Pro visibles et grisées avec leur marque, petites allocations gratuites (20 lectures de pièces, 10 questions, 5 relances, 1 relevé et 1 récurrence active), compteurs mensuels réservés côté serveur (section 9) |
| 9. Rattrapage des concurrents | Pilote automatique, factures fournisseurs et pain.001, temps et projets, application installable, assistant et MCP, relances intelligentes, pièces manquantes (relevé des concurrents du 30.9.2026) | Chaque fonction en ligne, testée | 9a fait : pilote automatique (option Pro, révisé au lot 7f : ouvert à toutes les formules, récapitulatif en Pro) qui comptabilise seul les paiements reconnus par leur référence, les règles confirmées trois fois et l'IA sûre à 97 %, sans renforcer ses propres règles ; écran « À vérifier » pour tout approuver ou annuler par extourne ; anomalies (doublons, justificatifs manquants, montants inhabituels) ; récapitulatif par e-mail le lundi ; 9b fait : factures fournisseurs (depuis un justificatif lu par l'IA avec échéance, IBAN et référence, depuis une e-facture XRechnung, ZUGFeRD, Factur-X ou UBL lue sans IA, ou saisies), double validation en option, comptabilisation à l'approbation (charge et impôt préalable contre fournisseurs, compte appris du fournisseur), fichier de paiement pain.001.001.09 validé contre le schéma ISO, solde automatique par le relevé ; 9c fait : temps et projets (projets par client avec tarif horaire et budget, chrono et saisie rapide, heures facturables transformées en brouillon de facture en un clic et libérées si le brouillon est supprimé, chiffre d'affaires facturé et tarif horaire réellement obtenu par projet) ; 9d fait : application installable (manifeste, icônes carrées, raccourcis « justificatif » et « chrono ») et écran de capture pour téléphone qui envoie la photo dès qu'elle est prise et montre ce que l'IA a lu ; 9e fait : assistant en langage naturel (Pro, révisé au lot 7f : 10 questions par mois en Gratuit) qui répond à partir d'un instantané des livres calculé sans IA, sans rien modifier, et serveur MCP (Pro+, /api/mcp) pour Claude ou ChatGPT avec les outils de lecture, de brouillon, d'émission, de paiement et de temps ; 9f fait : relances intelligentes (Pro) avec profil de paiement appris de chaque client, rythme adapté (14 jours pour les bons payeurs, 7 pour les retardataires), rappel courtois trois jours avant l'échéance pour les retardataires, prévision des encaissements par semaine selon les habitudes de chaque client ; 9g fait : confirmation de commande (depuis un devis) et bon de livraison sans prix (depuis un devis ou une facture) en PDF, factures d'acompte en pourcentage d'un devis (une ligne par taux) déduites de la facture finale en quantité négative, notes de frais et indemnités kilométriques saisies par chaque personne et remboursées par le circuit des factures fournisseurs (approbation, pain.001, relevé), prévision de trésorerie sur treize semaines avec premier découvert signalé, export DATEV (Buchungsstapel EXTF 700, TVA par clés BU, produits à 7 % sur 4300) et FEC (art. A47 A-1 LPF) ; à faire relire : format DATEV par un Steuerberater, FEC par un expert-comptable avec Test Compta Demat |
| 8. International | Packs pays DE, FR, UK, US | Premier pays hors Suisse | 8a fait : pack pays (taux datés, devise, bulletin, format des montants) et facturation Allemagne (EUR, USt 19/7 %, USt-IdNr., GiroCode SEPA, § 19 UStG, pays figé après la première pièce) ; 8b fait : comptabilité allemande (plan SKR04 réduit, écritures automatiques, banque camt, IA et justificatifs adaptés, UStVA Kz 81/86/35/21/48/66/83 validée sur 3820, échéance au 10); 8c fait : facture électronique allemande (PDF ZUGFeRD en PDF/A-3 avec XML EN 16931, XRechnung 3.0 en XML validé par le validateur officiel KoSIT sur 5 cas, PDF/A-3b validé par veraPDF, Steuernummer, docs/XRECHNUNG.md) ; 8d fait : facturation France (EUR, TVA 20/10/5,5 %, SIRET et TVA intracommunautaire contrôlés, mentions obligatoires, Factur-X validé par KoSIT) ; 8e fait : comptabilité française (PCG réduit à six chiffres, TVA déductible sur immobilisations et sur autres biens, CA3 lignes A1, E2, 08, 9B, 09, 16, 19, 20, 23, 28, 25 validée sur 445510) ; 8f fait : interface et documents en anglais (/en, 1025 messages, pages légales, libellés de comptes anglais) ; 8g fait : Royaume-Uni (GBP, VAT 20/5 %, VAT number et Companies House contrôlés, nominal ledger, déclaration MTD neuf cases validée sur 2202, échéance à un mois et sept jours) ; 8h fait : États-Unis (USD, sales tax au taux combiné de l'entreprise avec trois décimales, EIN, ZIP et État, adresses et dates américaines, papier Letter, sales tax non récupérable sur les achats, plan de comptes courant, relevé de sales tax validé sur 2210) ; reste les relectures d'experts et les dépôts électroniques (docs/PAYS.md) |

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
4. Limites de l'offre Gratuit (section 9) : décidé le 1er octobre 2026 (fonctions Pro grisées, petites allocations gratuites).
5. Neon Auth : le retirer puisque la connexion passe par le Compte Lead ?
