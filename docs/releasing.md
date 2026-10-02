# Cutting a release

Reader's releases are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml), triggered by
pushing a tag. It also supports a dispatch from `main` to publish the plugin
marketplace without creating a release tag. Tagged releases keep the Mac app
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
3. Commit both files.
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
   named after the tag. Only after that succeeds does it update the Git marketplace.

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

The same workflow publishes generated files to the `plugin-marketplace` branch
in this repository. The branch contains:

```
.agents/plugins/marketplace.json
release.json
versions/<version>/plugins/reader-markdown/
```

The generated catalog is named `reader-github`. Its local source path resolves
inside the fetched distribution branch, not on the developer’s machine. The
publisher creates this catalog; it never copies the checkout’s private `.agents`
state. `release.json` records source commit, version, repository, and file hashes.
Previous version folders remain available. Ordinary commits and pushes retain
history. A changed existing version, downgrade, or conflicting push fails rather
than overwriting published history. Retry the workflow only after resolving the
reported problem. A newer bundle needs a new `VERSION` before publication.

Release runs are serialized. A package failure prevents Mac publication. A Mac
release failure prevents the marketplace update. A marketplace failure marks
the workflow failed even if the GitHub release was already created. The branch
and ZIP are built from the same validated bundle. Generated files stay under
`build/` locally and never enter the source branch.

For the initial marketplace, run the existing workflow from merged `main`:

```
gh workflow run release.yml --ref main
```

This dispatch builds and publishes only the plugin marketplace and keeps its
ZIP as an Actions artifact. It skips the Mac job and creates no tag or GitHub
Release. Dispatches from other branches are skipped. Future version tags publish
all release assets through the same workflow. A bootstrap version cannot be
replaced with different source or tag provenance; bump `VERSION` for the next
tagged publication. Do not run this command until publication is intended.

After a successful publication, register the marketplace and install Reader:

```
codex plugin marketplace add anilkrc13/Reader --ref plugin-marketplace
codex plugin add reader-markdown@reader-github
```

Refresh the catalog with `codex plugin marketplace upgrade reader-github`,
then refresh/install Reader through the supported plugin interface. Pin an
existing distribution commit with `--ref <commit>` when a fixed snapshot is
needed. Node 22 or newer must be available to run the bundled stdio server.
See [official plugin packaging guidance](https://developers.openai.com/plugins/build/plugins)
for Git marketplace setup. Successful distribution does not prove real host
file routing; retain the [host acceptance checks](embedded-acceptance.md).
