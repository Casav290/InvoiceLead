# « Continuer avec Google » dans l'app Android / iOS (30.10.2026, révisé : liens vérifiés)

Demande d'Ève : dans l'app, l'écran du Compte Lead ne proposait qu'Apple et le mot de passe. Une personne qui a créé son
compte avec Google sur ordinateur n'avait pas de mot de passe et ne pouvait entrer que par « Mot de passe oublié ? ».
Google refuse sa connexion dans une vue web (« disallowed_useragent ») : la connexion Google se fait donc dans le
**navigateur sûr du téléphone**, puis l'app **revient toute seule**, connectée (RFC 8252).

Révision du même jour (choix d'Ève « Liens vérifiés ») : le retour ne passe plus par un schéma propre
(`io.invoicelead.app://…`, que n'importe quelle app du téléphone peut déclarer) mais par un **lien https réservé à l'app
par Apple et Google** : `https://invoicelead.io/lead-auth/return` (Universal Link iOS, App Link vérifié Android, ou
adresse rendue par la session iOS).

Contrat d'ERPlead (Compte Lead) : `~/projets/erplead-google-app/docs/GOOGLE-APP.md`. Cahier du chantier :
`~/projets/.unlazy/google-app/CAHIER.md`. Ici, la part d'InvoiceLead.

| | |
|---|---|
| Lien de retour (`RETOUR`) | `https://invoicelead.io/lead-auth/return?code=<43 caractères>&locale=<l>` ou `?error=expired&locale=<l>` ; origine de production **écrite dans le code** (`src/lib/lead-app-auth.ts`, `RETURN_URL`), jamais lue du serveur |
| Page relais | `https://invoicelead.io/lead-auth/google?start=…&back=…` (le proxy la sert dans la langue de `back` : `/<langue>/lead-auth/google`) |
| Émetteur (`ERPLEAD`) | `LEAD_ID_ISSUER` (https://erplead.io) |
| Agent de l'app | `InvoiceLeadApp LeadAppAuth/2` (dépôt mobile, `appendUserAgent`) : sans `LeadAppAuth/2` (anciennes versions et `LeadAppAuth/1`, jamais publiée), ERPlead ne montre pas Google dans l'app mais la phrase « Mot de passe oublié » |
| Fichiers d'association | `https://invoicelead.io/.well-known/apple-app-site-association` et `/.well-known/assetlinks.json` (`src/lib/app-links.ts`) |

## Parcours

1. Vue web de l'app → `/auth/lead/start` (agent de l'app : `platform=app`) → écran du Compte Lead : « Continuer avec
   Google » → ERPlead pose son cookie verifier (HttpOnly, dans la vue web) et renvoie vers la page relais.
2. **Page relais** (`src/app/[locale]/lead-auth/google/page.tsx`, `GoogleRelay`, `startRelay`) : `start` doit commencer
   par `ERPLEAD/auth/google/app/start?` (sans `m` : c'est l'app qui l'ajoute) et `back` par `ERPLEAD/login?` (sinon rien
   n'est ouvert : connexion ordinaire de l'app). Dans l'app : une connexion notée avant est effacée (ERPlead vient de
   remplacer le cookie verifier), `back` gardé (sessionStorage), écran « Connexion avec Google… » avec un lien
   « Retour », lecture du lien de lancement (au plus 1,5 s ; **jamais suivi sur cette page**), connexion notée **en
   cours** (localStorage `invoicelead.leadAuth.pending` : `{ t, stale, s, m }`, l'heure, l'empreinte de cet ancien
   lien, l'empreinte du départ `start` et la façon d'ouvrir : `auto` session iOS, `tap` navigateur par défaut d'iOS,
   `tab` Custom Tab), puis l'ouverture selon la plateforme (`Capacitor.getPlatform()`) :
   - **iOS 17.4+** (module de l'app `LeadAuthSession`, `isAvailable().https`) : `LeadAuthSession.start({ url: start +
     '&m=auto' })` (ASWebAuthenticationSession avec retour https vers `invoicelead.io/lead-auth/return`). L'adresse
     rendue suit les règles du lien de retour (point 4) ; `canceled` → connexion effacée, `back` ; autre refus
     (association absente, `busy`, `failed`…) → navigateur par défaut comme ci-dessous.
   - **iOS 15.0 à 17.3** : `LeadAuthSession.openExternal({ url: start + '&m=tap' })` : `UIApplication.open`, donc le
     **navigateur par défaut** (Safari, ou Chrome, Firefox… choisi par la personne depuis iOS 14). L'écran dit alors
     « Terminez la connexion dans votre navigateur, puis touchez « Ouvrir InvoiceLead » » (`leadAppAuth.relaySafari`,
     5 langues, jamais « Safari » : contrat § 3a). ERPlead y finit par une page à bouton : le lien touché (Universal
     Link) rouvre l'app (seul Safari est certain de le faire, contrat § 0 [A13] ; sinon la page de repli).
   - **iOS sans le module** (ne devrait pas arriver avec `LeadAppAuth/2`) : `back`.
   - **Android** : `Browser.open({ url: start + '&m=auto' })` (Custom Tab). ERPlead finit par une redirection vers
     l'App Link vérifié. Custom Tab refermé sans lien de retour (`browserFinished`, 1,5 s de grâce) ou impossible à
     ouvrir : connexion effacée, `back`.
   - Hors de l'app : `back` tout de suite.
   - **Page relais rechargée** pendant sa connexion (contrat § 3a, « page relais qui garde son adresse ») : sous iOS,
     Capacitor recharge la page quand le processus de la vue web est tué (`webViewWebContentProcessDidTerminate` →
     `bridge.reset()` puis `webView.reload()`), souvent pendant que la personne est dans son navigateur. La page garde
     `start` et `back` dans son adresse : le rechargement se reconnaît au **même départ** (empreinte `s` de la
     connexion en cours, fraîche ; ERPlead fait un départ neuf à chaque « Continuer avec Google »). Alors rien n'est
     effacé ni **jamais rouvert** (le départ est à usage unique : « La demande a expiré ») ; le lien de lancement y est
     suivi s'il n'est pas l'ancien noté (iOS : `getLaunchUrl` rend le dernier lien ouvert), comme l'`appUrlOpen` retenu
     par la coque. Navigateur par défaut (`m=tap`) : même texte, le lien attendu. Android (`tab`) : `browserFinished` →
     `back`. Session iOS (`auto`) : son résultat est perdu avec la page ; `LeadAuthSession.resume({ url: start +
     '&m=auto' })` si le module l'a (facultatif, contrat § 1 ; **présent** dans le module d'InvoiceLead 1.0.2 :
     ios/App/App/LeadAuthSession.swift) : adresse rendue → règles du lien de retour, `failed` → navigateur par défaut
     (`'&m=tap'`), autre refus (`none`, `canceled`) → `back` ; module sans `resume` : connexion effacée et `back`. Une autre page relais (autre départ), ou une
     connexion de plus de 15 min, reste une nouvelle connexion.
   - En-têtes de la page relais : `Referrer-Policy: no-referrer` (aussi la balise `<meta name="referrer">`) et
     `Cache-Control: no-store` (`next.config.ts`, et la redirection sans langue de `src/proxy.ts`) : son adresse porte le
     départ à usage unique (`d`) et la demande d'autorisation OpenID (`back`). Aucun script tiers sur le site.
3. Navigateur du téléphone : Google, puis ERPlead → `https://invoicelead.io/lead-auth/return?code=…&locale=…`
   (redirection serveur en `m=auto`, bouton « Ouvrir InvoiceLead » en `m=tap`).
4. **Lien de retour** (`listenForReturn`, `src/lib/lead-app-auth.ts`), sur **toutes** les pages (composant
   `LeadAppReturn` du gabarit `[locale]`) : `App.addListener('appUrlOpen')` (Universal Link, App Link) et
   `App.getLaunchUrl()`, plus l'adresse rendue par la session iOS. Seul le préfixe exact
   `https://invoicelead.io/lead-auth/return?` est accepté (tout schéma propre, dont `io.invoicelead.app://lead-auth`,
   et tout autre hôte ou chemin sont ignorés), et **seulement pendant une connexion en cours** : lien reçu sur la page
   relais qui a ouvert le navigateur, ou connexion notée il y a moins de 15 min (app relancée par son lien ; jamais le
   lien de lancement de la page relais ni celui qu'elle a noté comme ancien). Un lien inattendu (page web piégée,
   courriel, code QR, autre app, ancien lien redonné par `getLaunchUrl`) ne fait **rien** : ni navigateur fermé, ni
   page quittée. Un lien **avec code** n'est suivi qu'**une fois** (empreinte FNV gardée sans échéance dans
   localStorage `invoicelead.leadAuth.seen` ; le code n'est jamais gardé). Le lien d'erreur `?error=expired` est
   toujours le même : il n'est **jamais** gardé comme vu. Lien suivi : connexion effacée, `Browser.close()` sur Android
   (erreur ignorée ; iOS n'a rien à fermer) ; code valable → `location.replace(ERPLEAD + '/auth/google/app/redeem?code='
   + code)` ; sinon `back` gardé, ou `/auth/lead/start` (connexion ordinaire). `listenForReturn` rend, une fois le
   lien de lancement lu (au plus 1,5 s), **vrai si un lien a été pris** : lien de lancement, ou `appUrlOpen` que la
   coque a retenu (`retainUntilConsumed`) et livré à la première écoute, avant de répondre à `getLaunchUrl`.
5. ERPlead rachète le code avec le cookie de la vue web, ouvre sa session et reprend l'autorisation → `/auth/lead/callback`
   d'InvoiceLead, comme après un mot de passe.

**App relancée par le lien** (Android a fermé l'app pendant la connexion Google) : sans session, la vue web passe par
`/<langue>/login`, qui partait tout droit (redirection serveur) vers le Compte Lead. Pour les versions `LeadAppAuth/2`
seulement (`inAppAuthApp`), cet écran rend une page vide (`LeadAppLoginRedirect`, `departUnlessReturned`) qui lit
d'abord le lien de lancement (au plus 1,5 s), puis part vers `/auth/lead/start` **seulement si aucun lien n'a été pris**
(contrat § 3b, 6) : l'App Link (Android, activité neuve) ou l'Universal Link (iOS, app terminée) arrive aussi par
`appUrlOpen`, retenu par la coque et livré avant la réponse de `getLaunchUrl` ; le rachat est alors en route (TLS, base
d'ERPlead, 303, 302) et un départ vers le Compte Lead l'annulerait (code brûlé, écran de connexion d'ERPlead). Avec un
cookie de session **périmé** (déconnexion « de partout »),
la garde (`requireSession`, `src/server/auth/guard.ts`, `sessionLoginPath`) passe elle aussi par `/<langue>/login?next=…`
(ou `?invite=…`) dans l'app. Anciennes versions et navigateurs : inchangés (redirection serveur vers `/auth/lead/start`).

## Page `https://invoicelead.io/lead-auth/return` (repli, contrat § 3c)

Elle ne s'affiche que si le lien ne s'est pas ouvert dans l'app (app pas à jour, vérification Android pas encore faite,
fichier d'association pas encore chargé par iOS). Route `src/app/lead-auth/return/route.ts`, HTML de
`src/server/lead-app-return.ts` :

- servie **telle quelle** : 200, aucune redirection, aucun préfixe de langue (hors du `matcher` de `src/proxy.ts`) ;
- en-têtes `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` (posés par la route et par
  `next.config.ts`, après la règle générale) ;
- HTML minimal, **aucun script tiers**, aucun lien, aucun bouton, le code jamais écrit dans la page ;
- seul script, en tête : **hors de l'app**, `history.replaceState(null, '', '/lead-auth/return')` (le code quitte la
  barre d'adresse et l'historique) ; **dans l'app** (pont Capacitor natif), la vue web est menée à
  `/<langue>/lead-auth/return` avec la même recherche (`src/app/[locale]/lead-auth/return/page.tsx`,
  `followReturnPage`), où l'adresse est traitée comme le lien de retour (`RETOUR` + recherche, mêmes règles : connexion
  en cours, une seule fois) ; non suivie → l'app (`/<langue>/app`) ;
- message dans la langue de `locale` (sinon celle du navigateur), 5 langues (`leadAppReturn`) : « Revenez dans
  InvoiceLead », « InvoiceLead ne s'est pas ouverte toute seule… », pour Android « Réglages > Applications > InvoiceLead >
  Ouvrir par défaut », pour iPhone et iPad (agent `iPhone`, `iPad`, `iPod`, ou `Macintosh` : l'iPad en mode ordinateur ;
  `returnPageAgent`) le remède d'iOS « Sur iPhone ou iPad : revenez à la page précédente, appuyez longuement sur « Ouvrir
  InvoiceLead », puis choisissez « Ouvrir dans InvoiceLead ». Si votre navigateur n'est pas Safari, choisissez Safari
  comme navigateur par défaut dans les Réglages, puis touchez à nouveau « Continuer avec Google ». » (iOS retient pour
  le domaine le choix « ouvrir dans le navigateur », contrat § 3c [A14]), « Vous n'avez rien demandé dans l'app
  InvoiceLead ? Fermez simplement cette page. »

## Fichiers d'association (contrat § 3d)

Routes `src/app/.well-known/apple-app-site-association/route.ts` et `src/app/.well-known/assetlinks.json/route.ts`
(contenu dans `src/lib/app-links.ts`), statiques, `Content-Type: application/json`, aucune redirection (adresses avec un
point : hors du proxy), aucun autre chemin du site revendiqué :

- AASA : `applinks` → `appIDs` `X6K5247J6G.io.invoicelead.app`, `components` `{ "/": "/lead-auth/return" }` ;
  `webcredentials` → la même app (retour https de la session iOS).
- `assetlinks.json` : `io.invoicelead.app`, empreintes SHA-256 du certificat **Play App Signing**
  (`88:49:FC:61:…:0B:7F:54`) et de la **clé d'envoi** (`7B:E5:3E:52:…:EF:80:F6`, celle de
  `~/.android-signing/invoicelead-upload.jks`, vérifiée par la porte G2).

Ordre de mise en ligne (contrat d'ERPlead, « Ordre de mise en ligne ») : 1. ce site en production (sans risque :
l'interrupteur `GOOGLE_APP_ENABLED` d'ERPlead est fermé) ; 2. **avant d'envoyer quoi que ce soit aux stores**, vérifier
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://invoicelead.io&relation=delegate_permission/common.handle_all_urls`
(le paquet et les **deux** empreintes, aucune `errorCode`) et
`https://app-site-association.cdn-apple.com/a/v1/invoicelead.io` (l'AASA du site) ; 3. ensuite seulement la version
native 1.0.2 (Play, App Store) : sous Android 6 à 14, une version installée pendant que `assetlinks.json` répond 404
reste non vérifiée jusqu'à la suivante ; 4. ouverture de l'interrupteur : décision d'Ève. Rien n'est en production.

## Sécurité

- Le code ne va qu'au lien réservé (ou à la page de repli du navigateur) ; il ne sert à rien sans le cookie verifier,
  HttpOnly, de la vue web qui a fait le départ, qu'InvoiceLead ne lit jamais.
- Une app hostile du téléphone ne reçoit plus le code : sur iOS, le lien ne s'ouvre que dans l'app inscrite dans l'AASA
  et la session iOS n'accepte le retour https que pour un domaine associé à l'app (`webcredentials`) ; sur Android 12+,
  seule l'app vérifiée par `assetlinks.json` reçoit le lien. Limite acceptée (contrat § 5) : Android 6 à 11 quand la
  vraie app est absente ou non vérifiée.
- Login forcé : un lien `https://invoicelead.io/lead-auth/return?code=…` fabriqué par quelqu'un d'autre est ignoré
  hors d'une connexion en cours, et refusé au rachat pendant une connexion (autre verifier).
- L'app web n'ajoute aucun paquet npm : elle parle au pont que la coque injecte (`window.Capacitor.Plugins.App`,
  `.Browser`, `.LeadAuthSession`), seulement si `Capacitor.isNativePlatform()` est vrai. Elle ne parle à aucune API :
  tout passe par des navigations de la vue web.

## Fichiers

- `src/lib/lead-app-auth.ts` : la logique (sans React ni DOM réel), testée avec un faux pont.
- `src/lib/app-links.ts`, `src/app/.well-known/…/route.ts` : fichiers d'association.
- `src/server/lead-app-return.ts`, `src/app/lead-auth/return/route.ts`, `src/app/[locale]/lead-auth/return/page.tsx` :
  page de retour.
- `src/components/native/LeadAppAuth.tsx` : `LeadAppReturn`, `GoogleRelay`, `LeadAppLoginRedirect`, `LeadAppReturnPage`.
- `src/app/[locale]/lead-auth/google/page.tsx`, `src/app/[locale]/layout.tsx`, `src/app/[locale]/login/page.tsx`,
  `src/proxy.ts` (page relais sans langue ; `/lead-auth/return` hors du proxy), `src/lib/native.ts` (`isAppAuthAgent`,
  `LeadAppAuth/2`), `src/server/native.ts`, `src/server/auth/guard.ts`, `next.config.ts`.
- `messages/*.json` : `leadAppAuth` (dont `relaySafari`, « votre navigateur ») et `leadAppReturn` (dont `android` et
  `ios`, 5 langues).
- Essais : `tests/unit/lead-app-auth.test.ts`, `tests/unit/lead-app-guard.test.ts` ; `tests/e2e/google-app.spec.ts` avec
  `tests/support/fake-capacitor.js` (faux pont : Android, ou iOS avec `LeadAuthSession` ; `retained` : l'`appUrlOpen`
  retenu par la coque, livré à la première écoute avant la réponse de `getLaunchUrl`) et le faux Compte Lead
  (`tests/support/fake-lead-id.mjs`, routes `/auth/google/app…` du contrat, lien vérifié). App relancée par son lien
  sur l'accueil avec le rachat retenu 3 s (aucun départ de l'écran de connexion, § 3b, 6) ; page relais rechargée
  pendant sa connexion (§ 3a).
- Portes : `scripts/google-app-gates.mjs` (G1 essais et contrôles complets, G2 dépôt mobile, APERCU, G3 aperçu).

## Dépôt mobile (`~/projets/invoicelead-mobile`, branche `google-app`)

- `capacitor.config.ts` : `appendUserAgent: 'InvoiceLeadApp LeadAppAuth/2'` ; `allowNavigation` garde erplead.io et
  Apple, jamais Google.
- iOS : `ios/App/App/App.entitlements` (`com.apple.developer.associated-domains` = `applinks:invoicelead.io`,
  `webcredentials:invoicelead.io`), `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` (Debug et Release de la cible App) ;
  module `LeadAuthSession` (`ios/App/App/LeadAuthSession.swift` : `isAvailable`, `start`, `openExternal` (navigateur
  par défaut), et `resume` (contrat § 1, facultatif) : la page relais rechargée pendant la session iOS reçoit l'issue
  de la session de ce même départ ; session finie → issue gardée en mémoire, rendue une fois ; sinon refus `none` ;
  n'ouvre jamais rien), inscrit par `LeadBridgeViewController` (racine du `SceneDelegate`) ; plus de
  `CFBundleURLTypes`.
- Android `AndroidManifest.xml` : `intent-filter android:autoVerify="true"` VIEW / DEFAULT / BROWSABLE,
  `scheme="https"`, `host="invoicelead.io"`, `path="/lead-auth/return"`, activité principale `singleTask` ; plus de
  filtre `io.invoicelead.app`. `MainActivity.onPause()` → `CookieManager.getInstance().flush()` (contrat § 1) : le
  cookie verifier posé juste avant le Custom Tab est écrit sur le disque avant qu'Android ne puisse tuer l'app.
- `@capacitor/app` et `@capacitor/browser`, `npx cap sync`, version 1.0.2 (versionCode 3 ; build iOS = TestFlight + 1),
  jamais envoyée.
- **Comptes** (à faire par Ève ou sur son accord, rien n'a été touché) : Apple Developer → accepter le Program License
  Agreement ; Identifiers → `io.invoicelead.app` → activer **Associated Domains** ; Profiles → régénérer « InvoiceLead
  iOS App Store » (3R2LUDCN63, certificat 4DPPUA6FG4) ; Codemagic → remplacer `invoicelead_ios_appstore`. Rien dans App
  Store Connect, la Play Console, Google Cloud ni les variables Vercel.
