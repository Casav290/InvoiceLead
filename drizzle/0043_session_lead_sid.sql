-- Rejouable : rien n'est effacé, la colonne n'est créée que si elle manque.
-- Session du Compte Lead (claim `sid` du jeton d'identité d'ERPlead, un navigateur) gardée avec la
-- session InvoiceLead : « Se déconnecter » ferme les sessions de ce navigateur seulement, celles des
-- autres appareils restent (back-channel `lead_status: "logout"` avec `sid`). Null : session ouverte
-- avant, fermée par personne comme avant.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "lead_sid" text;
