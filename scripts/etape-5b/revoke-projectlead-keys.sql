-- Étape 5b des liens sans clé (integrations-design.json, rollout_order 5b) : À NE JOUER QU'APRÈS 7 jours verts de
-- ProjectLead relié sans clé ET un instantané Neon de la base InvoiceLead. Hors de drizzle/ : jamais appliqué tout seul.
-- Révoque les clés de portée « projectlead » encore actives (ProjectLead n'en lit plus aucune).
-- Retour arrière : update api_keys set revoked_at = null where id = any(<ids listés par le select ci-dessous, gardés avant>);
begin;
select id, organization_id, prefix, created_at, last_used_at from api_keys where scope = 'projectlead' and revoked_at is null;
update api_keys set revoked_at = now() where scope = 'projectlead' and revoked_at is null;
-- Vérifier le nombre de lignes (10 entreprises TEST au 13.10.2026), puis : commit;  sinon : rollback;
