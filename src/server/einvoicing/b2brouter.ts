import "server-only";
import { env } from "@/server/env";

/**
 * Client de l'API B2Brouter, plateforme agréée par la DGFiP (docs.b2brouter.net) : un compte par
 * entreprise cliente dans le groupe d'intégration InvoiceLead, inscrit à l'annuaire pour la
 * réception, puis relevé des factures reçues. Clé dans X-B2B-API-Key, version d'API fixée.
 */

export class B2BrouterError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`b2brouter_${status}`);
  }
}

export type ReceivedInvoice = { id: string; number: string | null; state: string | null };

export type B2Brouter = {
  createAccount(account: {
    name: string;
    siren: string;
    vatNumber: string | null;
    street: string | null;
    postalCode: string | null;
    town: string | null;
    email: string | null;
  }): Promise<string>;
  /** Inscription à l'annuaire pour la réception, active le matin suivant `startDate`. */
  registerReception(
    accountId: string,
    setting: { startDate: string; email: string | null; migrationCode: string | null },
  ): Promise<void>;
  listReceived(accountId: string, offset: number, limit: number): Promise<ReceivedInvoice[]>;
  downloadOriginal(invoiceId: string): Promise<{ type: string; bytes: Buffer }>;
  ack(invoiceId: string): Promise<void>;
  markAs(invoiceId: string, state: "accepted" | "refused" | "paid", reason?: string): Promise<void>;
};

/** Le client configuré, ou null sans clé (réception indisponible). */
export function b2brouterFromEnv(fetcher: typeof fetch = fetch): B2Brouter | null {
  const e = env();
  if (!e.B2BROUTER_API_KEY) return null;
  return b2brouter(
    { key: e.B2BROUTER_API_KEY, url: e.B2BROUTER_API_URL, version: e.B2BROUTER_API_VERSION },
    fetcher,
  );
}

export function b2brouter(
  config: { key: string; url: string; version: string },
  fetcher: typeof fetch = fetch,
): B2Brouter {
  const base = config.url.replace(/\/+$/, "");
  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetcher(`${base}${path}`, {
      method,
      headers: {
        "X-B2B-API-Key": config.key,
        "X-B2B-API-Version": config.version,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new B2BrouterError(res.status, (await res.text()).slice(0, 500));
    return res;
  }
  const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

  return {
    async createAccount(a) {
      const res = await call("POST", "/accounts", {
        account: {
          country: "fr",
          name: a.name,
          cin_scheme: "0002",
          cin_value: a.siren,
          ...(a.vatNumber ? { tin_scheme: 9957, tin_value: a.vatNumber } : {}),
          address: a.street ?? undefined,
          postalcode: a.postalCode ?? undefined,
          city: a.town ?? undefined,
          email: a.email ?? undefined,
        },
      });
      const data = await json(res);
      const account = (data.account ?? data) as { id?: unknown };
      if (account.id === undefined || account.id === null) throw new B2BrouterError(502, "no id");
      return String(account.id);
    },

    async registerReception(accountId, s) {
      await call("POST", `/accounts/${encodeURIComponent(accountId)}/tax_report_settings`, {
        tax_report_setting: {
          code: "dgfip",
          start_date: s.startDate,
          // Réception seule : ni rapports à la DGFiP ni statuts envoyés pour l'entreprise tant que
          // ses factures émises ne passent pas par la plateforme (docs/RECEPTION-FR.md).
          annuaire_only: true,
          ...(s.email ? { email: s.email } : {}),
          ...(s.migrationCode ? { peppol_migration_code: s.migrationCode } : {}),
        },
      });
    },

    async listReceived(accountId, offset, limit) {
      const q = new URLSearchParams({
        type: "ReceivedInvoice",
        offset: String(offset),
        limit: String(limit),
      });
      const data = await json(
        await call("GET", `/accounts/${encodeURIComponent(accountId)}/invoices?${q}`),
      );
      const rows = Array.isArray(data.invoices) ? (data.invoices as Record<string, unknown>[]) : [];
      return rows
        .filter((r) => r.id !== undefined && r.id !== null)
        .map((r) => ({
          id: String(r.id),
          number: typeof r.number === "string" ? r.number : null,
          state: typeof r.state === "string" ? r.state : null,
        }));
    },

    async downloadOriginal(invoiceId) {
      const res = await call("GET", `/invoices/${encodeURIComponent(invoiceId)}/as/original`);
      const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      return { type: type || "application/xml", bytes: Buffer.from(await res.arrayBuffer()) };
    },

    async ack(invoiceId) {
      await call("POST", `/invoices/${encodeURIComponent(invoiceId)}/ack`);
    },

    async markAs(invoiceId, state, reason) {
      await call("POST", `/invoices/${encodeURIComponent(invoiceId)}/mark_as`, {
        state,
        ...(reason ? { reason } : {}),
      });
    },
  };
}
