import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseSendForm } from "@/server/send";
import { enableShareLink, findSharedDocument, shareToken } from "@/server/sharing";
import { testDb } from "../support/db";

const t = testDb();
const db = t.database;
beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    APP_URL: "https://invoicelead.io",
    SESSION_SECRET: "unit-secret-unit-secret-unit-secret-unit",
    LEAD_ID_ISSUER: "https://crmlead.io",
    LEAD_ID_CLIENT_ID: "invoicelead",
    LEAD_ID_CLIENT_SECRET: "x",
    LEAD_ID_REDIRECT_URI: "https://invoicelead.io/auth/lead/callback",
    LEAD_ID_APP: "invoicelead",
  });
});
beforeEach(() => t.reset());
afterAll(() => t.close());

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("envoi et lien de consultation", () => {
  it("valide destinataire et objet", () => {
    const bad = parseSendForm(form({ to: "a@b, c@d.ch", subject: "" }));
    expect(!bad.ok && bad.errors).toEqual({ to: "email", subject: "required" });
    expect(
      parseSendForm(form({ to: "client@firma.ch", subject: "Rechnung", message: "" })).ok,
    ).toBe(true);
  });

  it("donne toujours le même lien à une pièce, et aucun à une pièce inconnue", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(shareToken(id)).toBe(shareToken(id));
    expect(shareToken(id)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(shareToken(id)).not.toBe(shareToken("00000000-0000-4000-8000-000000000002"));
    expect(await enableShareLink(db, id, id)).toBeNull();
    expect(await findSharedDocument(db, shareToken(id))).toBeNull();
    expect(await findSharedDocument(db, "pas-un-jeton")).toBeNull();
  });
});
