# File Editor LSP V1

## Scope
- Goal: add production-usable `syntax highlight + completion + diagnostics` for `TS/JS`, `Rust`, and `Python`.
- Keep `file-editor` basic edit/save always available even if LSP fails.
- Do not include go-to-definition, refactor, code actions in V1.

## Runtime Model
- Renderer: Monaco renders text and forwards document lifecycle + completion requests.
- Main: single IPC bridge for LSP channels and one event fan-out channel.
- Native: `crates/lyra-lsp-napi` owns JSON-RPC stdio sessions and process lifecycle.

## Process Model
- One language server runtime per `(languageId, projectRoot)`.
- `projectRoot` resolution:
1. explicit `projectRoot` from request (if provided)
2. nearest `.git` ancestor
3. file parent directory
- Multiple tabs/files in the same project/language share one backend process.

## Document Lifecycle
- Renderer emits:
1. `openDocument`
2. `changeDocument` (incremental version progression from editor state)
3. `saveDocument`
4. `closeDocument`
- Native maps to LSP notifications:
1. `textDocument/didOpen`
2. `textDocument/didChange`
3. `textDocument/didSave`
4. `textDocument/didClose`

## Completion + Diagnostics Flow
- Completion:
1. Monaco provider -> `desktopApi.lsp.completion(...)`
2. Main forwards to native
3. Native sends `textDocument/completion` request and maps result into typed payload
- Diagnostics:
1. LSP server pushes `textDocument/publishDiagnostics`
2. Native emits `lyra:lsp/event` with `kind: "diagnostic"`
3. Renderer maps diagnostics to Monaco markers

## Error Semantics
- Server startup/request failure returns empty completion + emits `kind: "error"` event.
- Any LSP error must not block typing, save, or tab lifecycle.
- Main bridge unavailable: file editor still works as plain Monaco editing.

## Channels
- Request channels:
1. `lyra:lsp/open-document`
2. `lyra:lsp/change-document`
3. `lyra:lsp/save-document`
4. `lyra:lsp/close-document`
5. `lyra:lsp/completion`
- Event channel:
1. `lyra:lsp/event`

## AI Extension Hook Points (Reserved)
- `diagnostic` stream can be merged with future AI assistant diagnostics.
- Completion endpoint can be augmented with AI-ranked candidates without changing editor surface API.
- Future stream contract can attach `plan/patch/cursor/approval` events beside LSP events via shared event bus.
