import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import { logoType, organizationLogo, removeLogo, saveLogo } from "@/server/logo";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
beforeAll(() => setTestEnv());
beforeEach(() => t.reset());
afterAll(() => t.close());

/** PNG de 1 × 1 pixel. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("logo de l'entreprise", () => {
  it("n'accepte que PNG et JPEG d'après leur contenu", () => {
    expect(logoType(PNG)).toBe("image/png");
    expect(logoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(logoType(Buffer.from("<svg></svg>"))).toBeNull();
  });

  it("se dépose, se relit et se retire, pour sa seule organisation", async () => {
    const a = await attachLeadIdentity(db, claims());
    const who = { organizationId: a.organization.id, userId: a.user.id };
    expect(await saveLogo(db, who, Buffer.from("pas une image"))).toBe("type");
    expect(await saveLogo(db, who, Buffer.alloc(0))).toBe("size");
    expect(await saveLogo(db, who, PNG)).toBe("saved");
    const logo = await organizationLogo(db, who.organizationId);
    expect(logo?.contentType).toBe("image/png");
    expect(logo?.bytes.equals(PNG)).toBe(true);
    const b = await attachLeadIdentity(
      db,
      claims({ sub: "sub-b", email: "b@autre.test", org: "org-b" }),
    );
    expect(await organizationLogo(db, b.organization.id)).toBeNull();
    await removeLogo(db, who);
    expect(await organizationLogo(db, who.organizationId)).toBeNull();
  });
});
