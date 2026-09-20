# Runtime socket contract

Audience: Internal
Status: Active
Last verified: 2026-09-20

Electron main communicates with `lyrad` through a same-user local transport.
Only protocol range `2-2` is currently accepted in both
`apps/desktop/src/main/runtime-client.ts` and
`crates/lyra-runtime-protocol/src/lib.rs`. The shell handshake is frozen in
`apps/desktop/src/shared/runtime-shell-handshake.ts` and
`crates/lyra-runtime-protocol`: `primaryHost`, Host API `1.0.0`,
`runtime.host.requests`, and `lyra.desktop` v1. `lyra-cli` remains
`auxiliaryClient` and is not the shell template. A second `primaryHost` is
rejected with `RUNTIME_PRIMARY_HOST_EXISTS`. Handoff is disconnect then claim;
there is no yield or steal RPC.

## Transport

- Unix-like systems: `~/.lyra/data/runtime/runtime/lyrad.sock`.
- Windows: a named pipe derived from the runtime storage root.
- Framing: one JSON `RuntimeEnvelope` per newline.
- Maximum Desktop frame size: 8 MiB.
- Startup: packaged Desktop resolves and verifies the active
  `lyra.runtime` component, spawns that exact binary with `--socket`, connects,
  then performs `runtime.handshake`. Development builds may use the repository
  binary fallback.

On Unix, the daemon creates a guarded parent, locks the endpoint, sets the
socket mode to `0600`, and rejects peers whose user ID differs where the
platform exposes peer credentials. Windows uses a per-pipe lock and named-pipe
security setup.

## Envelope

```json
{ "kind": "request", "id": "uuid", "method": "agent.session.read", "payload": {} }
```

Responses carry the same `id`, `ok`, and either `result` or a structured
`error`. Events carry `event` and `payload`. The daemon can also send request
envelopes to Desktop for registered host capabilities; Desktop applies a
bounded timeout before replying.

## Handshake and compatibility

The first request uses:

```json
{
  "protocolMinVersion": 2,
  "protocolMaxVersion": 2,
  "clientName": "lyra-desktop",
  "componentVersion": "0.1.0",
  "buildId": "core-build-id",
  "hostApiVersion": "1.0.0",
  "capabilities": ["runtime.host.requests"],
  "dataSchemas": {
    "lyra.desktop": 1
  },
  "connectionRole": "primaryHost",
  "connectionLeaseId": "uuid"
}
```

The response returns the Runtime protocol range, selected protocol, exact
component version, build ID, Host API version, capabilities, data schemas, and
the echoed connection role and lease. No protocol overlap, a different Host
API major, an unexpected packaged component version, incompatible schemas, or
a changed role/lease is fatal. Desktop also requires named daemon capabilities
to detect a stale binary and respawn it. Runtime V1 and a range-free fallback
are intentionally unsupported. A protocol change must update both sides,
round-trip tests, stale-daemon behavior, and packaging.

## Method ownership

`lyrad` routes the families in
[`crates/lyra-runtime-protocol/src/methods.rs`](../../crates/lyra-runtime-protocol/src/methods.rs)
(`runtime.*`, `agent.*`, `terminal.*`, `download.*`, `lsp.*`, `search.*`,
`files.*`, `performance.*`). The generated
[runtime method index](../generated/runtime-methods.md) is the readable list.
There is no retired code-family socket. Method names, payloads, errors, and
host-capability calls are private ABI. They must not be documented as
CLI/MCP/public SDK methods.

## Three waists

These are exclusive. A new capability belongs on exactly one:

- **Socket `RuntimeEnvelope`**: disk IO, agent, terminal, LSP, download,
  search, performance. Renderer pages do not speak this protocol.
- **IPC `window.lyraDesktop`**: Electron-only shell (file dialogs, preview
  URLs, window material). Not directory listing, trash, favorites, or watch.
- **Host `lyra.core.*`**: first-party page buttons and chrome. Pages read one
  Host model and forwarded lyrad events. They must not merge IPC directory
  reads, Host state, and a timer.

New work adds a socket method (or a Host-only chrome command) first. Do not
document a family the router does not dispatch. Do not add the same verb to
Host and lyrad as two products.

## Failure behavior

- Unknown methods return `METHOD_NOT_FOUND`.
- Invalid payloads return `BAD_REQUEST` or a mapped runtime error.
- Oversized or invalid frames close/reject pending work.
- Socket close rejects all pending Desktop promises.
- Cancellation/host timeouts are bounded; callers must not rely on an
  unbounded request remaining live.
- Reconnection creates a new primary-host lease, replays open LSP documents,
  and refreshes persisted download state. It cannot reconstruct a running
  Agent turn or terminal process after the owning daemon has crashed.
