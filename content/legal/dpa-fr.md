# Accord de sous-traitance (DPA) InvoiceLead

Version du 30 septembre 2026.

## 1. Parties et objet

Le présent accord complète les conditions générales d'InvoiceLead. Il s'applique lorsque l'Utilisateur (« le Client », responsable du traitement) traite dans InvoiceLead des données personnelles de tiers, notamment ses clients, fournisseurs et contacts. Quantum Liquid LLC, 30 N Gould St, Sheridan, WY 82801, États-Unis, agit comme sous-traitant (« le Sous-traitant »), au sens de l'art. 28 RGPD et de l'art. 9 nLPD.

## 2. Traitement

- Finalité : établir des devis et factures, suivre les paiements, tenir la comptabilité et la TVA du Client.
- Données : nom, adresse, coordonnées, numéros IDE/TVA, montants, historique des pièces et des paiements, notes saisies par le Client.
- Personnes concernées : clients, prospects, fournisseurs et contacts du Client.
- Durée : celle de l'utilisation du Service, augmentée des délais de restitution et de suppression.

## 3. Obligations du Sous-traitant

Le Sous-traitant traite les données uniquement sur instruction documentée du Client (conditions, réglages, utilisation de l'interface, demandes écrites) ; soumet son personnel à la confidentialité ; applique les mesures de sécurité de l'annexe ; assiste le Client pour les demandes des personnes concernées et les obligations de sécurité ; notifie toute violation de données dans les 72 heures après en avoir eu connaissance ; met à disposition les informations nécessaires pour démontrer le respect du présent accord.

## 4. Sous-traitants ultérieurs

Le Client autorise les sous-traitants ultérieurs listés en annexe. Tout ajout ou remplacement est annoncé 30 jours à l'avance ; le Client peut s'y opposer pour un motif légitime et, à défaut de solution, résilier.

## 5. Transferts

Les données sont hébergées aux États-Unis. Les transferts reposent sur le Swiss-U.S. et l'EU-U.S. Data Privacy Framework lorsque le prestataire y adhère, à défaut sur les clauses contractuelles types de la Commission européenne (décision 2021/914), adaptées au droit suisse et incorporées par référence.

## 6. Audit

Une fois par an, sur préavis de 30 jours et à ses frais, le Client peut vérifier le respect du présent accord, en priorité sur la base des rapports et certifications disponibles.

## 7. Fin du traitement

À la clôture du compte, les données restent exportables 30 jours, puis sont supprimées, sauvegardes comprises dans un délai supplémentaire de 30 jours. Une attestation de suppression est fournie sur demande.

---

## Annexe I : sous-traitants ultérieurs

| Sous-traitant | Rôle | Localisation |
|---|---|---|
| Vercel Inc. | Hébergement de l'application | États-Unis (Cleveland, Ohio) |
| Neon (Databricks, Inc.) | Base de données | États-Unis (AWS us-east-2, Ohio) |

## Annexe II : mesures de sécurité

- Chiffrement en transit (TLS) et au repos.
- Séparation stricte des données par organisation, vérifiée à chaque requête.
- Connexion par le Compte Lead (PKCE, jetons signés vérifiés), sessions courtes stockées sous forme d'empreinte.
- Pièces comptables figées après émission, corrections par écriture inverse, journal d'audit.
- Sauvegardes et restauration à un instant donné de la base.
- Revue de code et tests automatisés avant toute mise en production.
