ALTER TABLE "invoice_lines" ALTER COLUMN "vat_rate_bp" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "vat_rate_bp" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "sales_tax_rate_bp" SET DATA TYPE double precision;