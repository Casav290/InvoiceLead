-- Rejouable : chaque colonne n'est ajoutée que si elle manque, rien n'est effacé.
-- Visite guidée de l'application (04.11.2026) : elle s'ouvre seule au PREMIER passage d'une personne, une seule fois.
-- `users.tour_pending` : vrai tant que la visite ne s'est jamais ouverte pour cette personne. Les personnes déjà là au
-- passage de cette migration reçoivent FAUX (la colonne naît avec le défaut faux) : elles ne la voient pas d'elles-mêmes
-- et la lancent par « Revoir la visite » (menu de la personne). Ensuite le défaut devient VRAI : toute personne créée
-- après (première connexion par le Compte Lead, invitation) la verra à son premier passage.
-- `users.tour_seen_at` : la première ouverture (ou « Passer »), posée par markTourSeen (src/server/tour.ts).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tour_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tour_pending" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tour_seen_at" timestamp with time zone;
