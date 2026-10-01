ALTER TABLE "bank_transactions" ADD COLUMN "auto_posted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "autopilot" boolean DEFAULT false NOT NULL;