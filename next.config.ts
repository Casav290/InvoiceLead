import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: false,
  // Relevés camt.053 (5 Mo) et justificatifs (10 Mo chacun) envoyés par formulaire.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  serverExternalPackages: ["pg", "pdfkit", "swissqrbill", "qrcode"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Lien de retour de « Continuer avec Google » (server/lead-app-return.ts) : le code qu'il porte
        // ne part jamais en Referer, la page n'est ni gardée en cache ni indexée. Posé après la règle
        // générale : le dernier en-tête du même nom l'emporte.
        source: "/lead-auth/return",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      {
        // Captures et images de la page d'accueil : noms stables, contenu rarement changé.
        source: "/landing/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
