-- Rejouable : rien n'est effacé, chaque objet n'est créé que s'il manque.
-- Abonnement InvoiceLead payé dans InvoiceLead (décision d'Ève du 13.10.2026 : chaque application
-- Lead vend son propre abonnement, valable chez elle seule). Séparé de Stripe Connect
-- (organizations.stripe_account_id, invoice_payments) : client Stripe propre, abonnements et
-- événements dans leurs tables.
CREATE TABLE IF NOT EXISTS "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"subscription_id" text,
	"result" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" text NOT NULL,
	"plan" text NOT NULL,
	"interval" text NOT NULL,
	"price_id" text,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancel_at" timestamp with time zone,
	"livemode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erplead_synced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN IF NOT EXISTS "cancel_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_plan" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billing_plan_until" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_subscriptions_organization_idx" ON "billing_subscriptions" USING btree ("organization_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "organizations" ADD CONSTRAINT "organizations_billing_customer_id_unique" UNIQUE("billing_customer_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
