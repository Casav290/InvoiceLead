import { defineRouting } from "next-intl/routing";
import { LOCALES } from "./locales";

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "de",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
