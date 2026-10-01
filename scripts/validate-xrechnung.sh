#!/usr/bin/env bash
# Valide les échantillons XRechnung avec le validateur officiel KoSIT (Java 11+ requis).
# Usage : npm run validate:xrechnung
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=tmp/kosit
VALIDATOR=https://github.com/itplr-kosit/validator/releases/download/v1.5.0/validator-1.5.0-distribution.zip
CONFIG=https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/release-2024-06-20/validator-configuration-xrechnung_3.0.2_2024-06-20.zip
mkdir -p "$DIR"
[ -f "$DIR/validator/validationtool-1.5.0-standalone.jar" ] || {
  curl -sSL -o "$DIR/validator.zip" "$VALIDATOR" && unzip -qo "$DIR/validator.zip" -d "$DIR/validator"
}
[ -f "$DIR/config/scenarios.xml" ] || {
  curl -sSL -o "$DIR/config.zip" "$CONFIG" && unzip -qo "$DIR/config.zip" -d "$DIR/config"
}
rm -rf tmp/xrechnung "$DIR/out"
XRECHNUNG_OUT=tmp/xrechnung npx vitest run --config vitest.einvoice.config.ts
# Décomptes suisses eCH-0217, contre le schéma officiel (types importés en extrait minimal).
xmllint --noout --schema docs/ech-0217/eCH-0217-1-0-local.xsd tmp/xrechnung/ech0217-*.xml

# Ordres de paiement pain.001.001.09 contre le schéma ISO 20022 (docs/pain001).
xmllint --noout --schema docs/pain001/pain.001.001.09.xsd tmp/xrechnung/pain001-*.xml

java -jar "$DIR/validator/validationtool-1.5.0-standalone.jar" \
  -s "$DIR/config/scenarios.xml" -r "$DIR/config" -o "$DIR/out" $(ls tmp/xrechnung/*.xml | grep -v ech0217 | grep -v pain001)

# PDF ZUGFeRD : conformité PDF/A-3b avec veraPDF (récupéré par Maven s'il est installé).
if command -v mvn >/dev/null; then
  VP="$DIR/verapdf"
  if [ ! -d "$VP/lib" ]; then
    mkdir -p "$VP"
    cat > "$VP/pom.xml" <<'POM'
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>x</groupId><artifactId>vp</artifactId><version>1</version>
<dependencies><dependency><groupId>org.verapdf.apps</groupId><artifactId>greenfield-apps</artifactId><version>1.28.2</version></dependency></dependencies>
</project>
POM
    (cd "$VP" && mvn -q dependency:copy-dependencies -DoutputDirectory=lib)
  fi
  java -cp "$VP/lib/*" org.verapdf.apps.GreenfieldCliWrapper --flavour 3b --format text tmp/xrechnung/zugferd.pdf
else
  echo "Maven absent : contrôle veraPDF du PDF ZUGFeRD sauté."
fi
