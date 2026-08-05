#!/bin/bash
# Double-click this file in Finder to start Reader.
# Keep the Terminal window open while you use the app; close it (or press
# Control-C) to stop the server.

cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo ""
  echo "  Reader needs Python 3, which was not found on this Mac."
  echo ""
  echo "  Install Apple's command line tools (they include Python 3) by running:"
  echo ""
  echo "      xcode-select --install"
  echo ""
  echo "  Then double-click this file again."
  echo ""
  read -r -p "  Press Return to close. " _
  exit 1
fi

exec python3 reader.py "$@"
