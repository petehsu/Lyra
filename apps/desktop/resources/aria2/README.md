# Lyra aria2 Runtime Bundles

This directory is reserved for the pinned `aria2c` binaries that ship with Lyra.

Each target directory must contain a `manifest.json`. The manifest records the
real binary path, source package list, sha256 hashes, and executable bits.

Expected target directories:

- `darwin-arm64/manifest.json`
- `darwin-x64/manifest.json`
- `linux-arm64/manifest.json`
- `linux-x64/manifest.json`
- `win32-arm64/manifest.json`
- `win32-x64/manifest.json`

Conda-forge materialized bundles use:

- POSIX: `bin/aria2c`
- Windows: `Library/bin/aria2c.exe`

The download manager resolves these bundled binaries first. Development builds may fall back to a system `aria2c`; packaged builds should include the target binary here.

Useful commands:

- `npm --prefix apps/desktop run downloads:build-aria2-bundles`
- `npm --prefix apps/desktop run downloads:build-aria2-bundles -- --all-targets`
- `npm --prefix apps/desktop run downloads:verify-aria2-bundles -- --all-targets`
