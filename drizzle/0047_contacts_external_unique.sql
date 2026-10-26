-- Liaison sans clé (26.10.2026) : un contact par fiche d'origine (« crmlead:<id> »,
-- « projectlead:<client> ») et par entreprise. Un clic dans ProjectLead et sa tâche mensuelle arrivés
-- ensemble ne créent donc qu'un contact. S'il existe déjà des doublons, la migration s'arrête (rien
-- n'est changé) : on les fusionne à la main avant de relancer.
DO $$
DECLARE groups integer;
BEGIN
	SELECT count(*) INTO groups FROM (
		SELECT 1 FROM "contacts" WHERE "external_ref" IS NOT NULL
		GROUP BY "organization_id", "external_ref" HAVING count(*) > 1
	) d;
	IF groups > 0 THEN
		RAISE EXCEPTION 'contacts_org_external_idx : % groupe(s) de contacts en double (organization_id, external_ref), à fusionner avant la migration', groups;
	END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "contacts_org_external_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_external_idx" ON "contacts" USING btree ("organization_id","external_ref") WHERE "contacts"."external_ref" is not null;
