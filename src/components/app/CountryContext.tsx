"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import { forCountry } from "@/i18n/country";

/** Pays de l'entreprise ouverte, pour les libellés des composants client (src/i18n/country.ts). */
const CountryContext = createContext<string>("CH");

export function CountryProvider({
  country,
  children,
}: {
  country: string;
  children: React.ReactNode;
}) {
  return <CountryContext value={country}>{children}</CountryContext>;
}

export const useCountry = () => useContext(CountryContext);

/** useTranslations, avec les variantes du pays de l'entreprise (MWST en Suisse, USt en Allemagne…). */
export function useCountryTranslations(namespace: string) {
  return forCountry(useTranslations(namespace), useCountry());
}
