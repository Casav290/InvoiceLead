import type { Guide } from "./types";

/**
 * Pages mots-clés en français. Faits repris de messages/fr.json, docs/PAYS.md, docs/XRECHNUNG.md,
 * docs/ASSISTANT-ACTIONS.md et src/server/plans.ts.
 */
export const GUIDES_FR: Guide[] = [
  {
    slug: "logiciel-facturation-gratuit",
    lang: "fr",
    group: "free",
    keyword: "logiciel de facturation gratuit",
    source: "Google Suggest fr-FR, 04.11.2026",
    title: "Logiciel de facturation gratuit, sans carte",
    description:
      "Logiciel de facturation gratuit : 5 factures par mois, devis illimités, comptabilité et assistant IA. Sans carte bancaire, sans limite de durée.",
    eyebrow: "Formule gratuite",
    h1: "Un logiciel de facturation gratuit, avec ses vraies limites",
    lede: "InvoiceLead se prend gratuitement, sans carte bancaire et sans limite de durée. Voici exactement ce que contient la formule gratuite, et ce qui demande la formule Pro.",
    linkLabel: "Facturation gratuite",
    shot: "invoice-pdf",
    shotAlt: "Facture en PDF créée avec InvoiceLead, avec son GiroCode de virement SEPA",
    sections: [
      {
        h2: "Ce que contient la formule gratuite",
        paras: [
          "La formule gratuite coûte 0 €. Elle ne demande aucune carte bancaire et ne s'arrête pas au bout de quelques semaines. Elle compte un utilisateur et une entreprise.",
          "Les allocations sont mensuelles. Une fois atteintes, vos données restent là : la limite ne vaut que pour les nouvelles actions.",
        ],
        bullets: [
          "5 factures par mois, devis illimités",
          "50 contacts",
          "10 tickets et justificatifs lus par l'IA chaque mois, e-factures reçues sans limite",
          "Assistant IA : l'équivalent de 10 demandes par mois",
          "Première relance à la main, 5 par mois",
          "1 facture récurrente active",
          "1 relevé bancaire par mois (un compte, un mois au plus), avec le pilote automatique",
          "Mention « Créé avec InvoiceLead » sur vos documents",
        ],
      },
      {
        h2: "Des factures conformes à votre pays",
        paras: [
          "InvoiceLead sert cinq pays : États-Unis, Royaume-Uni, Allemagne, France et Suisse. Chaque facture reprend les taux, les numéros et les mentions du pays de votre entreprise.",
          "En France : TVA à 20 %, 10 % et 5,5 %, SIRET contrôlé, GiroCode pour le virement SEPA et PDF Factur-X. Les pénalités de retard et l'indemnité forfaitaire de 40 € figurent sur le PDF. Vos documents peuvent partir en allemand, français, anglais, italien ou espagnol, choisis pour chaque client.",
        ],
      },
      {
        h2: "La comptabilité se remplit dès le gratuit",
        paras: [
          "Vos factures et vos paiements créent les écritures d'une comptabilité en partie double, sur le plan comptable de votre pays (PCG en France). Le bilan et le compte de résultat sont disponibles sans payer.",
          "Le tableau de bord montre le chiffre d'affaires du mois et de l'année, l'encours, les retards et vos douze derniers mois en graphique.",
        ],
      },
      {
        h2: "Un assistant IA qui propose, vous confirmez",
        paras: [
          "L'Assistant IA intégré répond à vos questions à partir de vos livres : qui vous doit de l'argent, ce que vous avez facturé ce trimestre, quel devis attend une réponse.",
          "Il peut aussi proposer des changements : un brouillon de devis ou de facture, des contacts, des articles, du temps, des notes de frais ou des factures fournisseurs. Tout s'affiche sur une carte « À confirmer » qui montre ce qui sera écrit. Rien n'est enregistré sans votre clic sur « Confirmer ». Une carte peut regrouper jusqu'à 150 opérations, appliquées en un clic, tout ou rien.",
          "Il ne supprime rien, ne paie rien et n'envoie rien à l'extérieur : il ouvre l'écran pour que vous le fassiez. Gratuit : l'équivalent de 10 demandes par mois. Pro : sans limite.",
        ],
      },
      {
        h2: "Pensé aussi pour les indépendants",
        paras: [
          "La formule gratuite convient à un indépendant qui facture quelques clients par mois. En France, la franchise en base de TVA est gérée : la mention « TVA non applicable, art. 293 B du CGI » s'imprime sur la facture.",
          "Les fonctions Pro restent visibles en gris, avec leur marque. Vous savez ce qu'elles font avant de décider de payer.",
        ],
      },
      {
        h2: "Quand passer à la formule Pro",
        paras: [
          "Pro coûte 19 € par mois hors TVA, ou 190 € par an. Elle ouvre les factures et contacts illimités, l'accès gratuit pour votre expert-comptable, 50 pièces lues par mois, l'assistant sans limite, les relances automatiques sur trois niveaux et la déclaration CA3 préparée. Elle est facturée en euros par Quantum Liquid LLC et se résilie à tout moment.",
        ],
      },
    ],
    faq: [
      {
        q: "Le logiciel est-il vraiment gratuit sans limite de durée ?",
        a: "Oui. La formule gratuite n'a pas de date de fin et ne demande aucune carte bancaire. Ses limites sont mensuelles : 5 factures, 10 pièces lues par l'IA, l'équivalent de 10 demandes à l'assistant.",
      },
      {
        q: "Que se passe-t-il quand j'atteins 5 factures dans le mois ?",
        a: "Vous pouvez encore créer des devis, sans limite. La facture suivante attend le mois prochain ou le passage à Pro. Les factures déjà émises restent consultables.",
      },
      {
        q: "Faut-il installer une application ?",
        a: "Non. InvoiceLead s'ouvre dans le navigateur. Sur le téléphone, vous l'ajoutez à l'écran d'accueil pour photographier vos tickets, sans application à installer.",
      },
      {
        q: "Comment créer mon compte ?",
        a: "Avec Google, Apple ou votre adresse e-mail, par le Compte Lead (ERPlead). Le même compte ouvre aussi ScanLead, CRMlead, ProjectLead et Greetlead ; chaque application a son propre abonnement.",
      },
      {
        q: "Puis-je récupérer mes données ?",
        a: "Oui, à tout moment, et pendant 30 jours après une résiliation. Les données sont hébergées aux États-Unis (Vercel et Neon, Ohio), chiffrées en transit et au repos.",
      },
    ],
    related: [
      "logiciel-facturation-auto-entrepreneur",
      "logiciel-devis-facture",
      "logiciel-factur-x",
    ],
  },
  {
    slug: "logiciel-facturation-auto-entrepreneur",
    lang: "fr",
    group: "independent",
    keyword: "logiciel facturation auto entrepreneur",
    source: "Google Suggest fr-FR, 04.11.2026 (aussi « … sans tva »)",
    title: "Logiciel facturation auto-entrepreneur gratuit",
    description:
      "Logiciel facturation auto-entrepreneur : franchise en base (art. 293 B), SIRET contrôlé, devis illimités et 5 factures par mois gratuites, sans carte.",
    eyebrow: "Micro-entreprise",
    h1: "Le logiciel facturation auto-entrepreneur, franchise en base comprise",
    lede: "Vous êtes auto-entrepreneur et vous facturez sans TVA ? InvoiceLead imprime la bonne mention, contrôle votre SIRET et tient votre comptabilité, dès la formule gratuite.",
    linkLabel: "Facturer en auto-entrepreneur",
    shot: "quote-desktop",
    shotAlt: "Devis en cours pour un client dans InvoiceLead",
    sections: [
      {
        h2: "Facturer sans TVA, avec la bonne mention",
        paras: [
          "En franchise en base de TVA, votre facture ne porte pas de TVA et doit le dire. InvoiceLead gère ce régime : la mention « TVA non applicable, art. 293 B du CGI » s'imprime sur vos factures.",
          "Si votre entreprise est redevable de la TVA, ce sont les taux français (20 %, 10 % et 5,5 %) qui s'appliquent à vos lignes.",
        ],
      },
      {
        h2: "Les mentions françaises, sans y penser",
        paras: [
          "Votre SIRET est contrôlé à la saisie et figure sur chaque facture, avec votre numéro de TVA intracommunautaire s'il existe. Le PDF ajoute les pénalités de retard et l'indemnité forfaitaire de 40 € pour frais de recouvrement.",
        ],
        bullets: [
          "GiroCode pour que votre client paie par virement SEPA en scannant",
          "PDF Factur-X (profil EN 16931), lisible comme un PDF ordinaire par tous vos clients",
          "Documents en français, anglais, allemand, italien ou espagnol, selon le client",
        ],
      },
      {
        h2: "Du devis à l'encaissement",
        paras: [
          "Vos devis sont numérotés et valables 30 jours. Quand le client accepte, la date est notée et le devis devient facture en un clic, sans rien ressaisir. Un avoir corrige une facture émise. Vos clients, vos articles et vos tarifs sont enregistrés une fois, et le devis suivant se prépare en quelques lignes.",
          "Si vous facturez au temps passé, comme beaucoup de graphistes, développeurs ou consultants, le chrono ou la saisie rapide par projet garde vos heures ; les heures facturables passent sur la facture en un clic.",
        ],
      },
      {
        h2: "L'Assistant IA, pour gagner du temps",
        paras: [
          "Demandez à l'Assistant IA ce que vous avez encaissé ce mois-ci ou quels clients sont en retard : il répond à partir de vos livres.",
          "Demandez-lui un brouillon de devis, un nouveau contact ou une note de frais : il prépare une carte « À confirmer » qui montre tout ce qui sera écrit. Rien n'est enregistré avant votre clic sur « Confirmer ». Une carte peut grouper jusqu'à 150 opérations, appliquées en une fois, tout ou rien. Il ne supprime rien, ne paie rien, n'envoie rien à l'extérieur : il ouvre l'écran à la place.",
          "Formule gratuite : l'équivalent de 10 demandes par mois. Pro : sans limite.",
        ],
      },
      {
        h2: "Gratuit pour démarrer",
        paras: [
          "La formule gratuite est faite pour un indépendant qui démarre : 1 utilisateur, 5 factures par mois, devis illimités, 50 contacts, 10 tickets lus par l'IA, une première relance à la main (5 par mois) et 1 facture récurrente active. Pas de carte bancaire, pas de limite de durée. Vos documents portent la mention « Créé avec InvoiceLead ».",
          "Votre comptabilité en partie double se remplit avec vos factures, sur le plan comptable français (PCG). Le tableau de bord vous montre le chiffre d'affaires du mois et de l'année, l'encours et les retards.",
        ],
      },
      {
        h2: "Et si votre activité grandit",
        paras: [
          "La formule Pro, à 19 € par mois hors TVA, retire les limites de factures et de contacts, ouvre l'accès gratuit pour votre expert-comptable et envoie les relances seule chaque matin. InvoiceLead sert aussi les PME, en France comme au Royaume-Uni, en Allemagne, en Suisse et aux États-Unis.",
        ],
      },
    ],
    faq: [
      {
        q: "Puis-je faire une facture sans TVA ?",
        a: "Oui. En franchise en base, vos factures ne portent pas de TVA et affichent « TVA non applicable, art. 293 B du CGI ».",
      },
      {
        q: "Mon SIRET apparaît-il sur les factures ?",
        a: "Oui. Il est contrôlé à la saisie et imprimé sur chaque facture, avec votre numéro de TVA intracommunautaire si vous en avez un.",
      },
      {
        q: "Combien de factures puis-je faire gratuitement ?",
        a: "5 par mois, avec des devis illimités. La formule Pro, à 19 € par mois hors TVA, rend les factures illimitées.",
      },
      {
        q: "Est-ce que je peux photographier mes tickets ?",
        a: "Oui. Depuis l'écran d'accueil du téléphone, sans application à installer. L'IA lit le montant, la date, la TVA et le fournisseur ; 10 lectures par mois sont comprises dans la formule gratuite.",
      },
      {
        q: "Mon expert-comptable peut-il accéder à ma comptabilité ?",
        a: "Oui, avec la formule Pro : il y accède gratuitement, en plus de votre utilisateur. Dans la formule gratuite, vous pouvez exporter vos données à tout moment.",
      },
    ],
    related: [
      "logiciel-facturation-gratuit",
      "logiciel-devis-facture",
      "application-note-de-frais",
      "logiciel-relance-facture",
    ],
  },
  {
    slug: "application-note-de-frais",
    lang: "fr",
    group: "receipts",
    keyword: "application note de frais",
    source: "Google Suggest fr-FR, 04.11.2026",
    title: "Application note de frais : le ticket en photo",
    description:
      "Application note de frais : photographiez le ticket, l'IA lit montant, date et TVA, la photo reste en justificatif. 10 lectures gratuites par mois.",
    eyebrow: "Notes de frais",
    h1: "Une application note de frais qui lit vos tickets",
    lede: "Photographiez le ticket depuis votre téléphone : l'IA lit le montant, la date et la TVA, puis propose le compte. Vous validez, la note de frais est faite.",
    linkLabel: "Notes de frais en photo",
    shot: "capture-mobile",
    shotAlt: "Ticket photographié sur un téléphone et lu par l'IA d'InvoiceLead",
    sections: [
      {
        h2: "Trois gestes pour une note de frais",
        paras: [
          "Sur le chantier, en déplacement ou au restaurant, ouvrez InvoiceLead sur votre téléphone. Vous l'avez ajouté à l'écran d'accueil : il n'y a pas d'application à installer depuis un store. La lecture prend quelques secondes, et vous corrigez une valeur si besoin avant de valider.",
        ],
        bullets: [
          "Photographiez le ticket",
          "L'IA lit le montant, le taux de TVA, la date et le fournisseur, et propose le compte",
          "Vous validez : la dépense est comptabilisée, la photo reste attachée en justificatif",
        ],
      },
      {
        h2: "La TVA récupérable, au bon endroit",
        paras: [
          "La TVA lue sur le ticket passe dans votre comptabilité en partie double. En France, elle alimente la déclaration CA3 que la formule Pro prépare ; au Royaume-Uni, en Allemagne et en Suisse, la déclaration du pays. Les chiffres sont prêts à reporter, le dépôt reste de votre côté.",
          "Plus besoin de garder une boîte de tickets froissés : le justificatif est rangé avec l'écriture qu'il prouve, et votre expert-comptable le retrouve avec elle.",
        ],
      },
      {
        h2: "Les factures fournisseurs aussi",
        paras: [
          "La même lecture marche pour les factures de vos fournisseurs, en photo ou en PDF. Les e-factures reçues se lisent sans IA et sans limite. Les échéances sont visibles avant qu'elles ne tombent, et InvoiceLead prépare un ordre de paiement pain.001 (SEPA ou Suisse) à remettre à votre banque.",
        ],
      },
      {
        h2: "Demandez à l'Assistant IA",
        paras: [
          "L'Assistant IA intégré répond à partir de vos livres : combien de frais de déplacement ce trimestre, quelle facture fournisseur arrive à échéance.",
          "Il peut aussi proposer des changements : une note de frais, une facture fournisseur, un contact, un brouillon de devis ou de facture. La carte « À confirmer » montre tout ce qui sera écrit, et rien n'est enregistré sans votre clic sur « Confirmer ». Jusqu'à 150 opérations tiennent sur une carte, appliquées en un clic, tout ou rien.",
          "La photo, elle, se prend à l'écran : l'assistant ne transporte pas de fichier. Il ne supprime rien, ne paie rien et n'envoie rien à l'extérieur. Gratuit : l'équivalent de 10 demandes par mois ; Pro : sans limite.",
        ],
      },
      {
        h2: "Gratuit, pour un indépendant comme pour une équipe",
        paras: [
          "La formule gratuite comprend 10 tickets et justificatifs lus par l'IA chaque mois, sans carte bancaire et sans limite de durée. Elle compte aussi 5 factures par mois, des devis illimités, 50 contacts et l'assistant IA.",
          "La formule Pro (19 € par mois hors TVA) passe à 50 lectures par mois et donne un accès gratuit à votre expert-comptable. Pro+ (39 € par mois) en compte 300, pour 5 utilisateurs avec rôles : chaque membre de l'équipe photographie ses propres tickets.",
        ],
      },
      {
        h2: "Rapproché avec la banque",
        paras: [
          "Une dépense payée par carte ou par virement apparaît sur votre relevé. Importez le relevé camt.053, le format ISO 20022 des banques européennes : chaque mouvement est proposé face à la bonne pièce, et le pilote automatique valide les cas sûrs.",
          "La formule gratuite permet 1 relevé par mois (un compte, un mois au plus). Avec Pro, l'import camt est sans limite et le pilote vous envoie un récapitulatif le lundi.",
        ],
      },
    ],
    faq: [
      {
        q: "Faut-il télécharger une application ?",
        a: "Non. InvoiceLead s'ouvre dans le navigateur du téléphone. Ajoutez-le à l'écran d'accueil et photographiez vos tickets, sans rien installer.",
      },
      {
        q: "Combien de tickets puis-je faire lire gratuitement ?",
        a: "10 par mois dans la formule gratuite, tickets et justificatifs confondus. 50 avec Pro, 300 avec Pro+. Les e-factures reçues ne comptent pas.",
      },
      {
        q: "Que lit l'IA sur le ticket ?",
        a: "Le montant, la date, le taux de TVA et le fournisseur. Elle propose aussi le compte de charge. Vous vérifiez avant de valider.",
      },
      {
        q: "Dans quels pays l'application fonctionne-t-elle ?",
        a: "Aux États-Unis, au Royaume-Uni, en Allemagne, en France et en Suisse, avec la TVA, la VAT ou la sales tax et le plan comptable de chaque pays.",
      },
      {
        q: "Mes notes de frais vont-elles dans la comptabilité ?",
        a: "Oui. Chaque dépense validée crée son écriture en partie double, sur le plan comptable de votre pays, dès la formule gratuite.",
      },
    ],
    related: [
      "logiciel-facturation-gratuit",
      "logiciel-facturation-auto-entrepreneur",
      "alternative-quickbooks",
    ],
  },
  {
    slug: "logiciel-relance-facture",
    lang: "fr",
    group: "reminders",
    keyword: "logiciel relance facture",
    source: "Google Suggest fr-FR, 04.11.2026",
    title: "Logiciel relance facture : retards relancés",
    description:
      "Logiciel relance facture : factures échues classées par niveau, 3 niveaux avec frais et intérêts, envoi chaque matin. Premier rappel gratuit, sans carte.",
    eyebrow: "Relances",
    h1: "Un logiciel relance facture qui suit vos retards",
    lede: "InvoiceLead classe vos factures échues par niveau de relance et vous dit qui relancer. Avec Pro, les relances partent seules chaque matin.",
    linkLabel: "Relancer les impayés",
    shot: "reminders-desktop",
    shotAlt: "Écran des relances d'InvoiceLead avec les factures en retard",
    sections: [
      {
        h2: "Voir les retards d'un coup d'œil",
        paras: [
          "Le tableau de bord additionne l'encours et les factures en retard. L'écran des relances classe chaque facture échue selon son niveau : premier rappel, deuxième, troisième. Vous savez qui relancer avant d'ouvrir la moindre liste, et combien chaque retard vous coûte en trésorerie.",
          "Quand le virement arrive et que vous importez votre relevé bancaire (camt.053), le paiement est proposé face à la bonne facture. La facture sort des retards.",
        ],
      },
      {
        h2: "Trois niveaux, frais et intérêts",
        paras: [
          "Avec la formule Pro, les relances suivent trois niveaux. Vous pouvez ajouter des frais de rappel et des intérêts moratoires. Le rythme s'adapte au profil de paiement de chaque client : un bon payeur en retard d'un jour n'est pas traité comme un client qui paie toujours tard.",
        ],
        bullets: [
          "Rappel courtois, puis deuxième et troisième relance",
          "Frais de rappel et intérêts moratoires",
          "Envoi automatique chaque matin",
          "Pénalités de retard et indemnité forfaitaire de 40 € déjà sur le PDF en France",
        ],
      },
      {
        h2: "Gratuit : le premier rappel à la main",
        paras: [
          "Dans la formule gratuite, vous envoyez vous-même le premier rappel, jusqu'à 5 par mois. C'est souvent suffisant pour un indépendant. La formule gratuite comprend aussi 5 factures par mois, des devis illimités, 50 contacts et 1 relevé bancaire par mois. Elle ne demande aucune carte bancaire et n'a pas de limite de durée.",
          "Les relances automatiques restent visibles en gris, avec la marque Pro. Pro coûte 19 € par mois hors TVA, ou 190 € par an.",
        ],
      },
      {
        h2: "L'Assistant IA, côté relances",
        paras: [
          "Demandez à l'Assistant IA quels clients vous doivent le plus, ou depuis combien de temps une facture attend : il répond à partir de vos livres.",
          "Il peut proposer des changements, comme un brouillon de facture, un contact mis à jour ou des notes, sur une carte « À confirmer » qui montre tout ce qui sera écrit. Rien n'est enregistré sans votre clic sur « Confirmer ». Une carte peut regrouper jusqu'à 150 opérations, tout ou rien.",
          "Il n'envoie rien à l'extérieur : pour envoyer une relance, il ouvre l'écran des relances et c'est vous qui envoyez. Il ne supprime rien et ne paie rien. Gratuit : l'équivalent de 10 demandes par mois. Pro : sans limite.",
        ],
      },
      {
        h2: "Dans votre pays, dans la langue du client",
        paras: [
          "InvoiceLead sert les États-Unis, le Royaume-Uni, l'Allemagne, la France et la Suisse. Vos factures partent dans la langue choisie pour chaque client : allemand, français, anglais, italien ou espagnol. Les montants peuvent être en EUR, USD, GBP ou CHF avec Pro. Indépendant ou PME, vous gardez le même écran et les mêmes niveaux de relance.",
        ],
      },
      {
        h2: "Moins de retards dès la facture",
        paras: [
          "Une relance commence par une facture claire et une échéance visible. Sur chaque facture, InvoiceLead imprime l'échéance et les moyens de paiement du pays : GiroCode SEPA en France et en Allemagne, QR-facture en Suisse. Votre client paie en scannant, sans recopier l'IBAN.",
          "Votre client sait exactement quel montant virer et à quelle facture rattacher son paiement. Le rapprochement bancaire en devient plus simple.",
        ],
      },
    ],
    faq: [
      {
        q: "Les relances partent-elles seules ?",
        a: "Oui, avec la formule Pro : l'envoi automatique a lieu chaque matin, sur trois niveaux. Dans la formule gratuite, vous envoyez le premier rappel vous-même.",
      },
      {
        q: "Puis-je ajouter des frais de relance ?",
        a: "Oui, avec Pro : frais de rappel et intérêts moratoires. En France, les pénalités de retard et l'indemnité forfaitaire de 40 € figurent déjà sur chaque facture.",
      },
      {
        q: "Combien de relances dans la formule gratuite ?",
        a: "5 premières relances par mois, envoyées à la main. Sans carte bancaire, sans limite de durée.",
      },
      {
        q: "Comment savoir qu'une facture a été payée ?",
        a: "Importez votre relevé camt.053 : chaque crédit est proposé face à la bonne facture, et le pilote automatique valide les cas sûrs. La formule gratuite permet 1 relevé par mois.",
      },
      {
        q: "Faut-il une carte bancaire pour essayer ?",
        a: "Non. La formule gratuite ne demande aucune carte et n'a pas de limite de durée. L'Assistant IA y est compris, à hauteur de l'équivalent de 10 demandes par mois.",
      },
    ],
    related: [
      "logiciel-devis-facture",
      "logiciel-facturation-gratuit",
      "logiciel-facturation-auto-entrepreneur",
    ],
  },
  {
    slug: "logiciel-devis-facture",
    lang: "fr",
    group: "quotes",
    keyword: "logiciel devis facture",
    source: "Google Suggest fr-FR, 04.11.2026",
    title: "Logiciel devis facture : du devis au paiement",
    description:
      "Logiciel devis facture : devis numérotés, acceptés puis changés en facture en un clic, sans ressaisie. Devis illimités et 5 factures gratuites par mois.",
    eyebrow: "Devis et factures",
    h1: "Le logiciel devis facture qui ne ressaisit rien",
    lede: "Le devis accepté devient facture en un clic, avec ses lignes, ses taux et son client. Devis illimités dès la formule gratuite.",
    linkLabel: "Devis et factures",
    shot: "quote-desktop",
    shotAlt: "Devis en cours pour un client dans InvoiceLead",
    sections: [
      {
        h2: "Des devis clairs et suivis",
        paras: [
          "Chaque devis est numéroté et valable 30 jours. Quand le client répond, vous le marquez accepté ou refusé, avec la date. Vous voyez ce qui attend une réponse et ce qui a été signé. Demandez à l'Assistant IA quels devis attendent encore une réponse : il vous les liste.",
          "Vos articles et vos contacts sont enregistrés une fois. Le devis suivant se prépare en quelques lignes : vous choisissez le client, ajoutez les articles, ajustez les quantités. Le document part dans la langue de ce client.",
        ],
      },
      {
        h2: "Accepté, il devient facture en un clic",
        paras: [
          "Pas de copier-coller ni d'erreur de recopie : le devis accepté est converti en facture sans rien ressaisir. La facture reprend les taux, les numéros et les mentions du pays de votre entreprise. Un avoir corrige une facture déjà émise.",
        ],
        bullets: [
          "France : TVA 20 %, 10 % et 5,5 %, SIRET, GiroCode, PDF Factur-X",
          "Allemagne : USt 19 % et 7 %, XRechnung et ZUGFeRD",
          "Suisse : QR-facture SIX ; Royaume-Uni : VAT ; États-Unis : sales tax et papier Letter",
          "Documents en allemand, français, anglais, italien ou espagnol",
        ],
      },
      {
        h2: "Du temps passé à la facture",
        paras: [
          "Si vous facturez à l'heure, le chrono ou la saisie rapide par projet garde vos heures. Les heures facturables passent sur la facture en un clic. Le temps est relié à ProjectLead si vous l'utilisez.",
          "Un lead gagné dans CRMlead arrive dans InvoiceLead : le client est repris ou créé, vous n'avez plus qu'à faire le devis.",
        ],
      },
      {
        h2: "L'Assistant IA prépare, vous confirmez",
        paras: [
          "Demandez à l'Assistant IA un brouillon de devis pour un client, avec ses lignes : il le prépare sur une carte « À confirmer » qui montre tout ce qui sera écrit. Rien n'est enregistré sans votre clic sur « Confirmer ».",
          "Il crée aussi des contacts, des articles, du temps, des notes de frais ou des factures fournisseurs, jusqu'à 150 opérations sur une seule carte, appliquées en un clic, tout ou rien. Il répond à vos questions à partir de vos livres : devis en attente, chiffre d'affaires du mois.",
          "Il ne supprime rien, ne paie rien et n'envoie rien à l'extérieur : pour envoyer un devis, il ouvre l'écran. Gratuit : l'équivalent de 10 demandes par mois ; Pro : sans limite.",
        ],
      },
      {
        h2: "Gratuit pour commencer",
        paras: [
          "La formule gratuite comprend des devis illimités et 5 factures par mois, 50 contacts, 1 facture récurrente active et la comptabilité alimentée par vos factures. Pas de carte bancaire, pas de limite de durée, un utilisateur. Vos documents portent la mention « Créé avec InvoiceLead ». Elle suffit à un indépendant qui démarre, et vous pouvez faire autant de devis que vous voulez avant votre première facture.",
          "Pro, à 19 € par mois hors TVA, rend factures et contacts illimités, ajoute le multidevise (EUR, USD, GBP, CHF), les factures récurrentes sans limite et l'accès gratuit pour votre expert-comptable.",
        ],
      },
      {
        h2: "Suivre ce qui est facturé",
        paras: [
          "Le tableau de bord additionne le chiffre d'affaires du mois et de l'année, l'encours et les retards, et trace vos douze derniers mois. Les factures échues sont classées par niveau de relance : avec Pro, les relances partent seules chaque matin, avec frais et intérêts moratoires si vous le souhaitez.",
          "Chaque facture émise crée ses écritures dans votre comptabilité en partie double, sur le plan comptable de votre pays.",
        ],
      },
    ],
    faq: [
      {
        q: "Les devis sont-ils limités dans la formule gratuite ?",
        a: "Non, les devis sont illimités. Ce sont les factures qui sont limitées à 5 par mois.",
      },
      {
        q: "Combien de temps un devis reste-t-il valable ?",
        a: "30 jours. Vous notez ensuite s'il est accepté ou refusé, avec la date.",
      },
      {
        q: "Puis-je facturer dans une autre devise ?",
        a: "Oui, avec la formule Pro : devis et factures en EUR, USD, GBP ou CHF.",
      },
      {
        q: "Mon expert-comptable peut-il voir mes factures ?",
        a: "Oui, avec Pro : il accède gratuitement à votre comptabilité, en plus de votre utilisateur.",
      },
      {
        q: "Dans quels pays mes factures sont-elles conformes ?",
        a: "Aux États-Unis, au Royaume-Uni, en Allemagne, en France et en Suisse. Chaque facture reprend les taux, les numéros et les mentions du pays de votre entreprise.",
      },
    ],
    related: [
      "logiciel-facturation-gratuit",
      "logiciel-relance-facture",
      "logiciel-facturation-auto-entrepreneur",
      "logiciel-factur-x",
    ],
  },
  {
    slug: "logiciel-factur-x",
    lang: "fr",
    group: "einvoice",
    keyword: "logiciel factur-x",
    source: "Google Suggest fr-FR, 04.11.2026 (« logiciel factur x gratuit »)",
    title: "Logiciel Factur-X gratuit pour vos factures",
    description:
      "Logiciel Factur-X : chaque facture française part en PDF Factur-X, profil EN 16931, lisible par tous. Formule gratuite sans carte ni limite de durée.",
    eyebrow: "Facture électronique",
    h1: "Un logiciel Factur-X pour émettre vos factures",
    lede: "Chaque facture d'une entreprise française part en PDF Factur-X, profil EN 16931 : un PDF que tout le monde lit, avec les données que le client équipé importe sans ressaisie.",
    linkLabel: "Factures Factur-X",
    shot: "invoice-pdf",
    shotAlt: "Facture en PDF Factur-X créée avec InvoiceLead",
    sections: [
      {
        h2: "Ce qu'est le PDF Factur-X d'InvoiceLead",
        paras: [
          "Factur-X est le même format que le ZUGFeRD allemand. Le PDF est un PDF/A-3b qui porte en pièce jointe le fichier factur-x.xml (syntaxe CII, profil EN 16931) et le déclare dans ses métadonnées.",
          "Un client équipé importe la facture dans son propre outil sans ressaisie. Les autres la lisent et l'impriment comme un PDF ordinaire, sans rien installer. Si une donnée manque pour le XML, le PDF reste un PDF simple, et la page de la pièce dit ce qui manque.",
        ],
      },
      {
        h2: "Contrôlé avec le validateur officiel",
        paras: [
          "Le format n'est pas déclaré à la légère : des échantillons sont passés au validateur officiel de la KoSIT, l'organisme allemand qui publie les règles XRechnung : schéma XSD et règles EN 16931. Trois sont français (taux de 20, 10 et 5,5 %, franchise en base, avoir), cinq allemands. Résultat au 30.9.2026 : 8 acceptés, 0 rejeté.",
        ],
        bullets: [
          "SIRET et numéro de TVA intracommunautaire de votre entreprise",
          "Régime de TVA : art. 293 B, autoliquidation ou art. 259-1 du CGI",
          "Pénalités de retard et indemnité forfaitaire de 40 €",
          "GiroCode pour le virement SEPA",
        ],
      },
      {
        h2: "Où en est la transmission par plateforme",
        paras: [
          "Aujourd'hui, InvoiceLead émet le PDF Factur-X et vous l'envoyez par e-mail, comme une facture PDF habituelle, à l'adresse de votre client. La réforme française fait transiter les factures par une plateforme agréée : ce branchement n'est pas encore en place dans InvoiceLead. Le contenu de vos factures, lui, est prêt : mentions, numéros, taux et données structurées.",
        ],
      },
      {
        h2: "L'Assistant IA, pour préparer vos factures",
        paras: [
          "L'Assistant IA intégré répond à vos questions à partir de vos livres. Il peut proposer un brouillon de facture ou de devis, des contacts, des articles, du temps, des notes de frais ou des factures fournisseurs.",
          "Tout s'affiche sur une carte « À confirmer » qui montre ce qui sera écrit ; rien n'est enregistré sans votre clic sur « Confirmer ». Une carte peut grouper jusqu'à 150 opérations, appliquées en un clic, tout ou rien. Il ne supprime rien, ne paie rien et n'envoie rien à l'extérieur : il ouvre l'écran à la place. Gratuit : l'équivalent de 10 demandes par mois ; Pro : sans limite.",
        ],
      },
      {
        h2: "Factur-X dès la formule gratuite",
        paras: [
          "La formule gratuite produit vos factures du pays, Factur-X compris : 5 factures par mois, devis illimités, 50 contacts, 10 pièces lues par l'IA. Les e-factures de vos fournisseurs se lisent sans limite. Pas de carte bancaire, pas de limite de durée. Elle convient aux indépendants, y compris en franchise en base : l'un des échantillons acceptés par le validateur est justement une facture en franchise en base.",
          "Pro, à 19 € par mois hors TVA, rend les factures illimitées et prépare la déclaration CA3, prête à reporter.",
        ],
      },
      {
        h2: "Hors de France aussi",
        paras: [
          "Une entreprise allemande reçoit deux formats pour chaque facture : le PDF ZUGFeRD et le XML XRechnung 3.0. XRechnung demande en plus l'e-mail et le téléphone de l'entreprise, l'e-mail du client et l'IBAN ; la page dit ce qui manque. InvoiceLead sert aussi le Royaume-Uni (VAT), la Suisse (QR-facture SIX) et les États-Unis (sales tax), avec des documents en cinq langues.",
        ],
      },
    ],
    faq: [
      {
        q: "Le Factur-X est-il compris dans la formule gratuite ?",
        a: "Oui. Chaque facture d'une entreprise française part en PDF Factur-X, dans la limite de 5 factures par mois en formule gratuite.",
      },
      {
        q: "Quel profil Factur-X est utilisé ?",
        a: "Le profil EN 16931, avec un PDF/A-3b et le fichier factur-x.xml en syntaxe CII.",
      },
      {
        q: "InvoiceLead transmet-il mes factures par une plateforme agréée ?",
        a: "Pas encore. Vous envoyez aujourd'hui le PDF Factur-X par e-mail. Le branchement à une plateforme n'est pas encore en place.",
      },
      {
        q: "Mon client doit-il avoir un logiciel spécial ?",
        a: "Non. Il lit la facture comme un PDF ordinaire. S'il est équipé, il importe les données sans ressaisie.",
      },
      {
        q: "Pourquoi mon PDF n'est-il pas un Factur-X ?",
        a: "Une donnée manque pour le XML. La page de la pièce dit laquelle ; complétez-la et la facture suivante sortira en Factur-X.",
      },
    ],
    related: [
      "logiciel-facturation-gratuit",
      "logiciel-devis-facture",
      "logiciel-facturation-auto-entrepreneur",
    ],
  },
  {
    slug: "alternative-quickbooks",
    lang: "fr",
    group: "alternative-quickbooks",
    keyword: "alternative quickbooks",
    source: "Google Suggest fr-FR, 04.11.2026",
    title: "Alternative QuickBooks : ce qu'il faut vérifier",
    description:
      "Alternative QuickBooks : facturation, relances, tickets en photo et comptabilité pour 5 pays. Formule gratuite sans carte, et les points à vérifier avant.",
    eyebrow: "Changer d'outil",
    h1: "InvoiceLead, une alternative QuickBooks à considérer",
    lede: "Vous cherchez une alternative QuickBooks ? Voici ce que fait InvoiceLead, et les points à vérifier avant de changer d'outil, quel qu'il soit.",
    linkLabel: "Alternative à QuickBooks",
    shot: "dashboard-desktop",
    shotAlt:
      "Tableau de bord d'InvoiceLead : chiffre d'affaires, encours, retards et graphique sur douze mois",
    sections: [
      {
        h2: "Ce que fait InvoiceLead",
        paras: [
          "InvoiceLead va du devis à l'encaissement : devis numérotés changés en facture en un clic, factures conformes à votre pays, relances, tickets lus en photo, factures fournisseurs, relevés bancaires rapprochés. Votre comptabilité en partie double se remplit au passage, sur le plan comptable de votre pays, dès la formule gratuite.",
        ],
        bullets: [
          "Cinq pays : États-Unis, Royaume-Uni, Allemagne, France, Suisse",
          "Déclaration du pays préparée avec Pro : CA3, UStVA, MTD en neuf cases, relevé de sales tax, décompte TVA suisse",
          "Documents en 5 langues, multidevise EUR, USD, GBP, CHF avec Pro",
          "Tableau de bord : chiffre d'affaires, encours, retards, douze mois en graphique",
        ],
      },
      {
        h2: "Avant de changer d'outil, vérifiez",
        paras: [
          "Un changement de logiciel se prépare, de préférence en début d'exercice ou de trimestre. Ces points valent quel que soit l'outil que vous quittez ou que vous choisissez.",
        ],
        bullets: [
          "L'export de vos données actuelles : clients, articles, factures, écritures",
          "La suite de votre numérotation de factures, sans trou ni doublon",
          "Le plan comptable : PCG en France, SKR04 en Allemagne, plan PME en Suisse",
          "Les factures ouvertes et les relances en cours à reprendre",
          "La conservation de vos anciens livres, jusqu'à dix ans selon le pays, et l'accès de votre expert-comptable",
        ],
      },
      {
        h2: "Un Assistant IA qui demande votre accord",
        paras: [
          "L'Assistant IA d'InvoiceLead répond à vos questions à partir de vos livres. Il peut aussi proposer des changements : brouillons de devis ou de factures, contacts, articles, temps, notes de frais, factures fournisseurs.",
          "Pratique pour une reprise : une seule carte « À confirmer » peut regrouper jusqu'à 150 opérations, appliquées en un clic, tout ou rien. La carte montre tout ce qui sera écrit, et rien n'est enregistré sans votre clic sur « Confirmer ». Il ne supprime rien, ne paie rien, n'envoie rien à l'extérieur. Gratuit : l'équivalent de 10 demandes par mois ; Pro : sans limite.",
        ],
      },
      {
        h2: "Essayer sans engagement",
        paras: [
          "La formule gratuite ne demande pas de carte bancaire et n'a pas de limite de durée : 1 utilisateur, 5 factures par mois, devis illimités, 50 contacts, 10 pièces lues par l'IA, l'assistant IA, 1 relevé bancaire par mois. Vous pouvez tester avec un vrai client, un vrai devis et une vraie facture avant de décider. Si l'outil vous convient, vous passez à Pro ; sinon, vous exportez vos données et vous repartez.",
          "Pro coûte 19 € par mois hors TVA, Pro+ 39 € pour 5 utilisateurs avec API, serveur MCP et webhooks. Facturé en euros par Quantum Liquid LLC, résiliable à tout moment.",
        ],
      },
      {
        h2: "Pour les indépendants comme pour les PME",
        paras: [
          "Un indépendant démarre avec la formule gratuite ; la franchise en base française est gérée. Une PME passe à Pro pour les relances automatiques, les factures illimitées et l'accès gratuit de son expert-comptable. Une équipe prend Pro+ pour 5 utilisateurs avec rôles et 300 pièces lues par mois.",
          "Vos données sont hébergées aux États-Unis (Vercel et Neon, Ohio), chiffrées en transit et au repos, et exportables à tout moment.",
        ],
      },
      {
        h2: "Ce qui reste visible en gris",
        paras: [
          "Rien n'est caché : les fonctions Pro et Pro+ restent visibles dans l'application, en gris avec leur marque. Vous voyez les relances automatiques, les déclarations, le multidevise et l'accès comptable avant de payer, et vous jugez sur pièce.",
        ],
      },
    ],
    faq: [
      {
        q: "Puis-je importer mes données depuis mon ancien logiciel ?",
        a: "Commencez par exporter vos clients, articles et factures de votre outil actuel. L'Assistant IA peut ensuite proposer la création de contacts et d'articles par lots, jusqu'à 150 opérations par carte, que vous confirmez.",
      },
      {
        q: "InvoiceLead dépose-t-il mes déclarations ?",
        a: "Non. Avec Pro, les chiffres de la déclaration de votre pays sont préparés et prêts à reporter ; le dépôt auprès de l'administration reste de votre côté.",
      },
      {
        q: "Mon expert-comptable peut-il y accéder ?",
        a: "Oui, avec Pro, gratuitement, en plus de votre utilisateur.",
      },
      {
        q: "Puis-je repartir avec mes données ?",
        a: "Oui, à tout moment, et pendant 30 jours après une résiliation.",
      },
      {
        q: "Faut-il une carte bancaire pour essayer ?",
        a: "Non. La formule gratuite n'en demande pas et n'a pas de limite de durée.",
      },
    ],
    related: [
      "logiciel-facturation-gratuit",
      "logiciel-devis-facture",
      "logiciel-relance-facture",
      "application-note-de-frais",
    ],
  },
];
