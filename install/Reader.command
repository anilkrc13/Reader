#!/bin/bash
set -euo pipefail
# Double-click this file in Finder to update Reader from source and launch it.
# It quits the installed app, rebuilds from whatever is checked out, installs
# the fresh build over ~/Applications/Reader.app, and reopens it. That makes
# it the one-step way for someone running Reader day to day out of
# ~/Applications to pick up newly merged code: `open` on its own would just
# reactivate the already-running app rather than the new binary, and a plain
# rebuild leaves the old install running until something replaces it.
#
# The app it opens has to live outside this git checkout, at
# ~/Applications/Reader.app, not build/Reader.app produced by build-app.sh.
# The in-app updater (once it lands) replaces a release's app bundle in place
# on disk; doing that inside a git working tree would leave the checkout with
# uncommitted changes nobody made and a bundle git no longer recognises. A
# copy in ~/Applications is free to be overwritten like any other installed
# app, the same way Reader.app already behaves when it comes from a Release
# zip instead of a local build.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILT_APP="$PROJECT_DIR/build/Reader.app"
INSTALLED_APP="$HOME/Applications/Reader.app"
BUNDLE_ID="ai.trancend.reader"

# "application id ... is running" is the AppleScript idiom that answers the
# question without itself launching the app, unlike "tell application id ...".
is_reader_running() {
  [ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" = "true" ]
}

echo "Step 1/4: Checking for a running Reader..."
if is_reader_running; then
  # A normal quit (not kill/pkill) lets the app stop the local server it owns
  # before it exits. Targeting the bundle id, not the process name, means a
  # different app that happens to be called Reader is never touched.
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null
  for _ in $(seq 1 20); do
    is_reader_running || break
    sleep 0.5
  done
  if is_reader_running; then
    echo ""
    echo "Reader did not quit within 10 seconds. Quit Reader yourself, then run this again."
    echo ""
    read -r -p "Press Return to close. " _
    exit 1
  fi
fi

# This is now an update action, not a first-time install, so the build always
# runs: reusing whatever happened to be in build/Reader.app already would
# silently reinstall stale code, exactly the failure mode this script exists
# to remove. The old "only build if missing, only copy if newer" checks are
# gone for the same reason.
echo "Step 2/4: Building Reader from source..."
if ! "$PROJECT_DIR/macos/build-app.sh"; then
  echo ""
  echo "Reader could not build its native app. Open Xcode once, then try again."
  echo ""
  read -r -p "Press Return to close. " _
  exit 1
fi

# Nothing above this line touches the installed app, so a failed build above
# leaves it untouched and still working. Only a successful build reaches here.
echo "Step 3/4: Installing the new build..."
mkdir -p "$HOME/Applications"
rm -rf "$INSTALLED_APP"
ditto "$BUILT_APP" "$INSTALLED_APP"

echo "Step 4/4: Launching Reader..."
open "$INSTALLED_APP"
