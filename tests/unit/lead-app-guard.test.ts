import { describe, expect, it, vi } from "vitest";

/**
 * Page de l'app qui exige une session, sans session (cookie périmé : déconnexion « de partout »), dans
 * l'app Android / iOS qui revient de Google (LeadAppAuth/1) : la garde passe par l'écran de connexion de
 * l'app, qui lit d'abord le lien de lancement (lib/lead-app-auth.ts) ; sinon, l'app relancée par son
 * lien de retour irait tout droit au Compte Lead et le lien serait perdu (relecture du 30.10.2026).
 * Navigateurs et anciennes versions : tout droit vers le Compte Lead, comme avant.
 */

const ctx = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`NEXT_REDIRECT ${url}`);
    }
  }
  return { headers: new Headers(), Redirect };
});

vi.mock("next/headers", () => ({ headers: async () => ctx.headers }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new ctx.Redirect(url);
  },
}));
vi.mock("@/server/auth/session", () => ({ getSession: async () => null }));

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

async function target(
  ua: string | null,
  back?: { next?: string; invite?: string },
  requested = "/it/app/invoices?status=open",
) {
  const { requireSession } = await import("@/server/auth/guard");
  const { REQUESTED_PATH_HEADER } = await import("@/lib/cookies");
  ctx.headers = new Headers({
    ...(ua ? { "user-agent": ua } : {}),
    [REQUESTED_PATH_HEADER]: requested,
  });
  try {
    await requireSession("it", back);
  } catch (e) {
    if (e instanceof ctx.Redirect) return e.url;
    throw e;
  }
  return null;
}

describe("garde : page de l'app sans session", () => {
  it("dans l'app (LeadAppAuth/1) : par l'écran de connexion de l'app, qui lit le lien de lancement ; ailleurs, tout droit vers le Compte Lead", async () => {
    const app = `${IPHONE} InvoiceLeadApp LeadAppAuth/1`;
    expect(await target(app)).toBe(
      `/it/login?${new URLSearchParams({ next: "/it/app/invoices?status=open" })}`,
    );
    expect(await target(app, { invite: "a".repeat(43) })).toBe(
      `/it/login?${new URLSearchParams({ invite: "a".repeat(43) })}`,
    );
    expect(await target(app, { next: "/it/app/settings" })).toBe(
      `/it/login?${new URLSearchParams({ next: "/it/app/settings" })}`,
    );
    // Page demandée hors du site : aucune.
    expect(await target(app, undefined, "https://evil.example/x")).toBe("/it/login");
    // Ancienne version de l'app et navigateurs : comme avant.
    for (const ua of [`${IPHONE} InvoiceLeadApp`, IPHONE, null]) {
      expect(await target(ua), String(ua)).toBe(
        `/auth/lead/start?${new URLSearchParams({ locale: "it", next: "/it/app/invoices?status=open" })}`,
      );
    }
  });
});
