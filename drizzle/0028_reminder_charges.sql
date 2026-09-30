ALTER TABLE "invoice_reminders" ADD COLUMN "fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD COLUMN "interest_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_reminders" ADD COLUMN "waived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reminder_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "reminder_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "late_interest_bp" double precision;