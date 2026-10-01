import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loginCookieName } from "@/lib/cookies";
import {
  cookieBytes,
  DONE_BYTES,
  doneValue,
  hashState,
  INVITE_PATH,
  NEXT_MAX,
  openLogin,
  PENDING_BYTES,
  readDone,
  returnParams,
  safeFinished,
  safeNext,
  sealLogin,
  staleDone,
  stalePending,
  stateOf,
} from "@/server/auth/login-cookie";
import {
  nextForState,
  openState,
  PAGE_REF,
  STATE_MAX_AGE_SECONDS,
  STATE_NEXT_MAX,
  sealState,
} from "@/server/auth/login-state";
import { startLogin } from "@/server/lead-id/leadId";

const SECRET = "s".repeat(40);
const OTHER = "o".repeat(40);
const INVITE = "A".repeat(43);
const LONG_INVITE = "B".repeat(100);

/** Un lien d'import de CRMlead de `length` caractères exactement. */
function importLink(length: number): string {
  const head = "/fr/app/import/crmlead?d=";
  return head + "e".repeat(length - head.length);
}

describe("demande de connexion dans le state", () => {
  it("fait l'aller-retour : langue, page, invitation", () => {
    const page = sealState({ locale: "fr", next: "/fr/app/quotes?status=draft" }, SECRET);
    expect(openState(page, SECRET)).toMatchObject({
      locale: "fr",
      next: "/fr/app/quotes?status=draft",
    });
    const invite = sealState({ locale: "en", invite: INVITE, next: "/en/app" }, SECRET);
    const opened = openState(invite, SECRET);
    expect(opened).toMatchObject({ locale: "en", invite: INVITE });
    // L'invitation passe avant la page : la page n'est pas gardée.
    expect(opened?.next).toBeUndefined();
    expect(openState(sealState({ locale: "de" }, SECRET), SECRET)).toMatchObject({ locale: "de" });
  });

  it("chiffre : ni la page ni l'invitation ne se lisent dans le state", () => {
    const state = sealState({ locale: "fr", invite: INVITE }, SECRET);
    expect(Buffer.from(state, "base64url").toString("latin1")).not.toContain(INVITE);
    expect(state).not.toContain("quotes");
  });

  it("refuse un state modifié, tronqué, d'un autre secret ou de l'ancien format", () => {
    const state = sealState({ locale: "fr", next: "/fr/app/invoices" }, SECRET);
    const flip = (s: string, i: number) =>
      s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    expect(openState(flip(state, 5), SECRET)).toBeNull();
    expect(openState(flip(state, 30), SECRET)).toBeNull();
    expect(openState(flip(state, state.length - 2), SECRET)).toBeNull();
    expect(openState(state.slice(0, -4), SECRET)).toBeNull();
    expect(openState(state.slice(0, 40), SECRET)).toBeNull();
    expect(openState(state, OTHER)).toBeNull();
    expect(openState(`${state}=`, SECRET)).toBeNull();
    expect(openState("", SECRET)).toBeNull();
    expect(openState(null, SECRET)).toBeNull();
    // Ancien `state` (24 octets aléatoires) : rien à lire.
    expect(openState(startState(), SECRET)).toBeNull();
  });

  it("oublie une demande trop vieille, ou datée du futur", () => {
    const now = Date.now();
    const state = sealState({ locale: "fr" }, SECRET, now);
    expect(openState(state, SECRET, now + (STATE_MAX_AGE_SECONDS - 60) * 1000)).not.toBeNull();
    expect(openState(state, SECRET, now + (STATE_MAX_AGE_SECONDS + 60) * 1000)).toBeNull();
    expect(openState(sealState({ locale: "fr" }, SECRET, now + 3600_000), SECRET, now)).toBeNull();
  });

  it("ne garde jamais une page hors de l'application", () => {
    const state = sealState({ locale: "fr", next: "https://evil.example/" }, SECRET);
    expect(openState(state, SECRET)).toMatchObject({ locale: "fr" });
    expect(openState(state, SECRET)?.next).toBeUndefined();
    expect(nextForState("/fr/invite?token=x")).toBeUndefined();
  });

  it("une page trop longue n'en garde que le chemin", () => {
    const long = importLink(800);
    expect(nextForState(long)).toBe("/fr/app/import/crmlead");
    expect(nextForState("/fr/app/quotes?status=draft")).toBe("/fr/app/quotes?status=draft");
    expect(openState(sealState({ locale: "fr", next: long }, SECRET), SECRET)?.next).toBe(
      "/fr/app/import/crmlead",
    );
  });

  it("une page trop longue garde aussi la référence de la page entière", () => {
    const ref = "R".repeat(22);
    const long = openState(sealState({ locale: "fr", next: importLink(800), ref }, SECRET), SECRET);
    expect(long).toMatchObject({ next: "/fr/app/import/crmlead", ref });
    // Page qui tient entière, invitation, référence mal formée : pas de référence.
    const short = sealState({ locale: "fr", next: "/fr/app/quotes", ref }, SECRET);
    expect(openState(short, SECRET)?.ref).toBeUndefined();
    const invite = sealState({ locale: "fr", invite: INVITE, next: importLink(800), ref }, SECRET);
    expect(openState(invite, SECRET)?.ref).toBeUndefined();
    const bad = sealState({ locale: "fr", next: importLink(800), ref: "x/y" }, SECRET);
    expect(openState(bad, SECRET)?.ref).toBeUndefined();
    expect(PAGE_REF.test(ref)).toBe(true);
  });

  it("garde l'entrée « fraîche » du Compte Lead, et seulement elle", () => {
    const fresh = openState(sealState({ locale: "fr", fresh: true }, SECRET), SECRET);
    expect(fresh).toMatchObject({ locale: "fr", fresh: true });
    expect(openState(sealState({ locale: "fr" }, SECRET), SECRET)?.fresh).toBeUndefined();
  });

  it("donne à chaque demande un nom de cookie à elle", () => {
    const names = new Set(
      Array.from({ length: 2000 }, () => loginCookieName(sealState({ locale: "fr" }, SECRET))),
    );
    expect(names.size).toBe(2000);
    for (const name of names) expect(name).toMatch(/^il_lead_login_[A-Za-z0-9_-]{16}$/);
  });

  it("garde l'adresse /oauth/authorize sous 1 000 caractères, au pire", () => {
    const worst = [
      { locale: "fr" as const, next: `/fr/app/quotes?${"q".repeat(STATE_NEXT_MAX - 15)}` },
      {
        locale: "fr" as const,
        next: importLink(NEXT_MAX),
        ref: "R".repeat(22),
        fresh: true as const,
      },
      { locale: "fr" as const, invite: LONG_INVITE, fresh: true as const },
    ];
    for (const request of worst) {
      expect(safeNext(request.next ?? "/fr/app")).toBeDefined();
      const login = startLogin({ locale: request.locale, prompt: "create" });
      const url = new URL(login.url);
      url.searchParams.set("state", sealState(request, SECRET));
      // Ce que le Compte Lead porte dans ses adresses : le chemin, plus `login_after`.
      const carried = `${url.pathname}${url.search}&login_after=1790000000`;
      expect(carried.length).toBeLessThan(1000);
      // Le state passe les filtres du Compte Lead et d'InvoiceLead.
      expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    }
  });
});

/** Un `state` comme le kit Lead en tirait seul (24 octets aléatoires). */
function startState(): string {
  return startLogin({ locale: "fr" }).state;
}

describe("cookie de la demande", () => {
  it("ne vaut que pour son state", () => {
    const state = sealState({ locale: "fr" }, SECRET);
    const saved = openLogin(
      sealLogin({ stateHash: hashState(state), nonce: "n", verifier: "v", at: 1 }, SECRET),
      SECRET,
    );
    expect(saved).not.toBeNull();
    if (!saved) return;
    expect(stateOf(saved, state)).toBe(state);
    expect(stateOf(saved, sealState({ locale: "fr" }, SECRET))).toBeUndefined();
    expect(stateOf(saved, "")).toBeUndefined();
    // Ancien cookie : le state en clair.
    const legacy = { state: "st", nonce: "n", verifier: "v", locale: "fr" as const };
    const opened = openLogin(sealLogin(legacy, SECRET), SECRET);
    expect(opened).toEqual(legacy);
    if (opened) expect(stateOf(opened, "st")).toBe("st");
  });

  it("refuse un cookie sans state ni empreinte", () => {
    expect(openLogin(sealLogin({ nonce: "n", verifier: "v" }, SECRET), SECRET)).toBeNull();
  });

  it("tient sous 4 000 octets avec la page la plus longue", () => {
    const state = sealState({ locale: "fr", next: importLink(NEXT_MAX) }, SECRET);
    const value = sealLogin(
      {
        stateHash: hashState(state),
        nonce: "n".repeat(32),
        verifier: "v".repeat(64),
        at: Date.now(),
        next: importLink(NEXT_MAX),
      },
      SECRET,
    );
    expect(cookieBytes(loginCookieName(state), value)).toBeLessThan(4000);
    expect(openLogin(value, SECRET)?.next).toBe(importLink(NEXT_MAX));
    // Ancien format le plus lourd : toujours lisible, toujours sous la limite.
    const legacy = sealLogin(
      {
        state: "s".repeat(32),
        nonce: "n".repeat(32),
        verifier: "v".repeat(64),
        locale: "fr",
        invite: LONG_INVITE,
        next: importLink(NEXT_MAX),
      },
      SECRET,
    );
    expect(cookieBytes(`il_lead_login_${"s".repeat(16)}`, legacy)).toBeLessThan(4000);
    expect(openLogin(legacy, SECRET)?.next).toBe(importLink(NEXT_MAX));
  });
});

describe("page de retour", () => {
  it("accepte un lien d'import de CRMlead jusqu'à 2 400 caractères", () => {
    expect(safeNext(importLink(NEXT_MAX))).toBe(importLink(NEXT_MAX));
    expect(safeNext(importLink(NEXT_MAX + 1))).toBeUndefined();
    expect(safeNext("/fr/app//evil.example")).toBeUndefined();
    expect(safeNext("/fr/invite?token=x")).toBeUndefined();
    expect(safeNext("https://evil.example/fr/app")).toBeUndefined();
  });

  it("accepte une recherche telle qu'un navigateur l'écrit, « * » compris", () => {
    const pages = [
      "/fr/app/contacts?q=M%C3%BCller*",
      "/de/app/contacts?q=%C3%84rzte+%26+Co&archived=1",
      "/en/app/invoices?q=(A)!$;@/?|[1]{2}^'x'",
    ];
    for (const page of pages) {
      expect(safeNext(page)).toBe(page);
      expect(nextForState(page)).toBe(page);
      expect(openState(sealState({ locale: "fr", next: page }, SECRET), SECRET)?.next).toBe(page);
      expect(returnParams(page)).toEqual({ next: page });
      expect(readDone(doneValue(page))?.target).toBe(page);
    }
    for (const bad of [
      "/fr/app?x=a#b",
      "/fr/app?x=a\\b",
      "/fr/app?x=//evil",
      "/fr/app?x=a b",
      "/fr/app\r\nX",
      "/fr/app?x=\r\nSet-Cookie:a=b",
      "/fr/app?x=<script>",
      '/fr/app?x="y"',
      "/fr/app?x=`y`",
      "/fr/app*",
    ])
      expect(safeNext(bad)).toBeUndefined();
  });

  it("une connexion aboutie peut mener à une page ou à une invitation, rien d'autre", () => {
    expect(safeFinished("/fr/app/quotes")).toBe("/fr/app/quotes");
    expect(safeFinished(`/fr/invite?token=${INVITE}`)).toBe(`/fr/invite?token=${INVITE}`);
    expect(safeFinished("//evil.example")).toBeUndefined();
    expect(safeFinished("/fr/invite?token=court")).toBeUndefined();
    expect(safeFinished(`/fr/invite?token=${INVITE}&next=/x`)).toBeUndefined();
    expect(safeFinished(`https://evil.example/fr/invite?token=${INVITE}`)).toBeUndefined();
    expect(safeFinished("/it/app")).toBeUndefined();
    expect(INVITE_PATH.exec(`/de/invite?token=${INVITE}`)?.[2]).toBe(INVITE);
  });

  it("repart vers le Compte Lead avec l'invitation ou la page", () => {
    expect(returnParams(`/fr/invite?token=${INVITE}`)).toEqual({ invite: INVITE });
    expect(returnParams("/fr/app/quotes?status=draft")).toEqual({
      next: "/fr/app/quotes?status=draft",
    });
    expect(returnParams("/elsewhere")).toEqual({});
    expect(returnParams(undefined)).toEqual({});
  });
});

describe("plafond des cookies de connexion", () => {
  const pending = (at: number, next?: string) => {
    const state = sealState({ locale: "fr" }, SECRET);
    return {
      name: loginCookieName(state),
      value: sealLogin(
        {
          stateHash: hashState(state),
          nonce: "n".repeat(32),
          verifier: "v".repeat(64),
          at,
          ...(next ? { next } : {}),
        },
        SECRET,
      ),
    };
  };

  it("efface les demandes les plus anciennes au-delà de cinq", () => {
    const jar = Array.from({ length: 10 }, (_, i) => pending(1000 + i));
    const incoming = cookieBytes(jar[0]?.name ?? "", jar[0]?.value ?? "");
    const stale = stalePending([...jar].reverse(), SECRET, incoming);
    expect([...stale].sort()).toEqual(
      jar
        .slice(0, 6)
        .map((c) => c.name)
        .sort(),
    );
  });

  it("efface d'abord les cookies illisibles ou sans date", () => {
    const jar = [
      pending(5000),
      { name: `il_lead_login_${"x".repeat(16)}`, value: "falsifié" },
      { name: "il_lead_login", value: "ancien cookie commun, hors plafond" },
      { name: "il_session", value: "jamais touché" },
      pending(4000),
      pending(3000),
      pending(2000),
    ];
    const stale = stalePending(jar, SECRET, 400);
    expect(stale).toEqual([`il_lead_login_${"x".repeat(16)}`]);
  });

  it("reste dans le budget d'octets avec des pages longues", () => {
    const jar = [
      pending(3000, importLink(NEXT_MAX)),
      pending(2000, importLink(NEXT_MAX)),
      pending(1000),
    ];
    const fresh = pending(4000, importLink(NEXT_MAX));
    const stale = stalePending(jar, SECRET, cookieBytes(fresh.name, fresh.value));
    const kept = jar.filter((c) => !stale.includes(c.name));
    const total =
      cookieBytes(fresh.name, fresh.value) +
      kept.reduce((sum, c) => sum + cookieBytes(c.name, c.value), 0);
    expect(total).toBeLessThanOrEqual(PENDING_BYTES);
    expect(stale).toContain(jar[1]?.name);
  });

  it("garde trois traces au plus, les plus récentes", () => {
    const done = (i: number, target = "/fr/app/quotes") => ({
      name: `il_lead_login_${String(i).padStart(16, "t")}_ok`,
      value: doneValue(target, 1_790_000_000_000 + i * 1000),
    });
    const jar = Array.from({ length: 6 }, (_, i) => done(i));
    const stale = staleDone(jar, 60, done(9).name);
    expect([...stale].sort()).toEqual(
      jar
        .slice(0, 4)
        .map((c) => c.name)
        .sort(),
    );
    // Une trace longue ne laisse pas dépasser le budget.
    const long = done(10, importLink(NEXT_MAX));
    const kept = jar.filter(
      (c) => !staleDone(jar, cookieBytes(long.name, long.value), long.name).includes(c.name),
    );
    const total =
      cookieBytes(long.name, long.value) +
      kept.reduce((sum, c) => sum + cookieBytes(c.name, c.value), 0);
    expect(total).toBeLessThanOrEqual(DONE_BYTES);
  });

  it("lit les traces, anciennes comprises", () => {
    expect(readDone(doneValue("/fr/app/quotes", 1_790_000_000_000))).toEqual({
      at: 1_790_000_000,
      target: "/fr/app/quotes",
    });
    expect(readDone("/fr/app/quotes")).toEqual({ at: 0, target: "/fr/app/quotes" });
    expect(readDone(`123/fr/invite?token=${INVITE}`)?.target).toBe(`/fr/invite?token=${INVITE}`);
    expect(readDone("123//evil.example")).toBeUndefined();
    expect(readDone("https://evil.example")).toBeUndefined();
    expect(readDone(undefined)).toBeUndefined();
  });
});

const ENV = {
  LEAD_ID_ISSUER: "https://crmlead.io",
  LEAD_ID_CLIENT_ID: "invoicelead",
  LEAD_ID_CLIENT_SECRET: "lid_test",
  LEAD_ID_REDIRECT_URI: "https://invoicelead.io/auth/lead/callback",
};
const before: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    before[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(before)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
