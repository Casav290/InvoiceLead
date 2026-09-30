# Passage d'un lead gagné de CRMlead vers InvoiceLead

Quand un lead passe à « gagné » dans CRMlead, un bouton « Créer le devis » (ou « Créer la facture ») ouvre InvoiceLead dans le navigateur de la personne. Aucun appel de serveur à serveur, aucun secret partagé : la personne est connectée par le Compte Lead, relit ce qui arrive et confirme. Rien n'est créé avant ce clic.

## Lien

```
https://invoicelead.io/{locale}/app/import/crmlead?d={données}
```

`locale` vaut `de` ou `fr`. `d` est le JSON ci-dessous, encodé en base64url (sans remplissage), 60 000 caractères au plus.

```json
{
  "v": 1,
  "kind": "quote",
  "lead": { "id": "identifiant stable du lead", "title": "Refonte du site" },
  "contact": {
    "id": "identifiant stable de l'entreprise ou de la personne dans CRMlead",
    "kind": "company",
    "name": "Boulangerie Rochat SA",
    "contactPerson": "Léa Rochat",
    "email": "lea@rochat.ch",
    "phone": "+41 21 000 00 00",
    "street": "Rue de Bourg",
    "buildingNumber": "12",
    "postalCode": "1003",
    "town": "Lausanne",
    "country": "CH",
    "language": "fr"
  },
  "lines": [
    { "description": "Atelier de cadrage", "quantity": 1.5, "unit": "day", "unitPriceCents": 120000, "vatCode": "normal" }
  ]
}
```

Champs obligatoires : `v`, `lead.id`, `contact.name`, au moins une ligne avec `description`, `quantity` et `unitPriceCents` (hors TVA, en centimes). Valeurs admises :

| Champ | Valeurs | Par défaut |
|---|---|---|
| `kind` | `quote`, `invoice` | `quote` |
| `contact.kind` | `company`, `person` | `company` |
| `contact.country` | `CH`, `LI`, `DE`, `FR`, `IT`, `AT` | `CH` |
| `contact.language` | `de`, `fr`, `it`, `en` | langue du lien |
| `lines[].unit` | `hour`, `day`, `piece`, `flat`, `km`, `month` | `flat` |
| `lines[].vatCode` | `normal`, `reduced`, `lodging`, `exempt`, `export` | `normal` |
| `currency` | `CHF` | `CHF` |

## Règles côté InvoiceLead

Le client est repris s'il existe déjà : même `contact.id` CRMlead d'abord, puis même e-mail, puis même nom. Sinon il est créé (dans la limite de contacts de la formule).

Un même `lead.id` ne donne qu'une pièce par entreprise : rouvrir le lien ramène au brouillon déjà créé.

La pièce créée est un brouillon, modifiable avant émission. La personne doit avoir un rôle qui permet la facturation.
