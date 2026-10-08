import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { incomingSender, send, verifyLeadJwt } from "@/server/lead-id/leadId";
import { setTestEnv } from "../support/env";

// Transition vers ERPlead : CRMlead signe encore ses envois d'échange, on les accepte en réception seulement.
beforeAll(() => setTestEnv({ LEAD_ID_ISSUER: "https://erplead.io" }));
afterEach(() => vi.unstubAllGlobals());

const keys = {
  "https://erplead.io": generateKeyPairSync("rsa", { modulusLength: 2048 }),
  "https://crmlead.io": generateKeyPairSync("rsa", { modulusLength: 2048 }),
  "https://autre.test": generateKeyPairSync("rsa", { modulusLength: 2048 }),
};
type Iss = keyof typeof keys;
const kidOf = (iss: Iss) => new URL(iss).hostname;

function jwt(iss: Iss, claims: Record<string, unknown>) {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: kidOf(iss) })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss, exp: Math.floor(Date.now() / 1000) + 300, ...claims })).toString("base64url");
  return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), keys[iss].privateKey).toString("base64url")}`;
}

function stubJwks(extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(url);
    const own = extra?.(url, init);
    if (own) return own;
    for (const iss of Object.keys(keys) as Iss[])
      if (url === `${iss}/oauth/jwks`)
        return Response.json({ keys: [{ ...keys[iss].publicKey.export({ format: "jwk" }), kid: kidOf(iss) }] });
    return new Response("{}", { status: 404 });
  }));
  return calls;
}

describe("réception d'un échange pendant la transition", () => {
  it("accepte un jeton d'ERPlead et un jeton de CRMlead, refuse tout autre émetteur", async () => {
    stubJwks();
    const claims = { aud: "invoicelead", scope: "exchange", app: "crmlead" };
    expect(await incomingSender(`Bearer ${jwt("https://erplead.io", claims)}`)).toBe("crmlead");
    expect(await incomingSender(`Bearer ${jwt("https://crmlead.io", claims)}`)).toBe("crmlead");
    expect(await incomingSender(`Bearer ${jwt("https://autre.test", claims)}`)).toBeNull();
  });

  it("la connexion n'accepte que l'émetteur ERPlead", async () => {
    stubJwks();
    expect(await verifyLeadJwt(jwt("https://erplead.io", { aud: "invoicelead" }), "invoicelead")).not.toBeNull();
    expect(await verifyLeadJwt(jwt("https://crmlead.io", { aud: "invoicelead" }), "invoicelead")).toBeNull();
  });

  it("un jeton signé par une autre clé mais annonçant CRMlead est refusé", async () => {
    stubJwks();
    const forged = jwt("https://autre.test", { aud: "invoicelead", scope: "exchange", app: "crmlead" })
      .replace(/^[^.]+\.[^.]+/, (hp) => {
        const [h] = hp.split(".");
        const p = Buffer.from(JSON.stringify({ iss: "https://crmlead.io", aud: "invoicelead", scope: "exchange",
          app: "crmlead", exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
        return `${h}.${p}`;
      });
    expect(await incomingSender(`Bearer ${forged}`)).toBeNull();
  });
});

describe("envoi vers CRMlead pendant la transition", () => {
  it("refusé avec le jeton d'ERPlead : redemande le jeton à CRMlead et renvoie", async () => {
    const auth: string[] = [];
    const calls = stubJwks((url, init) => {
      if (url === "https://erplead.io/oauth/token") return Response.json({ access_token: "erp", expires_in: 300 });
      if (url === "https://crmlead.io/oauth/token") return Response.json({ access_token: "crm", expires_in: 300 });
      if (url.endsWith("/.well-known/lead-app.json"))
        return Response.json({ exchange: { inbox: "https://crmlead.io/api/lead-exchange/v1/inbox" } });
      if (url.endsWith("/inbox")) {
        const a = new Headers(init?.headers).get("authorization") ?? "";
        auth.push(a);
        return a === "Bearer crm"
          ? Response.json({ id: "1", url: "u", status: "created" })
          : Response.json({ error: "invalid_token" }, { status: 401 });
      }
    });
    const out = await send({ app: "crmlead", url: "https://crmlead.io" },
      { type: "invoice", org: "o", source: { id: "f1" }, data: {} });
    expect(out.status).toBe("created");
    expect(auth).toEqual(["Bearer erp", "Bearer crm"]);
    expect(calls).toContain("https://crmlead.io/oauth/token");
  });
});
