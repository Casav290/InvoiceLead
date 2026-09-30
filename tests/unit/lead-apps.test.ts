import { describe, expect, it } from "vitest";
import { leadAppItems } from "@/lib/lead-apps";

describe("sélecteur d'applications", () => {
  it("sans droits connus : sœurs ouvertes sur /login, InvoiceLead courante, ProjectLead bientôt", () => {
    const items = leadAppItems("invoicelead", null);
    expect(items.map((i) => [i.code, i.state, i.href])).toEqual([
      ["scanlead", "open", "https://scanlead.io/login"],
      ["crmlead", "open", "https://crmlead.io/login"],
      ["projectlead", "soon", null],
      ["invoicelead", "current", null],
    ]);
  });

  it("suit les droits du Compte Lead : mise à niveau, bientôt, applications nouvelles", () => {
    const items = leadAppItems("invoicelead", {
      scanlead: {
        access: false,
        url: "https://scanlead.io",
        status: "live",
        upgrade_url: "https://scanlead.io/billing",
      },
      projectlead: { access: true, url: "https://projectlead.io", status: "soon" },
      newlead: { access: true, name: "NewLead", url: "https://newlead.io/", status: "live" },
    });
    expect(items.find((i) => i.code === "scanlead")).toMatchObject({
      state: "upgrade",
      href: "https://scanlead.io/billing",
    });
    expect(items.find((i) => i.code === "projectlead")).toMatchObject({
      state: "soon",
      href: null,
    });
    expect(items.find((i) => i.code === "newlead")).toMatchObject({
      state: "open",
      href: "https://newlead.io/login",
      mark: "NE",
    });
  });
});
