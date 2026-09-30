ALTER TABLE "invoice_payments" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_external_idx" ON "invoice_payments" USING btree ("external_ref") WHERE "invoice_payments"."external_ref" is not null;