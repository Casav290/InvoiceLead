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
   l'app). Dans l'app : `back` gardé (sessionStorage), écran « Connexion avec Google… » avec un lien « Retour »,
   `Browser.open({ url: start })`. Navigateur refermé sans lien de retour (`browserFinished`, 1,5 s de grâce pour
   Android) : `back`. Hors de l'app : `back` tout de suite.
3. Navigateur du téléphone : Google, puis ERPlead → page « Revenez dans InvoiceLead » → `io.invoicelead.app://lead-auth?code=…`.
4. **Lien de retour** (`listenForReturn`, `src/lib/lead-app-auth.ts`), sur **toutes** les pages (composant
   `LeadAppReturn` du gabarit `[locale]`) : `App.addListener('appUrlOpen')` et `App.getLaunchUrl()`. Seul le préfixe
   `io.invoicelead.app://lead-auth?` est accepté ; chaque lien n'est traité qu'**une fois** (empreinte FNV gardée dans
   localStorage : iOS redonne son dernier lien à `getLaunchUrl` sur chaque page ; le code n'est jamais gardé) ;
   `Browser.close()` (erreur ignorée) ; code valable → `location.replace(ERPLEAD + '/auth/google/app/redeem?code=' + code)` ;
   sinon `back` gardé, ou `/auth/lead/start` (connexion ordinaire).
5. ERPlead rachète le code avec le cookie de la vue web, ouvre sa session et reprend l'autorisation → `/auth/lead/callback`
   d'InvoiceLead, comme après un mot de passe.

**App relancée par le lien** (Android a fermé l'app pendant la connexion Google) : sans session, la vue web passe par
`/<langue>/login`, qui partait tout droit (redirection serveur) vers le Compte Lead. Pour les versions `LeadAppAuth/1`
seulement (`inAppAuthApp`), cet écran rend une page vide (`LeadAppLoginRedirect`) qui lit d'abord le lien de lancement
(au plus 1,5 s), puis part vers `/auth/lead/start`. Anciennes versions et navigateurs : inchangés (redirection serveur).

L'app web n'ajoute aucun paquet npm : elle parle au pont que la coque injecte (`window.Capacitor.Plugins.App`,
`.Browser`), seulement si `Capacitor.isNativePlatform()` est vrai. Elle ne lit ni ne garde jamais le verifier, ne parle
à aucune API : tout passe par des navigations de la vue web.

## Fichiers

- `src/lib/lead-app-auth.ts` : la logique (sans React ni DOM réel), testée avec un faux pont.
- `src/components/native/LeadAppAuth.tsx` : `LeadAppReturn`, `GoogleRelay`, `LeadAppLoginRedirect`.
- `src/app/[locale]/lead-auth/google/page.tsx`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/login/page.tsx`,
  `src/proxy.ts` (page relais sans langue), `src/lib/native.ts` (`isAppAuthAgent`), `src/server/native.ts`.
- `messages/*.json` : `leadAppAuth` (5 langues).
- Essais : `tests/unit/lead-app-auth.test.ts` ; `tests/e2e/google-app.spec.ts` avec `tests/support/fake-capacitor.js`
  (faux pont) et le faux Compte Lead (`tests/support/fake-lead-id.mjs`, routes `/auth/google/app…` du contrat).
- Portes : `scripts/google-app-gates.mjs` (G1 essais et contrôles complets, G2 dépôt mobile, APERCU, G3 aperçu).

## Dépôt mobile (`~/projets/invoicelead-mobile`, branche `google-app`)

- `capacitor.config.ts` : `appendUserAgent: 'InvoiceLeadApp LeadAppAuth/1'` ; `allowNavigation` garde erplead.io et Apple.
- iOS `Info.plist` : `CFBundleURLTypes` → `io.invoicelead.app` ; le `SceneDelegate` passe déjà les liens à Capacitor.
- Android `AndroidManifest.xml` : `intent-filter` VIEW / DEFAULT / BROWSABLE, `scheme="io.invoicelead.app"`,
  `host="lead-auth"`, activité principale `singleTask`.
- `@capacitor/app` et `@capacitor/browser`, `npx cap sync`, version 1.0.2 (build / versionCode 3).
