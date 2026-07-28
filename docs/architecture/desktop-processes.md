# Desktop main and renderer processes

Audience: Internal
Status: Active
Last verified: 2026-07-28

## Process boundary

The primary renderer is a sandboxed, context-isolated web application. It calls
the typed `LyraDesktopApi` exposed by preload. Preload maps each method to a
constant from `LYRA_CHANNELS`; Electron main registers the corresponding
handler or event producer.

The channel list is private and may change with the application. It must not be
used as an external integration point. The source-derived list is in the
[IPC index](../generated/ipc.md).

## Main-process responsibilities

- application/window lifecycle and single-instance behavior;
- custom protocols and file access allowlists;
- BrowserWindow and WebContentsView creation;
- browser live/isolated sessions and site-data operations;
- safeStorage-backed auth, login credentials, and sensitive-value access;
- OS permissions, notifications, location, editors, shell, and file reveal;
- loading N-API/native bindings and starting `lyrad`;
- validating IPC payloads and forwarding runtime events.

Main should not become a duplicate implementation for Agent, terminal,
download, file, LSP, or indexing behavior owned by native cores.

## Renderer responsibilities

- workbench layout, tabs, panels, settings, and visual state;
- generic forms for provider, Skill, MCP, and UIUX configuration;
- rendering snapshots and events returned through the bridge;
- user gestures and permission/clarification responses;
- no direct filesystem, process, secret, or Electron access.

## Preload rules

- Add a named API method and matching shared DTO; never expose raw
  `ipcRenderer`.
- Use fixed channels from `LYRA_CHANNELS`; never accept a channel name from
  renderer input.
- Return structured-clone-safe data.
- Remove listeners when the subscription disposer runs.
- Treat API growth as privileged surface growth and update
  [the IPC contract](../contracts/desktop-ipc-preload.md).

## Web contents

Embedded website views are distinct from the renderer. They use isolated
Electron sessions and preload choices appropriate to their role. Page scripts
used for observation, credential capture, or interaction must treat page data
as hostile. Do not interpolate page-provided text into executable source.

