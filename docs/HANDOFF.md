# Passation InvoiceLead et CRMlead (1er octobre 2026, 13 h)

Dossier à donner à la session Claude Code qui reprend le travail. Il dit ce qui est en ligne, ce qui attend, comment tester et ce qu'il ne faut pas refaire.

## 1. Le projet et les règles d'Ève

InvoiceLead (invoicelead.io) est un clone de bexio : facturation et comptabilité avec IA, d'abord pour la Suisse, puis l'Allemagne, la France, le Royaume-Uni et les États-Unis. L'IA fait 99 % de la comptabilité, l'humain valide. InvoiceLead fait partie de la famille Lead : Scanlead, CRMlead, ProjectLead et InvoiceLead. Une seule connexion, le « Compte Lead », sert pour les quatre. C'est un fournisseur OpenID Connect hébergé dans CRMlead (crmlead.io).

Règles permanentes :

- **Écrire à Ève** en français naturel, avec des phrases simples et courtes. Pas d'emoji, pas de tiret cadratin, peu de listes, pas de gras inutile. Quand elle doit faire quelque chose, le dire en une ou deux étapes très claires. Elle ne veut pas de bla-bla ni de pauses inutiles : avancer, tester soi-même, et ne revenir que quand c'est fini et vérifié.
- **Secrets** : n'en jamais coller ni stocker. Ils vont dans Vercel ou dans les secrets Replit, posés par Ève ou par Claude Desktop. L'ancienne clé GLM est révoquée : ne jamais la réutiliser.
- **Commits** : aucun identifiant de modèle dans les commits ou les PR. Chaque commit se termine par les deux lignes `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` et `Claude-Session: https://claude.ai/code/session_015AT1U1UY4BxSTw2EdKn1UP`. Le corps des PR finit par « 🤖 Generated with [Claude Code](https://claude.com/claude-code) » puis l'adresse de la session.
- **Branches et fusions** :
  - Travailler sur la branche `claude/adoring-volta-d1nses` dans les deux dépôts.
  - Fusionner en squash : pas de commit de fusion sur `main` dans CRMlead (`docs/CLAUDE.md` de CRMlead).
  - Le garde-fou refuse une fusion sans accord explicite d'Ève. Il faut une phrase claire comme « fusionne » ou « fais-le » ; un simple « ok » a été refusé une fois.
  - La poussée forcée est refusée aussi. Pour repartir de main sur une branche déjà fusionnée : prendre la branche distante, y fusionner `origin/main`, puis appliquer les nouveaux commits par-dessus.
- **Règle produit du jour** : « une personne qui ne paie rien nulle part peut accéder partout, en formule gratuite ». Toutes les applications sont ouvertes dans toutes les formules ; seules les limites sont payantes.

## 2. Ce qui est en ligne

**InvoiceLead.** `main` = 3419a12 (PR #4), en production sur Vercel (fusion = déploiement automatique). Contenu :

- connexion directe vers le Compte Lead ;
- tableau de bord chiffré ;
- couleur prune #7a2e67 ;
- logo de l'entreprise ;
- synchronisation des devis et factures vers CRMlead ;
- scan des tickets de notes de frais par l'IA (en formule gratuite, compris dans les 20 lectures de pièces du mois depuis le 1er octobre, voir docs/PLAN.md section 9).

**CRMlead.** `main` = 31e1259 (PR #3), publié sur Replit le 1er octobre à 10 h 08 UTC. L'agent Replit a vérifié en production : titre « Compte Lead », bundle avec `sso-parked`. Contenu :

- écran de connexion neutre « Compte Lead » (quatre carrés SL CL PL IL) ;
- retour direct après la connexion ;
- retour de Google direct ;
- fiche du lead avec ses devis et factures InvoiceLead (migration 112).

## 3. Ce qui attend (poussé, ni fusionné ni publié)

**InvoiceLead PR #5** (https://github.com/Casav290/InvoiceLead/pull/5, brouillon). Branche `claude/adoring-volta-d1nses`, tête 084635d.

- Demande de connexion propre à chaque onglet : cookie `il_lead_login_<state>`, valable 3 h.
- Une demande expirée est relancée une fois sans écran (`il_login_retry`).
- Une session expirée rouvre la page demandée : le proxy pose `x-il-requested-path`, lu par `requireSession`.
- Un second onglet arrivant sur la même demande va sur sa page (cookie `<nom>_ok`).
- L'écran d'erreur garde `next`.

Tests :
- local : `biome ci`, `tsc`, 161 tests unitaires et 141 e2e passent ;
- CI : verte sur 9e5cc01. Rouge sur b5446d2 : un seul échec sur 141, `tests/e2e/uk.spec.ts:65` (après « post-pending », le journal ne contient pas « 1100 »). Non investigué. Piste : la date du jour (1er octobre, début de trimestre et exercice créé par « fiscal-year-first »), plutôt que la connexion. À regarder en premier, puis vérifier la CI de la tête.

**CRMlead PR #4** (https://github.com/Casav290/crmlead/pull/4, brouillon). Même branche, tête c835719. Pas de CI dans ce dépôt.

- La page du Compte Lead est servie neutre dès le premier octet (`leadAccountPage`) : titre, icône SVG, pas de manifeste, marque déjà dessinée, langue de `ui_locales`.
- **Retour de Google** :
  - la demande revient dans l'adresse (`loginPage(outcome, next, mode)`) ;
  - un cookie par départ (`crmlead_sso_next_<state>`), valable 3 h ;
  - un échec à l'inscription renvoie sur `/signup` ;
  - le second facteur est gardé au rechargement.
- **Navigation** : Retour, rechargement et lien interne relisent la demande dans l'adresse (`urlAppRequest`). Un autre onglet repart vers l'application quand il reprend le focus.
- **Mot de passe oublié** : la demande suit l'aller-retour. L'email part au nom du Compte Lead, dans la langue de l'application, et ramène à l'application. Le lien `jeton` affiche toujours son formulaire.
- **Inscription depuis une application** :
  - pas d'emails CRMlead (bienvenue, J+1, J+4, récapitulatif, rapport du lundi) : `quietForApp` ;
  - email de confirmation neutre ;
  - la page de confirmation mène à l'application.
- **Hors connexion** : le service worker sert une page neutre, plus l'accueil CRMlead.
- **Migration 113** : toutes les applications sont ouvertes dans toutes les formules, ProjectLead compris. Une application ajoutée plus tard est ouverte par défaut (`lead_entitlements` redéfinie).

**Mise en ligne, une fois l'accord d'Ève obtenu :**

1. Vérifier la CI d'InvoiceLead #5, sortir les deux PR du brouillon et les fusionner en squash.
2. InvoiceLead se déploie seul sur Vercel.
3. Pour CRMlead (replId `8029293c-b0aa-47fd-a5bc-dd836e1021c1`), ne pas utiliser le bouton « Pull » de Replit : il ne marche pas. Faire lancer par l'agent Replit (`update_app_using_prompt`) :
   - `node scripts/sync-from-github.mjs` ;
   - puis `npm run db:migrate` sur la base de dev ;
   - puis le calcul de l'écart de schéma dev vers production, qui ne doit rien supprimer.

   Il dit « sans publier » ; on lui demande ensuite le résultat avec `ask_question`.
4. Publier avec `publish_app`. Pendant 1 à 2 minutes, crmlead.io peut répondre 500 (redémarrage) : c'est normal.
5. Faire vérifier la production par l'agent Replit, par exemple : `curl https://crmlead.io/login?next=%2Foauth%2Fauthorize%3Fclient_id%3Dinvoicelead` doit contenir `<title>Compte Lead</title>`.

## 4. La connexion : où on en est

Ève a demandé une note de 1 à 10, en corrigeant jusqu'à 10/10. Elle ne veut jamais voir CRMlead (logo, page, tableau de bord, onglet, icône, emails) quand on se connecte depuis InvoiceLead, et toujours arriver directement sur la page demandée.

Trois rounds de vérification par des agents indépendants (scripts dans `~/.claude/.../workflows/scripts/`) :

| Round | Notes | Résultat |
|---|---|---|
| 1 | 4 à 8 | Une quinzaine de défauts, tous corrigés |
| 2 | 6 à 9 | Neuf défauts réels, tous corrigés |
| 3 | 7 à 9 | Ses défauts confirmés sont corrigés par les derniers commits (b5446d2, 084635d, 484b5f5, c835719) |

Le round 3 avait déjà jugé les cas Google réglés, une fois le code relu. Reste à faire : un 4e round sur les têtes actuelles pour confirmer 10/10, puis la mise en ligne.

En parallèle, 16 parcours ont été vérifiés dans un vrai navigateur, avec les deux applications branchées l'une sur l'autre en local. Chaque affichage de crmlead.io est relevé depuis le premier octet. Résultat : 0 apparition de CRMlead, et l'arrivée se fait sur la bonne page. Voir la section 7.

Limites acceptées, à ne pas « corriger » :

- l'adresse crmlead.io dans la barre (domaine neutre à décider par Ève) ;
- le nom affiché par l'écran de Google, qui se change dans Google Cloud Console (écran de consentement OAuth, nom « Compte Lead ») et qu'Ève doit faire elle-même ;
- un code de second facteur faux consomme le défi (protection) ;
- l'application mobile native ;
- le slogan neutre qui cite les quatre applications ;
- un rechargement unique quand le service worker se met à jour ;
- les pages de mauvaise configuration ;
- les emails envoyés depuis noreply@crmlead.io (pas d'autre domaine vérifié).

## 5. Autres travaux faits aujourd'hui

- **Tableau de bord** : chiffres du mois et de l'année, encaissé, à encaisser, retards, offres en cours et acceptées, fournisseurs, graphique sur 12 mois (`src/server/dashboard.ts`).
- **Couleur** : prune #7a2e67 pour InvoiceLead, à côté du bleu Scanlead #2563eb et du vert CRMlead #0f6e70.
- **Scan des tickets** : « Scanner un ticket » en tête des notes de frais. La photo est lue par l'IA, qui remplit la note ; la personne vérifie et envoie (`scanTicketAction`, `extractReceipt` sans rapprochement bancaire). La formule gratuite lit 20 pièces par mois par l'IA (tickets et justificatifs, un seul compteur ; les e-factures, lues sans IA, n'y comptent pas) ; les fonctions Pro restent visibles, grisées avec leur marque (docs/PLAN.md, section 9).

## 6. Reste à faire

- Les icônes PNG de l'application (PWA) sont encore bleues : les refaire en prune.
- **Formule à jour** : elle est écrite à la connexion web. Quand elle a plus de 12 h, elle est relue au Compte Lead (`src/server/plan-refresh.ts`, `GET /api/lead-id/v1/entitlements?org=…` avec un jeton d'application de portée `exchange`, sinon `billing`) : tâche quotidienne d'abord, API et MCP, pages (fiduciaire d'une entreprise dont personne ne se connecte). Sans réponse pendant 72 h, l'entreprise est traitée en formule gratuite. À vérifier en production : que le client `invoicelead` obtient ce jeton (le retour de la tâche quotidienne dit `plans: { refreshed, stale }`) ; sinon une entreprise Pro+ qui n'utilise que l'API retombe en gratuit au bout de 72 h, jusqu'à sa prochaine connexion.
- Ève demandait où sont les fonctions du lot 9. Elles sont en ligne : justificatifs, pilote automatique, factures fournisseurs, relances, assistant, temps. Certaines restent réservées à Pro, et sa propre organisation est en formule gratuite. Elle trouve évident que tout soit fait par l'IA ; vérifier chaque écran avec ce regard (comme le scan de ticket, ajouté après sa remarque).
- La session ProjectLead (`session_0163GdSWCc4xq32BHpUh7X3J`) demandait comment invoicelead.io a été branché sur Porkbun et Resend. Réponse : par Ève, avec Claude Desktop sur son ordinateur. DNS chez Porkbun, clé Resend dans Vercel ; étapes dans `docs/RESEND.md`. Cette session n'avait pas d'outil pour répondre.
- Côté Ève :
  - le paiement test Stripe (étape 5) ;
  - le stockage S3 (partie C, non faite ; les fichiers vont en base en attendant) ;
  - `scripts/smoke.sh` de CRMlead, jamais lancé ici.

## 7. Tester en local

**Postgres** (s'arrête souvent ; le relancer si `ECONNREFUSED`) :

```
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/il-data -l /var/lib/postgresql/il.log start"
```

**InvoiceLead** :

- `npx biome ci .`, `npx tsc --noEmit`, `npx vitest run`, `npx playwright test`. L'e2e utilise un faux Compte Lead : `tests/support/fake-lead-id.mjs`.
- `npx playwright test` sert le build existant : refaire `npx next build` avant.
- Migrations : `npx drizzle-kit generate --name X`, puis `DATABASE_URL=postgres://postgres@localhost:5432/invoicelead_test VERCEL_ENV=production npm run db:migrate`.

**CRMlead** (`/home/user/crmlead`) :

- `npx tsc --noEmit -p .` et `npx vite build`.
- Dépendances : `npm ci --ignore-scripts`.
- `server/migrate.ts` échoue sur une base vide. Pour monter `crmlead_e2e`, appliquer les fichiers dans l'ordre avec psql (en superutilisateur), puis rejouer `db/000_roles.sql` :

  ```
  for f in $(ls db/*.sql | sort); do psql -U postgres -h localhost -d crmlead_e2e -v ON_ERROR_STOP=1 -q -f $f; done
  ```

- Brancher InvoiceLead sur ce Compte Lead :

  ```
  update lead_id_clients set redirect_uris='{http://localhost:3300/auth/lead/callback}', secret_hash=encode(sha256('lid_test_e2e_secret'::bytea),'hex') where client_id='invoicelead'
  ```

**Les deux ensemble** :

- `scripts/lead-login-live/start-both.sh` lance CRMlead sur 3301 et InvoiceLead sur 3300.
- Puis `node scripts/lead-login-live/e2e-login.mjs` (et `e2e-login2`, `e2e-login3`, `e2e-login4`). Pour `e2e-login2`, passer en argument le dossier des journaux, ou `CRM_LOG=/tmp/crm.log`.
- Ces scripts relèvent chaque affichage de crmlead.io et comptent les apparitions de CRMlead : il en faut zéro.

## 8. Pièges connus

- Ne jamais lancer `pkill -f` sur une chaîne présente dans sa propre commande : cela tue le shell. Utiliser `fuser -k <port>/tcp`.
- `after()` de `next/server` hors requête : dans Vitest, le simuler avec `vi.mock`.
- Le proxy d'InvoiceLead ne doit pas rediriger tout droit vers le Compte Lead : un préchargement lancerait une connexion. Les liens publics sont des `<a>` simples vers `/auth/lead/start`.
- Le réseau de la session bloque crmlead.io, porkbun.com et api.resend.com. Pour vérifier la production de CRMlead, passer par l'agent Replit.
