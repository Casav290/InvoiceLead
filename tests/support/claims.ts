import type { LeadClaims } from "@/server/lead-id/leadId";

export function claims(overrides: Partial<LeadClaims> & { access?: boolean } = {}): LeadClaims {
  const { access = true, ...rest } = overrides;
  return {
    sub: "sub-ada",
    email: "ada@atelier.test",
    email_verified: true,
    name: "Ada Muster",
    locale: "fr",
    zoneinfo: "Europe/Zurich",
    org: "org-atelier",
    org_name: "Atelier Muster GmbH",
    org_role: "admin",
    lead: {
      plan: { code: "free", name: "Gratuit", rank: 0, seats: 1 },
      apps: {
        invoicelead: {
          access,
          name: "InvoiceLead",
          url: null,
          status: "live",
          upgrade_url: "https://scanlead.io/billing",
        },
        crmlead: {
          access: true,
          name: "CRMlead",
          url: "https://crmlead.io",
          status: "live",
          upgrade_url: null,
        },
      },
      subscriptions: [],
    },
    ...rest,
  };
}
