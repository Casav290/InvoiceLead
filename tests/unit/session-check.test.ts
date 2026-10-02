import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachLeadIdentity } from "@/server/auth/attach";
import {
  CHECK_SECONDS,
  checkOtherSessionsSoon,
  createSession,
  dropSessionsBefore,
  findSession,
  revalidateSession,
} from "@/server/auth/session";
import { sessions } from "@/server/db/schema";
import { claims } from "../support/claims";
import { testDb } from "../support/db";
import { setTestEnv } from "../support/env";

const t = testDb();
const db = t.database;
setTestEnv();
beforeEach(() => t.reset());
afterAll(() => t.close());

/** Faux Compte Lead : jetons de rafraîchissement valables (jeton → personne), qui tournent. */
function fakeLead() {
  const valid = new Map<string, string>();
  const calls: string[] = [];
  let n = 0;
  const refresh = async (token: string) => {
    calls.push(token);
    const sub = valid.get(token);
    valid.delete(token);
    if (!sub) throw new Error("lead_id:invalid_grant");
    const next = `rt-${++n}-${sub}`;
    valid.set(next, sub);
    return { claims: { sub }, tokens: { refresh_token: next } };
  };
  return { valid, calls, refresh };
}

async function open(refreshToken: string | null, sub = "sub-ada") {
  const { user, organization } = await attachLeadIdentity(
    db,
    claims(sub === "sub-ada" ? {} : { sub, email: `${sub}@x.test` }),
  );
  const made = await createSession(db, {
    userId: user.id,
    organizationId: organization.id,
    idToken: null,
    refreshToken,
  });
  return { ...made, userId: user.id };
}
const stale = (id: string, seconds = CHECK_SECONDS + 60) =>
  db
    .update(sessions)
    .set({ lastSeenAt: new Date(Date.now() - seconds * 1000) })
    .where(eq(sessions.id, id));
const found = async (token: string) => {
  const row = await findSession(db, token);
  if (!row) throw new Error("session absente");
  return row;
};

describe("vérification des sessions auprès du Compte Lead", () => {
  it("garde le jeton chiffré, ne vérifie qu'après cinq minutes et garde le jeton tourné", async () => {
    const lead = fakeLead();
    lead.valid.set("rt-0", "sub-ada");
    const s = await open("rt-0");
    const [row] = await db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(row?.refreshTokenEnc).toBeTruthy();
    expect(row?.refreshTokenEnc).not.toContain("rt-0");

    // Session neuve : rien n'est demandé.
    expect(await revalidateSession(db, await found(s.token), lead.refresh)).toBe(true);
    expect(lead.calls).toEqual([]);
    // Cinq minutes plus tard : le jeton est échangé, le nouveau gardé pour la fois suivante.
    await stale(s.id);
    expect(await revalidateSession(db, await found(s.token), lead.refresh)).toBe(true);
    expect(lead.calls).toEqual(["rt-0"]);
    await stale(s.id);
    expect(await revalidateSession(db, await found(s.token), lead.refresh)).toBe(true);
    expect(lead.calls).toEqual(["rt-0", "rt-1-sub-ada"]);
    // Deux pages en même temps : une seule vérifie (le jeton ne tourne qu'une fois).
    await stale(s.id);
    const row2 = await found(s.token);
    const both = await Promise.all([
      revalidateSession(db, row2, lead.refresh),
      revalidateSession(db, row2, lead.refresh),
    ]);
    expect(both).toEqual([true, true]);
    expect(lead.calls).toHaveLength(3);
    expect(await findSession(db, s.token)).not.toBeNull();
  });

  it("le Compte Lead refuse le jeton (mot de passe réinitialisé) : la session tombe", async () => {
    const lead = fakeLead();
    lead.valid.set("rt-0", "sub-ada");
    const s = await open("rt-0");
    lead.valid.clear();
    await stale(s.id);
    expect(await revalidateSession(db, await found(s.token), lead.refresh)).toBe(false);
    expect(await findSession(db, s.token)).toBeNull();
  });

  it("une panne du Compte Lead n'est pas une révocation ; une autre personne, si", async () => {
    const s = await open("rt-0");
    await stale(s.id);
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await revalidateSession(db, await found(s.token), down)).toBe(true);
    expect(await findSession(db, s.token)).not.toBeNull();
    const busy = async () => {
      throw new Error("lead_id:500");
    };
    await stale(s.id);
    expect(await revalidateSession(db, await found(s.token), busy)).toBe(true);
    await stale(s.id);
    const other = async () => ({ claims: { sub: "sub-autre" }, tokens: {} });
    expect(await revalidateSession(db, await found(s.token), other)).toBe(false);
    expect(await findSession(db, s.token)).toBeNull();
  });

  it("une nouvelle connexion fait vérifier les autres sessions dès leur page suivante", async () => {
    const lead = fakeLead();
    lead.valid.set("rt-a", "sub-ada");
    const a = await open("rt-a");
    // Session d'avant les jetons de rafraîchissement : rien à prouver.
    const legacy = await open(null);
    const other = await open("rt-b", "sub-bob");
    lead.valid.set("rt-b", "sub-bob");
    expect(await revalidateSession(db, await found(legacy.token), lead.refresh)).toBe(true);
    // Mot de passe réinitialisé au Compte Lead (jetons de l'auteur révoqués), puis la personne se
    // reconnecte ailleurs : les autres sessions vérifient tout de suite.
    lead.valid.delete("rt-a");
    const fresh = await open("rt-c");
    lead.valid.set("rt-c", "sub-ada");
    await checkOtherSessionsSoon(db, fresh.userId, fresh.id);
    expect(await revalidateSession(db, await found(a.token), lead.refresh)).toBe(false);
    expect(await findSession(db, a.token)).toBeNull();
    // Sans jeton, elle ne peut rien prouver : elle tombe (reconnexion sans écran au Compte Lead).
    expect(await revalidateSession(db, await found(legacy.token), lead.refresh)).toBe(false);
    expect(await findSession(db, legacy.token)).toBeNull();
    // La nouvelle et celle d'une autre personne ne bougent pas.
    expect(await revalidateSession(db, await found(fresh.token), lead.refresh)).toBe(true);
    expect(await revalidateSession(db, await found(other.token), lead.refresh)).toBe(true);
    expect(lead.calls).toEqual(["rt-a"]);
  });

  it("date du dernier changement d'identifiants : les sessions ouvertes avant tombent", async () => {
    const before = await open("rt-0");
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 3600_000) })
      .where(eq(sessions.id, before.id));
    const kept = await open("rt-1");
    const fresh = await open("rt-2");
    await dropSessionsBefore(db, fresh.userId, new Date(Date.now() - 60_000), fresh.id);
    expect(await findSession(db, before.token)).toBeNull();
    expect(await findSession(db, kept.token)).not.toBeNull();
    expect(await findSession(db, fresh.token)).not.toBeNull();
  });
});
