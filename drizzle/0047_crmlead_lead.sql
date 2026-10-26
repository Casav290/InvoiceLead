-- Rejouable : rien n'est effacé, chaque objet n'est créé que s'il manque.
-- Affaire CRMlead d'un nouveau devis du même client (26.10.2026) : le devis O-2026-0002 accepté à 7 500 CHF
-- n'était relié à rien, CRMlead et ProjectLead gardaient les 5 000 du premier devis refusé.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "crmlead_lead_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_org_crmlead_lead_idx" ON "invoices" USING btree ("organization_id","crmlead_lead_id") WHERE "invoices"."crmlead_lead_id" is not null;
