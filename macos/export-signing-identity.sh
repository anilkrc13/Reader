#!/bin/bash
# Exports Reader's local signing identity so CI (or another Mac) can sign with
# the same certificate instead of falling back to an ad-hoc signature. The
# identity itself never leaves this Mac except as the password-protected .p12
# you choose to hand to GitHub as a secret -- this script never uploads or
# transmits anything itself.
#
#   ./macos/export-signing-identity.sh path/to/reader-signing.p12 path/to/reader-signing.p12.base64
#
# The second path receives the base64 form GitHub Actions secrets expect. It
# is written to a file, never printed, because a base64 blob in a terminal
# scrollback or a copy-paste over a screen share is exactly the kind of leak a
# secret is supposed to resist.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $(basename "$0") <output.p12> <output.p12.base64>" >&2
  exit 2
fi

P12_OUT="$1"
BASE64_OUT="$2"
SUPPORT_DIR="$HOME/Library/Application Support/Reader/signing"
KEYCHAIN="$SUPPORT_DIR/reader-signing.keychain-db"
PASSWORD_FILE="$SUPPORT_DIR/keychain-password"
IDENTITY_NAME="Reader Local Signing"

if [ ! -f "$KEYCHAIN" ] || [ ! -f "$PASSWORD_FILE" ]; then
  echo "No Reader signing identity found. Run ./macos/ensure-signing-identity.sh first." >&2
  exit 1
fi

security unlock-keychain -p "$(cat "$PASSWORD_FILE")" "$KEYCHAIN" 2>/dev/null || true

if ! security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -qF "\"$IDENTITY_NAME\""; then
  echo "The \"$IDENTITY_NAME\" identity is not usable in $KEYCHAIN." >&2
  echo "Run ./macos/ensure-signing-identity.sh to (re)create it first." >&2
  exit 1
fi

EXPORT_PASSWORD="$(/usr/bin/openssl rand -base64 24)"
PASSWORD_OUT="$BASE64_OUT.password"

mkdir -p "$(dirname "$P12_OUT")"
# security export, not openssl pkcs12, because the private key was imported
# non-extractable-by-default and only "security export" can pull it back out
# of this specific keychain with the right access controls satisfied.
security export -k "$KEYCHAIN" -t identities -f pkcs12 \
  -P "$EXPORT_PASSWORD" -o "$P12_OUT"
chmod 600 "$P12_OUT"

mkdir -p "$(dirname "$BASE64_OUT")"
base64 -i "$P12_OUT" -o "$BASE64_OUT"
chmod 600 "$BASE64_OUT"

( umask 077; printf '%s' "$EXPORT_PASSWORD" > "$PASSWORD_OUT" )

echo "Wrote $P12_OUT, its base64 form at $BASE64_OUT, and the export password"
echo "at $PASSWORD_OUT. None of it was printed to this terminal."
echo ""
echo "Set the two GitHub Actions secrets this repository's release workflow"
echo "reads (replace OWNER/REPO, or drop --repo to use the current directory's):"
echo ""
echo "  gh secret set READER_SIGNING_P12_BASE64 --repo OWNER/REPO < \"$BASE64_OUT\""
echo "  gh secret set READER_SIGNING_P12_PASSWORD --repo OWNER/REPO --body-file \"$PASSWORD_OUT\""
echo ""
echo "Delete $P12_OUT, $BASE64_OUT and $PASSWORD_OUT once both secrets are set --"
echo "they are a copy of your private signing key and do not need to persist on"
echo "disk. The same two files also work with the counterpart script,"
echo "import-signing-identity.sh, to put this identity on another Mac."
