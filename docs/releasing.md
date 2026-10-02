# Cutting a release

Reader's releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml), triggered by
pushing a tag. It also supports a dispatch from `main` to validate and archive the committed
development plugin package and stage production without creating a release tag. Tagged releases keep the Mac app
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

Reader uses one implementation and two logical identities:

| Channel | Display name | Catalog | Plugin and MCP configuration key | Source |
| --- | --- | --- | --- | --- |
| Development | Reader-Dev | `reader-dev` | `reader-markdown-dev` | Checkout / `main` |
| Production | Reader | `reader-github` | `reader-markdown` | Proposed `reader-release` branch |

The distinct catalog and plugin names prevent the development checkout from
sharing production's discovery identity. The physical package folder remains
`plugins/reader-markdown` in both trees; manifests determine identity. The
existing local label edit is carried forward as `Reader-Dev`. No installed plugin
or configured marketplace is migrated by generation. Host discovery and existing
registrations need verification after a separately authorized registration change.

### Generate development and stage production

The Node build emits production manifests into `build/chatgpt`. `sync` derives
only the development manifest and MCP key; runtime files, branding, and licenses
are identical. The checkout tracks the development catalog, package, and hash
record. Edit `src/reader`, then regenerate them:

```sh
npm run build:chatgpt
python3 scripts/plugin_release.py sync \
  --plugin-dir build/chatgpt --version-file VERSION \
  --repository-root . --repository-url https://github.com/anilkrc13/Reader
python3 scripts/plugin_release.py check \
  --plugin-dir build/chatgpt --version-file VERSION \
  --repository-root . --repository-url https://github.com/anilkrc13/Reader
```

`sync` owns `.agents/plugins/marketplace.json`, `plugins/reader-markdown`, and
`plugins/release.json`. It accepts the legacy Reader catalog with a label-only
edit, and refuses unknown catalog settings, extra files, or symlinks before
writing. Private assistant state and other plugin folders are preserved. `check`
is read only and compares all development bytes, hashes, versions, and catalog
paths. CI rebuilds with pinned dependencies and rejects stale generated files.

Production staging uses the production build, never the development package:

```sh
python3 scripts/plugin_release.py stage \
  --plugin-dir build/chatgpt --version-file VERSION \
  --source-commit "$(git rev-parse HEAD)" \
  --repository-url https://github.com/anilkrc13/Reader \
  --output-dir build/plugin-marketplace --archive-dir build/releases
```

Destinations must be unused ordinary paths without symlink parents. Staging
validates the production identity, complete file set, catalog, and hashes. It
writes a production tree plus `Reader-plugin-<version>.zip` without rewriting the
development catalog, package, or source build. A tagged release adds
`--tag v<version>`, matching `VERSION`. The ZIP has a `reader-markdown/` root and
includes the server, viewer, manifests, artwork, project license, shared notices,
and bundled npm notices. The Mac updater still consumes only its Mac manifest.

For publishable provenance, regenerate from a completed clean source commit and
supply that exact SHA. A dirty checkout stage is only a local preview; the SHA
format check does not establish source freshness. This identity preparation is
unreleased and retains the current version. A release must bump `VERSION` and
add its `CHANGELOG.md` entry.

### Proposed production source and publication boundary

Production consumers should fetch `https://github.com/anilkrc13/Reader` at the
explicit `reader-release` ref. The branch must contain the entire validated
staging tree:

```
.agents/plugins/marketplace.json  # reader-github, displayed as Reader
plugins/reader-markdown/         # production manifests and complete ready package
release.json                    # version, source commit/tag, repository URL, hashes
```

Git installation does not execute the build. Publishing only a catalog that
points to development files would therefore install the wrong identity. `main`
remains the development source; a plain repository URL would select that channel
after these changes land. The proposed `reader-release` branch is not created or
published by this change. The legacy `plugin-marketplace` branch is unused and
retained as history.

The release workflow checks development, stages production, and uploads Actions
artifacts. Tagged runs also publish Mac and plugin release assets. Neither it nor
the local generator commits or pushes a distribution branch. Production branch
publication, marketplace source migration, and installation require separate
authorization. Publish the validated staged contents from a clean source commit
before changing any production registration, then verify branch/ref, identities,
package hashes, and real host acceptance on a machine without the checkout.

### Installation and update semantics

After the proposed branch has been published, the production CLI route is:

```sh
codex plugin marketplace add https://github.com/anilkrc13/Reader --ref reader-release
codex plugin add reader-markdown@reader-github
```

For local development, after generation, the separate route is:

```sh
codex plugin marketplace add /path/to/Reader
codex plugin add reader-markdown-dev@reader-dev
```

These are instructions, not actions performed by the generator. An existing
`reader-github` source using `main` or the local checkout must be explicitly
migrated to the production ref through the host's marketplace management. Adding
another source is not proof that an existing registration changed. Existing
installed identities and cached packages are untouched by this repository change.

The installed CLI documents `--ref` for Git source selection and
`codex plugin marketplace upgrade reader-github` for refreshing the configured Git
snapshot. A catalog refresh does not prove that an installed plugin updated.
Automatic installed-plugin updates have not been verified; use the host's update
action and check its installed version and identity on each machine. Real file
routing and refresh still require [host acceptance](embedded-acceptance.md).

A manual workflow dispatch from merged `main` validates and archives the packages
without publishing the production branch, creating a tag, or running the Mac job.
Dispatches from other branches are skipped.
