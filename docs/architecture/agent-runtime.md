# Agent runtime architecture

Audience: Internal
Status: Active
Last verified: 2026-07-28

The authoritative Agent path is `lyra-agent-runtime::LyraAgentBackend`, composed
by `lyrad` and `lyra-cli`. Desktop sends `agent.*` runtime methods through the
local daemon and receives structured snapshots/events; it does not load Agent
kernel modules into the renderer.

## Major responsibilities

- session and project binding;
- model/provider profile resolution and protocol execution;
- provider-context construction, trimming, and replay;
- Solo turns and Experimental Oma team orchestration;
- permission, clarification, plan, todo, memory, checkpoint, and rollback
  state;
- Tool-FS discovery and execution;
- Skill and MCP catalogs;
- Desktop host-capability dispatch;
- runtime event projection back to the UI.

## Turn path

1. Desktop validates an IPC request and maps it to an `agent.*` daemon method.
2. Runtime loads the session, provider profile, model capabilities, memory, and
   previous tool telemetry.
3. Runtime reads host context and currently collects local identity signals on
   every turn.
4. Runtime computes a persona and incorporates the computed result, device,
   workspace, time, screen, consented location label, active Skills, memory,
   attachments, and message history into provider context as applicable.
5. The selected provider receives the normalized request.
6. Tool calls are checked against permission and quality gates, dispatched
   natively or through Desktop host capabilities, and appended to the session.
7. Events and the final snapshot are projected to Desktop.

The current persona collection path does not consult the separate Desktop
persona consent service. This is a privacy/release risk, not a documentation
ambiguity; see [the privacy audit](../operations/privacy-data-flow-audit.md).

## Boundary invariants

- No `jcode.*` daemon routes or `lyra:jcode/...` IPC channels.
- Runtime must not depend on Desktop or `lyrad`.
- API/DTO crates must not depend on kernel implementation crates.
- `lyra-agent-core` remains a facade and may not expose legacy modules.
- Provider support is true only when the runtime route and protocol are
  implemented; TypeScript catalog declarations alone are insufficient.

See [ADR-0002](../decisions/ADR-0002-agent-runtime-boundary.md),
[ADR-0003](../decisions/ADR-0003-agent-vendor-removal.md), and the accepted
[provider/protocol ownership ADR](../decisions/ADR-0004-provider-protocol-rust-ownership.md).
