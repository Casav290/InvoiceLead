-- Rejouable : rien n'est effacé, chaque objet n'est créé que s'il manque.
-- Après la 0038_plan_usage des formules, et datée après elle dans le journal (« when ») : le migrateur
-- de Drizzle n'applique que les migrations plus récentes que la dernière appliquée. Une base qui l'a
-- reçue sous son ancienne date, avant la 0038, peut la recevoir une seconde fois sans dommage.
CREATE TABLE IF NOT EXISTS "login_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"next" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_pages_created_idx" ON "login_pages" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_organization_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_last_organization_id_organizations_id_fk" FOREIGN KEY ("last_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Plafond horaire des pages par client (login-pages.ts) : le réseau qui a demandé la page, en HMAC.
ALTER TABLE "login_pages" ADD COLUMN IF NOT EXISTS "client" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_pages_client_idx" ON "login_pages" USING btree ("client","created_at");
