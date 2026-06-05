# Lyra Performance Helper

These scripts install `lyra-performance-helper` as a real privileged OS helper for
local development and pressure validation.

Production macOS distribution still needs the signed app bundle,
entitlements, and `SMAppService` registration flow. The LaunchDaemon script is
the real root helper path for development and CI hosts; it does not pretend to
be a signed App Store-style Service Management installer.

## Build

```sh
cargo build --release -p lyra-performance-core --bin lyra-performance-helper
```

## macOS

```sh
sudo scripts/performance-helper/install-macos-launchdaemon.sh target/release/lyra-performance-helper
```

The helper listens on `/var/run/lyra-performance-helper.sock`. Lyra auto-detects
that socket when it exists.

## Linux

```sh
sudo scripts/performance-helper/install-linux-systemd.sh target/release/lyra-performance-helper
```

The helper listens on `/run/lyra-performance-helper.sock`. Lyra auto-detects
that socket when it exists.

## Windows

Run PowerShell as Administrator:

```powershell
scripts\performance-helper\install-windows-service.ps1 -HelperPath target\release\lyra-performance-helper.exe
```

The Windows helper runs as `LocalSystem`, listens on `127.0.0.1:37691`, and the
installer sets the machine-level `LYRA_PERFORMANCE_HELPER_TCP` environment
variable for Lyra.
