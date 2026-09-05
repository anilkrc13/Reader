#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
INSTALL_DIR="$ROOT_DIR/install"
APP_BUNDLE="$INSTALL_DIR/Reader.app"
RESOURCES_DIR="$APP_BUNDLE/Contents/Resources"
MACOS_BIN_DIR="$APP_BUNDLE/Contents/MacOS"
WORK_DIR="$(mktemp -d "$ROOT_DIR/.reader-build.XXXXXX")"
ICON_PARTIAL_PLIST="$WORK_DIR/ReaderIcon-PartialInfo.plist"

trap 'rm -rf "$WORK_DIR"' EXIT

ARCHS_STRING="${ARCHS:-arm64}"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
MIN_MACOS="13.0"

mkdir -p "$INSTALL_DIR"
rm -rf "$APP_BUNDLE"
mkdir -p "$RESOURCES_DIR" "$MACOS_BIN_DIR"

cp "$ROOT_DIR/reader.py" "$RESOURCES_DIR/reader.py"
cp "$ROOT_DIR/VERSION" "$RESOURCES_DIR/VERSION"
cp "$ROOT_DIR/reader_backend.py" "$RESOURCES_DIR/reader_backend.py"
ditto "$ROOT_DIR/static" "$RESOURCES_DIR/static"
cp "$MACOS_DIR/Assets/ReaderDockIcon-Light.png" "$RESOURCES_DIR/ReaderDockIcon-Light.png"
cp "$MACOS_DIR/Assets/ReaderDockIcon-Dark.png" "$RESOURCES_DIR/ReaderDockIcon-Dark.png"
if [ -d "$ROOT_DIR/licenses" ]; then
  ditto "$ROOT_DIR/licenses" "$RESOURCES_DIR/licenses"
fi

ICON_SOURCE="$MACOS_DIR/Assets/ReaderIcon.icon"
if [ ! -d "$ICON_SOURCE" ]; then
  echo "Missing icon source: $ICON_SOURCE" >&2
  exit 1
fi

# Xcode 26 compiles the Icon Composer source into both Assets.car (the
# appearance-aware Tahoe representation) and ReaderIcon.icns (the static
# Default-appearance fallback used by earlier macOS releases).
xcrun actool \
  --compile "$RESOURCES_DIR" \
  --platform macosx \
  --minimum-deployment-target "$MIN_MACOS" \
  --app-icon ReaderIcon \
  --output-partial-info-plist "$ICON_PARTIAL_PLIST" \
  "$ICON_SOURCE"

for icon_output in "$RESOURCES_DIR/Assets.car" "$RESOURCES_DIR/ReaderIcon.icns"; do
  if [ ! -f "$icon_output" ]; then
    echo "Icon compilation did not produce: $icon_output" >&2
    exit 1
  fi
done

read -r -a ARCHS <<< "$ARCHS_STRING"
OBJECTS=()
for arch in "${ARCHS[@]}"; do
  output="$WORK_DIR/ReaderLauncher-$arch"
  swiftc -O -whole-module-optimization \
    -target "$arch-apple-macosx$MIN_MACOS" \
    -sdk "$SDK_PATH" \
    -framework Cocoa \
    -framework WebKit \
    "$MACOS_DIR/ReaderLauncher.swift" \
    -o "$output"
  OBJECTS+=("$output")
done

if [ "${#OBJECTS[@]}" -eq 1 ]; then
  cp "${OBJECTS[0]}" "$MACOS_BIN_DIR/ReaderLauncher"
else
  lipo -create "${OBJECTS[@]}" -output "$MACOS_BIN_DIR/ReaderLauncher"
fi

cp "$MACOS_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
# The VERSION file is the single source of truth; stamp it into the bundle so
# the launcher, the server and the About panel all report the same number.
APP_VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/VERSION")"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$APP_BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_VERSION" "$APP_BUNDLE/Contents/Info.plist"
chmod +x "$MACOS_BIN_DIR/ReaderLauncher"
rm -f "${OBJECTS[@]}"

# Sign the complete bundle so Info.plist and resources are bound to one app
# identity. That identity wants to be the same one every time: macOS keys
# folder-access consent to it, and an ad-hoc signature produces a fresh identity
# on every build, which silently revokes every permission already granted.
#
# Order of preference:
#   1. CODE_SIGN_IDENTITY, if you have an Apple Development/Developer ID cert.
#   2. Reader's own per-user self-signed identity, created on first use.
#   3. Ad-hoc, so a build never fails outright -- with the caveat spelled out.
SIGN_ARGS=()
if [ -n "${CODE_SIGN_IDENTITY:-}" ]; then
  SIGN_IDENTITY="$CODE_SIGN_IDENTITY"
else
  ENSURE="$MACOS_DIR/ensure-signing-identity.sh"
  IDENTITY_MODE="use-existing"
  # Creating the identity needs one password authorisation, so only reach for it
  # when there is a person at a terminal to answer. Set READER_SIGNING=create to
  # force it from a script.
  if [ -t 1 ] || [ "${READER_SIGNING:-}" = "create" ]; then
    IDENTITY_MODE="create"
  fi
  if IDENTITY_INFO="$("$ENSURE" "$IDENTITY_MODE")"; then
    SIGN_IDENTITY="$(printf '%s' "$IDENTITY_INFO" | sed -n 1p)"
    SIGN_KEYCHAIN="$(printf '%s' "$IDENTITY_INFO" | sed -n 2p)"
    SIGN_ARGS+=(--keychain "$SIGN_KEYCHAIN")
  else
    SIGN_IDENTITY="-"
    echo "Signing ad-hoc. macOS will re-ask for folder permissions after each" >&2
    echo "build; run ./macos/ensure-signing-identity.sh once to stop that." >&2
  fi
fi

codesign --force --deep --sign "$SIGN_IDENTITY" \
  ${SIGN_ARGS+"${SIGN_ARGS[@]}"} \
  --identifier "com.reader.local" "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

echo "Built $APP_BUNDLE"
