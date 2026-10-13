import { describe, expect, it } from "vitest";
import { LEAD_FAMILY, leadAppItems, leadFamilyTexts, PROJECTLEAD_URL } from "@/lib/lead-apps";

const ORDER = ["erplead", "scanlead", "crmlead", "projectlead", "invoicelead", "greetlead"];

describe("lanceur de la famille Lead", () => {
  it("liste les six applications, dans l'ordre commun, vers leur adresse d'entrée", () => {
    const items = leadAppItems("invoicelead", "fr");
    expect(items.map((i) => [i.code, i.mark, i.color, i.href])).toEqual([
      ["erplead", "EL", "#4338ca", "https://erplead.io/account"],
      ["scanlead", "SL", "#2563eb", "https://scanlead.io/login"],
      ["crmlead", "CL", "#0f6e70", "https://crmlead.io/login"],
      ["projectlead", "PL", "#9a6a00", "https://projectlead.io/login"],
      ["invoicelead", "IL", "#7a2e67", null],
      ["greetlead", "GL", "#c2185b", "https://greetlead.io/login"],
    ]);
    expect(items.filter((i) => i.current).map((i) => i.code)).toEqual(["invoicelead"]);
    expect(items.map((i) => i.action)).toEqual([
      "Gérer mon compte",
      "Scanner des contacts",
      "Suivre mes leads",
      "Gérer mes projets",
      "Faire une facture",
      "Envoyer une carte",
    ]);
  });

  it("ne cache, ne désactive ni ne détourne aucune application (ni « Bientôt » ni mise à niveau)", () => {
    for (const locale of ["de", "fr", "en"]) {
      const items = leadAppItems("invoicelead", locale);
      expect(items.map((i) => i.code)).toEqual(ORDER);
      for (const item of items.filter((i) => !i.current)) {
        const entry = LEAD_FAMILY.apps.find((a) => a.code === item.code)?.entry;
        expect(item.href).toBe(entry);
        // Jamais la racine publique ni une page de formule.
        expect(item.href).toMatch(/^https:\/\/[a-z]+\.io\/(login|account)$/);
      }
      expect(JSON.stringify(items)).not.toMatch(/upgrade|soon|billing|plan/i);
    }
  });

  it("dit « Vous êtes ici » et « Ouvrir » dans la langue de la page, le français par défaut", () => {
    expect(leadFamilyTexts("fr")).toEqual({
      title: "Applications Lead",
      open: "Ouvrir",
      here: "Vous êtes ici",
    });
    expect(leadFamilyTexts("de")).toEqual({
      title: "Lead-Apps",
      open: "Öffnen",
      here: "Sie sind hier",
    });
    expect(leadFamilyTexts("en").here).toBe("You are here");
    expect(leadFamilyTexts("rm").here).toBe("Vous êtes ici");
    expect(leadAppItems("invoicelead", "de")[4]?.action).toBe("Rechnung erstellen");
  });

  it("garde le lien de ProjectLead des pages Temps et Liaison", () => {
    expect(PROJECTLEAD_URL).toBe("https://projectlead.io");
  });
});
