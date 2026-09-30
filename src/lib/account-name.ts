/** Libellé d'un compte dans la langue de l'interface ; l'anglais retombe sur l'allemand s'il manque. */
export function accountName(
  account: { nameDe: string; nameFr: string; nameEn?: string | null },
  locale: string,
): string {
  if (locale === "fr") return account.nameFr;
  if (locale === "en") return account.nameEn || account.nameDe;
  return account.nameDe;
}
