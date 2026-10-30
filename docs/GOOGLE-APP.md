# « Continuer avec Google » dans l'app Android / iOS (30.10.2026)

Demande d'Ève : dans l'app, l'écran du Compte Lead ne proposait qu'Apple et le mot de passe. Une personne qui a créé son
compte avec Google sur ordinateur n'avait pas de mot de passe et ne pouvait entrer que par « Mot de passe oublié ? ».
Google refuse sa connexion dans une vue web (« disallowed_useragent ») : la connexion Google se fait désormais dans le
**navigateur du téléphone**, puis l'app **revient toute seule**, connectée (RFC 8252).

Contrat d'ERPlead (Compte Lead) : `~/projets/erplead-google-app/docs/GOOGLE-APP.md`. Cahier du chantier :
`~/projets/.unlazy/google-app/CAHIER.md`. Ici, la part d'InvoiceLead.

| | |
|---|---|
| Schéma du lien de retour | `io.invoicelead.app` (appId Capacitor), lien `io.invoicelead.app://lead-auth?code=<43 caractères>` ou `?error=expired` |
| Page relais | `https://invoicelead.io/lead-auth/google?start=…&back=…` (le proxy la sert dans la langue de `back` : `/<langue>/lead-auth/google`) |
| Émetteur (`ERPLEAD`) | `LEAD_ID_ISSUER` (https://erplead.io) |
| Agent de l'app | `InvoiceLeadApp LeadAppAuth/1` (dépôt mobile, `appendUserAgent`) : sans `LeadAppAuth/1`, ERPlead ne montre pas Google dans l'app mais la phrase « Mot de passe oublié » |

## Parcours

1. Vue web de l'app → `/auth/lead/start` (agent de l'app : `platform=app`) → écran du Compte Lead : « Continuer avec
   Google » → ERPlead pose son cookie verifier (HttpOnly, dans la vue web) et renvoie vers la page relais.
2. **Page relais** (`src/app/[locale]/lead-auth/google/page.tsx`, `GoogleRelay`) : `start` doit commencer par
   `ERPLEAD/auth/google/app/start?` et `back` par `ERPLEAD/login?` (sinon rien n'est ouvert : connexion ordinaire de
   l'app). Dans l'app : une connexion notée avant est effacée (ERPlead vient de remplacer le cookie verifier : son code
   ne pourrait plus aboutir), `back` gardé (sessionStorage), écran « Connexion avec Google… » avec un lien « Retour »,
   lecture du lien de lancement (au plus 1,5 s ; **jamais suivi sur cette page**, c'est un ancien lien), connexion
   notée **en cours** (localStorage `invoicelead.leadAuth.pending` : l'heure et l'empreinte de cet ancien lien), puis
   `Browser.open({ url: start })`. Navigateur refermé sans lien de retour (`browserFinished`, 1,5 s de grâce pour
   Android) ou impossible à ouvrir : connexion effacée, `back`. Hors de l'app : `back` tout de suite.
3. Navigateur du téléphone : Google, puis ERPlead → page « Revenez dans InvoiceLead » → `io.invoicelead.app://lead-auth?code=…`.
4. **Lien de retour** (`listenForReturn`, `src/lib/lead-app-auth.ts`), sur **toutes** les pages (composant
   `LeadAppReturn` du gabarit `[locale]`) : `App.addListener('appUrlOpen')` et `App.getLaunchUrl()`. Seul le préfixe
   `io.invoicelead.app://lead-auth?` est accepté, et **seulement pendant une connexion en cours** : lien reçu par
   `appUrlOpen` sur la page relais qui a ouvert le navigateur, ou connexion notée il y a moins de 15 min (app relancée
   par son lien ; jamais le lien de lancement de la page relais ni celui qu'elle a noté comme ancien). Un lien inattendu
   (page web piégée, courriel, code QR, autre app, ancien lien redonné par `getLaunchUrl`) ne fait **rien** : ni
   navigateur fermé, ni page quittée. Un lien **avec code** n'est suivi qu'**une fois** (empreinte FNV gardée sans
   échéance dans localStorage `invoicelead.leadAuth.seen` : iOS redonne son dernier lien à `getLaunchUrl` sur chaque
   page ; le code n'est jamais gardé). Le lien d'erreur `?error=expired` est toujours le même : il n'est **jamais**
   gardé comme vu (sinon la deuxième demande expirée ne ramènerait plus à l'écran de connexion). Lien suivi : connexion
   effacée, `Browser.close()` (erreur ignorée) ; code valable → `location.replace(ERPLEAD + '/auth/google/app/redeem?code=' + code)` ;
   sinon `back` gardé, ou `/auth/lead/start` (connexion ordinaire).
5. ERPlead rachète le code avec le cookie de la vue web, ouvre sa session et reprend l'autorisation → `/auth/lead/callback`
   d'InvoiceLead, comme après un mot de passe.

**App relancée par le lien** (Android a fermé l'app pendant la connexion Google) : sans session, la vue web passe par
`/<langue>/login`, qui partait tout droit (redirection serveur) vers le Compte Lead. Pour les versions `LeadAppAuth/1`
seulement (`inAppAuthApp`), cet écran rend une page vide (`LeadAppLoginRedirect`) qui lit d'abord le lien de lancement
(au plus 1,5 s), puis part vers `/auth/lead/start`. Avec un cookie de session **périmé** (déconnexion « de partout »),
le proxy laisse passer vers `/<langue>/app` et c'est la garde (`requireSession`, `src/server/auth/guard.ts`,
`sessionLoginPath`) qui renvoyait tout droit vers `/auth/lead/start` : aucune page d'InvoiceLead ne lisait le lien, le
code était perdu, et l'essai suivant le rachetait avec le NOUVEAU cookie (ERPlead brûlait alors ce nouveau départ).
Dans l'app (`LeadAppAuth/1`), la garde passe donc elle aussi par `/<langue>/login?next=…` (ou `?invite=…`).
Anciennes versions et navigateurs : inchangés (redirection serveur vers `/auth/lead/start`).

**Limite (relecture du 30.10.2026, contrat d'ERPlead § 5)** : le schéma `io.invoicelead.app` peut être déclaré par
n'importe quelle app du téléphone. Une app hostile qui fait elle-même le départ (sa propre vue web, agent
`LeadAppAuth/1`) et ouvre `start` dans un onglet du navigateur recevrait le code et le rachèterait avec SON cookie : la
session ERPlead de la personne qui finit la connexion Google. La parade d'ERPlead (départ sur un autre réseau → « Ouvrir
InvoiceLead ? ») ne joue pas (même téléphone, même réseau). Parade complète : un lien https revendiqué (App Links
Android + `assetlinks.json`, Universal Links iOS + Associated Domains) pour les CINQ apps, ou ASWebAuthenticationSession
sur iOS — décision et réglages Apple / Google Play à prendre, pas faits ici.

L'app web n'ajoute aucun paquet npm : elle parle au pont que la coque injecte (`window.Capacitor.Plugins.App`,
`.Browser`), seulement si `Capacitor.isNativePlatform()` est vrai. Elle ne lit ni ne garde jamais le verifier, ne parle
à aucune API : tout passe par des navigations de la vue web.

## Fichiers

- `src/lib/lead-app-auth.ts` : la logique (sans React ni DOM réel), testée avec un faux pont.
- `src/components/native/LeadAppAuth.tsx` : `LeadAppReturn`, `GoogleRelay`, `LeadAppLoginRedirect`.
- `src/app/[locale]/lead-auth/google/page.tsx`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/login/page.tsx`,
  `src/proxy.ts` (page relais sans langue), `src/lib/native.ts` (`isAppAuthAgent`), `src/server/native.ts`,
  `src/server/auth/guard.ts` (`sessionLoginPath` : sans session, dans l'app, par l'écran de connexion de l'app).
- `messages/*.json` : `leadAppAuth` (5 langues).
- Essais : `tests/unit/lead-app-auth.test.ts`, `tests/unit/lead-app-guard.test.ts` ; `tests/e2e/google-app.spec.ts` avec `tests/support/fake-capacitor.js`
  (faux pont) et le faux Compte Lead (`tests/support/fake-lead-id.mjs`, routes `/auth/google/app…` du contrat).
- Portes : `scripts/google-app-gates.mjs` (G1 essais et contrôles complets, G2 dépôt mobile, APERCU, G3 aperçu).

## Dépôt mobile (`~/projets/invoicelead-mobile`, branche `google-app`)

- `capacitor.config.ts` : `appendUserAgent: 'InvoiceLeadApp LeadAppAuth/1'` ; `allowNavigation` garde erplead.io et Apple.
- iOS `Info.plist` : `CFBundleURLTypes` → `io.invoicelead.app` ; le `SceneDelegate` passe déjà les liens à Capacitor.
- Android `AndroidManifest.xml` : `intent-filter` VIEW / DEFAULT / BROWSABLE, `scheme="io.invoicelead.app"`,
  `host="lead-auth"`, activité principale `singleTask`.
- `@capacitor/app` et `@capacitor/browser`, `npx cap sync`, version 1.0.2 (build / versionCode 3).
