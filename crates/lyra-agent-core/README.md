# Lyra Agent Core

`lyra-agent-core` is the temporary compatibility facade for Lyra Agent while the
agent platform is split into stable API, runtime orchestration, kernel, plugins,
and CLI crates.

## Crate Boundaries

```text
apps/desktop -> lyrad -> lyra-agent-core facade
                         -> lyra-agent-api
                         -> lyra-agent-runtime
                         -> lyra-agent-kernel
                         -> lyra-agent-plugins
```

- `lyra-agent-api` owns public DTOs, errors, snapshots, runtime events, tool
  activity, memory projection, and software/LCP contracts.
- `lyra-agent-runtime` owns session, turn, event, memory, provider, permission,
  clarification, todo, browser, software, follow, recovery, and archive services.
- `lyra-agent-kernel` owns the model/tool turn loop boundary. Legacy jcode code is
  an internal implementation source only.
- `lyra-agent-plugins` owns extension traits for providers, tools, software,
  browser operators, and memory adapters.
- `lyra-agent-core` keeps the existing daemon-facing JSON functions while callers
  migrate to the new crates.

## Public API Rules

- Public names use `Agent*`, `Lyra*`, and `agent.*` method names.
- Desktop and `lyrad` must not reference `jcode_core`, `root_src`,
  `kernel_legacy`, `Jcode*`, `jcode.*`, or `lyra:jcode/...`.
- Legacy jcode symbols may remain only inside private compatibility modules until
  their behavior is moved into kernel/runtime services.
- UI state must come from structured snapshots, runtime events, tool activity,
  memory projection, todo projection, clarification, and permission DTOs.

## Adding Capabilities

- Add a provider by implementing `ProviderAdapter` in `lyra-agent-plugins` and
  registering its capability profile in the runtime provider service.
- Add a tool by implementing `ToolProvider`; tool output must be projected into
  `AgentToolActivity`.
- Add a Lyra software adapter by implementing `SoftwareAdapter` and exposing the
  minimal readable state, commands, events, and permissions for the task.
- Add memory behavior through `MemoryStore` and `MemoryProjectionBuilder`, not by
  coupling UI code to storage internals.

## Auth Callback

OpenAI OAuth uses the local callback URI
`http://localhost:1455/auth/callback`; browser and manual callback flows are
started from Lyra Agent settings.

## Tests

Run the boundary and crate checks before landing agent-core changes:

```bash
cargo test -p lyra-agent-api
cargo test -p lyra-agent-kernel
cargo test -p lyra-agent-runtime
cargo test -p lyra-agent-core
cargo test -p lyrad
cargo check --workspace --tests
npm --prefix apps/desktop run typecheck
pnpm lint:agent-boundary
pnpm lint:no-jcode-public-api
pnpm lint:structure
pnpm lint:native-core
cargo fmt --all --check
git diff --check
```
