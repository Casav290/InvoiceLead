# Stockage des justificatifs (Neon Object Storage)

Les justificatifs (factures fournisseurs, tickets) sont gardés dans le bucket privé `receipts` du
projet Neon, déclaré dans `neon.ts`. Tant que le stockage n'est pas configuré, l'application les garde
dans la base Postgres : tout fonctionne, mais la base grossit plus vite.

## À faire une fois (session sur le Mac)

1. Dans le dossier du dépôt, sur la branche `production` du projet Neon :
   `neon link --project-id tiny-shape-39858234 --branch production -y` puis `neon deploy`.
   Cela crée le bucket `receipts` et écrit ses identifiants dans `.env.local` (fichier jamais commité).
2. Dans Vercel, projet `invoice-lead`, « Settings », « Environment Variables », pour Production :
   ajouter `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` et `AWS_REGION` avec les
   valeurs de `.env.local`.
3. Redéployer le dernier déploiement.

Ces identifiants ne doivent jamais être collés dans une conversation, un ticket ou le dépôt.

Les fichiers déjà gardés en base y restent lisibles ; seuls les nouveaux partent dans le bucket.
