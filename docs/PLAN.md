# InvoiceLead, plan de développement

Version 1, 30.09.2026. Document de travail, à valider avant le début du code.

## 1. Vision

InvoiceLead est un logiciel de facturation en ligne pour indépendants et PME, équivalent fonctionnel du module facturation de bexio (offres, factures avec QR-facture, relances, encaissements, rapprochement bancaire). Il rejoint la famille Lead (Scanlead, CRMlead, ProjectLead) et en reprend le visuel « Trait net ».

Marché de départ : la Suisse, en allemand et en français (puis italien et anglais). L'architecture est pensée dès le premier jour pour ajouter l'Allemagne, la France, le Royaume-Uni et les États-Unis sans refonte.

Précision juridique : on reproduit les fonctionnalités et la logique de conversion de la landing page bexio, pas ses textes, images, marque ni sa mise en page exacte (droit d'auteur et LCD/UWG). Tous les textes seront originaux, et le rendu visuel sera celui de la famille Lead.

## 2. Ce qu'on reprend de bexio

| Fonction bexio | InvoiceLead | Phase |
|---|---|---|
| Contacts (entreprises, personnes, adresses) | Contacts avec adresse structurée, langue, conditions de paiement | 2 |
| Articles et prestations | Catalogue avec prix, unité, taux de TVA | 2 |
| Offre, confirmation de commande, facture, avoir | Même chaîne, conversion en un clic | 2 |
| QR-facture | PDF avec section paiement QR conforme SIX | 2 |
| Envoi par e-mail, consultation en ligne | E-mail + lien sécurisé vers la facture en ligne | 2 |
| Relances (3 niveaux, frais) | Relances automatiques paramétrables | 3 |
| E-banking, rapprochement des paiements | Import camt.054 / camt.053, lettrage automatique par référence | 3 |
| bexio pay, TWINT | Stripe (carte, TWINT) sur la facture en ligne | 3 |
| Factures récurrentes | Abonnements clients avec génération automatique | 3 |
| Multi-utilisateurs, accès fiduciaire | Équipe, rôles, accès comptable en lecture | 4 |
| Saisie des justificatifs (OCR/IA) | Dépenses avec scan de justificatifs | 5 |
| Comptabilité, décompte TVA | Comptabilité simplifiée PME, rapport TVA | 5 |
| Suivi du temps, projets | Pont avec ProjectLead | 5 |
| eBill | Nécessite un partenariat avec un réseau eBill | 5 |
| Salaires (Swissdec) | Hors périmètre (certification lourde) | non prévu |
| Application mobile | Application web responsive (PWA) d'abord | 2 |

## 3. Stack technique

Tout est gratuit pendant le développement. Les limites indiquées sont celles des offres gratuites au moment de la rédaction, à revérifier avant le lancement.

| Besoin | Choix | Offre gratuite, remarques |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | Rendu serveur utile pour le SEO de la landing et pour les PDF |
| Interface | Tailwind CSS v4 + composants shadcn/ui (Radix) réglés sur Trait net, icônes Lucide | Open source |
| Base de données | Neon Postgres, région AWS Francfort (eu-central-1) | 0,5 Go et 100 CU-heures par projet et par mois, 10 branches, mise en veille après 5 min |
| Accès aux données | Drizzle ORM + drizzle-kit (migrations), pilote `@neondatabase/serverless` | Léger, typé, adapté au serverless |
| Authentification | Better Auth (open source, données stockées dans Neon) | Organisations, 2FA, passkeys, lien magique ; aucune dépendance à un fournisseur |
| Validation | Zod, React Hook Form | Schémas partagés client/serveur |
| PDF | PDFKit + `swissqrbill` v4 | Bibliothèque de référence pour la QR-facture en Node |
| E-mails | Resend + React Email | Environ 3000 e-mails/mois, 100/jour |
| Fichiers (logos, PDF archivés, justificatifs) | Cloudflare R2 | 10 Go, pas de frais de sortie |
| Traductions | next-intl | de-CH, fr-CH au départ |
| Tâches planifiées (relances, récurrences) | Cron quotidien (Vercel Cron ou GitHub Actions) vers des routes protégées | Suffisant tant qu'on n'a pas besoin de précision horaire |
| Paiements en ligne | Stripe (cartes, TWINT) | Pas d'abonnement, commission par transaction |
| Erreurs, analytics produit | Sentry, PostHog | Offres gratuites suffisantes pour la bêta |
| Tests | Vitest (unitaires), Playwright (bout en bout, audit visuel) | |
| Intégration continue | GitHub Actions | Lint, types, tests à chaque PR |
| Hébergement | Vercel Hobby pour le développement et les prévisualisations | Voir le point d'attention ci-dessous |

Point d'attention hébergement : l'offre Vercel Hobby interdit tout usage commercial, et une landing de SaaS payant compte déjà comme commercial. Deux options au moment d'ouvrir au public : Vercel Pro (environ 20 USD/mois) ou Cloudflare Workers via OpenNext (offre gratuite autorisant l'usage commercial, un peu plus de configuration). Le code restera compatible avec les deux.

## 4. Visuel « Trait net »

Charte reprise de Scanlead et CRMlead (pages publiques alignées le 24.09.2026) :

| Règle | Application dans InvoiceLead |
|---|---|
| Police Archivo uniquement | `next/font/google`, aucune police de repli visible |
| Accent bleu #2563eb | Variable CSS `--primary`, liens, boutons principaux, focus |
| Aucun arrondi | `--radius: 0` pour tous les composants shadcn/ui |
| Aucune ombre | Utilitaires `shadow-*` neutralisés dans le thème |
| Aucun dégradé, pas de sections sombres, pas de cercles décoratifs | Fonds unis, structure portée par les traits (bordures fines) |
| En-tête public en cellules, pied de page commun | Composant `PublicChrome` équivalent à celui de Scanlead |
| Sélecteur d'applications à 9 points dans l'app | Scanlead, CRMlead, ProjectLead, InvoiceLead, chaque lien ouvre `<app>/login` |
| `/login` et `/signup` pour un utilisateur déjà connecté | Redirection directe vers le tableau de bord |

Le même contrôle que sur Scanlead sera automatisé dans la CI : un test Playwright parcourt toutes les pages publiques et l'app à 390, 820 et 1280 px et échoue s'il trouve une police autre qu'Archivo, un arrondi, une ombre, un dégradé ou un débordement horizontal.

Une fois InvoiceLead en ligne, il faudra passer l'entrée « InvoiceLead, Bientôt » des sélecteurs Scanlead et CRMlead vers `https://<domaine>/login` (hors de ce dépôt).

Structure de la landing (logique de conversion inspirée de la page bexio, textes originaux) : en-tête en cellules avec CTA essai gratuit, bloc d'accroche avec aperçu d'une facture QR, trois bénéfices clés, sections détaillées (QR-facture, relances automatiques, rapprochement bancaire, paiement en ligne), fonctionnement en trois étapes, témoignages réels uniquement, tarifs, FAQ, CTA final, pied de page commun.

## 5. Architecture

Un monolithe modulaire : un seul dépôt, un seul déploiement, découpé par domaines métier.

```
src/
  app/
    [locale]/(marketing)/   landing, fonctionnalités, tarifs, FAQ, pages légales
    [locale]/(auth)/        connexion, inscription, mot de passe oublié
    [locale]/(app)/         tableau de bord, documents, contacts, articles, réglages
    i/[token]/              facture en ligne côté client (consultation, paiement)
    api/                    webhooks Stripe, cron, plus tard API publique
  modules/                  contacts, products, documents, payments, reminders, banking, recurring
  core/                     money, tax, numbering, pdf, email, auth, tenancy, audit
  countries/
    ch/                     TVA, QR-facture, camt, mentions légales, formats
    (de, fr, uk, us plus tard)
  db/                       schéma Drizzle, migrations, données de démo
```

Principes retenus :

Multi-entreprise dès le départ. Chaque table métier porte `organization_id`, toutes les lectures et écritures passent par une couche de service qui injecte l'organisation courante, et la sécurité au niveau des lignes de Postgres (RLS) sert de seconde barrière.

L'argent est stocké en entiers (centimes, Rappen) avec le code devise ISO, jamais en nombres à virgule flottante. L'arrondi à 5 centimes est un paramètre par organisation.

Un document émis est figé. Les coordonnées du client, de l'entreprise et les taux de TVA sont copiés dans le document au moment de l'émission, le PDF est archivé dans R2, et toute correction passe par un avoir puis une nouvelle facture. Un journal d'audit trace les actions sensibles.

Les règles propres à un pays vivent dans un « pack pays » (`countries/ch`) qui implémente une interface commune : devise, taux de TVA historisés, règles fiscales, bulletin de paiement, formats de facture électronique, mentions obligatoires, formats d'adresse, de date et de nombre. Le code métier ne connaît que l'interface, ce qui permet d'ajouter l'Allemagne ou les États-Unis sans toucher au cœur.

Les mutations internes passent par des Server Actions ; une API REST publique documentée (OpenAPI) viendra en phase 5.

## 6. Modèle de données, première version

| Table | Contenu principal |
|---|---|
| `organizations`, `members` | Entreprise (raison sociale, IDE/UID, n° TVA, méthode TVA, langue, devise, logo), utilisateurs et rôles |
| tables Better Auth | Utilisateurs, sessions, comptes, invitations |
| `bank_accounts` | IBAN, QR-IBAN, banque |
| `contacts`, `contact_persons` | Entreprise ou personne, adresse structurée (rue, numéro, NPA, localité, pays), langue, e-mail, conditions de paiement |
| `products` | Référence, désignation multilingue, unité, prix, taux de TVA |
| `tax_rates` | Pays, code, taux en points de base, dates de validité |
| `number_sequences` | Modèle de numérotation par type de document (ex. `RE-{YYYY}-{0000}`) |
| `documents` | Type (offre, commande, facture, avoir), numéro, statut, client, adresse figée, dates, devise, langue, totaux, référence QR/SCOR, document d'origine |
| `document_lines` | Position, type (article, texte, sous-total, rabais), quantité, prix, rabais, taux TVA figé, total |
| `payments` | Montant, date, moyen, source (manuel, import bancaire, Stripe) |
| `bank_imports`, `bank_transactions` | Fichiers camt importés et lignes à lettrer |
| `reminder_levels`, `reminders` | Paramètres de relance par organisation, relances envoyées |
| `recurring_invoices` | Modèle, fréquence, prochaine échéance |
| `email_messages` | Historique d'envoi et d'ouverture |
| `files`, `audit_logs`, `subscriptions` | Fichiers R2, journal, abonnement InvoiceLead de l'organisation |

## 7. Exigences suisses

QR-facture : norme SIX IG v2.3, en vigueur depuis le 21 novembre 2025 et valable jusqu'en novembre 2027 ; seules les adresses structurées sont admises. Deux combinaisons : IBAN classique avec référence créancier SCOR (ISO 11649), ou QR-IBAN avec référence QR à 27 chiffres (clé modulo 10 récursif). Les factures générées seront vérifiées avec l'outil de validation de SIX avant le lancement.

TVA : 8,1 %, 2,6 % et 3,8 % depuis le 1er janvier 2024, stockés avec leurs dates de validité pour gérer les changements futurs. Méthode effective ou taux de la dette fiscale nette, décompte sur contre-prestations convenues ou reçues. Mentions obligatoires de l'art. 26 LTVA sur chaque facture, dont le numéro au format `CHE-123.456.789 TVA` (MWST, IVA selon la langue).

Documents en allemand, français, italien et anglais, la langue étant choisie par client.

Relances : niveaux, délais et frais paramétrables, intérêt moratoire de 5 % (art. 104 CO) en option.

Rapprochement : import des avis de crédit camt.054 et des relevés camt.053 (ISO 20022), lettrage automatique par référence QR ou SCOR, file de validation pour les cas ambigus.

Conservation : pièces conservées dix ans (art. 958f CO), PDF émis immuables.

Protection des données : nLPD. Hébergement dans l'UE (Francfort), à indiquer dans la politique de confidentialité avec la liste des sous-traitants et un DPA, comme pour Scanlead.

## 8. Feuille de route

Chaque phase donne lieu à une ou plusieurs PR avec une URL de prévisualisation et une branche Neon dédiée, pour tester sans toucher aux données réelles. Les durées supposent des sessions de travail régulières ; le rythme dépend surtout des retours et validations.

| Phase | Contenu | Terminé quand | Durée indicative |
|---|---|---|---|
| 0. Fondations | Next.js, TypeScript, lint et formatage, CI, Neon + Drizzle, Better Auth avec organisations, next-intl (de, fr), thème Trait net, audit Playwright, déploiement de prévisualisation | On peut créer un compte et une entreprise, arriver sur un tableau de bord vide, et la CI est verte | 2 à 3 jours |
| 1. Site public | Landing, fonctionnalités, tarifs, FAQ, pages légales (mentions, confidentialité, conditions, DPA), SEO, en-tête en cellules et sélecteur d'apps | Pages publiques en de et fr, audit Trait net sans erreur à 3 largeurs | 3 à 4 jours |
| 2. MVP facturation | Configuration de l'entreprise, contacts, articles, offres, factures, avoirs, numérotation, PDF avec QR-facture, envoi par e-mail, facture en ligne, paiements saisis à la main, tableau de bord | Une vraie facture QR envoyée à un client et payée en scannant le QR dans une app bancaire | 2 à 3 semaines |
| 3. Encaissement | Relances automatiques, import camt et lettrage, paiement par carte et TWINT via Stripe, factures récurrentes, exports CSV | Une facture payée par TWINT et une autre par virement se marquent payées toutes seules | 2 semaines |
| 4. SaaS commercial | Offres et facturation d'InvoiceLead par Stripe Billing, essai gratuit, limites par offre, équipe et rôles, accès fiduciaire, bêta privée | Premiers clients bêta facturés | 1 à 2 semaines |
| 5. Au-delà de la facture | Dépenses et justificatifs, comptabilité simplifiée (plan comptable PME), rapport TVA, pont ProjectLead et CRMlead, API publique et webhooks, eBill | Selon les priorités issues de la bêta | continu |
| 6. International | Packs pays, voir ci-dessous | Premier pays hors Suisse en production | par pays |

Packs pays prévus :

| Pays | Particularités à couvrir |
|---|---|
| Allemagne | EUR, USt 19 % et 7 %, XRechnung et ZUGFeRD ; réception des e-factures B2B obligatoire depuis 2025, émission obligatoire dès 2027 au-delà de 800 000 EUR de chiffre d'affaires puis pour tous en 2028 ; QR code EPC (GiroCode) |
| France | EUR, TVA 20 %, 10 %, 5,5 %, 2,1 %, Factur-X ; réception obligatoire pour toutes les entreprises depuis le 1er septembre 2026, émission pour les PME et TPE au 1er septembre 2027, via une plateforme agréée |
| Royaume-Uni | GBP, VAT 20 %, 5 %, 0 %, Making Tax Digital |
| États-Unis | USD, pas de TVA mais une sales tax par État et localité, formats US (dates, adresses) |

## 9. Méthode de travail

Une branche et une PR par lot de fonctionnalités, relue avant fusion. Tests unitaires obligatoires sur tout ce qui calcule de l'argent : TVA, arrondis, totaux, références QR et SCOR, numérotation. Tests de bout en bout sur les parcours critiques (inscription, création et envoi d'une facture, paiement). Aucun secret dans le dépôt : les clés (Neon, Resend, Stripe, R2) vivent dans les variables d'environnement de l'hébergeur et de l'environnement de développement.

## 10. Coûts

| Poste | Pendant le développement | Au lancement commercial |
|---|---|---|
| Neon | Gratuit | Gratuit tant qu'on reste sous 0,5 Go, ensuite facturation à l'usage |
| Hébergement | Gratuit (Vercel Hobby) | Vercel Pro environ 20 USD/mois, ou Cloudflare gratuit |
| E-mails | Gratuit | Offre payante de Resend au-delà de 3000 e-mails/mois |
| Stockage R2 | Gratuit | Gratuit jusqu'à 10 Go |
| Stripe | Gratuit | Commission par transaction uniquement |
| Nom de domaine | À prévoir | Environ 15 à 30 CHF/an |

## 11. Risques

| Risque | Parade |
|---|---|
| Clause non commerciale de Vercel Hobby | Bascule vers Vercel Pro ou Cloudflare avant l'ouverture publique |
| Démarrage à froid de Neon (veille après 5 min) | Latence de quelques centaines de ms sur la première requête, acceptable ; compute toujours actif si besoin plus tard |
| Non-conformité de la QR-facture | Bibliothèque éprouvée, tests unitaires, validation SIX, test réel avec plusieurs apps bancaires |
| Ressemblance excessive avec bexio | Textes originaux, visuel Trait net, aucune reprise de marque ou d'images |
| eBill et connexion bancaire directe (bLink) | Nécessitent des partenariats payants, reportés en phase 5 ; l'import camt couvre le besoin en attendant |

## 12. Questions ouvertes

Ce document sera mis à jour avec les réponses.

1. Fichiers de référence du visuel : `trait-public-static.css` et `PublicChrome.tsx` de Scanlead (ou accès au code), le logo, et les couleurs secondaires (texte, bordures, fonds, erreur, succès). bexio.com, scanlead.io et crmlead.io sont bloqués par le réseau de l'environnement de développement actuel.
2. Comptes : un login propre à InvoiceLead, comme aujourd'hui entre Scanlead et CRMlead, ou un compte unique pour toute la famille Lead ?
3. Périmètre du MVP : facturation seule (recommandé) ou comptabilité et TVA dès le départ ?
4. Cible et prix : indépendants seuls ou PME à plusieurs utilisateurs, essai gratuit ou offre gratuite limitée, prix visé.
5. Hébergement : GitHub + Vercel (puis Vercel Pro ou Cloudflare) alors que Scanlead et CRMlead sont sur Replit, d'accord ?
6. Langues au lancement (de + fr ?) et nom de domaine.
7. Neon : compte existant, et accès depuis l'environnement de développement (variable `DATABASE_URL`, domaine `*.neon.tech` autorisé).
8. Dépôt GitHub : il est public aujourd'hui ; le passer en privé ? Et créer une branche `main` pour servir de base aux PR.
