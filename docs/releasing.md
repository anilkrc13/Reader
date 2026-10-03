# Cutting a release

Reader's releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml), triggered by
pushing a tag. It also supports a dispatch from `main` to validate and archive the committed
production plugin package without creating a release tag. Tagged releases keep the Mac app
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
   named after the tag. Publishing the production marketplace branch is a separate action.

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

Reader uses one implementation and one Git branch, `main`. The tracked catalog
and ready package always have production identities. Local development is a
separate generated marketplace, ignored by Git.

| Source | Display name | Catalog | Plugin and MCP configuration key |
| --- | --- | --- | --- |
| GitHub `main` | Reader | `reader-github` | `reader-markdown` |
| Local `build/reader-dev` | Reader - Dev | `reader-dev` | `reader-markdown-dev` |

### Local development

Install the pinned build dependencies once, then build the current working tree:

```sh
npm ci --prefix src/reader/chatgpt --ignore-scripts
npm run build:dev
```

This includes saved, uncommitted edits under `src/reader`. It first builds the
production input into `build/chatgpt`, then derives the development identity into
`build/reader-dev`. It changes no tracked package or catalog. Both marketplace
and plugin display **Reader - Dev**. Runtime files, assets, and licenses match
that source build byte for byte; only plugin identity, label, and MCP key differ.
All catalog and MCP paths are relative to their own package roots.

Register this generated root, using the actual checkout path on your computer:

```sh
codex plugin marketplace add /path/to/Reader/build/reader-dev
codex plugin add reader-markdown-dev@reader-dev
```

Registering `/path/to/Reader` instead discovers production **Reader**. Do not
edit its tracked label to make it development. Re-run `npm run build:dev` after
local edits. The generated package is a snapshot, not a source watcher.
Generation does not update an installed plugin. Refresh the development install
with the host's supported update or reload action and verify its active package
before testing; automatic refresh and live desktop behavior remain unverified.

The generator only writes owned files. It rejects unknown files, catalog
settings, source/output overlap, and symlink destinations before writing. It
preserves unrelated repository state and performs no host registration or install.

### Keep GitHub main installable

When preparing a source change for GitHub, regenerate the tracked production
package from the same source build and verify freshness:

```sh
npm run build:chatgpt
python3 scripts/plugin_release.py sync \
  --plugin-dir build/chatgpt --version-file VERSION \
  --repository-root . --repository-url https://github.com/anilkrc13/Reader
python3 scripts/plugin_release.py check \
  --plugin-dir build/chatgpt --version-file VERSION \
  --repository-root . --repository-url https://github.com/anilkrc13/Reader
```

Commit `.agents/plugins/marketplace.json`, `plugins/reader-markdown`, and
`plugins/release.json` with the source change. `check` is read only and compares
production identities, all bytes, hashes, version, and relative catalog paths.
CI rebuilds with pinned dependencies and rejects stale generated files. Git
installation uses the ready package and runs no build. No release tag, separate
branch, or publishing workflow is needed for this GitHub install route:

```sh
codex plugin marketplace add https://github.com/anilkrc13/Reader --ref main
codex plugin add reader-markdown@reader-github
```

`sync` can repair the exact development catalog generated by PR40 into production.
It also accepts the owned legacy catalog with a label-only edit. It refuses
unknown catalog settings, extra package files, or symlinks rather than overwriting
them. Neither generation nor Git changes migrate host registrations. A machine
registered to the old local root should register `build/reader-dev` as its dev
source; authorize installation changes separately. Existing unrelated installs
are preserved. Do not assume paths from another computer exist.

The bundled Codex CLI supports local marketplace roots and separate catalog
names. Read-only discovery with temporary configuration overrides can verify
both packages without changing global registration. Actual installation, viewer
routing, cache refresh, and simultaneous desktop activation require host checks.
See [embedded acceptance](embedded-acceptance.md). A marketplace refresh alone
is not proof that an installed plugin updated.

### Optional versioned release archive

The existing release workflow can still archive the production build, and tags
still publish the Mac and plugin assets. This is independent of GitHub marketplace
installation from `main`. This correction does not bump `VERSION` or create a
release. To stage an optional archive locally:

```sh
python3 scripts/plugin_release.py stage \
  --plugin-dir build/chatgpt --version-file VERSION \
  --source-commit "$(git rev-parse HEAD)" \
  --repository-url https://github.com/anilkrc13/Reader \
  --output-dir build/plugin-marketplace --archive-dir build/releases
```

Destinations must be unused ordinary paths without symlink parents. The stage
validates production identity, complete files, catalog, and hashes. It writes a
self-contained tree plus `Reader-plugin-<version>.zip`, with `reader-markdown/`
at the ZIP root, without changing either local development or tracked production.
A tagged release adds `--tag v<version>`, matching `VERSION`. The ZIP includes
runtime, manifests, artwork, project license, and shared and bundled npm notices.
The Mac updater still consumes only its Mac manifest.

For release provenance, build from a completed clean source commit and supply
its exact SHA. A dirty checkout stage is only a local preview; validating SHA
format does not prove source freshness. No script commits or pushes anything.
