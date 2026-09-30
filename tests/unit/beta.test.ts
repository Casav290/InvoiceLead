import { describe, expect, it } from "vitest";
import { betaAllowed } from "@/server/beta";
import { parseFeedbackForm } from "@/server/feedback";

describe("bêta privée", () => {
  const who = { leadOrg: "org_abc", email: "Lea@Fidu.ch" };
  it("sans liste, tout le monde entre", () => {
    expect(betaAllowed(undefined, who)).toBe(true);
    expect(betaAllowed(" , ", who)).toBe(true);
  });
  it("par organisation, adresse ou domaine", () => {
    expect(betaAllowed("org_xyz, org_abc", who)).toBe(true);
    expect(betaAllowed("lea@fidu.ch", who)).toBe(true);
    expect(betaAllowed("@fidu.ch", who)).toBe(true);
    expect(betaAllowed("@idu.ch, fidu.ch, org_xyz", who)).toBe(false);
    expect(betaAllowed("", { leadOrg: "", email: "x@y.ch" })).toBe(true);
    expect(betaAllowed("org_abc", { leadOrg: "", email: "x@y.ch" })).toBe(false);
  });
});

describe("avis", () => {
  const form = (v: Record<string, string>) => {
    const f = new FormData();
    for (const [k, x] of Object.entries(v)) f.set(k, x);
    return f;
  };
  it("garde un chemin de l'application, jamais une adresse externe", () => {
    expect(
      parseFeedbackForm(form({ kind: "idea", message: "Super", page: "/fr/app/invoices" })),
    ).toEqual({ kind: "idea", message: "Super", page: "/fr/app/invoices" });
    expect(
      parseFeedbackForm(form({ kind: "problem", message: "Bug", page: "https://evil.test" }))?.page,
    ).toBeNull();
    expect(parseFeedbackForm(form({ kind: "spam", message: "Bonjour" }))).toBeNull();
    expect(parseFeedbackForm(form({ kind: "idea", message: " " }))).toBeNull();
  });
});
