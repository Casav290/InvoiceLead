ALTER TABLE "invoice_payments" ADD COLUMN "fx_rate" double precision;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "receivable_home_cents" bigint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "fx_rate" double precision;