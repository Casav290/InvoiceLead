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
    ];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
