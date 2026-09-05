#!/bin/bash
# Pulls one version's section out of CHANGELOG.md to use as GitHub release
# notes, so the notes never drift from what CHANGELOG.md already says. Falls
# back to a generic line rather than failing the release outright, since a
# missing changelog entry is a documentation gap, not a build problem.
#
#   ./macos/extract-changelog.sh 2.1.0

set -euo pipefail

VERSION="${1:?usage: extract-changelog.sh <version>}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="$ROOT_DIR/CHANGELOG.md"
HEADING="## $VERSION"

if [ -f "$CHANGELOG" ] && grep -qxF "$HEADING" "$CHANGELOG"; then
  awk -v heading="$HEADING" '
    $0 == heading { found = 1; next }
    found && /^## / { exit }
    found { print }
  ' "$CHANGELOG"
else
  printf 'Reader %s.\n' "$VERSION"
fi
