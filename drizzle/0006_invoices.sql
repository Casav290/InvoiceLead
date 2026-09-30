CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity_milli" bigint NOT NULL,
	"unit" text NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"vat_code" text,
	"vat_rate_bp" integer DEFAULT 0 NOT NULL,
	"net_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"language" text DEFAULT 'de' NOT NULL,
	"currency" text DEFAULT 'CHF' NOT NULL,
	"title" text,
	"intro_text" text,
	"footer_text" text,
	"issue_date" date NOT NULL,
	"service_date" date NOT NULL,
	"due_date" date NOT NULL,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"net_cents" bigint DEFAULT 0 NOT NULL,
	"vat_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"recipient" jsonb,
	"sender" jsonb,
	"issued_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_sequences_organization_id_kind_year_pk" PRIMARY KEY("organization_id","kind","year")
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_position_idx" ON "invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoices_org_idx" ON "invoices" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_idx" ON "invoices" USING btree ("organization_id","number") WHERE "invoices"."number" is not null;