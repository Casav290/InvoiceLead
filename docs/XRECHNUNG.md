# Facture électronique allemande (XRechnung et ZUGFeRD)

Une entreprise allemande reçoit deux formats pour chaque facture et chaque avoir émis.

Le PDF est un ZUGFeRD : un PDF/A-3b, police Archivo intégrée, qui porte en pièce jointe `factur-x.xml` (CII, profil EN 16931) et le déclare dans ses métadonnées XMP. Un client équipé l'importe sans ressaisie, les autres le lisent comme un PDF ordinaire. Si des données manquent pour le XML, le PDF reste un PDF simple.

Le bouton « XRechnung (XML) » télécharge le XML seul, au standard XRechnung 3.0 (syntaxe CII). XRechnung exige davantage que le profil EN 16931 : e-mail et téléphone de l'entreprise, e-mail du client, IBAN. Quand une donnée manque, la page de la pièce dit laquelle.

## Contrôle

`npm run validate:xrechnung` produit cinq échantillons (taux mélangés, avoir, petite entreprise § 19 UStG, autoliquidation vers la France, exportation vers la Suisse) et les passe au validateur officiel de la KoSIT (1.5.0, configuration XRechnung 3.0.2 du 20.6.2024) : schéma XSD, règles EN 16931 et règles allemandes. Java 11 ou plus est nécessaire. Résultat au 30.9.2026 : 5 acceptés, 0 rejeté, aucun avertissement.

Le PDF/A-3 n'a pas encore été contrôlé par veraPDF. C'est à faire avant l'ouverture en Allemagne, avec un fichier réel téléchargé depuis l'application.

## Règles appliquées

| Cas | Catégorie TVA | Remarque |
|---|---|---|
| Taux normal ou réduit | S (19 % ou 7 %) | |
| Code « exempt » | E | Motif « Steuerfreie Leistung (§ 4 UStG) » |
| Petite entreprise (non assujettie) | E, 0 % | Motif § 19 UStG ; la Steuernummer sert d'identifiant du vendeur |
| Code « export », client dans l'UE | AE | USt-IdNr. du client obligatoire |
| Code « export », client hors UE | G | |

Chaque facture porte l'USt-IdNr. ou la Steuernummer de l'entreprise (réglages de l'entreprise, l'un des deux est obligatoire en Allemagne).
