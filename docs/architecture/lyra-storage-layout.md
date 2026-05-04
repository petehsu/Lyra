# Lyra Storage Layout

Status: Active  
Source of truth: `apps/desktop/src/main/storage/roots.ts`

## Root Layout
Lyra desktop stores local data under:

```text
~/.lyra/
  modules/
  electron/
```

Resolved paths:

- `lyraRoot`: `~/.lyra`
- `modulesRoot`: `~/.lyra/modules`
- `electronRoot`: `~/.lyra/electron`
- `electronDesktopRoot`: `~/.lyra/electron/desktop`

On startup, `ensureLyraStorageRoots()` creates all required directories.

## Electron Paths
Desktop process rewires Electron paths to keep app state under Lyra root:

- `app.getPath("userData")` -> `~/.lyra/electron/desktop`
- `app.getPath("sessionData")` -> `~/.lyra/electron/desktop/session`

## Module Storage Roots
`LyraModuleStorageRoots` currently defines:

- `~/.lyra/modules/file-manager`
- `~/.lyra/modules/ai`
- `~/.lyra/modules/mcp`
- `~/.lyra/modules/skills`
- `~/.lyra/modules/linux-compat`
- `~/.lyra/modules/terminal`
- `~/.lyra/modules/workbench-state`
- `~/.lyra/modules/search`
- `~/.lyra/modules/image-viewer`

## Rules
1. New persistent module data must be placed under `~/.lyra/modules/<module-name>`.
2. Do not write desktop state into repository-relative directories.
3. Path derivation must stay centralized in `storage/roots.ts`.
4. Any new module root requires:
   - type update in `LyraModuleStorageRoots`
   - creation in `resolveLyraStorageRoots()`
   - inclusion in `ensureLyraStorageRoots()`
   - wiring where consumed in `apps/desktop/src/main/index.ts`

## Validation
This layout is guardrailed by the native-core architecture check:

```bash
pnpm lint:rust-first
```

`lint:rust-first` is a historical compatibility name for the native-core guard.
