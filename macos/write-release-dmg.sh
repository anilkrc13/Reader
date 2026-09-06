#!/bin/bash
# Builds the disk image that lets a first-time install be the familiar drag
# Reader.app into Applications gesture. Run right after write-release-manifest.sh,
# once build/Reader.app exists.
#
#   ./macos/write-release-dmg.sh 2.1.0
#
# Leaves Reader-<version>.dmg at the repository root, beside the zip and
# manifest.json write-release-manifest.sh writes. The zip stays the in-app
# updater's format (it verifies the zip's sha256 and code signature, then
# unpacks it with ditto -x -k) -- this script only adds a second artifact for
# people installing for the first time, and never touches the zip or manifest.

set -euo pipefail

VERSION="${1:?usage: write-release-dmg.sh <version>}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/build/Reader.app"
DMG_NAME="Reader-$VERSION.dmg"
DMG_PATH="$ROOT_DIR/$DMG_NAME"
VOLUME_NAME="Reader $VERSION"

if [ ! -d "$APP_BUNDLE" ]; then
  echo "Missing $APP_BUNDLE; run ./macos/build-app.sh first." >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d "$ROOT_DIR/.reader-dmg.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

# Everything that goes inside the image lives under one payload folder, and
# hdiutil is pointed at that folder itself (a single -srcfolder), never at the
# Applications symlink directly. Passing a symlink as its own -srcfolder makes
# hdiutil follow it and copy the real /Applications folder's entire contents
# into the image instead of preserving it as a symlink; contained inside a
# parent folder, it copies as the symlink it is.
PAYLOAD_DIR="$STAGE_DIR/payload"
mkdir -p "$PAYLOAD_DIR"

# ditto, not cp -R, so the app's code signature (extended attributes and
# resource fork data codesign relies on) survives the copy into the staging
# folder.
ditto "$APP_BUNDLE" "$PAYLOAD_DIR/Reader.app"

# A symlink literally named Applications, sitting next to Reader.app, is what
# makes "drag this onto that" the obvious gesture the same way every other
# macOS app's installer dmg does.
ln -s /Applications "$PAYLOAD_DIR/Applications"

rm -f "$DMG_PATH"

# hdiutil ships with every Mac, including bare CI runners, so it needs no
# extra install step. create-dmg (a common alternative) is a Homebrew formula;
# adding "brew install create-dmg" would mean installing a new dependency on
# every release run for a result hdiutil already produces on its own.
#
# hdiutil create -format UDZO can build a compressed image directly from a
# source folder in one step, but doing that writes the volume name into the
# compressed image without ever mounting a writable copy, and a stray failure
# midway (out of disk, wrong permissions in the staging folder) is harder to
# tell apart from a genuinely bad build. Building an intermediate read-write
# (UDRW) image and then converting it to compressed read-only (UDZO) costs one
# extra step but means the first hdiutil call either fully succeeds with a
# mountable, inspectable image or fails cleanly before compression begins.
RW_DMG_PATH="$STAGE_DIR/Reader-rw.dmg"
hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$PAYLOAD_DIR" \
  -format UDRW \
  -ov \
  "$RW_DMG_PATH" >/dev/null

hdiutil convert "$RW_DMG_PATH" -format UDZO -o "$DMG_PATH" -ov >/dev/null

# Same identity the app itself was signed with -- read the same way
# write-release-manifest.sh does, from codesign's own diagnostic output rather
# than assuming which secrets happen to be set. Signing the dmg with that
# identity is what stops macOS reporting the image itself, separately from the
# app inside it, as from an unidentified developer. An ad-hoc app signature
# prints no Authority= line, and there is no ad-hoc equivalent worth applying
# to a dmg, so skip signing in that case.
SIGNING_IDENTITY="$(codesign -dvv "$APP_BUNDLE" 2>&1 | sed -n 's/^Authority=//p' | head -n1)"
if [ -n "$SIGNING_IDENTITY" ]; then
  # An unsigned image beside a signed app would be a confusing release, but it
  # is still an installable one, so say so loudly rather than failing the whole
  # release. This is the shape of the one CI ordering mistake worth catching:
  # the identity lives in a keychain the workflow tears down, so signing here
  # only works while that keychain is still around.
  if ! codesign --force --sign "$SIGNING_IDENTITY" "$DMG_PATH"; then
    echo "warning: could not sign $DMG_NAME with \"$SIGNING_IDENTITY\"." >&2
    echo "The signing keychain may already have been removed." >&2
  fi
else
  echo "App is signed ad-hoc; leaving $DMG_NAME unsigned." >&2
fi

# Verify the image actually behaves like an installer before calling this
# done: mount it, check both expected entries are there, and make sure the app
# inside still passes the same signature check build-app.sh already ran.
MOUNT_DIR="$STAGE_DIR/mount"
mkdir -p "$MOUNT_DIR"

cleanup_mount() {
  hdiutil detach "$MOUNT_DIR" -quiet -force >/dev/null 2>&1 || true
}
trap 'cleanup_mount; rm -rf "$STAGE_DIR"' EXIT

hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_DIR" >/dev/null

if [ ! -d "$MOUNT_DIR/Reader.app" ]; then
  echo "Mounted image is missing Reader.app." >&2
  exit 1
fi

if [ ! -L "$MOUNT_DIR/Applications" ]; then
  echo "Mounted image is missing the Applications symlink." >&2
  exit 1
fi

if ! codesign --verify --deep --strict "$MOUNT_DIR/Reader.app"; then
  echo "Reader.app inside the mounted image failed signature verification." >&2
  exit 1
fi

cleanup_mount
trap 'rm -rf "$STAGE_DIR"' EXIT

echo "Wrote $DMG_NAME"
