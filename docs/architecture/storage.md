# Storage architecture

Audience: Internal
Status: Active
Last verified: 2026-07-28

Lyra's primary application data root is `~/.lyra`. Desktop modules store most
persistent files below `~/.lyra/modules/<module-name>`, and Electron-owned
profile/session data lives below `~/.lyra/electron/desktop`.

Lyra modules persist user data under module-specific storage roots resolved by
the Desktop storage service. For runtime-backed modules, Electron passes the
module storage root with each `lyrad` request. Rust crates own reading, writing,
and normalizing those files; the Desktop shell may read cached snapshots only
for shell-only actions such as opening or revealing a completed download.

## Agent storage

Desktop sets `LYRA_AGENT_HOME` to `~/.lyra/modules/agent`. The native backend
derives its authoritative root at
`~/.lyra/modules/agent/agent-runtime`, containing `state.json`, per-session
SQLite stores, `memory.sqlite`, prompt cache, ledgers, checkpoints, logs, and
artifacts. `LYRA_AGENT_RUNTIME_DIR` is
`~/.lyra/modules/agent/runtime` for compatibility/runtime support files; it is
not the Desktop-to-daemon socket root.

Desktop consumes Agent snapshots and projection DTOs through `lyrad`; it must
not scan session SQLite/JSONL files to decide visible messages, recovery state,
todos, provider labels, or active browser state.

Legacy session JSON, backup, and journal files are not a normal runtime read
path. A future importer may read them only through an explicit migration that
converts old reload markers and summaries into structured audit records.

The separate Desktop-to-`lyrad` transport root is
`~/.lyra/modules/runtime`; its Unix socket is normally
`~/.lyra/modules/runtime/runtime/lyrad.sock`.

The runtime also sets the legacy `JCODE_HOME` and `JCODE_RUNTIME_DIR`
compatibility variables to Agent paths for the internalized core. Provider API
keys should use Lyra-prefixed aliases; legacy `JCODE_*` variables are
compatibility fallbacks only. Legacy locations such as `~/.jcode` and
`~/Library/Application Support/jcode` are not Lyra GUI storage roots and must
not be deleted automatically at startup.

## Other roots

- Supabase session and cached account identity:
  `~/.lyra/auth/*.json`, encrypted with Electron safeStorage.
- Language packs and local locale overrides: `~/.lyra/language-packs` and
  `~/.lyra/locales`.
- Browser workflow cache: `~/.lyra/browser-workflows`.
- Electron live/isolated profiles, cookies, history, cache, and site storage:
  below the Electron desktop profile.
- Workspaces, attachments selected from disk, downloads, and exported files
  can live outside `~/.lyra`.

Not every file below `~/.lyra` has the same protection or retention. See
[persistence formats](../contracts/persistence.md) and the
[privacy data-flow audit](../operations/privacy-data-flow-audit.md).

