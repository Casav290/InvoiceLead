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
