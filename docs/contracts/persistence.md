# Persistence formats

Audience: Internal
Status: Active
Last verified: 2026-07-28

Lyra's storage root is `~/.lyra`, with Electron session data under
`electron/desktop` and module-owned state primarily under `modules/<name>`.
See [storage architecture](../architecture/storage.md).

## Format classes

| Class | Examples | Ownership |
| --- | --- | --- |
| Versioned JSON | Workbench `*.v1.json`, login-manager, UIUX, Skills/MCP registries | Owning Desktop or runtime module |
| Encrypted JSON envelope | Auth session/local identity, login passwords | Electron safeStorage owner |
| SQLite | Agent session/memory/runtime-turn state | Agent runtime |
| JSONL ledger | Session events, diagnostics, terminal memory | Runtime module |
| Binary/cache/artifact | images, screenshots, icons, browser caches | Producing module |
| Electron profile | cookies, local/session storage, cache, history | Electron session |

## Compatibility rules

- Every durable JSON document needs an explicit version or uniquely versioned
  filename.
- The owner validates on read, normalizes supported older forms, and quarantines
  corrupt state when practical.
- Writes that replace a document use the repository's atomic write helper.
- SQLite migrations must be transactional and idempotent for the supported
  starting versions.
- Append-only logs need size/retention policy and tolerant parsing of a final
  partial line.
- A cache is never the only copy of user-authored content.
- A reset path names exactly which roots are removed; never recursively delete
  `~`, `~/.lyra` as an unresolved variable, or a workspace.

## Secret distinctions

`safeStorage` ciphertext is encrypted using the current operating-system
facility. MCP headers/env and many provider/extension registries are ordinary
local JSON even when renderer projections redact them. Documentation and UI
must not collapse "redacted", "file permissions", and "encrypted" into one
claim.

## Migration contract

A persistence change must specify:

1. old and new schema/version;
2. forward migration and retry semantics;
3. rollback or backup behavior;
4. data-loss conditions;
5. tests using representative previous snapshots;
6. privacy/retention impact.

Private formats may change without external deprecation, but existing user data
must still be migrated or an intentional reset must be called out in release
notes.

