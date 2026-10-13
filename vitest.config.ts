import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    // Le proxy (src/proxy.ts) est testé tel quel : next-intl importe « next/server » sans extension,
    // que seul Vite sait résoudre.
    server: { deps: { inline: ["next-intl"] } },
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/invoicelead_test",
    },
  },
});
