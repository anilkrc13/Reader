#!/bin/bash
# Installs a signing identity exported by export-signing-identity.sh onto
# another Mac, into Reader's own keychain at the same path build-app.sh and
# ensure-signing-identity.sh already expect, so builds on that Mac carry the
# same certificate identity and folder-permission grants are not tied to one
# machine.
#
#   ./macos/import-signing-identity.sh reader-signing.p12
#   ./macos/import-signing-identity.sh reader-signing.p12 reader-signing.p12.password
#
# The p12 password is read, in order: the second argument if given, a sibling
# "<file>.password" (export-signing-identity.sh writes one next to its base64
# output), or an interactive prompt. It is never accepted as plain text on the
# command line itself, since that would land in shell history.
#
# Safe to run again: re-importing the same identity replaces it in place
# rather than erroring or duplicating it.

set -euo pipefail

P12_IN="${1:?usage: import-signing-identity.sh <file.p12> [password-file]}"
PASSWORD_FILE="${2:-$P12_IN.password}"
SUPPORT_DIR="$HOME/Library/Application Support/Reader/signing"
KEYCHAIN="$SUPPORT_DIR/reader-signing.keychain-db"
PASSWORD_FILE_STORE="$SUPPORT_DIR/keychain-password"
CERT_FILE="$SUPPORT_DIR/certificate.pem"
IDENTITY_NAME="Reader Local Signing"

if [ ! -f "$P12_IN" ]; then
  echo "No such file: $P12_IN" >&2
  exit 1
fi

if [ -f "$PASSWORD_FILE" ]; then
  P12_PASSWORD="$(cat "$PASSWORD_FILE")"
else
  read -r -s -p "Password for $P12_IN: " P12_PASSWORD
  echo ""
fi

mkdir -p "$SUPPORT_DIR"
chmod 700 "$SUPPORT_DIR"

# A keychain that already holds a different identity under this name would
# leave the code ambiguous about which one signs -- start clean, same as
# ensure-signing-identity.sh does when it recreates from scratch.
if [ -f "$KEYCHAIN" ]; then
  security delete-keychain "$KEYCHAIN" 2>/dev/null || rm -f "$KEYCHAIN"
fi

KEYCHAIN_PASSWORD="$(/usr/bin/openssl rand -hex 24)"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"

security import "$P12_IN" -k "$KEYCHAIN" -P "$P12_PASSWORD" \
  -f pkcs12 -T /usr/bin/codesign -T /usr/bin/security
# Without a partition list the private key raises a confirmation dialog on
# every single signature instead of none.
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null 2>&1

( umask 077; printf '%s\n' "$KEYCHAIN_PASSWORD" > "$PASSWORD_FILE_STORE" )
chmod 600 "$PASSWORD_FILE_STORE"

# codesign refuses an untrusted identity outright, the same way it would for
# one created fresh by ensure-signing-identity.sh, so this Mac's trust store
# needs the certificate too even though the private key already arrived
# trusted for signing on the Mac it came from.
security export -k "$KEYCHAIN" -t certs -f pemseq -o "$CERT_FILE" 2>/dev/null || \
  security find-certificate -c "$IDENTITY_NAME" -p "$KEYCHAIN" > "$CERT_FILE"
chmod 644 "$CERT_FILE"
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$CERT_FILE"

if ! security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -qF "\"$IDENTITY_NAME\""; then
  echo "Imported, but the identity is still not usable for code signing." >&2
  echo "Open Keychain Access, select the \"$IDENTITY_NAME\" certificate in the" >&2
  echo "\"reader-signing\" keychain, and set Code Signing to \"Always Trust\"." >&2
  exit 1
fi

echo "Imported \"$IDENTITY_NAME\" into $KEYCHAIN."
echo "./macos/build-app.sh will find and use it automatically from now on."
