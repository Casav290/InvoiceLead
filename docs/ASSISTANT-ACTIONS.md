# Assistant IA : ce qu'il applique dans InvoiceLead

Cahier commun de la famille Lead du 27.10.2026 (« tout ce que l'assistant propose s'applique »), point
A1. Ce fichier recense **toutes les écritures qu'un membre peut faire dans l'interface** : chaque
action serveur (`"use server"`) et chaque route d'écriture appelée par un écran. Pour chacune, soit
l'outil de la bulle qui l'applique (`propose_…`), soit la raison pour laquelle l'assistant ne la fait
pas. Le contrôle `scripts/assistant-actions-gates.mjs G1` vérifie que rien ne manque.

## Comment une écriture s'applique

- L'outil `propose_<opération>` ne fait que **proposer** : l'opération est jouée dans une transaction
  aussitôt **annulée** (essai à blanc), avec les mêmes fonctions et les mêmes contrôles que l'écran ;
  la carte « À confirmer » montre ce que la base contiendrait. Rien n'est écrit.
- « Confirmer » envoie un jeton HMAC (personne, entreprise, 10 minutes, usage unique) à
  `/api/assistant/confirm`, qui relit les droits de chaque opération, consomme le jeton, puis joue
  l'opération dans une transaction **validée**. Un échec n'écrit rien.
- `propose_batch` regroupe jusqu'à **150 opérations** sous une seule carte, un seul clic et une seule
  transaction (tout ou rien). Une opération qui crée quelque chose porte une clé (`"key": "c1"`) ; une
  opération suivante la cite à la place d'un identifiant (`"contactId": "@c1"`, `productId` des
  lignes, `projectId`, `documentId`, `quoteId`, `invoiceId`, `billId`, `accountId`). La carte groupe
  les opérations par action (cinq lignes par groupe, « + N autres »).
- Les suites de l'écran partent **après** la validation, jamais d'un essai à blanc : états vers
  CRMlead (`src/server/pending-effects.ts`), comptabilisation et webhooks de l'entreprise après une
  émission.
- Droits : ceux de l'action serveur de l'écran (`requirePermission` : facturation, comptabilité, mise
  en place, entreprise ; les notes de frais : toute personne qui n'est pas en lecture seule ; la langue
  de l'interface : toute personne connectée, pour elle-même), le plan comptable du pays, et les
  fonctions de la formule (multidevise, décompte TVA, réglages des relances).
- Après « Confirmer », la bulle ouvre la page qui montre le résultat (ou rafraîchit la page ouverte si
  c'est déjà elle) et dit en une ligne ce qui a été enregistré.

## Légende de la colonne « Assistant »

- `propose_…` : appliqué depuis la conversation (carte « À confirmer »).
- **interdit : <catégorie>** : catégories du cahier (A7), inchangées : *supprimer*, *payer*,
  *formule et abonnement*, *membres et droits*, *clés API*, *envoyer à l'extérieur*. L'assistant
  l'explique et ouvre l'écran (`open_page`).
- **écran : fichier** : l'action part d'un fichier choisi sur l'appareil (photo, PDF, relevé
  bancaire, e-facture, logo) ; la conversation ne transporte pas de fichier. L'assistant ouvre
  l'écran ; une fois le fichier déposé, ce qui suit (lire, transformer en facture) a son outil.
- **écran : lien** : l'action arrive avec les données d'un lien d'une autre application (import depuis
  CRMlead) ; l'assistant n'a pas ces données.
- **écran : session** : la session de la personne (changer d'entreprise, se déconnecter), pas une
  donnée de l'entreprise.
- **lecture** : une question posée à une IA de lecture, sans changement de données.

## Contacts

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Contacts | Nouveau contact (client ou fournisseur) | `saveContact` | `propose_create_contact` |
| Contacts | Modifier un contact | `saveContact` | `propose_update_contact` |
| Contacts | Archiver un contact | `archiveContactAction` | interdit : supprimer (l'archivage retire le contact des listes) |

## Factures, devis et avoirs

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Factures, Devis | Nouveau brouillon de facture ou de devis | `saveInvoice` | `propose_create_invoice_draft` |
| Factures, Devis, Avoirs | Modifier un brouillon (lignes, textes, dates, client, devise) | `saveInvoice` | `propose_update_invoice_draft` |
| Pièce (brouillon) | Émettre (numéro définitif) | `issueInvoiceAction` | `propose_issue_document` (n'envoie rien) |
| Pièce (brouillon) | Supprimer le brouillon | `deleteDraftAction` | interdit : supprimer |
| Devis | Accepté, refusé | `quoteOutcomeAction` | `propose_set_quote_outcome` |
| Pièce (brouillon) | Détacher l'affaire CRMlead reprise d'un devis précédent | `detachCrmleadAction` | `propose_update_invoice_draft` (`detachCrmleadDeal`) |
| Devis | Facturer (devis en facture) | `convertQuoteAction` | `propose_convert_quote_to_invoice` |
| Devis | Facture d'acompte | `depositInvoiceAction` | `propose_create_deposit_invoice` |
| Facture émise | Créer un avoir | `createCreditNoteAction` | `propose_create_credit_note` |
| Facture émise | Enregistrer un paiement | `addPaymentAction` | interdit : payer |
| Facture émise | Supprimer un paiement | `deletePaymentAction` | interdit : payer |
| Pièce émise | Envoyer par e-mail | `sendDocumentAction` | interdit : envoyer à l'extérieur |
| Pièce émise | Lien de partage public | `shareLinkAction` | interdit : envoyer à l'extérieur |
| Facture émise | Rendre récurrente | `createRecurringAction` | `propose_create_recurring_invoice` (sans envoi automatique) |
| Facture émise | Rendre récurrente avec envoi automatique | `createRecurringAction` | interdit : envoyer à l'extérieur (l'envoi automatique se coche à l'écran) |
| Factures récurrentes | Mettre en pause, reprendre | `updateRecurringAction` | `propose_set_recurring_status` |
| Factures récurrentes | Supprimer une récurrence | `updateRecurringAction` | interdit : supprimer |
| Relances | Envoyer une relance (e-mail ou courrier noté) | `sendReminderAction` | interdit : envoyer à l'extérieur |
| Relances | Envoyer toutes les relances dues | `sendAllRemindersAction` | interdit : envoyer à l'extérieur |
| Relances | Réglages : frais, intérêt moratoire, couper l'envoi automatique | `saveReminderSettingsAction` | `propose_update_reminder_settings` |
| Relances | Réglages : activer l'envoi automatique des relances | `saveReminderSettingsAction` | interdit : envoyer à l'extérieur |
| Facture émise | Renoncer aux frais et intérêts de relance | `waiveChargesAction` | `propose_waive_reminder_charges` |

## Articles

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Articles | Nouvel article ou service | `saveProduct` | `propose_create_product` |
| Articles | Modifier un article | `saveProduct` | `propose_update_product` |
| Articles | Archiver un article | `archiveProductAction` | interdit : supprimer |

## Temps et projets

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Temps | Démarrer le chrono | `startTimerAction` | `propose_start_timer` |
| Temps | Arrêter le chrono | `stopTimerAction` | `propose_stop_timer` |
| Temps | Saisir du temps | `addEntryAction` | `propose_create_time_entry` |
| Temps | Supprimer une saisie | `deleteEntryAction` | interdit : supprimer |
| Projets | Nouveau projet | `saveProjectAction` | `propose_create_project` |
| Projets | Modifier un projet | `saveProjectAction` | `propose_update_project` |
| Projet | Réactiver un projet archivé | `archiveProjectAction` | `propose_update_project` (`reactivate`) |
| Projet | Archiver un projet | `archiveProjectAction` | interdit : supprimer |
| Projet | Facturer le temps non facturé | `invoiceProjectAction` | `propose_invoice_project_time` |

## Notes de frais

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Notes de frais | Note de frais ou indemnité kilométrique | `createClaimAction` | `propose_create_expense_claim` (sans photo) |
| Notes de frais | Scanner un ticket (photo lue par l'IA) | `scanTicketAction` | écran : fichier |
| Notes de frais | Supprimer une note de frais | `deleteClaimAction` | interdit : supprimer |

## Comptabilité

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Comptabilité | Comptabiliser les pièces en attente | `postPendingAction` | `propose_post_pending_entries` |
| Banque | Importer un relevé bancaire (camt) | `importStatementAction` | écran : fichier |
| Banque | Proposer les écritures (IA, pilote automatique) | `proposeAction` | interdit : payer (rapprochement bancaire) |
| Banque | Valider une ligne bancaire | `validateBankAction` | interdit : payer (rapprochement bancaire) |
| Banque | Valider les lignes sûres | `validateConfidentAction` | interdit : payer (rapprochement bancaire) |
| Banque | Ignorer une ligne bancaire | `ignoreBankAction` | interdit : payer (rapprochement bancaire) |
| Banque | Supprimer une règle de comptabilisation | `deleteRuleAction` | interdit : supprimer |
| Justificatifs | Déposer des justificatifs | `uploadReceiptsAction` | écran : fichier |
| Justificatifs | Lire ou relire un justificatif (IA) | `readReceiptAction` | `propose_read_receipt` (pas dans un lot) |
| TVA | Valider le décompte d'une période | `validateVatAction` | `propose_validate_vat_return` |
| TVA | Relecture du décompte par l'IA | `reviewVatAction` | lecture |
| À relire | Activer ou couper le pilote automatique | `autopilotAction` | interdit : payer (il valide lui-même les paiements de la banque) |
| À relire | Approuver les écritures automatiques | `approveReviewAction` | interdit : payer (rapprochement bancaire) |
| À relire | Annuler une écriture automatique | `undoAutoAction` | interdit : payer (retire le paiement enregistré) |
| Ancienne page Assistant | Poser une question comptable | `askAction` | lecture |

## Factures fournisseurs

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Factures fournisseurs | Nouvelle facture fournisseur | `saveBillAction` | `propose_create_supplier_bill` |
| Factures fournisseurs | Modifier un brouillon | `saveBillAction` | `propose_update_supplier_bill` |
| Facture fournisseur | Approuver (comptabiliser) | `approveBillAction` | `propose_approve_supplier_bill` |
| Facture fournisseur | Supprimer | `deleteBillAction` | interdit : supprimer |
| Facture fournisseur reçue par la plateforme | Refuser, avec motif | `refuseBillAction` | interdit : envoyer à l'extérieur (le refus part à la plateforme et au fournisseur) |
| Facture fournisseur | Marquer payée | `markBillPaidAction` | interdit : payer |
| Factures fournisseurs | Importer des e-factures (XML, PDF) | `importEInvoicesAction` | écran : fichier |
| Justificatifs | Facture fournisseur depuis un justificatif lu | `billFromReceiptAction` | `propose_create_bill_from_receipt` |
| Factures fournisseurs | Prendre en photo | `billFromPhotoAction` | écran : fichier |
| Factures fournisseurs | Double validation | `dualApprovalAction` | interdit : membres et droits (qui doit approuver) |

## Réglages

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Entreprise | Coordonnées, formes, numéros de TVA, IBAN, début de l'exercice, pays | `saveCompany` | `propose_update_company_settings` |
| Entreprise | Déposer le logo | `uploadLogoAction` | écran : fichier |
| Entreprise | Retirer le logo | `removeLogoAction` | interdit : supprimer |
| Plan comptable | Nouveau compte | `saveAccount` | `propose_create_account` |
| Plan comptable | Modifier un compte | `saveAccount` | `propose_update_account` |
| Plan comptable | Installer le plan comptable type | `installChartAction` | `propose_install_chart` |
| Exercices | Ouvrir le premier exercice | `openFirstFiscalYearAction` | `propose_open_first_fiscal_year` |
| Exercices | Ouvrir l'exercice suivant | `openNextFiscalYearAction` | `propose_open_next_fiscal_year` |
| Exercices | Clôturer un exercice | `closeFiscalYearAction` | `propose_close_fiscal_year` |
| Facturation électronique | S'inscrire à l'annuaire de la plateforme | `registerReceptionAction` | interdit : envoyer à l'extérieur |
| Facturation électronique | Relever maintenant | `syncReceptionAction` | interdit : envoyer à l'extérieur (échange avec la plateforme) |
| Paiements en ligne | Relier Stripe | `/api/stripe/connect` | interdit : payer |
| Paiements en ligne | Déconnecter Stripe | `disconnectStripeAction` | interdit : payer |
| API | Créer une clé d'API | `createApiKeyAction` | interdit : clés API |
| API | Révoquer une clé d'API | `revokeApiKeyAction` | interdit : clés API |
| API | Ajouter un webhook | `createWebhookAction` | interdit : clés API (secret de signature) |
| API | Désactiver un webhook | `disableWebhookAction` | interdit : clés API |
| Équipe | Rôle d'une personne dans InvoiceLead | `setAppRoleAction` | interdit : membres et droits |
| Équipe | Inviter la fiduciaire | `inviteFiduciaryAction` | interdit : membres et droits |
| Équipe | Inviter une personne | `inviteMemberAction` | interdit : membres et droits |
| Équipe | Retirer la fiduciaire | `removeFiduciaryAction` | interdit : membres et droits |
| Équipe | Annuler une invitation | `cancelInvitationAction` | interdit : membres et droits |
| Équipe | Retirer une personne | `removeMemberAction` | interdit : membres et droits |
| Équipe | Rétablir une personne | `restoreMemberAction` | interdit : membres et droits |
| Invitation | Accepter une invitation | `acceptInvitationAction` | interdit : membres et droits |
| Formule | Passer à Pro ou Pro+ | `/api/billing/checkout` | interdit : formule et abonnement |
| Formule | Gérer l'abonnement | `/api/billing/portal` | interdit : formule et abonnement |

## Ailleurs dans l'application

| Écran | Action dans l'interface | Fonction serveur | Assistant |
|---|---|---|---|
| Avis | Envoyer un avis (copie par e-mail) | `sendFeedbackAction` | interdit : envoyer à l'extérieur |
| Import CRMlead | Importer le client ou la pièce d'un lien CRMlead | `importCrmleadAction` | écran : lien |
| Menu | Choisir la langue de l'interface (la sienne) | `chooseLocaleAction` | `propose_set_interface_language` (pas dans un lot) |
| Menu | Changer d'entreprise | `switchOrgAction` | écran : session |
| Menu | Se déconnecter | `/auth/lead/logout` | écran : session |

## Plusieurs changements à la fois

| Demande | Assistant |
|---|---|
| Plusieurs contacts, articles, saisies ; un nouveau client et son devis ; un projet et ses saisies ; toute combinaison des opérations ci-dessus (sauf la lecture d'un justificatif) | `propose_batch` |
