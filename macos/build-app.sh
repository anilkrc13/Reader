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
chmod +x "$MACOS_BIN_DIR/ReaderLauncher"
rm -f "${OBJECTS[@]}"

# Sign the complete bundle so Info.plist and resources are bound to one app
# identity. A configured Apple Development/Developer ID identity remains stable
# across rebuilds; '-' is a valid ad-hoc fallback for local development.
CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:--}"
codesign --force --deep --sign "$CODE_SIGN_IDENTITY" \
  --identifier "com.reader.local" "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

echo "Built $APP_BUNDLE"
