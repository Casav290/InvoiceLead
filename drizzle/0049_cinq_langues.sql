-- Rejouable : chaque colonne n'est ajoutée que si elle manque, rien n'est effacé.
-- Cinq langues (27.10.2026) : langue choisie dans InvoiceLead (users.chosen_locale, avant celle du
-- Compte Lead) et devise de la région d'inscription quand le pays n'a pas encore son pack
-- (organizations.region_currency : l'euro pour l'Italie, l'Espagne…). Deux colonnes vides.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "region_currency" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "chosen_locale" text;
