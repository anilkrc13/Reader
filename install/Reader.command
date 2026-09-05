#!/bin/bash
# Double-click this file in Finder to launch Reader. It deliberately uses the
# same native app as the direct launch path, so server ownership and adaptive
# Dock icons stay unified.
#
# The app it opens has to live outside this git checkout, at
# ~/Applications/Reader.app, not the sibling install/Reader.app built here.
# The in-app updater (once it lands) replaces a release's app bundle in place
# on disk; doing that inside a git working tree would leave the checkout with
# uncommitted changes nobody made and a bundle git no longer recognises. A
# copy in ~/Applications is free to be overwritten like any other installed
# app, the same way Reader.app already behaves when it comes from a Release
# zip instead of a local build.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILT_APP="$SCRIPT_DIR/Reader.app"
INSTALLED_APP="$HOME/Applications/Reader.app"

# A local build that is newer than the installed copy replaces it, so a
# developer who has just run build-app.sh sees that build rather than the
# release the updater last installed.
if [ -d "$INSTALLED_APP" ] && ! [ "$BUILT_APP" -nt "$INSTALLED_APP" ]; then
  open "$INSTALLED_APP"
  exit 0
fi

if [ ! -d "$BUILT_APP" ]; then
  echo "Building Reader.app…"
  if ! "$PROJECT_DIR/macos/build-app.sh"; then
    echo ""
    echo "Reader could not build its native app. Open Xcode once, then try again."
    echo ""
    read -r -p "Press Return to close. " _
    exit 1
  fi
fi

mkdir -p "$HOME/Applications"
rm -rf "$INSTALLED_APP"
ditto "$BUILT_APP" "$INSTALLED_APP"
open "$INSTALLED_APP"
