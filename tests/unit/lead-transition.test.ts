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
  const p = Buffer.from(
    JSON.stringify({ iss, exp: Math.floor(Date.now() / 1000) + 300, ...claims }),
  ).toString("base64url");
  return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), keys[iss].privateKey).toString("base64url")}`;
}

function stubJwks(extra?: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      const own = extra?.(url, init);
      if (own) return own;
      for (const iss of Object.keys(keys) as Iss[])
        if (url === `${iss}/oauth/jwks`)
          return Response.json({
            keys: [{ ...keys[iss].publicKey.export({ format: "jwk" }), kid: kidOf(iss) }],
          });
      return new Response("{}", { status: 404 });
    }),
  );
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
    expect(
      await verifyLeadJwt(jwt("https://erplead.io", { aud: "invoicelead" }), "invoicelead"),
    ).not.toBeNull();
    expect(
      await verifyLeadJwt(jwt("https://crmlead.io", { aud: "invoicelead" }), "invoicelead"),
    ).toBeNull();
  });

  it("un jeton signé par une autre clé mais annonçant CRMlead est refusé", async () => {
    stubJwks();
    const forged = jwt("https://autre.test", {
      aud: "invoicelead",
      scope: "exchange",
      app: "crmlead",
    }).replace(/^[^.]+\.[^.]+/, (hp) => {
      const [h] = hp.split(".");
      const p = Buffer.from(
        JSON.stringify({
          iss: "https://crmlead.io",
          aud: "invoicelead",
          scope: "exchange",
          app: "crmlead",
          exp: Math.floor(Date.now() / 1000) + 300,
        }),
      ).toString("base64url");
      return `${h}.${p}`;
    });
    expect(await incomingSender(`Bearer ${forged}`)).toBeNull();
  });
});

describe("relecture des clés pour un kid inconnu : au plus une toutes les 30 s, par émetteur", () => {
  it("une lecture récente des clés de CRMlead ne retarde pas une rotation chez ERPlead", async () => {
    const erp = "https://erplead.io";
    const crm = "https://crmlead.io";
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = (iss: Iss) => ({
      ...keys[iss].publicKey.export({ format: "jwk" }),
      kid: kidOf(iss),
    });
    const published: Record<string, unknown[]> = { [erp]: [jwk(erp)], [crm]: [jwk(crm)] };
    const reads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const iss = url.replace(/\/oauth\/jwks$/, "");
        if (!(iss in published)) return new Response("{}", { status: 404 });
        reads.push(iss);
        return Response.json({ keys: published[iss] });
      }),
    );
    const withKid = (kid: string, iss: string, signer: typeof rotated.privateKey) => {
      const h = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
      const p = Buffer.from(
        JSON.stringify({ iss, aud: "invoicelead", exp: Math.floor(Date.now() / 1000) + 300 }),
      ).toString("base64url");
      return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), signer).toString("base64url")}`;
    };
    const exchange = { aud: "invoicelead", scope: "exchange", app: "crmlead" };
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 3_600_000); // caches d'une heure échus
      expect(await verifyLeadJwt(jwt(erp, { aud: "invoicelead" }), "invoicelead")).not.toBeNull();
      expect(reads).toEqual([erp]);
      published[erp] = [jwk(erp), { ...rotated.publicKey.export({ format: "jwk" }), kid: "erp-2" }];
      // 31 s plus tard, un envoi signé par CRMlead fait lire ses clés.
      vi.setSystemTime(Date.now() + 31_000);
      expect(await incomingSender(`Bearer ${jwt(crm, exchange)}`)).toBe("crmlead");
      expect(reads).toEqual([erp, crm]);
      // Une seconde après : la clé tournée d'ERPlead est lue (sa dernière lecture date de 32 s)…
      vi.setSystemTime(Date.now() + 1_000);
      const turned = withKid("erp-2", erp, rotated.privateKey);
      expect(await verifyLeadJwt(turned, "invoicelead")).not.toBeNull();
      expect(reads).toEqual([erp, crm, erp]);
      // … mais une clé inconnue annoncée par CRMlead, relu il y a 1 s, ne fait rien relire.
      const unknown = withKid("crm-inconnue", crm, rotated.privateKey);
      expect(await incomingSender(`Bearer ${unknown}`)).toBeNull();
      expect(reads).toEqual([erp, crm, erp]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("en rafale, clés à relire : une seule lecture à la fois, partagée par toutes les requêtes", async () => {
    const erp = "https://erplead.io";
    const calls = stubJwks();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 4 * 3_600_000); // caches d'une heure échus
      // Émetteur et audience attendus, clé inventée, signature bidon.
      const forged = (kid: string) =>
        [
          Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url"),
          Buffer.from(JSON.stringify({ iss: erp, aud: "invoicelead" })).toString("base64url"),
          "c2ln",
        ].join(".");
      const out = await Promise.all([
        ...Array.from({ length: 10 }, (_, i) =>
          verifyLeadJwt(forged(`rafale-${i}`), "invoicelead"),
        ),
        verifyLeadJwt(jwt(erp, { aud: "invoicelead" }), "invoicelead"),
      ]);
      expect(out.slice(0, 10)).toEqual(Array(10).fill(null));
      expect(out[10]).not.toBeNull();
      expect(calls.filter((url) => url === `${erp}/oauth/jwks`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("envoi vers CRMlead pendant la transition", () => {
  it("refusé avec le jeton d'ERPlead : redemande le jeton à CRMlead et renvoie", async () => {
    const auth: string[] = [];
    const calls = stubJwks((url, init) => {
      if (url === "https://erplead.io/oauth/token")
        return Response.json({ access_token: "erp", expires_in: 300 });
      if (url === "https://crmlead.io/oauth/token")
        return Response.json({ access_token: "crm", expires_in: 300 });
      if (url.endsWith("/.well-known/lead-app.json"))
        return Response.json({
          exchange: { inbox: "https://crmlead.io/api/lead-exchange/v1/inbox" },
        });
      if (url.endsWith("/inbox")) {
        const a = new Headers(init?.headers).get("authorization") ?? "";
        auth.push(a);
        return a === "Bearer crm"
          ? Response.json({ id: "1", url: "u", status: "created" })
          : Response.json({ error: "invalid_token" }, { status: 401 });
      }
    });
    const out = await send(
      { app: "crmlead", url: "https://crmlead.io" },
      { type: "invoice", org: "o", source: { id: "f1" }, data: {} },
    );
    expect(out.status).toBe("created");
    expect(auth).toEqual(["Bearer erp", "Bearer crm"]);
    expect(calls).toContain("https://crmlead.io/oauth/token");
  });
});
