# Desktop IPC and preload contract

Audience: Internal
Status: Active
Last verified: 2026-07-28

The typed Desktop bridge spans three files:

- `apps/desktop/src/shared/desktop-bridge.ts`: DTOs, `LYRA_CHANNELS`, and
  `LyraDesktopApi`;
- `apps/desktop/src/preload/index.ts`: fixed-channel `ipcRenderer` adapters and
  `window.lyraDesktop`;
- `apps/desktop/src/main/**`: handler registration, payload validation, and
  event production.

The generated [IPC index](../generated/ipc.md) lists the current channels.

## Invariants

- Renderer code receives no raw `ipcRenderer`, Node module, filesystem handle,
  child process, or arbitrary channel call.
- Channel strings are constants and all payloads are treated as `unknown` at
  the privileged boundary.
- Main handlers validate required strings, enums, arrays, paths, limits, and
  caller state before executing.
- Events use explicit subscribe/dispose methods; preload removes the exact
  listener it registered.
- Paths returned for previewing use controlled custom protocols or opaque
  references rather than unrestricted `file://` access.
- Sensitive results are returned only through narrowly named methods and must
  not be cached in renderer state longer than needed.

## Request and event shape

Most request/response calls use `ipcRenderer.invoke` and `ipcMain.handle`.
Streaming or lifecycle updates use `webContents.send` and renderer
subscriptions. Message ports are used for high-volume terminal data rather than
ordinary invoke frames.

IPC DTO names are an internal TypeScript contract. Changing a DTO requires
updating shared types, preload mapping, main validation, renderer callers, and
boundary tests in one change.

## Security review triggers

Require focused review when adding:

- a method that reads secrets, arbitrary files, browser storage, screenshots,
  or OS identity;
- a write/destructive action;
- a method callable by activated UIUX code;
- an event containing page, terminal, model, or account content;
- a path that bypasses the local `lyrad` permission or quality gates.

## Non-contract

Channel names and `LyraDesktopApi` are not supported extension APIs. UIUX Pack
code currently receives the API as trusted Preview code, but that fact does not
make its private methods stable.

