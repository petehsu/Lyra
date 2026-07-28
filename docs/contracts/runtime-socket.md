# Runtime socket contract

Audience: Internal
Status: Active
Last verified: 2026-07-28

Electron main communicates with `lyrad` through a same-user local transport.
Protocol version is currently `1` in both
`apps/desktop/src/main/runtime-client.ts` and
`crates/lyra-runtime-protocol/src/lib.rs`.

## Transport

- Unix-like systems: `~/.lyra/modules/runtime/runtime/lyrad.sock`.
- Windows: a named pipe derived from the runtime storage root.
- Framing: one JSON `RuntimeEnvelope` per newline.
- Maximum Desktop frame size: 8 MiB.
- Startup: Desktop resolves the packaged/development `lyrad` binary, spawns it
  with `--socket`, connects, then performs `runtime.handshake`.

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
  "protocolVersion": 1,
  "clientName": "lyra-desktop"
}
```

Version mismatch is fatal. Desktop also requires named daemon capabilities to
detect a stale binary and respawn it. A protocol change must update both sides,
round-trip tests, stale-daemon behavior, and packaging.

## Method ownership

`lyrad` routes `runtime.*`, `agent.*`, `terminal.*`, `download.*`, `lsp.*`,
`search.*`, `code.*`, and `performance.*` families. Method names, payloads,
errors, and host-capability calls are private ABI. They must not be documented
as CLI/MCP/public SDK methods.

## Failure behavior

- Unknown methods return `METHOD_NOT_FOUND`.
- Invalid payloads return `BAD_REQUEST` or a mapped runtime error.
- Oversized or invalid frames close/reject pending work.
- Socket close rejects all pending Desktop promises.
- Cancellation/host timeouts are bounded; callers must not rely on an
  unbounded request remaining live.

