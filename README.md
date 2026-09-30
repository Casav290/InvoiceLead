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
npm run build && npm run e2e   # Playwright : connexion Compte Lead et audit Trait net à 390, 820, 1280 px
```

L'audit Trait net échoue sur toute police autre qu'Archivo, tout arrondi, toute ombre, tout dégradé
et tout débordement horizontal.

## Variables d'environnement

Voir `.env.example`. Sur Vercel : `DATABASE_URL` (chaîne « pooled » de Neon), `APP_URL`,
`SESSION_SECRET`, `LEAD_ID_ISSUER`, `LEAD_ID_CLIENT_ID`, `LEAD_ID_CLIENT_SECRET`,
`LEAD_ID_REDIRECT_URI`, `LEAD_ID_APP`. Le script `vercel-build` applique les migrations avant le build.
