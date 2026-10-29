# InvoiceLead

Devis, factures QR et comptabilité suisse pour indépendants et PME, dans la famille Lead (ScanLead,
CRMlead, ProjectLead). Premier marché : la Suisse, en allemand et en français.

Le plan de développement est dans [docs/PLAN.md](docs/PLAN.md).

## Pile

Next.js 16 (App Router, `src/proxy.ts`), React 19, TypeScript strict, Tailwind CSS v4 au visuel
« Trait net », next-intl en cinq langues (`/de`, `/fr`, `/en`, `/it`, `/es`, liste unique `src/i18n/locales.ts`), Drizzle ORM sur Postgres (Neon en production, `pg`),
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
  par la déconnexion) empêche toute boucle. Si ce cookie ne revient pas (cookies refusés), l'adresse de retour
  porte la marque `?lead_probe=1`, qui fait le même office. Robots, préchargements et `HEAD` reçoivent la page
  telle quelle.
- Déconnexion annoncée par ERPlead (`/auth/lead/backchannel-logout`, `src/server/lead-id/backchannel.ts`) :
  chaque session garde le `sid` du Compte Lead (colonne `sessions.lead_sid`, migration
  `drizzle/0043_session_lead_sid.sql`). `lead_status: "logout"` avec `sid` ferme les sessions de ce navigateur
  (et les anciennes sans `sid`), pas celles des autres appareils ; `"disabled"` (départ) ou un jeton sans `sid`
  (ERPlead d'avant le 13.10.2026) ferment toutes les sessions de la personne.
- Le lanceur à 9 points (`AppSwitcher.tsx`) lit la liste commune des six applications (`src/lib/lead-apps.ts`,
  copie de `~/projets/lead-e2e/lead-family.json`) : même ordre, mêmes marques et couleurs, jamais cachée ni
  détournée par la formule. L'espace porte `data-lead-org` (organisation du Compte Lead) pour le banc
  `~/projets/lead-e2e/check-passage.mjs`.

## Bulle « Assistant IA »

Cahier commun de la famille Lead (24.10.2026, étendu le 27.10.2026 : « tout ce que l'assistant propose
s'applique »). Une bulle ronde en bas à droite de toutes les pages de l'application (jamais sur les
pages publiques) ouvre un fil où l'on demande ce qu'on veut. Code : `src/server/ai-assistant/`
(outils, opérations, prompt, jeton, quota), routes `POST /api/assistant` et
`POST /api/assistant/confirm`, composant `src/components/assistant/AssistantBubble.tsx`, textes
`app.aiBubble` dans `messages/`.

- Modèle `claude-opus-5-5` par le Tool Runner du SDK officiel (`@anthropic-ai/sdk`), effort bas,
  16 000 jetons de sortie par appel, 10 itérations au plus, tour arrêté à 290 s (`maxDuration` 300 s,
  plan Hobby avec Fluid compute ; dépassement : réponse « timeout »), repli serveur en cas de refus. Clé `ANTHROPIC_API_KEY` sur Vercel
  seulement ; sans elle, bulle masquée et route 503.
- Outils = fonctions d'InvoiceLead avec l'entreprise et les droits de la session. Lecture : chiffres,
  livres, contacts, pièces, paiements reçus, relances dues, articles, projets et temps, factures
  fournisseurs, justificatifs, récurrences, plan comptable, exercices, périodes TVA, réglages.
- Écriture : chaque action permise d'un écran a son outil `propose_…` (37 opérations, inventaire et
  raisons des refus dans [docs/ASSISTANT-ACTIONS.md](docs/ASSISTANT-ACTIONS.md)), et `propose_batch`
  regroupe jusqu'à 150 opérations sous une carte, un clic, une transaction (tout ou rien, clés locales
  `@c1`). Proposer = l'opération jouée dans une transaction annulée (rien n'est écrit, la carte montre
  ce que la base contiendrait) ; « Confirmer » = jeton HMAC (personne, entreprise, 10 minutes, usage
  unique), droits relus, même opération dans une transaction validée ; envois vers CRMlead,
  comptabilisation et webhooks seulement après (`src/server/pending-effects.ts`). La page du résultat
  s'ouvre ensuite.
- Jamais : envoyer quoi que ce soit (pièce, relance, lien de partage, plateforme de facturation
  électronique, envoi automatique, reprise d'une récurrence qui s'envoie seule), payer ou enregistrer
  un paiement (rapprochement bancaire et fichier pain.001 compris), supprimer, archiver ou désactiver
  (un compte du plan comptable compris), toucher à l'abonnement, à l'équipe et aux droits ou aux clés.
  L'assistant le dit et ouvre l'écran. Émettre une pièce est permis (numéro définitif, rien n'est
  envoyé).
- Quota : 40 messages par heure et par personne, 400 par jour et par entreprise (`assistant_usage`,
  migration 0046). Le contenu des conversations n'est pas gardé en base ; le fil vit dans le
  `sessionStorage` de l'onglet.
- Même comportement que les bulles des autres applications Lead (alignement du 28.10.2026, B1–B14 :
  délai du tour, cache, fil refusé, réponse jamais muette, « Page ouverte : <écran> », texte simple
  rendu sans HTML, carte lisible, clavier, rien de masqué, mention « peut se tromper », quota et
  « Confirmer » sans course, même origine) : tableau point → code → test dans
  [docs/ASSISTANT-IA.md](docs/ASSISTANT-IA.md).
- Portes du chantier : `node scripts/assistant-actions-gates.mjs G1` à `G8` (inventaire, tests, contrôles
  complets, aperçu réel, refus, production, alignement statique, alignement sur l'aperçu).

## Langues et devise par pays

- Cinq langues partout (interface, e-mails, PDF, pages juridiques) : `messages/<langue>.json`,
  `content/legal/<doc>-<langue>.md`. Le test `tests/unit/messages.test.ts` exige les mêmes clés et
  variables dans les cinq fichiers ; `tests/unit/cinq-langues.test.ts` rend les PDF dans chaque langue.
- Sélecteur de langue (`src/components/LocaleMenu.tsx`) dans l'en-tête de chaque page connectée et des
  pages publiques. Dans l'espace, le choix est gardé dans le compte (`users.chosen_locale`) et passe avant
  la langue du Compte Lead à chaque arrivée sans langue dans l'adresse.
- Langue des documents choisie à part, parmi les cinq. La section paiement de la QR-facture n'existe qu'en
  allemand, français, italien et anglais (norme SIX) : une pièce en espagnol l'imprime en anglais.
- Devise d'une nouvelle entreprise selon la région (`src/lib/region.ts` : en-tête `x-vercel-ip-country`,
  puis Accept-Language, puis langue du Compte Lead) : CH/LI → CHF, Allemagne et France → leur pays en EUR,
  GB → GBP, US → USD, autre pays de la zone euro → pack suisse avec l'euro par défaut
  (`organizations.region_currency`), jamais réservé à Pro.

## Variables d'environnement

Voir `.env.example`. Sur Vercel : `DATABASE_URL` (chaîne « pooled » de Neon), `APP_URL`,
`SESSION_SECRET`, `LEAD_ID_ISSUER`, `LEAD_ID_CLIENT_ID`, `LEAD_ID_CLIENT_SECRET`,
`LEAD_ID_REDIRECT_URI`, `LEAD_ID_APP`. Facultatives : `RESEND_API_KEY` (envoi des e-mails par Resend ; sans elle, seul le lien de consultation est proposé) et `EMAIL_FROM` (par défaut `InvoiceLead <factures@invoicelead.io>`), puis `AI_API_KEY` pour l'assistant comptable (API compatible OpenAI, Z.ai GLM par défaut ; `AI_BASE_URL`, `AI_MODEL` et `AI_VISION_MODEL` pour en changer), et les variables `AWS_*` de Neon Object Storage pour les justificatifs (voir `docs/STOCKAGE.md`). `CRON_SECRET` (32 caractères aléatoires) protège la tâche quotidienne `/api/cron/daily` déclarée dans `vercel.json` (factures récurrentes) ; Vercel l'envoie tout seul quand la variable existe. `BETA_ALLOWLIST` ferme l'application aux organisations Lead, adresses ou domaines (`@fidu.ch`) qui n'y figurent pas, pendant la bêta privée ; `FEEDBACK_EMAIL` reçoit une copie des avis envoyés depuis le menu. `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID` et `STRIPE_WEBHOOK_SECRET` activent le paiement en ligne par Stripe Connect (voir `docs/STRIPE.md`). Le script `vercel-build` applique les migrations avant le build,
en production seulement ; une prévisualisation ne migre que si `ALLOW_PREVIEW_MIGRATIONS=1` (base dédiée).
