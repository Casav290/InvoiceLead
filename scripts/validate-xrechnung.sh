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
java -jar "$DIR/validator/validationtool-1.5.0-standalone.jar" \
  -s "$DIR/config/scenarios.xml" -r "$DIR/config" -o "$DIR/out" tmp/xrechnung/*.xml
