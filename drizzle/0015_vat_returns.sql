CREATE TABLE "vat_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text DEFAULT 'validated' NOT NULL,
	"figures" jsonb NOT NULL,
	"anomalies" jsonb NOT NULL,
	"journal_entry_id" uuid,
	"validated_by" uuid,
	"validated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vat_returns_dates_check" CHECK ("vat_returns"."period_end" >= "vat_returns"."period_start")
);
--> statement-breakpoint
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD CONSTRAINT "vat_returns_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vat_returns_period_idx" ON "vat_returns" USING btree ("organization_id","period_start");