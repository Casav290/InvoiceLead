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
  // Neon Object Storage (variables AWS standard). Sans elles, les fichiers sont gardés en base.
  AWS_ENDPOINT_URL_S3: z.url().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  RECEIPTS_BUCKET: z.string().min(1).default("receipts"),
  /** Secret des tâches planifiées Vercel (en-tête Authorization: Bearer …). */
  CRON_SECRET: z.string().min(16).optional(),
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
