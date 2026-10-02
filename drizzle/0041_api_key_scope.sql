-- Rejouable : rien n'est effacé, la colonne n'est créée que si elle manque.
-- Portée des clés d'API (api-keys.ts) : « full » ouvre l'API et le serveur MCP (formule Pro+),
-- « projectlead » seulement les contacts et les brouillons de factures dont ProjectLead a besoin, dans
-- toutes les formules. Les clés déjà créées gardent tout (« full »).
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'full' NOT NULL;
