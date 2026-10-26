import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  LEAD_ID_ISSUER: z.url(),
  LEAD_ID_CLIENT_ID: z.string().min(1),
  LEAD_ID_CLIENT_SECRET: z.string().min(1),
  LEAD_ID_REDIRECT_URI: z.url(),
  LEAD_ID_APP: z.string().min(1),
  /** L'application CRMlead (envoi des clients et des factures), distincte de l'émetteur des connexions. */
  CRMLEAD_URL: z.url().default("https://crmlead.io"),
  /**
   * Liaison sans clé : expéditeurs dont le jeton d'échange doit porter l'organisation ERPlead
   * (liste séparée par des virgules). Défaut « projectlead » : exigée dès le premier jour.
   */
  EXCHANGE_ORG_SENDERS: z.string().optional(),
  // Envoi des e-mails par Resend ; sans clé, l'envoi est désactivé et seul le lien reste proposé.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_API_URL: z.url().default("https://api.resend.com"),
  EMAIL_FROM: z.string().min(3).default("InvoiceLead <factures@invoicelead.io>"),
  // Assistant comptable : API compatible OpenAI (Z.ai GLM par défaut). Sans clé, seules les règles
  // sûres (références QR des factures) proposent des écritures.
  AI_API_KEY: z.string().min(1).optional(),
  AI_BASE_URL: z.url().default("https://api.z.ai/api/paas/v4"),
  AI_MODEL: z.string().min(1).default("glm-4.6"),
  /** Modèle capable de lire une image (photo de ticket, facture scannée). */
  AI_VISION_MODEL: z.string().min(1).default("glm-4.5v"),
  /**
   * Bulle « Assistant IA » (Claude, API d'Anthropic) : lue côté serveur seulement. Sans clé, la bulle
   * est masquée et /api/assistant répond 503.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Neon Object Storage (variables AWS standard). Sans elles, les fichiers sont gardés en base.
  AWS_ENDPOINT_URL_S3: z.url().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  RECEIPTS_BUCKET: z.string().min(1).default("receipts"),
  /** Secret des tâches planifiées Vercel (en-tête Authorization: Bearer …). */
  CRON_SECRET: z.string().min(16).optional(),
  /**
   * Bêta privée : liste séparée par des virgules d'organisations Lead (« org_… »), d'adresses e-mail
   * ou de domaines (« @fidu.ch »). Vide : ouvert à toutes les organisations dont la formule le permet.
   */
  BETA_ALLOWLIST: z.string().optional(),
  /** Adresse qui reçoit les avis envoyés depuis l'application. */
  FEEDBACK_EMAIL: z.email().optional(),
  // Paiement en ligne par Stripe Connect : chaque entreprise relie son propre compte Stripe, l'argent
  // ne transite jamais par InvoiceLead. Sans ces variables, le paiement en ligne reste masqué.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_API_URL: z.url().default("https://api.stripe.com"),
  STRIPE_CONNECT_URL: z.url().default("https://connect.stripe.com"),
  // Abonnement InvoiceLead (src/server/billing) : compte Stripe de la famille Lead, distinct de
  // Stripe Connect ci-dessus (autres clés, autre webhook /api/billing/webhook, autre secret). Sans
  // clé ni les quatre prix, les boutons « Passer à Pro » se disent indisponibles et le webhook
  // répond 503.
  STRIPE_BILLING_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_BILLING_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_BILLING_PRICE_PRO_MONTHLY: z.string().min(1).optional(),
  STRIPE_BILLING_PRICE_PRO_YEARLY: z.string().min(1).optional(),
  STRIPE_BILLING_PRICE_PROPLUS_MONTHLY: z.string().min(1).optional(),
  STRIPE_BILLING_PRICE_PROPLUS_YEARLY: z.string().min(1).optional(),
  /** Configuration du portail client propre à InvoiceLead (« bpc_… »), jamais celle par défaut. */
  STRIPE_BILLING_PORTAL_CONFIGURATION: z.string().min(1).optional(),
  /** « 1 » : TVA calculée par Stripe Tax au Checkout (éteinte par défaut, comme CRMlead). */
  STRIPE_BILLING_AUTOMATIC_TAX: z.enum(["0", "1"]).optional(),
  STRIPE_BILLING_API_URL: z.url().default("https://api.stripe.com"),
  // Réception des factures électroniques françaises par la plateforme agréée B2Brouter : clé du
  // groupe d'intégration InvoiceLead (un compte par entreprise cliente, créé par l'API). Sans clé,
  // l'inscription se dit indisponible et rien n'est relevé. Une clé « test_ » vise le bac à sable.
  B2BROUTER_API_KEY: z.string().min(1).optional(),
  B2BROUTER_API_URL: z.url().default("https://api.b2brouter.net"),
  B2BROUTER_API_VERSION: z.string().min(1).default("2026-06-26"),
  /** Cours de change de référence de la BCE, pour les factures en devise. */
  FX_API_URL: z.url().default("https://api.frankfurter.dev/v1"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Variables d'environnement validées, lues au premier besoin (jamais pendant le build). */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Configuration incomplète : ${missing}`);
    }
    cached = { ...parsed.data, APP_URL: parsed.data.APP_URL.replace(/\/+$/, "") };
  }
  return cached;
}

export const isProduction = process.env.NODE_ENV === "production";
