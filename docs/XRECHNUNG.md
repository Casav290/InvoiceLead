# Facture électronique allemande et française (XRechnung, ZUGFeRD, Factur-X)

Une entreprise allemande reçoit deux formats pour chaque facture et chaque avoir émis. Une entreprise française reçoit le PDF Factur-X (même format que ZUGFeRD, profil EN 16931) ; la transmission par une plateforme agréée (PDP), obligatoire en réception depuis le 1.9.2026 et en émission pour les PME au 1.9.2027, reste à brancher quand une plateforme aura été choisie.

Le PDF est un ZUGFeRD : un PDF/A-3b, police Archivo intégrée, qui porte en pièce jointe `factur-x.xml` (CII, profil EN 16931) et le déclare dans ses métadonnées XMP. Un client équipé l'importe sans ressaisie, les autres le lisent comme un PDF ordinaire. Si des données manquent pour le XML, le PDF reste un PDF simple.

Le bouton « XRechnung (XML) » télécharge le XML seul, au standard XRechnung 3.0 (syntaxe CII). XRechnung exige davantage que le profil EN 16931 : e-mail et téléphone de l'entreprise, e-mail du client, IBAN. Quand une donnée manque, la page de la pièce dit laquelle.

## Contrôle

`npm run validate:xrechnung` produit huit échantillons et les passe au validateur officiel de la KoSIT (1.5.0, configuration XRechnung 3.0.2 du 20.6.2024) : schéma XSD, règles EN 16931 et, pour XRechnung, règles allemandes. Cinq sont allemands (taux mélangés, avoir, petite entreprise § 19 UStG, autoliquidation vers la France, exportation vers la Suisse), trois français en profil EN 16931 (taux de 20, 10 et 5,5 %, franchise en base, avoir). Java 11 ou plus est nécessaire. Résultat au 30.9.2026 : 8 acceptés, 0 rejeté, aucun avertissement.

Le même script rend un PDF ZUGFeRD et le passe à veraPDF 1.28.2 (profil PDF/A-3b), si Maven est installé pour le récupérer. Résultat au 30.9.2026 : PASS.

## Règles appliquées

| Cas | Catégorie TVA | Remarque |
|---|---|---|
| Taux normal ou réduit | S (19 % ou 7 %) | |
| Code « exempt » | E | Motif « Steuerfreie Leistung (§ 4 UStG) » |
| Petite entreprise (non assujettie) | E, 0 % | Motif § 19 UStG ; la Steuernummer sert d'identifiant du vendeur |
| Code « export », client dans l'UE | AE | USt-IdNr. du client obligatoire |
| Code « export », client hors UE | G | |

Chaque facture allemande porte l'USt-IdNr. ou la Steuernummer de l'entreprise (l'un des deux est obligatoire). Chaque facture française porte le SIRET (le SIREN va dans l'immatriculation légale, schéma 0002, et sert d'identifiant fiscal en franchise en base) et, s'il existe, le numéro de TVA intracommunautaire. Le PDF français ajoute les mentions obligatoires : régime de TVA (art. 293 B, autoliquidation ou art. 259-1 du CGI) et pénalités de retard avec l'indemnité forfaitaire de 40 €.
