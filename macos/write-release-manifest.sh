#!/bin/bash
# Zips the built app bundle the way Finder expects and writes the manifest the
# in-app updater reads to decide whether a newer build exists. Kept as one
# script, run right after build-app.sh, because the manifest's sha256 and size
# have to describe the exact zip the release step attaches -- computing them
# anywhere else risks the two drifting apart.
#
#   ./macos/write-release-manifest.sh 2.1.0
#
# Leaves Reader-<version>.zip and manifest.json at the repository root.

set -euo pipefail

VERSION="${1:?usage: write-release-manifest.sh <version>}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/install/Reader.app"
ZIP_NAME="Reader-$VERSION.zip"
ZIP_PATH="$ROOT_DIR/$ZIP_NAME"

if [ ! -d "$APP_BUNDLE" ]; then
  echo "Missing $APP_BUNDLE; run ./macos/build-app.sh first." >&2
  exit 1
fi

# -c -k --keepParent produces a zip Finder and Archive Utility open the same
# way a user's own "Compress" would -- plain ditto without --keepParent nests
# the bundle's contents at the top level instead of inside Reader.app/.
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"

SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
SIZE="$(stat -f%z "$ZIP_PATH")"
MIN_MACOS="$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$APP_BUNDLE/Contents/Info.plist")"
PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# codesign's own diagnostic output says what actually signed the bundle, which
# is a better source of truth than remembering which secrets happened to be
# set. An ad-hoc signature prints no Authority= line at all.
SIGNING_IDENTITY="$(codesign -dvv "$APP_BUNDLE" 2>&1 | sed -n 's/^Authority=//p' | head -n1)"
SIGNING_IDENTITY="${SIGNING_IDENTITY:-ad-hoc}"

URL="https://github.com/anilkrc13/Reader/releases/download/v$VERSION/$ZIP_NAME"

cat > "$ROOT_DIR/manifest.json" <<JSON
{
  "version": "$VERSION",
  "url": "$URL",
  "sha256": "$SHA256",
  "size": $SIZE,
  "minimum_macos": "$MIN_MACOS",
  "published_at": "$PUBLISHED_AT",
  "signing_identity": "$SIGNING_IDENTITY"
}
JSON

echo "Wrote $ZIP_NAME and manifest.json"
