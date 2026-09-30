import type { PartySnapshot } from "@/server/db/schema";

/** Pays où le numéro précède la rue (« 221B Baker Street », « 10 rue de Rivoli »). */
const NUMBER_FIRST = new Set(["US", "GB", "FR", "IE"]);

/**
 * Lignes d'une adresse postale selon les usages du pays de la partie : « 8001 Zürich »,
 * « London / NW1 6XE », « Austin, TX 78701 ». Une adresse d'un autre pays que l'expéditeur finit
 * par le nom du pays, dans la langue du document.
 */
export function addressLines(p: PartySnapshot, home: string, language: string): string[] {
  const lines = [p.name];
  if (p.contactPerson) lines.push(p.contactPerson);
  if (p.street) {
    const n = p.buildingNumber ?? "";
    lines.push((NUMBER_FIRST.has(p.country) ? `${n} ${p.street}` : `${p.street} ${n}`).trim());
  }
  const postal = p.postalCode ?? "";
  const town = p.town ?? "";
  if (p.country === "US") {
    const cityLine = [town, [p.region, postal].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    if (cityLine) lines.push(cityLine);
  } else if (p.country === "GB") {
    if (town) lines.push(town);
    if (postal) lines.push(postal);
  } else if (postal || town) {
    lines.push(`${postal} ${town}`.trim());
  }
  if (p.country !== home) {
    let name = p.country;
    try {
      name = new Intl.DisplayNames([language], { type: "region" }).of(p.country) ?? p.country;
    } catch {
      // Langue inconnue d'ICU : le code du pays suffit.
    }
    lines.push(name);
  }
  return lines;
}
