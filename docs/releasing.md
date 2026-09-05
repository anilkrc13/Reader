# Cutting a release

Reader's releases are built by `.github/workflows/release.yml`, triggered by
pushing a tag. This is how to cut one, and how to sign it so it is not merely
ad-hoc.

## Cutting a release

1. Bump `VERSION` at the repository root to the new version, for example
   `2.1.0`.
2. Add a `## 2.1.0` section to `CHANGELOG.md`, above `## 2.0`, describing what
   changed. The release workflow copies this section verbatim into the
   GitHub release notes; a missing section falls back to a generic one-line
   note, so it is worth writing.
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
   zips it, writes `manifest.json`, and publishes both as a GitHub Release
   named after the tag.

## Signing releases (one-time setup)

Without a signing identity, the workflow still produces a release, but the
app is signed ad-hoc, which loses folder permissions on every future rebuild
(see `docs/macos.md`) and gives the in-app updater nothing stable to trust
across versions. Set it up once:

1. On a Mac that already has Reader's local signing identity (run
   `./macos/ensure-signing-identity.sh` first if it does not), export it:

   ```
   ./macos/export-signing-identity.sh /tmp/reader-signing.p12 /tmp/reader-signing.p12.base64
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
different app each time. Copy the `.p12` file `export-signing-identity.sh`
wrote (not its base64 form) to the other Mac, then:

```
./macos/import-signing-identity.sh reader-signing.p12
```

It installs the identity into Reader's own keychain at the same path
`ensure-signing-identity.sh` uses, trusts the certificate for code signing,
and writes the keychain's own password so `build-app.sh` can unlock it
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
| `minimum_macos` | The lowest macOS version the app declares support for (`LSMinimumSystemVersion` in `Info.plist`). |
| `published_at` | When the release was built, in ISO 8601 UTC. |
| `signing_identity` | The common name of the certificate that signed the app, or `"ad-hoc"` if none was configured. An updater can refuse to install a build whose identity does not match the one it already trusts. |
