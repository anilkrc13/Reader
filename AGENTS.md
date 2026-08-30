# Reader project instructions

## macOS app build gate

`install/Reader.app` is a tracked deliverable and the primary way the user runs Reader.

- After changing `static/`, `reader.py`, `reader_backend.py`, macOS launcher or icon sources, licenses, or bundle metadata, run `./macos/build-app.sh` before declaring the work complete.
- Do not treat manual edits inside `install/Reader.app` as a finished build. The script must recreate and sign the bundle.
- Verify the finished bundle with `codesign --verify --deep --strict install/Reader.app` and confirm changed source resources match their copies under `install/Reader.app/Contents/Resources/`.
- Include regenerated bundle artifacts in the same change. If the build or signature check cannot complete, state that the macOS app is not ready for testing.
