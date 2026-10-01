import type { MetadataRoute } from "next";

/**
 * Application installable (écran d'accueil du téléphone, fenêtre propre sur ordinateur). Les
 * raccourcis mènent droit à la photo d'un justificatif et au chrono.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "InvoiceLead",
    short_name: "InvoiceLead",
    description: "Factures, comptabilité et TVA, préparées par l'IA.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#eceae7",
    theme_color: "#7a2e67",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Justificatif / Beleg / Receipt",
        url: "/app/accounting/receipts/capture",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Chrono / Stoppuhr / Timer",
        url: "/app/time",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
