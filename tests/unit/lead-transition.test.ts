import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { incomingExchange, send, verifyLeadJwt } from "@/server/lead-id/leadId";
import { setTestEnv } from "../support/env";

// Liaison sans clé : seuls les jetons d'ERPlead sont acceptés, en connexion comme en réception (plus de crmlead.io).
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

describe("réception d'un échange : ERPlead seulement", () => {
  it("accepte un jeton d'ERPlead, refuse celui de CRMlead (ancienne transition) et tout autre émetteur", async () => {
    stubJwks();
    const claims = { aud: "invoicelead", scope: "exchange", app: "crmlead", sub: "client:crmlead" };
    expect(
      await incomingExchange(`Bearer ${jwt("https://erplead.io", claims)}`, "exchange"),
    ).toEqual({ app: "crmlead", org: null, person: null, person_role: null });
    expect(
      await incomingExchange(`Bearer ${jwt("https://crmlead.io", claims)}`, "exchange"),
    ).toBeNull();
    expect(
      await incomingExchange(`Bearer ${jwt("https://autre.test", claims)}`, "exchange"),
    ).toBeNull();
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
    expect(await incomingExchange(`Bearer ${forged}`, "exchange")).toBeNull();
  });
});

describe("relecture des clés pour un kid inconnu : au plus une toutes les 30 s, par émetteur", () => {
  it("une clé tournée chez ERPlead est lue ; une clé inconnue relue il y a moins de 30 s ne fait rien relire", async () => {
    const erp = "https://erplead.io";
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = (iss: Iss) => ({
      ...keys[iss].publicKey.export({ format: "jwk" }),
      kid: kidOf(iss),
    });
    let published: unknown[] = [jwk(erp)];
    const reads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url !== `${erp}/oauth/jwks`) return new Response("{}", { status: 404 });
        reads.push(url);
        return Response.json({ keys: published });
      }),
    );
    const withKid = (kid: string, signer: typeof rotated.privateKey) => {
      const h = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
      const p = Buffer.from(
        JSON.stringify({ iss: erp, aud: "invoicelead", exp: Math.floor(Date.now() / 1000) + 300 }),
      ).toString("base64url");
      return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), signer).toString("base64url")}`;
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 2 * 3_600_000); // caches d'une heure échus
      expect(await verifyLeadJwt(jwt(erp, { aud: "invoicelead" }), "invoicelead")).not.toBeNull();
      expect(reads).toHaveLength(1);
      published = [jwk(erp), { ...rotated.publicKey.export({ format: "jwk" }), kid: "erp-2" }];
      vi.setSystemTime(Date.now() + 31_000);
      expect(
        await verifyLeadJwt(withKid("erp-2", rotated.privateKey), "invoicelead"),
      ).not.toBeNull();
      expect(reads).toHaveLength(2);
      vi.setSystemTime(Date.now() + 1_000);
      expect(
        await verifyLeadJwt(withKid("inconnue", rotated.privateKey), "invoicelead"),
      ).toBeNull();
      expect(reads).toHaveLength(2);
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

  it("juste après une rotation, les jetons arrivés pendant une relecture en cours l'attendent au lieu d'être refusés", async () => {
    const erp = "https://erplead.io";
    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let published: unknown[] = [
      { ...keys[erp].publicKey.export({ format: "jwk" }), kid: kidOf(erp) },
    ];
    const reads: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url !== `${erp}/oauth/jwks`) return new Response("{}", { status: 404 });
        reads.push(url);
        await new Promise((done) => setTimeout(done, 50)); // une vraie lecture prend du temps
        return Response.json({ keys: published });
      }),
    );
    const signed = (kid: string, signer: typeof rotated.privateKey, sid: string) => {
      const h = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url");
      const p = Buffer.from(
        JSON.stringify({
          iss: erp,
          aud: "invoicelead",
          sid,
          exp: Math.floor(Date.now() / 1000) + 300,
        }),
      ).toString("base64url");
      return `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), signer).toString("base64url")}`;
    };
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 6 * 3_600_000); // caches d'une heure échus
      expect(await verifyLeadJwt(jwt(erp, { aud: "invoicelead" }), "invoicelead")).not.toBeNull();
      expect(reads).toHaveLength(1);
      // ERPlead publie sa nouvelle clé. Une minute plus tard (cache d'une heure encore frais, dernière lecture
      // vieille de plus de 30 s), arrivent ensemble : un jeton à clé inventée, qui lance la relecture, puis deux
      // jetons légitimes signés par la nouvelle clé, pendant que cette relecture est en cours.
      published = [...published, { ...rotated.publicKey.export({ format: "jwk" }), kid: "erp-2" }];
      vi.setSystemTime(Date.now() + 60_000);
      const out = await Promise.all([
        verifyLeadJwt(signed("inventee", rotated.privateKey, "sid-x"), "invoicelead"),
        verifyLeadJwt(signed("erp-2", rotated.privateKey, "sid-a"), "invoicelead"),
        verifyLeadJwt(signed("erp-2", rotated.privateKey, "sid-b"), "invoicelead"),
      ]);
      expect(out.map((c) => c?.sid ?? null)).toEqual([null, "sid-a", "sid-b"]);
      // Une seule relecture, partagée par les trois.
      expect(reads).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("envoi vers CRMlead", () => {
  it("refusé en 401 : jeton d'ERPlead oublié et redemandé une fois, jamais à CRMlead", async () => {
    const auth: string[] = [];
    let n = 0;
    const calls = stubJwks((url, init) => {
      if (url === "https://erplead.io/oauth/token")
        return Response.json({ access_token: `erp${++n}`, expires_in: 900 });
      if (url.endsWith("/.well-known/lead-app.json"))
        return Response.json({
          exchange: { inbox: "https://crmlead.io/api/lead-exchange/v1/inbox" },
        });
      if (url.endsWith("/inbox")) {
        const a = new Headers(init?.headers).get("authorization") ?? "";
        auth.push(a);
        return auth.length === 1
          ? Response.json({ error: "invalid_token" }, { status: 401 })
          : Response.json({ id: "1", url: "u", status: "created" });
      }
    });
    const out = await send(
      { app: "crmlead", url: "https://crmlead.io" },
      { type: "document", org: "o-transition", source: { id: "f1" }, data: {} },
    );
    expect(out.status).toBe("created");
    expect(auth).toEqual(["Bearer erp1", "Bearer erp2"]);
    expect(calls).not.toContain("https://crmlead.io/oauth/token");
  });
});
