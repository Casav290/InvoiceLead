# Mise en place de l'envoi d'e-mails (Resend)

InvoiceLead envoie les factures, devis et avoirs par Resend (offre gratuite : 3000 e-mails par mois,
100 par jour). Sans cette configuration, l'application fonctionne mais ne propose que le lien de
consultation à copier.

## 1. Créer le compte et le domaine chez Resend

1. Ouvrir https://resend.com et créer un compte (ou se connecter).
2. Menu « Domains », « Add Domain », saisir `invoicelead.io`, région « EU (Ireland) ».
3. Resend affiche des enregistrements DNS à créer (en général un TXT « resend._domainkey », un MX et un
   TXT SPF sur le sous-domaine `send`). Garder cette page ouverte.

## 2. Ajouter les enregistrements chez Porkbun

1. Ouvrir https://porkbun.com, « Domain Management », ligne `invoicelead.io`, bouton « DNS ».
2. Pour chaque ligne affichée par Resend, ajouter un enregistrement du même type, avec le même nom
   (sans `.invoicelead.io` à la fin, Porkbun l'ajoute) et la même valeur. Priorité du MX : celle indiquée.
3. Ne rien supprimer des enregistrements existants (ceux de Vercel doivent rester).
4. Revenir sur Resend et cliquer « Verify DNS Records ». La vérification peut prendre quelques minutes.

## 3. Donner la clé à Vercel

1. Resend, menu « API Keys », « Create API Key », nom `invoicelead-production`, permission
   « Sending access », domaine `invoicelead.io`. Copier la clé (elle commence par `re_`).
2. Vercel, projet `invoice-lead`, « Settings », « Environment Variables » : ajouter
   `RESEND_API_KEY` avec cette clé, pour Production et Preview.
3. Facultatif : `EMAIL_FROM` = `InvoiceLead <factures@invoicelead.io>` (c'est déjà la valeur par défaut).
4. Redéployer le dernier déploiement pour que la variable soit prise en compte.

La clé ne doit jamais être collée dans une conversation, un ticket ou le dépôt.

## Ce que voit le client

L'e-mail part de `"Nom de l'entreprise" <factures@invoicelead.io>`. Les réponses du client arrivent à
l'adresse e-mail saisie dans les réglages de l'entreprise. Le PDF est joint et un lien permet de
consulter la pièce en ligne sans compte.
