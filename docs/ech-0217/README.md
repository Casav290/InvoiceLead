# eCH-0217 (e-TVA)

`eCH-0217-1-0.xsd` est le schéma officiel v1.0 publié par l'association eCH, repris tel quel (identique dans deux projets libres indépendants, OCA l10n-switzerland et open-ech-emwst), avec l'exemple officiel `eCH-0217_V1.0_example_effectiveReportingMethod.xml`. Les sites ech.ch et estv.admin.ch n'étaient pas joignables depuis l'environnement de développement.

Le schéma importe des types d'eCH-0097 v3 (IDE, nom d'organisation) et d'eCH-0058 v5 (référence et application émettrice). Pour valider hors ligne, `eCH-0097-3-0-minimal.xsd` et `eCH-0058-5-0-minimal.xsd` reprennent seulement ces quatre types, et `eCH-0217-1-0-local.xsd` pointe vers eux. L'exemple officiel passe cette validation.

`npm run validate:xrechnung` produit un décompte en méthode effective et un en TDFN et les valide contre ce schéma. Avant la mise en production, déposer un fichier réel en test sur le portail ePortal de l'AFC, et vérifier que la version 1.0.1 (2024) ne change rien au format.
