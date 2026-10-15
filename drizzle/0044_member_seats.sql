-- Rejouable : rien n'est effacé, chaque objet n'est créé que s'il manque.
-- Places de l'équipe (suites de l'abonnement par application, 15.10.2026) : la dernière venue de chaque
-- personne gardée sur son adhésion (elle reste après la fin des sessions), et le retrait par un
-- responsable (« Retirer »), gardé à la reconnexion tant qu'il n'est pas rétabli.
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "removed_by" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "memberships" ADD CONSTRAINT "memberships_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
-- Adhésions d'avant : la dernière venue reprend la dernière connexion connue (journal auth.login, ou
-- session encore ouverte), seulement là où elle manque. Rejouée, elle ne change rien.
UPDATE "memberships" AS m
SET "last_seen_at" = seen."at"
FROM (
	SELECT "organization_id", "user_id", max("at") AS "at"
	FROM (
		SELECT "organization_id", "user_id", "created_at" AS "at" FROM "audit_log" WHERE "action" = 'auth.login'
		UNION ALL
		SELECT "organization_id", "user_id", "created_at" AS "at" FROM "sessions"
	) AS arrivals
	WHERE "organization_id" IS NOT NULL AND "user_id" IS NOT NULL
	GROUP BY "organization_id", "user_id"
) AS seen
WHERE m."organization_id" = seen."organization_id"
	AND m."user_id" = seen."user_id"
	AND m."last_seen_at" IS NULL;
