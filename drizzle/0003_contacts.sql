CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text DEFAULT 'company' NOT NULL,
	"is_customer" boolean DEFAULT true NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"email" text,
	"phone" text,
	"street" text,
	"building_number" text,
	"postal_code" text,
	"town" text,
	"country" text DEFAULT 'CH' NOT NULL,
	"language" text DEFAULT 'de' NOT NULL,
	"uid" text,
	"payment_term_days" integer DEFAULT 30 NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_org_name_idx" ON "contacts" USING btree ("organization_id",lower("name"));