# InvoiceLead

Devis, factures QR et comptabilité suisse pour indépendants et PME, dans la famille Lead (Scanlead,
CRMlead, ProjectLead). Premier marché : la Suisse, en allemand et en français.

Le plan de développement est dans [docs/PLAN.md](docs/PLAN.md).

## Pile

Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript strict, Tailwind CSS v4 au visuel
« Trait net », next-intl (`/de`, `/fr`), Drizzle ORM sur Postgres (Neon en production, `pg`),
connexion par le **Compte Lead** (OpenID Connect hébergé par CRMlead, kit `src/server/lead-id/leadId.ts`).
Hébergement : Vercel. Base : projet Neon `tiny-shape-39858234`, branche `production`.

## Démarrer en local

```bash
npm ci
cp .env.example .env.local        # puis remplir DATABASE_URL, SESSION_SECRET, LEAD_ID_*
npm run db:migrate
npm run dev
```

Sans accès au vrai Compte Lead, le faux émetteur des tests suffit :
`node tests/support/fake-lead-id.mjs` (port 4010) avec `LEAD_ID_ISSUER=http://localhost:4010`,
`LEAD_ID_CLIENT_SECRET=lid_test_secret` et `LEAD_ID_REDIRECT_URI=http://localhost:3100/auth/lead/callback`.

## Contrôles

```bash
npm run lint        # Biome
npm run typecheck   # TypeScript
npm test            # Vitest, sur la base TEST_DATABASE_URL (migrée)
npm run build && npm run e2e   # Playwright : connexion Compte Lead et audit Trait net à 320, 390, 820, 1280 px
```

L'audit Trait net échoue sur toute police autre qu'Archivo, tout arrondi, toute ombre, tout dégradé
et tout débordement horizontal. `E2E_APP_PORT` et `E2E_LEAD_PORT` (3100 et 4010 par défaut) lancent la
suite Playwright sur d'autres ports, à côté d'une autre suite.

## Passer d'une application Lead à l'autre

Règle commune de la famille (13.10.2026). L'adresse d'entrée d'InvoiceLead est `https://invoicelead.io/login` :
c'est elle que visent les lanceurs et les liens des autres applications.

- Session du Compte Lead ouverte : `/login`, la racine tapée (`/`, `/fr`, `/?lang=fr`) et tout lien profond
  mènent sans écran dans l'espace de l'entreprise, créé ou rejoint au besoin (`attach.ts`), dans la langue de
  l'adresse ou, sans elle, dans celle du Compte Lead (`claims.locale`), jamais celle du navigateur.
- Session fermée : la racine fait un seul essai silencieux (`/auth/lead/start?prompt=none&from=…`, décision
  dans `src/lib/lead-entry.ts`), puis montre la page de vente ; le cookie `lead_probe` (10 minutes, posé aussi
  par la déconnexion) empêche toute boucle. Robots, préchargements et `HEAD` reçoivent la page telle quelle.
- Le lanceur à 9 points (`AppSwitcher.tsx`) lit la liste commune des six applications (`src/lib/lead-apps.ts`,
  copie de `~/projets/lead-e2e/lead-family.json`) : même ordre, mêmes marques et couleurs, jamais cachée ni
  détournée par la formule. L'espace porte `data-lead-org` (organisation du Compte Lead) pour le banc
  `~/projets/lead-e2e/check-passage.mjs`.

## Variables d'environnement

Voir `.env.example`. Sur Vercel : `DATABASE_URL` (chaîne « pooled » de Neon), `APP_URL`,
`SESSION_SECRET`, `LEAD_ID_ISSUER`, `LEAD_ID_CLIENT_ID`, `LEAD_ID_CLIENT_SECRET`,
`LEAD_ID_REDIRECT_URI`, `LEAD_ID_APP`. Facultatives : `RESEND_API_KEY` (envoi des e-mails par Resend ; sans elle, seul le lien de consultation est proposé) et `EMAIL_FROM` (par défaut `InvoiceLead <factures@invoicelead.io>`), puis `AI_API_KEY` pour l'assistant comptable (API compatible OpenAI, Z.ai GLM par défaut ; `AI_BASE_URL`, `AI_MODEL` et `AI_VISION_MODEL` pour en changer), et les variables `AWS_*` de Neon Object Storage pour les justificatifs (voir `docs/STOCKAGE.md`). `CRON_SECRET` (32 caractères aléatoires) protège la tâche quotidienne `/api/cron/daily` déclarée dans `vercel.json` (factures récurrentes) ; Vercel l'envoie tout seul quand la variable existe. `BETA_ALLOWLIST` ferme l'application aux organisations Lead, adresses ou domaines (`@fidu.ch`) qui n'y figurent pas, pendant la bêta privée ; `FEEDBACK_EMAIL` reçoit une copie des avis envoyés depuis le menu. `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID` et `STRIPE_WEBHOOK_SECRET` activent le paiement en ligne par Stripe Connect (voir `docs/STRIPE.md`). Le script `vercel-build` applique les migrations avant le build,
en production seulement ; une prévisualisation ne migre que si `ALLOW_PREVIEW_MIGRATIONS=1` (base dédiée).
