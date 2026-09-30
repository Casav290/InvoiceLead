CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"number" integer NOT NULL,
	"entry_date" date NOT NULL,
	"description" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"reversal_of" uuid,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"vat_rate_bp" integer,
	"vat_base_cents" bigint,
	CONSTRAINT "journal_lines_one_side" CHECK (("journal_lines"."debit_cents" >= 0 and "journal_lines"."credit_cents" >= 0 and ("journal_lines"."debit_cents" = 0) <> ("journal_lines"."credit_cents" = 0)))
);
--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_seq_idx" ON "journal_entries" USING btree ("organization_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_year_number_idx" ON "journal_entries" USING btree ("fiscal_year_id","number");--> statement-breakpoint
CREATE INDEX "journal_entries_org_date_idx" ON "journal_entries" USING btree ("organization_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
-- Le journal ne se modifie pas : seules les insertions sont admises (corrections par extourne).
CREATE OR REPLACE FUNCTION journal_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'journal_append_only: % sur %', TG_OP, TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION journal_append_only();--> statement-breakpoint
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION journal_append_only();
