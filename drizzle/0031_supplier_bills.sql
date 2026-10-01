CREATE TABLE "supplier_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"supplier_name" text NOT NULL,
	"supplier_street" text,
	"supplier_postal_code" text,
	"supplier_town" text,
	"supplier_country" text,
	"iban" text,
	"bic" text,
	"payment_reference" text,
	"number" text,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" text DEFAULT 'CHF' NOT NULL,
	"total_cents" bigint NOT NULL,
	"vat_code" text,
	"account_id" uuid,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"receipt_id" uuid,
	"fx_rate" double precision,
	"first_approved_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"paid_on" date,
	"journal_entry_id" uuid,
	"payment_entry_id" uuid,
	"bank_transaction_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_bills_positive" CHECK ("supplier_bills"."total_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "dual_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_first_approved_by_users_id_fk" FOREIGN KEY ("first_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_bills_org_status_idx" ON "supplier_bills" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_bills_receipt_idx" ON "supplier_bills" USING btree ("receipt_id") WHERE "supplier_bills"."receipt_id" is not null;