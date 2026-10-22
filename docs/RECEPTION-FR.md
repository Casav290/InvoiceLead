# Réception des factures électroniques en France

Depuis le 1er septembre 2026, toute entreprise française doit pouvoir recevoir ses factures électroniques par une plateforme agréée par la DGFiP. InvoiceLead passe par **B2Brouter** (plateforme agréée, API publique : docs.b2brouter.net).

## Ce que fait InvoiceLead

1. **Inscription** (Réglages → Factures reçues, administrateur, accord coché) : un compte est créé chez B2Brouter au nom de l'entreprise (SIREN tiré du SIRET, schéma 0002 ; TVA intracommunautaire, schéma 9957), puis inscrit à l'annuaire en **réception seule** (`annuaire_only`). L'annuaire s'active la nuit suivante. Un SIREN déjà inscrit ailleurs demande le code de transfert de l'ancienne plateforme.
2. **Relevé** : à l'ouverture des factures fournisseurs (au plus tous les quarts d'heure, après l'affichage), par le bouton « Relever maintenant » et par la tâche quotidienne. Chaque facture reçue est téléchargée dans son format d'origine (Factur-X, CII, UBL), archivée comme justificatif et devient une facture à payer en brouillon (`supplier_bills.platform_ref`). Une pièce illisible sans IA (avoir, PDF sans XML) reste un justificatif à lire. Chaque facture est ensuite acquittée (`/ack`) et ne revient plus.
3. **Décisions** : approuvée → `accepted`, payée → `paid`, refusée avec motif → `refused` (`/mark_as`), chacune une seule fois (`supplier_bills.platform_state`).

Code : `src/server/einvoicing/` ; tests : `tests/unit/pa-reception.test.ts` (faux serveur).

## Mise en service (geste d'Ève)

1. Ouvrir un compte B2Brouter pour InvoiceLead (contrat éditeur, offre avec création de comptes par l'API, « eDocSync »).
2. Dans le bac à sable (Developers → Create Sandbox), créer une clé `test_…` et faire l'aller-retour : inscription d'une entreprise de test, factures reçues.
3. Mettre la clé de production dans Vercel : `B2BROUTER_API_KEY` (et `B2BROUTER_API_URL` si B2Brouter donne une autre adresse). Sans clé, la page dit « ouvre bientôt » et rien n'est relevé.

## Limites connues

- **Réception seule.** En mode `annuaire_only`, B2Brouter n'envoie ni rapports à la DGFiP ni statuts de cycle de vie (CDAR) : le refus est noté chez la plateforme, mais il faut aussi prévenir le fournisseur.
- **Émission et e-reporting** pas encore branchés : obligatoires pour les PME et micro-entreprises au 1er septembre 2027 (grandes entreprises et ETI depuis le 1er septembre 2026). Les factures émises restent en Factur-X par e-mail.
- Pas de webhook de réception chez B2Brouter : le relevé est périodique.
