import { NextRequest, type NextResponse } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { isNativeAgent } from "@/lib/native";
import { startLogin } from "@/server/lead-id/leadId";
import { setTestEnv } from "../support/env";

/**
 * App Android / iOS (coque Capacitor, agent « InvoiceLeadApp ») : pas de pages de présentation ni de
 * prix (Apple 3.1.1), et la connexion au Compte Lead demandée en mode app (sans Google, règle 4.8).
 */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
  headers: async () => new Headers(),
}));

const APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 InvoiceLeadApp";
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function request(path: string, ua: string, extra: Record<string, string> = {}) {
  return new NextRequest(`https://invoicelead.io${path}`, {
    headers: { "user-agent": ua, "accept-language": "fr-CH,fr;q=0.9", ...extra },
  });
}
async function proxy(path: string, ua: string, extra?: Record<string, string>) {
  const { default: run } = await import("@/proxy");
  return run(request(path, ua, extra)) as NextResponse;
}
const where = (r: Response) => new URL(r.headers.get("location") ?? "", "https://x").pathname;

beforeAll(() => setTestEnv());

describe("app Android / iOS", () => {
  it("reconnaît l'agent de l'app, pas un navigateur", () => {
    expect(isNativeAgent(APP_UA)).toBe(true);
    expect(isNativeAgent(CHROME)).toBe(false);
    expect(isNativeAgent(null)).toBe(false);
  });

  it("ouvre l'application à la place de l'accueil, des tarifs et de la FAQ", async () => {
    for (const [path, to] of [
      ["/", "/fr/app"],
      ["/de", "/de/app"],
      ["/en/", "/en/app"],
      ["/fr/pricing", "/fr/app"],
      ["/de/faq", "/de/app"],
    ] as const) {
      const r = await proxy(path, APP_UA);
      expect(r.status, path).toBe(303);
      expect(where(r), path).toBe(to);
    }
  });

  it("garde la langue choisie sur le site quand l'adresse n'en donne pas", async () => {
    const r = await proxy("/", APP_UA, { cookie: "NEXT_LOCALE=en" });
    expect(where(r)).toBe("/en/app");
  });

  it("laisse les pages légales et un navigateur comme avant", async () => {
    const legal = await proxy("/fr/legal/privacy", APP_UA);
    expect(where(legal)).not.toBe("/fr/app");
    const site = await proxy("/fr/pricing", CHROME);
    expect(site.headers.get("location") ?? "").not.toContain("/fr/app");
  });

  it("demande au Compte Lead une connexion en mode app", () => {
    expect(new URL(startLogin({ locale: "fr", app: true }).url).searchParams.get("platform")).toBe(
      "app",
    );
    expect(new URL(startLogin({ locale: "fr" }).url).searchParams.get("platform")).toBeNull();
  });

  it("le départ vers le Compte Lead porte platform=app depuis l'app seulement", async () => {
    const { GET } = await import("@/app/auth/lead/start/route");
    const fromApp = await GET(request("/auth/lead/start?locale=fr", APP_UA));
    expect(new URL(fromApp.headers.get("location") ?? "").searchParams.get("platform")).toBe("app");
    const fromSite = await GET(request("/auth/lead/start?locale=fr", CHROME));
    expect(new URL(fromSite.headers.get("location") ?? "").searchParams.get("platform")).toBeNull();
  });
});
