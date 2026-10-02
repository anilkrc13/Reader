# Cutting a release

Reader's releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml), triggered by
pushing a tag. It also supports a dispatch from `main` to validate and archive the committed
plugin package without creating a release tag. Tagged releases keep the Mac app
and plugin on the same versioned source.

## Cutting a release

1. Bump [`VERSION`](../VERSION) at the repository root to the new version, for example
   `2.1.0`.
2. Rename the `## Unreleased` section in [`CHANGELOG.md`](../CHANGELOG.md) to `## 2.1.0`; merged
   pull requests add their entries there as they land, so the section should
   already describe what changed. The release workflow copies this section
   verbatim into the GitHub release notes; a missing section falls back to a
   generic one-line note, so it is worth checking it is accurate before
   tagging.
3. Rebuild and sync the ready plugin package using the commands below. Commit
   the version, changelog, catalog, and generated package together through a PR.
4. Tag the commit and push the tag:

   ```
   git tag v2.1.0
   git push origin v2.1.0
   ```

   The workflow refuses to run if the tag (without its leading `v`) does not
   match `VERSION`, so tagging the wrong commit fails loudly instead of
   shipping the wrong build.
5. Watch the Actions run. It builds `Reader.app`, verifies the signature,
   zips it, writes `manifest.json`, builds a `.dmg` of the same build, and
   publishes those assets plus `Reader-plugin-<version>.zip` as a GitHub Release
   named after the tag. The marketplace package is already on `main`.

## Two artifacts, two purposes

Every release carries both a zip and a `.dmg` of the same signed
`Reader.app`, built one after the other from the same bundle, but they serve
different consumers and neither can stand in for the other:

- **The zip** (`Reader-<version>.zip`, built by [`write-release-manifest.sh`](../src/reader/macos/scripts/write-release-manifest.sh))
  is what the in-app updater downloads. It only ever talks to `manifest.json`,
  which points at the zip and carries its sha256 and size; the updater
  verifies both plus the code signature before unpacking it with
  `ditto -x -k`. Its format (`ditto -c -k --keepParent`) is load-bearing for
  that unpack step and must not change.
- **The `.dmg`** (`Reader-<version>.dmg`, built by [`write-release-dmg.sh`](../src/reader/macos/scripts/write-release-dmg.sh)) is
  for a first-time install: mount it, and drag `Reader.app` onto the
  `Applications` symlink inside, the familiar macOS installer gesture. The
  updater never reads or produces a `.dmg`; it exists purely for people
  downloading Reader for the first time from the Releases page.

## Signing releases (one-time setup)

Without a signing identity, the workflow still produces a release, but the
app is signed ad-hoc, which loses folder permissions on every future rebuild
(see [`docs/macos.md`](macos.md)) and gives the in-app updater nothing stable to trust
across versions. Set it up once:

1. On a Mac that already has Reader's local signing identity (run
   [`./src/reader/macos/scripts/ensure-signing-identity.sh`](../src/reader/macos/scripts/ensure-signing-identity.sh) first if it does not), export it:

   ```
   ./src/reader/macos/scripts/export-signing-identity.sh /tmp/reader-signing.p12 /tmp/reader-signing.p12.base64
   ```

   This writes the certificate and private key as a password-protected
   `.p12`, its base64 form (what a GitHub secret holds), and the export
   password, all to files rather than the terminal. It prints the exact
   `gh secret set` commands to run next.
2. Run those commands to set `READER_SIGNING_P12_BASE64` and
   `READER_SIGNING_P12_PASSWORD` on the repository.
3. Delete the temporary files the export script wrote. They are a copy of
   your private signing key.

From then on, every tagged push is signed with "Reader Local Signing" instead
of ad-hoc, as long as the two secrets remain set.

## Installing the same identity on another Mac

Development happens on more than one machine, but the signing identity has to
be the same certificate everywhere, or Gatekeeper and the updater see it as a
different app each time. Copy the `.p12` file [`export-signing-identity.sh`](../src/reader/macos/scripts/export-signing-identity.sh)
wrote (not its base64 form) to the other Mac, then:

```
./src/reader/macos/scripts/import-signing-identity.sh reader-signing.p12
```

It installs the identity into Reader's own keychain at the same path
`ensure-signing-identity.sh` uses, trusts the certificate for code signing,
and writes the keychain's own password so [`build-app.sh`](../src/reader/macos/scripts/build-app.sh) can unlock it
without a prompt. Safe to run again; it replaces the identity in place rather
than erroring.

## What the manifest means

Every release includes `manifest.json` alongside the zip, for an in-app
updater to read:

| Field | Meaning |
|---|---|
| `version` | The release's version, matching `VERSION` and the tag. |
| `url` | Direct download URL for the release's zip. |
| `sha256` | SHA-256 of the zip, to verify the download before unzipping it over an existing install. |
| `size` | Size of the zip in bytes, for a progress bar. |
| `minimum_macos` | The lowest macOS version the app declares support for (`LSMinimumSystemVersion` in [`Info.plist`](../src/reader/macos/Info.plist)). |
| `published_at` | When the release was built, in ISO 8601 UTC. |
| `signing_identity` | The common name of the certificate that signed the app, or `"ad-hoc"` if none was configured. An updater can refuse to install a build whose identity does not match the one it already trusts. |

Local release files and their manifest are generated under `build/releases/`.
Published asset names and updater URLs are unchanged. Native build and DMG
staging also stay under `build`. Nothing is published by these local scripts.

## Plugin package and Git marketplace

The existing Release workflow builds the bundled plugin with pinned Node
dependencies before starting the Mac release job. `scripts/plugin_release.py`
checks the manifest against `VERSION` and the release tag. It requires the
server, viewer, branding, project license, shared notices, and bundled npm notices.
Unexpected files, missing files, and symlinks fail the job before publication.

`Reader-plugin-<version>.zip` contains a `reader-markdown/` folder with the
portable plugin at its root. It joins the Mac ZIP, DMG, and updater manifest
on each tagged GitHub release. The updater still reads only its existing Mac
manifest. Git marketplace installation uses exploded files rather than this ZIP.

The repository's default `main` branch contains everything needed to discover
and install Reader:

```
.agents/plugins/marketplace.json
plugins/release.json
plugins/reader-markdown/
```

The public catalog is named `reader-github`. Its source path is
`./plugins/reader-markdown`, within the fetched repository. This is the only
public file under `.agents`; other assistant state and root `AGENTS.md` remain
ignored. `plugins/release.json` records the version, repository URL, and all
package hashes. Source commit and tag provenance belong to the staged release
artifact, where they can refer to a completed commit.

The ready package is generated output approved for tracking on `main`. Edit
`src/reader`, then regenerate it before opening the source PR:

```sh
npm run build:chatgpt
python3 scripts/plugin_release.py sync \
  --plugin-dir build/chatgpt --version-file VERSION \
  --repository-root . --repository-url https://github.com/anilkrc13/Reader
python3 scripts/plugin_release.py check \
  --plugin-dir build/chatgpt --version-file VERSION \
  --repository-root . --repository-url https://github.com/anilkrc13/Reader
```

`sync` owns the public catalog, package files, and hash manifest. It preserves
other plugin folders and private assistant state. Unexpected files and symlinks
in the package fail validation. `check` never writes or repairs files. CI rebuilds
from pinned dependencies and compares every package byte, version, catalog path,
and hash. A stale committed package blocks delivery. A release version change
requires regeneration; moving identical files does not require a version bump.

Release automation rebuilds, checks, and archives the committed package. It
never commits or pushes catalog changes, so it cannot bypass branch protection
or trigger itself through a generated commit. A package failure prevents Mac
publication. The existing `plugin-marketplace` branch is unused and is retained
only as history; neither discovery nor release automation depends on it.

A manual validation run from merged `main` is available:

```sh
gh workflow run release.yml --ref main
```

It keeps the package and ZIP as Actions artifacts. It skips the Mac job and
creates no tag or GitHub Release. Dispatches from other branches are skipped.

## Install from GitHub

Add `https://github.com/anilkrc13/Reader` in the desktop marketplace UI. No branch
selection is needed. The supported CLI equivalent is:

```sh
codex plugin marketplace add https://github.com/anilkrc13/Reader
codex plugin add reader-markdown@reader-github
```

The package needs Node 22 or newer on the host path. It needs no local build,
source checkout, or dependency install. Refresh discovery with
`codex plugin marketplace upgrade reader-github`, then use the host's plugin
update action. The plugin has no document settings file; embedded display
preferences remain owned by the host viewer. Real file routing still needs
[host acceptance](embedded-acceptance.md).
