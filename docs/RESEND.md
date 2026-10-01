# Mise en place de l'envoi d'e-mails (Resend)

InvoiceLead envoie les factures, devis et avoirs par Resend (offre gratuite : 3000 e-mails par mois,
100 par jour). Sans cette configuration, l'application fonctionne mais ne propose que le lien de
consultation à copier.

## 1. Créer le compte et le domaine chez Resend

1. Ouvrir https://resend.com et créer un compte (ou se connecter).
2. Menu « Domains », « Add Domain », saisir `invoicelead.io`, région « EU (Ireland) ».
3. Resend affiche les enregistrements DNS à créer. En octobre 2026, pour invoicelead.io (région
   eu-west-1), ce sont : un TXT `resend._domainkey` (clé DKIM), un CNAME `send` vers
   `send.forge.rmta.net` et un CNAME `rsend` vers `rsend-euw1.forge.rmta.net`. S'y ajoute un TXT
   `_dmarc` avec `v=DMARC1; p=none;` (recommandé). Toujours recopier ce que Resend affiche, qui peut
   changer. Garder cette page ouverte.

## 2. Ajouter les enregistrements chez Porkbun

1. Ouvrir https://porkbun.com, « Domain Management », ligne `invoicelead.io`, bouton « DNS ».
2. Pour chaque ligne affichée par Resend, ajouter un enregistrement du même type, avec le même nom
   (sans `.invoicelead.io` à la fin, Porkbun l'ajoute) et la même valeur. Priorité du MX : celle indiquée.
3. Ne rien supprimer des enregistrements existants : le A vers Vercel et le CNAME `*` doivent rester
   (un nom explicite comme `send` passe avant le `*`).
4. Revenir sur Resend et cliquer « Verify DNS Records ». La vérification peut prendre quelques minutes.

## 3. Donner la clé à Vercel

1. Resend, menu « API Keys », « Create API Key », nom `invoicelead-production`, permission
   « Sending access », domaine `invoicelead.io`. Copier la clé (elle commence par `re_`).
2. Vercel, projet `invoice-lead`, « Settings », « Environment Variables » : ajouter
   `RESEND_API_KEY` avec cette clé, en type « Secret », pour Production et Preview.
3. Facultatif : `EMAIL_FROM` = `InvoiceLead <factures@invoicelead.io>` (c'est déjà la valeur par défaut).
4. Redéployer le dernier déploiement pour que la variable soit prise en compte.

La clé ne doit jamais être collée dans une conversation, un ticket ou le dépôt.

## Ce que voit le client

L'e-mail part de `"Nom de l'entreprise" <factures@invoicelead.io>`. Les réponses du client arrivent à
l'adresse e-mail saisie dans les réglages de l'entreprise. Le PDF est joint et un lien permet de
consulter la pièce en ligne sans compte.

## État

Mis en place le 1er octobre 2026 : domaine vérifié chez Resend, enregistrements ajoutés chez
Porkbun, `RESEND_API_KEY` dans Vercel, production redéployée. Reste à faire un premier envoi réel
depuis une facture émise et à vérifier qu'il arrive en boîte de réception.
