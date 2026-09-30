ALTER TABLE "organizations" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "legal_form" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "building_number" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "town" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "uid" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "vat_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "vat_method" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "vat_settlement" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "qr_iban" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "fiscal_year_start_month" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "settings_completed_at" timestamp with time zone;