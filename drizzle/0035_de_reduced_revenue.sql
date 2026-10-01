-- Allemagne : les produits à 7 % vont sur 4300 (compte automatique SKR04), pour les plans déjà installés.
UPDATE "accounts" SET "role" = 'revenue_reduced'
FROM "organizations"
WHERE "accounts"."organization_id" = "organizations"."id"
  AND "organizations"."country" = 'DE'
  AND "accounts"."number" = '4300'
  AND "accounts"."role" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "accounts" a2
    WHERE a2."organization_id" = "accounts"."organization_id" AND a2."role" = 'revenue_reduced'
  );
