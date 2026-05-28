# Lyra Storage Layout

Lyra owns a single application data root at `~/.lyra`. Desktop modules store
their persistent files below `~/.lyra/modules/<module-name>`, and Electron-owned
profile/session data lives below `~/.lyra/electron/desktop`.

Lyra modules persist user data under module-specific storage roots resolved by
the desktop storage service. Native-owned modules must keep their existing file
names and JSON wire shapes when migrating from Electron main-process ownership,
so user data can be reused without an explicit conversion step.

For runtime-backed modules, Electron passes the module storage root with each
`lyrad` request. Rust crates own reading, writing, and normalizing those module
files; the desktop shell may read cached snapshots only for shell-only actions
such as opening or revealing a completed download.

Lyra Agent keeps provider configuration, auth files, runtime sockets, rollback
checkpoints, logs, and transient provider transcript files under
`~/.lyra/modules/agent`. The desktop runtime client starts `lyrad` with
`LYRA_AGENT_HOME` set to that directory and `LYRA_AGENT_RUNTIME_DIR` set to
`~/.lyra/modules/agent/runtime`.

The authoritative Agent session memory root is
`~/.lyra/modules/agent-memory`. Runtime-owned SQLite stores below this root are
the source of truth for Agent sessions, append-only session events,
RuntimeTurn state, context snapshots, trim archives, browser/follow memory, and
shared/frozen memory. Desktop code consumes snapshots and projection DTOs from
this root through `lyrad`; it must not scan legacy session JSON or journals to
decide visible messages, recovery state, todos, provider labels, or active
browser state.

Legacy `~/.lyra/modules/agent/sessions/*.json`,
`*.bak`, and `*.journal.jsonl` files are not a normal runtime read path. During
the memory rebuild they may be cleared locally; future importers may read them
only through an explicit migration command that converts old reload markers and
summaries into audit-only structured records. The separate Lyra runtime socket
root remains `~/.lyra/modules/runtime`.

The runtime also sets the legacy `JCODE_HOME` and `JCODE_RUNTIME_DIR`
compatibility variables to the same paths for the internalized Agent core.
Provider API keys should use Lyra-prefixed aliases such as
`LYRA_AGENT_OPENAI_API_KEY` or `LYRA_AGENT_PROVIDER_<PROFILE>_API_KEY`; legacy
`JCODE_*` key variables remain compatibility fallbacks only.
Legacy locations such as `~/.jcode` and
`~/Library/Application Support/jcode` are not Lyra GUI storage roots. They may be
deleted during a one-time local reset, but Lyra must not delete them
automatically during startup.
