CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"booking_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'CHF' NOT NULL,
	"counterparty" text,
	"reference" text,
	"text" text,
	"status" text DEFAULT 'new' NOT NULL,
	"proposal" jsonb,
	"journal_entry_id" uuid,
	"payment_id" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_org_external_idx" ON "bank_transactions" USING btree ("organization_id","external_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_org_status_idx" ON "bank_transactions" USING btree ("organization_id","status","booking_date");