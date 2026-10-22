-- Rejouable : rien n'est effacé, chaque objet n'est créé que s'il manque.
-- Réception des factures électroniques par une plateforme agréée (France, 22.10.2026) : le compte de
-- l'entreprise chez B2Brouter, et sur chaque facture reçue son identifiant chez la plateforme, le
-- dernier état transmis et le motif d'un refus.
CREATE TABLE IF NOT EXISTS "einvoice_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text DEFAULT 'b2brouter' NOT NULL,
	"external_account_id" text NOT NULL,
	"siren" text NOT NULL,
	"start_date" date NOT NULL,
	"registered_by" uuid,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "einvoice_connections_organization_id_unique" UNIQUE("organization_id")
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "einvoice_connections" ADD CONSTRAINT "einvoice_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "einvoice_connections" ADD CONSTRAINT "einvoice_connections_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD COLUMN IF NOT EXISTS "platform_ref" text;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD COLUMN IF NOT EXISTS "platform_state" text;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD COLUMN IF NOT EXISTS "refusal_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_bills_platform_ref_idx" ON "supplier_bills" USING btree ("organization_id","platform_ref") WHERE "supplier_bills"."platform_ref" is not null;
