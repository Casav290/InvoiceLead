/**
 * Fichiers d'association du site avec l'app (contrat d'ERPlead docs/GOOGLE-APP.md § 1 et § 3d, liens
 * vérifiés du 30.10.2026) : ils réservent le lien de retour de « Continuer avec Google »
 * (`https://invoicelead.io/lead-auth/return`) à l'app d'InvoiceLead, et à elle seule.
 *
 * - iOS : `/.well-known/apple-app-site-association` (Universal Links ; `webcredentials` pour le retour
 *   https d'ASWebAuthenticationSession, iOS 17.4+). App ID = préfixe d'équipe Apple + identifiant.
 * - Android : `/.well-known/assetlinks.json` (App Links vérifiés) : certificat Play App Signing (les APK
 *   installés depuis Google Play) ET clé d'envoi (essais d'APK construits localement).
 *
 * Servis par des routes (src/app/.well-known/…/route.ts) : JSON, `Content-Type: application/json`,
 * aucune redirection (hors du proxy : adresses avec un point), aucun autre chemin du site revendiqué.
 */

/** Préfixe d'App ID / Team ID Apple (profils App Store, relevé le 30.10.2026). */
export const APPLE_TEAM_ID = "X6K5247J6G";
/** Identifiant de l'app (iOS : bundle, Android : paquet) : l'appId Capacitor du dépôt mobile. */
export const APP_BUNDLE_ID = "io.invoicelead.app";
export const APPLE_APP_ID = `${APPLE_TEAM_ID}.${APP_BUNDLE_ID}`;
/** Seule adresse du site revendiquée par l'app. */
export const CLAIMED_PATH = "/lead-auth/return";

/** Empreintes SHA-256 des certificats Android (lues par l'API Play et dans l'AAB signé, 30.10.2026). */
export const ANDROID_CERT_SHA256 = {
  /** Certificat de signature de Google Play (Play App Signing). */
  playAppSigning:
    "88:49:FC:61:6B:A1:B0:A9:8D:87:E4:0E:B3:DE:4C:CD:18:4C:AA:61:1C:93:0C:1A:95:4D:2F:CE:94:0B:7F:54",
  /** Clé d'envoi (~/.android-signing/invoicelead-upload.jks). */
  upload:
    "7B:E5:3E:52:B6:BB:67:F5:F2:FB:93:4B:A4:4A:58:D9:AA:BC:EE:EC:B3:B7:41:F3:BC:36:97:6B:F0:EF:80:F6",
} as const;

/** apple-app-site-association : le lien de retour seulement, et les identifiants pour la session iOS. */
export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: [APPLE_APP_ID],
        components: [
          {
            "/": CLAIMED_PATH,
            comment: "Retour de « Continuer avec Google » (Compte Lead) vers l'app",
          },
        ],
      },
    ],
  },
  webcredentials: { apps: [APPLE_APP_ID] },
} as const;

/** assetlinks.json : l'app Android (paquet et certificats) peut ouvrir les liens du site. */
export const ASSET_LINKS = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: APP_BUNDLE_ID,
      sha256_cert_fingerprints: [ANDROID_CERT_SHA256.playAppSigning, ANDROID_CERT_SHA256.upload],
    },
  },
] as const;

/** Réponse JSON d'un fichier d'association : en-têtes posés ici, jamais le type d'un fichier statique. */
export function associationResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Relu par le CDN d'Apple (environ une fois par semaine) et par Android à l'installation.
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}
