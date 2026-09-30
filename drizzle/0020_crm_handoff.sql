ALTER TABLE "contacts" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "external_ref" text;--> statement-breakpoint
CREATE INDEX "contacts_org_external_idx" ON "contacts" USING btree ("organization_id","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_external_idx" ON "invoices" USING btree ("organization_id","external_ref") WHERE "invoices"."external_ref" is not null;