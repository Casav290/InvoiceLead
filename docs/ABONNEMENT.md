# Abonnement InvoiceLead (Pro, Pro+)

Décision d'Ève du 13 octobre 2026 : chaque application Lead (Scanlead, CRMlead, InvoiceLead, ProjectLead, Greetlead) vend son propre abonnement, valable chez elle seule ; ailleurs, la version gratuite. InvoiceLead encaisse donc Pro et Pro+ lui-même. Mêmes prix que les autres applications : Pro 19 € par mois ou 190 € par an (1 personne), Pro+ 39 € par mois ou 390 € par an (5 personnes), hors TVA.

Rien à voir avec Stripe Connect (docs/STRIPE.md), qui sert aux factures que les entreprises clientes encaissent chez leurs propres clients : autres variables, autre webhook, autre secret.

## Parcours

1. Tous les liens « Passer à Pro / Pro+ » (menu de la personne, fonctions grisées, équipe, tableau de bord, page Tarifs après inscription) mènent à **Réglages → Formule** (`/[locale]/app/settings/plan`, `?plan=pro|pro_plus` présélectionne).
2. L'administrateur (rôle Lead `admin`) choisit mensuel ou annuel et clique : `POST /api/billing/checkout` crée (une fois) le client Stripe propre à InvoiceLead, puis une session Stripe Checkout, et l'y envoie.
3. Au retour, Stripe ramène sur `GET /api/billing/return?locale=…&session_id=…`, qui relit la session chez Stripe et enregistre l'abonnement aussitôt (si la session est bien celle de l'entreprise connectée), puis ouvre la page Formule sur `?checkout=done`. Le webhook fait de même de son côté.
4. Ensuite, « Gérer l'abonnement » (`POST /api/billing/portal`) ouvre le portail Stripe d'InvoiceLead : changer de formule ou de période, carte, factures, résiliation en fin de période.
5. Toutes les places prises (écran « sans accès ») : l'administrateur peut passer à Pro+ depuis cet écran même.

## Ce qui est écrit, et où

- `organizations.billing_customer_id` : le client Stripe d'InvoiceLead (metadata `app=invoicelead`, `account_id` = id de l'entreprise). Jamais retrouvé par e-mail ni partagé : le portail ne montre que les abonnements InvoiceLead.
- `billing_subscriptions` : un abonnement Stripe par ligne (formule, période, statut, fin, résiliation programmée, `erplead_synced_at`).
- `billing_events` : chaque événement Stripe traité, une seule fois.
- `organizations.billing_plan` / `billing_plan_until` : la formule payée ici, jusqu'à la fin de période plus trois jours de grâce. `tierOf` prend la meilleure de celle-ci et de la formule InvoiceLead que donne le Compte Lead : le paiement vaut tout de suite, même si ERPlead tarde.
- Déclaration au Compte Lead : `POST {LEAD_ID_ISSUER}/api/lead-id/v1/subscriptions` (jeton d'application, portée `billing`), avec l'organisation Lead, `external_id` = `sub_…`, la formule (`pro`, `pro_plus`), le statut Stripe et la fin de période. Les droits rendus sont enregistrés comme une relecture de formule. Sans réponse, `erplead_synced_at` reste vide et la tâche quotidienne (`/api/cron/daily`) redéclare.

## Isolation sur le compte Stripe partagé

Le compte Stripe live (« scanlead.io ») est celui de toutes les applications Lead. InvoiceLead :

- marque tout : `metadata.app = "invoicelead"` sur le client, la session Checkout et l'abonnement (`subscription_data.metadata`), avec `account_id`, `plan`, `interval` ; produits et prix marqués, `lookup_key` `invoicelead_pro_monthly`, `_pro_yearly`, `_proplus_monthly`, `_proplus_yearly` ;
- n'envoie jamais `client_reference_id` ni `metadata.workspace_id` (Scanlead les lit et annule ce qu'il ne reconnaît pas), ni `invoice_id` / `organization_id` (clés de Connect) ;
- filtre chaque événement AVANT toute écriture (`classify`, src/server/billing/stripe.ts) : `checkout.session.completed` en mode abonnement marqué invoicelead ; `customer.subscription.*` marqué invoicelead ET avec un prix reconnu (identifiant, lookup_key ou metadata) ; `invoice.payment_failed` dont l'abonnement est marqué invoicelead. Tout le reste répond 200 (`other_app`, `connect`, `ignored`) sans écrire ni appeler Stripe ;
- relit l'abonnement chez Stripe pour chaque événement retenu, sous un verrou par abonnement puis par entreprise : l'ordre d'arrivée des événements n'a pas d'effet ;
- ne crée chez Stripe que des clients, des sessions Checkout et des sessions de portail. Aucune annulation, aucun remboursement.

## Variables (Vercel, Production seulement, jamais en Preview)

| Variable | Valeur |
|---|---|
| `STRIPE_BILLING_SECRET_KEY` | clé du compte Stripe de la famille (clé restreinte `rk_live_` de préférence) |
| `STRIPE_BILLING_WEBHOOK_SECRET` | secret `whsec_` de l'endpoint `https://invoicelead.io/api/billing/webhook` |
| `STRIPE_BILLING_PRICE_PRO_MONTHLY`, `_PRO_YEARLY`, `_PROPLUS_MONTHLY`, `_PROPLUS_YEARLY` | identifiants des 4 prix |
| `STRIPE_BILLING_PORTAL_CONFIGURATION` | configuration de portail propre à InvoiceLead (`bpc_…`) |
| `STRIPE_BILLING_AUTOMATIC_TAX` | facultatif, `1` : TVA par Stripe Tax (éteinte, comme CRMlead) |
| `STRIPE_BILLING_API_URL` | facultatif (tests : faux Stripe) |

Sans clé ni les 4 prix, la page Formule dit « bientôt » et le webhook répond 503 (Stripe réessaie pendant 3 jours).

## Mise en place des objets Stripe

`scripts/stripe-billing-setup.mjs` (idempotent ; refuse une clé live sans `--live`) crée les produits `invoicelead_pro` et `invoicelead_pro_plus`, les 4 prix (EUR, `tax_behavior=exclusive`), la configuration de portail (4 prix, prorata, **sans quantité**, résiliation en fin de période) et, avec `--webhook`, l'endpoint aux 5 événements (`checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`). Le secret de l'endpoint n'est jamais affiché : il est écrit dans `--secret-file` (mode 600), à poser tel quel dans Vercel. Le script commun de CRMlead (`scripts/stripe-setup.mjs --app invoicelead`) suit les mêmes conventions ; vérifier dans ce cas que le portail n'autorise pas la quantité.

## Essais

- `npx vitest run tests/unit/billing-webhook.test.ts tests/unit/plans.test.ts` : règle par application, isolation (CRMlead, Scanlead, ProjectLead, Greetlead, Connect : 200 sans écriture), signatures, ordre des événements, Compte Lead en panne.
- `npx playwright test tests/e2e/billing.spec.ts` : parcours complet avec le faux Stripe du faux Compte Lead (tests/support/fake-lead-id.mjs).
- Stripe en mode test réel, en local seulement : application lancée avec les `STRIPE_BILLING_*` de test, puis `node scripts/stripe-billing-checkout.mjs --cancel` (Playwright sans tête, carte 4242, portail, résiliation) et `node scripts/stripe-billing-replay.mjs --since <t0>` (rejeu signé des événements de test vers `/api/billing/webhook` ; refuse une clé live et une adresse non locale).

## Retour arrière

Retirer les variables `STRIPE_BILLING_*` : la page Formule se dit « bientôt », le webhook répond 503, les abonnements déjà vendus restent dans Stripe et en base (et valent jusqu'à `billing_plan_until`). La migration 0042 est additive. Les objets Stripe ne se suppriment pas : les désactiver (prix `active=false`, endpoint désactivé).
