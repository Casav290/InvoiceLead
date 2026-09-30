# Paiement en ligne avec Stripe Connect

Les clients d'une entreprise paient une facture depuis son lien de consultation, par carte, TWINT (Suisse), SEPA ou ACH, selon ce que le compte Stripe de l'entreprise accepte. L'argent va directement sur ce compte : InvoiceLead ne touche jamais les fonds, il est seulement la plateforme qui ouvre la session de paiement et reçoit la confirmation.

## Mise en place (une fois, par Ève)

1. Dans le tableau de bord Stripe d'InvoiceLead, activer Connect et choisir les comptes « Standard ». Dans Connect, onglet des réglages OAuth, ajouter l'adresse de retour `https://invoicelead.io/api/stripe/callback` et noter le client ID (`ca_…`).
2. Créer un point de terminaison de webhook vers `https://invoicelead.io/api/stripe/webhook`, en cochant « Événements sur les comptes connectés », avec l'événement `checkout.session.completed`. Noter son secret de signature (`whsec_…`).
3. Dans Vercel, ajouter `STRIPE_SECRET_KEY` (clé secrète `sk_live_…`), `STRIPE_CONNECT_CLIENT_ID` et `STRIPE_WEBHOOK_SECRET`, puis redéployer.

Pour un essai, les mêmes étapes en mode test (`sk_test_…`) avec un compte connecté de test.

## Côté entreprise

Réglages, onglet « Paiement en ligne », bouton « Relier mon compte Stripe ». Une fois relié, le lien de chaque facture ouverte montre « Payer en ligne ». Le paiement confirmé par Stripe est enregistré sur la facture (moyen « en ligne »), une seule fois même si Stripe renvoie la notification.

## Comptabilité

Le paiement est comptabilisé sur le compte d'attente du prestataire (1091 en Suisse, 1460 en Allemagne, 517000 en France, 1250 au Royaume-Uni, 1020 aux États-Unis), créé au besoin. Le versement de Stripe sur la banque, importé avec le relevé, solde ce compte ; ce qui reste correspond aux frais Stripe, à passer en frais bancaires.
