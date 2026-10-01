-- Rejouable : rien n'est effacé, la colonne n'est créée que si elle manque.
-- Jeton de rafraîchissement du Compte Lead, chiffré, gardé avec la session (session.ts) : relu toutes
-- les quelques minutes, il fait tomber la session dont l'accès a été révoqué au Compte Lead (mot de
-- passe réinitialisé, déconnexion de partout, compte fermé).
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "refresh_token_enc" text;
