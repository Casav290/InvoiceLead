import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Échantillons de factures électroniques, hors de la suite unitaire (voir validate-xrechnung.sh). */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/einvoice/**/*.test.ts"], environment: "node" },
});
