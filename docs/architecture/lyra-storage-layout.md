# Lyra Unified Storage Layout (`~/.lyra`)

## Purpose
Lyra desktop now uses a single storage root: `~/.lyra`.

This is a hard-cut development-stage contract:
- No compatibility reads from `~/.config/lyra-desktop`
- No migration layer
- No fallback paths

If required storage directories cannot be created, startup fails.

## Directory Contract
```
~/.lyra/
  electron/
    desktop/                 # Electron profile (userData/sessionData)
  modules/
    file-manager/
    mcp/
    skills/
    computer/
    system-images/
    linux-compat/
    terminal/
    workbench-state/
      preferences.v1.json
      workspace-tabs.v1.json
      terminal-dock.v1.json
      ai-sessions.v1.json
      notifications.v1.json
      layout.v1.json
```

## Ownership Rules
- `electron/*`: host runtime data only (Chromium/Electron internals).
- `modules/*`: product/module data owned by domain services.
- `modules/workbench-state/*`: renderer workbench UI state persisted via `workbenchState` bridge.

Renderer modules must not access `window.localStorage` for workbench state.

## Workbench State API Contract
Bridge namespace: `workbenchState`
- `readSync(key): string | null`
- `writeSync(key, json): void`
- `removeSync(key): void`

Valid keys:
- `preferences`
- `workspace-tabs`
- `terminal-dock`
- `ai-sessions`
- `notifications`
- `layout`

Each key maps to a fixed `*.v1.json` file in `modules/workbench-state/`.

## Versioning Rule
- File name carries schema major version (`<key>.v1.json`).
- Breaking schema change => new file suffix (`v2`) with explicit rollout decision.
- Do not silently reinterpret incompatible JSON.

## Guardrails
- `tools/verify-boundaries.ts`
  - blocks direct `localStorage/sessionStorage` in workbench modules (tests excluded)
  - blocks `app.getPath("userData")` and `userDataPath` path plumbing in main modules
- `tools/verify-rust-first.ts`
  - keeps native-owned/main ownership boundaries stable
