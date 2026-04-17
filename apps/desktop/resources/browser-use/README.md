# Bundled browser-use Runtime

This directory holds the offline, pinned browser-use runtime bundles that ship with Lyra.

Expected layout:

```text
apps/desktop/resources/browser-use/<target-triplet>/
  manifest.json
  artifacts/python-runtime.tar.gz
  wheelhouse/...
```

Supported target triplets:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-x64`

Unsupported target triplets:

- `win32-arm64`
  Reason: the pinned upstream `browser-use` dependency set does not currently publish a complete offline wheel set for Windows ARM64, so Lyra treats that platform as `unsupported_platform` and does not expose `browser_use.*`.

Each `manifest.json` must declare:

- `bundleVersion`
- `target`
- `browserUsePin`
- `pythonBinary`
- `pythonArchive`
- `browserUseWheel`
- `wheelhouseDir`
- `files[]` with relative paths and SHA-256 hashes

Release packaging must fail when the required manifest or referenced bundle files are missing or invalid.
