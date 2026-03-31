# ADR-0004: File Editor Foundation (Rust + Monaco)

## Status
Accepted

## Date
2026-03-28

## Context
Lyra workbench now needs a real file editing loop:
- Double-click file in file-manager opens editor in workspace tab.
- Text/code files can be viewed, edited, and saved safely.
- Later AI IDE streaming features must attach to stable editor contracts without refactoring the file core again.

## Decision
1. Introduce `file-editor` as a first-class workspace app (`appId = "file-editor"`), not a browser-page special case.
2. Keep same-file tab singleton semantics by file path (platform-aware normalization).
3. Use Monaco as renderer editor core (MIT), loaded lazily.
4. Keep file IO in Rust NAPI (`lyra-files-napi`) with:
   - `readTextFile`
   - `writeTextFile`
   - `statFile`
5. Persist write safety with atomic save (`temp -> fsync -> rename`) and optimistic revision guard (`expectedRevision`).
6. Support text V1 scope:
   - UTF-8 / UTF-8 BOM editable
   - unsupported encodings/files gracefully downgraded
7. Save behavior:
   - manual `Ctrl/Cmd+S`
   - idle autosave (800ms)
   - blur autosave
8. Predefine AI editor stream contract (`AiEditorStreamEvent`) for `plan|patch|cursor|diagnostic|approval` without enabling execution in V1.

## Consequences
Positive:
- File editing is now independent from browser tab logic and ready for future AI IDE integration.
- Rust boundary remains explicit and testable.
- Same-file dedupe avoids editor tab explosion.

Tradeoffs:
- Monaco runtime introduces large worker bundles when editor is used.
- Non-text and unsupported encoding files remain read-only/uneditable in V1.

## License Baseline
Current and near-term stack is frozen to permissive licenses:
- Monaco (MIT)
- notify (MIT/Apache-2.0/CC0)
- ripgrep (MIT/Unlicense)
- tantivy (MIT, planned)
- tree-sitter (MIT, planned)
- tower-lsp (MIT/Apache-2.0, planned)

GPL/AGPL/LGPL components are excluded from core release path.

