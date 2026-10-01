ALTER TABLE "supplier_bills" ADD COLUMN "claimant_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD COLUMN "distance_meters" integer;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD COLUMN "rate_per_km_cents" integer;--> statement-breakpoint
ALTER TABLE "supplier_bills" ADD CONSTRAINT "supplier_bills_claimant_id_users_id_fk" FOREIGN KEY ("claimant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;