#!/bin/bash
# Reader's own code-signing identity, created once per user.
#
# An ad-hoc signature ('codesign --sign -') is derived from the bundle's
# contents, so its designated requirement is a bare cdhash:
#
#   designated => cdhash H"26e68e53a7b3ce765be0c532a456a83f1f441ef2"
#
# macOS keys folder-access consent (Desktop, Documents, Downloads, removable
# and network volumes) to that requirement, and the hash changes on every
# build -- even a rebuild from unchanged sources. Each build was therefore a
# brand-new app as far as the privacy database was concerned, which is why the
# folder prompts kept coming back. Signing with a certificate instead pins the
# requirement to the certificate rather than to the bundle's bytes, so the
# grants survive rebuilds.
#
# Nothing here is an Apple developer account: it is a self-signed certificate
# in a keychain of Reader's own, kept beside Reader's preferences. The login
# keychain is not touched. Gatekeeper still treats the app as unnotarised, so
# the first-launch warning is unchanged.
#
#   ./macos/ensure-signing-identity.sh          create it if missing, then print it
#   ./macos/ensure-signing-identity.sh use-existing   print it, never create
#
# Creating it needs one authorisation: macOS asks for your login password to
# trust the certificate for code signing, because codesign refuses an untrusted
# identity outright. That happens once. build-app.sh calls this script in
# use-existing mode unless it is running on a terminal, so a build never raises
# an authorisation dialog behind your back.
#
# To undo everything this script does:
#
#   security delete-keychain ~/Library/Application\ Support/Reader/signing/reader-signing.keychain-db
#   security remove-trusted-cert ~/Library/Application\ Support/Reader/signing/certificate.pem
#   rm -rf ~/Library/Application\ Support/Reader/signing

set -euo pipefail

MODE="${1:-create}"
SUPPORT_DIR="$HOME/Library/Application Support/Reader/signing"
KEYCHAIN="$SUPPORT_DIR/reader-signing.keychain-db"
PASSWORD_FILE="$SUPPORT_DIR/keychain-password"
CERT_FILE="$SUPPORT_DIR/certificate.pem"
IDENTITY_NAME="Reader Local Signing"
# LibreSSL at a fixed path: always present, and unaffected by whichever
# openssl happens to be first on PATH.
OPENSSL="/usr/bin/openssl"

case "$MODE" in
  create|use-existing) ;;
  *) echo "usage: $(basename "$0") [create|use-existing]" >&2; exit 2 ;;
esac

log() { printf '%s\n' "$*" >&2; }

# stdout carries exactly two lines, so callers can read the identity and the
# keychain that holds it without parsing anything else.
emit() {
  printf '%s\n%s\n' "$IDENTITY_NAME" "$KEYCHAIN"
}

unlock_keychain() {
  [ -f "$PASSWORD_FILE" ] || return 1
  security unlock-keychain -p "$(cat "$PASSWORD_FILE")" "$KEYCHAIN" 2>/dev/null
}

identity_is_usable() {
  # -v restricts the listing to identities that pass the code-signing policy,
  # which is the same check codesign itself applies.
  security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null \
    | grep -qF "\"$IDENTITY_NAME\""
}

if [ -f "$KEYCHAIN" ]; then
  unlock_keychain || true
  if identity_is_usable; then
    emit
    exit 0
  fi
fi

if [ "$MODE" = "use-existing" ]; then
  log "No Reader signing identity yet."
  exit 1
fi

log "Creating Reader's local signing identity."
log "macOS will ask for your login password once, to trust the certificate for"
log "code signing. Nothing is sent anywhere and your login keychain is untouched."
log ""

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$SUPPORT_DIR"
chmod 700 "$SUPPORT_DIR"

PASSWORD="$("$OPENSSL" rand -hex 24)"

"$OPENSSL" req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$WORK_DIR/key.pem" -out "$WORK_DIR/cert.pem" \
  -subj "/CN=$IDENTITY_NAME" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null

"$OPENSSL" pkcs12 -export \
  -inkey "$WORK_DIR/key.pem" -in "$WORK_DIR/cert.pem" \
  -out "$WORK_DIR/identity.p12" -passout pass:"$PASSWORD" \
  -name "$IDENTITY_NAME"

# A keychain left over from a half-finished run would hold a certificate whose
# private key no longer matches, so start from a clean one.
if [ -f "$KEYCHAIN" ]; then
  security delete-keychain "$KEYCHAIN" 2>/dev/null || rm -f "$KEYCHAIN"
fi

security create-keychain -p "$PASSWORD" "$KEYCHAIN"
# No arguments resets the lock-on-sleep flag and the inactivity timeout, so the
# keychain does not re-lock between builds. It is unlocked from the stored
# password before every signature regardless.
security set-keychain-settings "$KEYCHAIN"
security unlock-keychain -p "$PASSWORD" "$KEYCHAIN"

( umask 077; printf '%s\n' "$PASSWORD" > "$PASSWORD_FILE" )
chmod 600 "$PASSWORD_FILE"

security import "$WORK_DIR/identity.p12" -k "$KEYCHAIN" -P "$PASSWORD" \
  -f pkcs12 -T /usr/bin/codesign -T /usr/bin/security
# Without a partition list the private key raises a confirmation dialog on
# every single signature instead of none.
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$PASSWORD" "$KEYCHAIN" >/dev/null 2>&1

cp "$WORK_DIR/cert.pem" "$CERT_FILE"
chmod 644 "$CERT_FILE"

# codesign rejects an untrusted identity outright ("no identity found"), so the
# certificate has to be a trusted root for the code-signing policy. -d is
# deliberately absent: this is the user's trust domain, not the system's, and it
# needs no administrator rights.
log "Requesting trust for code signing..."
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$CERT_FILE"

# codesign is given --keychain explicitly, but adding the keychain to this
# user's search list keeps other tooling able to find the identity too. The
# existing entries are preserved; -s replaces the whole list.
search_list=()
while IFS= read -r entry; do
  entry="${entry//\"/}"
  entry="$(printf '%s' "$entry" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  [ -n "$entry" ] && search_list+=("$entry")
done < <(security list-keychains -d user)

already_listed="no"
for entry in ${search_list+"${search_list[@]}"}; do
  [ "$entry" = "$KEYCHAIN" ] && already_listed="yes"
done
if [ "$already_listed" = "no" ] && [ "${#search_list[@]}" -gt 0 ]; then
  security list-keychains -d user -s ${search_list+"${search_list[@]}"} "$KEYCHAIN"
fi

if ! identity_is_usable; then
  log ""
  log "The certificate was created but is still not trusted for code signing."
  log "Open Keychain Access, select the \"$IDENTITY_NAME\" certificate in the"
  log "\"reader-signing\" keychain, and set Code Signing to \"Always Trust\"."
  exit 1
fi

log ""
log "Done. Every build from now on is signed with this identity, so the folder"
log "permissions you grant Reader will outlive its rebuilds."
emit
