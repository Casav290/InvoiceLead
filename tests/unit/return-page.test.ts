import { describe, expect, it } from "vitest";
import { returnPage } from "@/lib/return-page";
import { safeNext } from "@/server/auth/login-cookie";

const YEAR = "0b6f3f0e-6a51-4a1e-9a43-1f2d3c4b5a69";
const DOC = "6c33e4a5-1b3d-489d-96ed-28de6a32fadd";

describe("page de retour d'une reconnexion", () => {
  it("un fichier à télécharger ramène à la page de son formulaire ou de son lien", () => {
    const cases: [string, string, string][] = [
      [
        "/de/app/accounting/reports/datev",
        `?year=${YEAR}&consultant=1001&client=1`,
        `/de/app/accounting/reports?year=${YEAR}`,
      ],
      [
        "/fr/app/accounting/reports/fec",
        `?year=${YEAR}`,
        `/fr/app/accounting/reports?year=${YEAR}`,
      ],
      ["/fr/app/accounting/reports/fec", "", "/fr/app/accounting/reports"],
      [
        "/fr/app/accounting/vat/xml",
        "?period=2026-07-01",
        "/fr/app/accounting/vat?period=2026-07-01",
      ],
      ["/de/app/invoices/" + DOC + "/xrechnung", "", `/de/app/invoices/${DOC}`],
      ["/de/app/credit-notes/" + DOC + "/xrechnung", "", `/de/app/credit-notes/${DOC}`],
      ["/fr/app/accounting/bills/export", "", "/fr/app/accounting/bills"],
    ];
    for (const [path, search, page] of cases) {
      expect(returnPage(path, search)).toBe(page);
      expect(safeNext(returnPage(path, search))).toBe(page);
    }
  });

  it("ne garde que des paramètres connus et bien formés", () => {
    expect(returnPage("/de/app/accounting/reports/datev", "?year=x'&client=1")).toBe(
      "/de/app/accounting/reports",
    );
    expect(returnPage("/fr/app/accounting/vat/xml", "?period=2026-7-1")).toBe(
      "/fr/app/accounting/vat",
    );
    expect(returnPage("/de/app/invoices/pas-un-id/xrechnung", "")).toBe("/de/app/invoices");
  });

  it("lit le chemin tel que le routeur le lit (encodé, majuscules, barre finale)", () => {
    expect(returnPage("/de/%61pp/accounting/reports/datev", `?year=${YEAR}`)).toBe(
      `/de/app/accounting/reports?year=${YEAR}`,
    );
    expect(returnPage("/DE/app/accounting/reports/datev/", "")).toBe("/de/app/accounting/reports");
  });

  it("toute autre page reste celle demandée", () => {
    const pages: [string, string][] = [
      ["/fr/app/contacts", "?q=M%C3%BCller*"],
      ["/fr/app/accounting/reports", `?year=${YEAR}`],
      ["/fr/app/invoices/" + DOC, ""],
      ["/fr/app/invoices/" + DOC + "/pdf", ""],
      ["/fr/app", ""],
    ];
    for (const [path, search] of pages) expect(returnPage(path, search)).toBe(`${path}${search}`);
  });
});
