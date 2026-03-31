# Lyra Linux Compat V1

## Goal
- Make Linux startup deterministic across Wayland/X11 environments.
- Prefer auto-safe behavior over manual launch tweaks.
- Keep one diagnostics contract for support and release debugging.

## Effective Startup Strategy
- Platform is not Linux:
  - Linux compat layer is disabled.
- Linux session:
  - Backend selection order:
    1. CLI: `--lyra-backend=wayland|x11`
    2. Env: `LYRA_LINUX_BACKEND=wayland|x11`
    3. Auto: infer from `XDG_SESSION_TYPE`, `WAYLAND_DISPLAY`, `DISPLAY`
  - GPU mode selection order:
    1. Safe mode: `--safe-mode` / `--lyra-safe-mode` / `LYRA_SAFE_MODE=1` -> software
    2. CLI: `--lyra-gpu=software|hardware`, `--disable-gpu`, `--disable-gpu-compositing`
    3. Env: `LYRA_SOFTWARE_GPU=1`
    4. Auto: hardware

## Applied Runtime Mutations
- Wayland backend:
  - `ELECTRON_OZONE_PLATFORM_HINT=wayland`
  - `DISPLAY=""` (avoid accidental X11 path and client exhaustion)
  - `--enable-features=UseOzonePlatform,WaylandWindowDecorations`
  - `--ozone-platform=wayland`
- X11 backend:
  - `ELECTRON_OZONE_PLATFORM_HINT=x11`
  - `WAYLAND_DISPLAY=""`
  - `--enable-features=UseOzonePlatform,WaylandWindowDecorations`
  - `--ozone-platform=x11`
- Software mode:
  - `app.disableHardwareAcceleration()`
  - `--disable-gpu`
  - `--disable-gpu-compositing`

## Diagnostics Contract
- Runtime status file:
  - `~/.config/@lyra/desktop/linux-compat/last-status.json`
- Exported diagnostics snapshot:
  - `~/.config/@lyra/desktop/diagnostics/linux-compat-<timestamp>.json`
- IPC API:
  - `lyraDesktop.linuxCompat.readStatus()`
  - `lyraDesktop.linuxCompat.exportDiagnostics()`

## Support Matrix (V1 policy)
- Primary support:
  - Ubuntu LTS / Fedora / Arch / Debian
  - GNOME / KDE / wlroots desktops (best effort with same contract)
- Degradation policy:
  - Unknown session or conflicting env vars -> warning + deterministic backend
  - Safe mode available for emergency startup.
