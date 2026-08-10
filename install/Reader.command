#!/bin/bash
# Double-click this file in Finder to launch the sibling Reader.app bundle.
# It deliberately uses the same native app as the direct launch path, so
# server ownership and adaptive Dock icons stay unified.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_BUNDLE="$SCRIPT_DIR/Reader.app"

if [ ! -d "$APP_BUNDLE" ]; then
  echo "Building Reader.app…"
  if ! "$PROJECT_DIR/macos/build-app.sh"; then
    echo ""
    echo "Reader could not build its native app. Open Xcode once, then try again."
    echo ""
    read -r -p "Press Return to close. " _
    exit 1
  fi
fi

open "$APP_BUNDLE"
