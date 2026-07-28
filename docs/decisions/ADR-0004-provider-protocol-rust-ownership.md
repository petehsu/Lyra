# ADR-0004: Rust ownership of provider and protocol execution

Audience: Internal
Date: 2026-06-13
Status: Accepted
Accepted: 2026-07-28
Last verified: 2026-07-28
Scope: Lyra Desktop Agent provider and protocol stack

## Context

When this decision was proposed, provider support was declared broadly in
TypeScript while the native runtime implemented a smaller set of routes.
Provider loop behavior, request dispatch, streaming fallback, reply
normalization, and vendor-specific behavior were also concentrated in one
large Rust module. The two representations could drift, allowing the UI to
imply support that the runtime did not have.

The repository no longer has that structure. As verified on 2026-07-28:

- `crates/lyra-agent-runtime/src/native_backend/providers/registry.rs` assembles
  the protocol and route registries used by execution.
- `providers/catalog.rs` exposes those registries and configured profiles
  through `agent.provider.catalog.read`.
- `providers/protocol/*` contains wire behavior grouped by protocol family.
- `providers/routes/*` contains hosted-service and local-server route metadata,
  defaults, discovery hooks, and compatibility behavior.
- `native_backend/provider.rs` is now an orchestration entry point with focused
  submodules under `native_backend/provider/`; it is no longer the provider
  catalog or the sole owner of protocol wire behavior.
- Desktop receives the runtime catalog through IPC and preload, keeps DTOs in
  `apps/desktop/src/shared/agent.ts`, and renders the returned routes in the
  settings UI.
- The former TypeScript catalog in `apps/desktop/src/shared/ai.ts` and the
  provider-preset directory under `settings-ai/providers/` no longer exist.

This ADR records the ownership boundary that the implementation now follows.
It does not claim that every cataloged protocol is executable.

## Decision

Lyra adopts the following provider-stack rules:

1. Rust native runtime is the operational source of truth for provider routes,
   protocol families, runtime support, discovery support, auth defaults, and
   execution behavior.
2. TypeScript owns bridge DTOs, presentation, search labels and aliases, local
   form state, and generic rendering. It must not independently declare a route
   or protocol as executable.
3. Wire behavior is grouped by protocol family. Marketing brands that share a
   wire contract reuse the same protocol implementation.
4. Provider routes own service-specific base URLs, auth defaults, discovery,
   request decoration, and compatibility quirks.
5. A profile persists a stable `routeId`; the runtime resolves its
   `protocolId` from the Rust registry instead of persisting redundant protocol
   truth.
6. Unsupported work may appear in the catalog only when
   `runtimeSupported: false`. The UI must not present that entry as a usable
   runtime route.
7. New routes for an existing protocol should require a Rust route module and
   registry entry, not a TypeScript operational catalog change.
8. Shared orchestration may dispatch among protocol modules, but protocol wire
   parsing and provider-specific behavior must not migrate back into a mixed
   catalog/transport/wire monolith.

## Implemented architecture

The current stack has four practical layers:

1. **Catalog and registry** — `providers/catalog.rs`,
   `providers/registry.rs`, and `providers/types.rs`.
2. **Provider routes** — `providers/routes/*`.
3. **Protocol implementations** — `providers/protocol/*`.
4. **Transport and execution orchestration** —
   `providers/transport/*` plus `native_backend/provider/*`.

The runtime call path is:

1. load a `NativeProviderProfile` from runtime state;
2. resolve its `route_id` with `providers::registry::require_route`;
3. use the route descriptor's `protocol_id` to select protocol execution;
4. apply route-specific auth, discovery, or request hooks;
5. execute the transport and parse the result through the protocol module;
6. normalize the reply for the model loop.

The registry, not the persisted profile or Desktop code, decides the protocol
used by a route.

### Current protocol status

These flags come from the Rust protocol catalog:

| Protocol family | Runtime | Streaming | Tool calling | Transport |
| --- | --- | --- | --- | --- |
| `openai_chat_completions` | Supported | Supported | Supported | HTTP JSON stream |
| `openai_responses` | Supported | Supported | Supported | HTTP JSON stream |
| `anthropic_messages` | Supported | Supported | Supported | HTTP JSON stream |
| `gemini_generate_content` | Supported | Supported | Supported | HTTP JSON stream |
| `ollama_chat` | Supported | Supported | Supported | HTTP JSONL stream |
| `aws_bedrock_converse` | Supported | Not supported | Supported | AWS SigV4 HTTP JSON |
| `local_inference` | Not supported | Not supported | Not supported | Native FFI placeholder |

`local_inference` has a catalog entry but no FFI execution backend. This is an
explicit deferred capability, not a second implementation path or an
acceptance gap for the shipped provider architecture. HTTP-served local
backends such as Ollama, LM Studio, llama.cpp server, and vLLM use their
declared HTTP protocol routes.

### Current profile persistence

Provider profiles remain in the Agent runtime `state.json` configuration as a
map of `NativeProviderProfile` values. A profile contains:

- profile ID and label;
- stable Rust route ID;
- optional base URL and default model;
- API-key reference or environment-variable name;
- optional auth-header override;
- model capability records.

The implementation deliberately does not persist `protocolId`, backend kind, or
runtime-support flags in each profile. Those values are derived from the route
registry and returned in the runtime catalog. This avoids stale duplicated
truth.

The earlier proposed standalone `profile_store.rs`, `migration.rs`, and
profile-schema-v2 layout was not adopted. Existing state loading and migration
remain in `native_backend/state.rs`; profile CRUD remains in
`native_backend/provider_config.rs`.

### Desktop boundary

The end-to-end read path is:

```text
agent.provider.catalog.read
  -> Desktop main-process IPC
  -> preload readAgentProviderCatalog()
  -> settings AI service
  -> catalog-driven settings view
```

`apps/desktop/src/shared/agent.ts` defines transport DTOs but no executable
provider implementation. Settings-page provider aliases are presentation-only
search synonyms. The `quickSetupRoutes` and `localRoutes` fallbacks used by the
view are themselves filtered from the Rust catalog, not static route
declarations.

## Implementation variations

The accepted boundary differs from the original implementation sketch in a few
intentional ways:

- Concrete protocol modules and route descriptors are used instead of one
  object-safe `ProtocolAdapter` trait. Route-specific extension points use
  narrow hook traits where behavior actually differs.
- `route_id` is persisted while `protocol_id` is derived. The original sketch
  proposed persisting both.
- Protocol selection remains centralized in
  `native_backend/provider/protocol_io.rs`, and shared request/reply mapping
  remains in `provider/protocol_mapping.rs`. These files are sizable
  orchestration hot spots, but they no longer own the catalog and most
  protocol-specific wire parsers. Further size reduction is maintenance work,
  not an unresolved ownership decision.
- AWS Bedrock currently uses a non-streaming execution path, and its async path
  bridges through blocking execution. The catalog accurately reports streaming
  as unsupported.

These variations supersede the original proposed trait definitions and exact
folder sketch; those sketches are not public or internal runtime contracts.

## Acceptance evidence

| Criterion | Current evidence |
| --- | --- |
| Rust is the operational source of truth | `registry.rs` resolves every saved route and assembles protocol/route catalogs used by execution. |
| TypeScript does not embed protocol behavior | Desktop consumes `agent.provider.catalog.read`; shared TypeScript contains DTOs and presentation behavior. |
| Execution is no longer one mixed provider god module | Catalog, routes, protocols, transport, mapping, I/O, cache state, usage, and model loop are separated by responsibility. |
| A new route does not require unrelated protocol changes | Routes bind to an existing protocol descriptor and may provide narrow discovery or request hooks. |
| Protocol families can evolve in isolation | Request, response, streaming, discovery, and shared wire helpers live under `providers/protocol/*`. |
| Local and hosted backends share only applicable abstractions | HTTP-served local backends reuse HTTP protocol families; nonexistent native FFI execution is explicitly unsupported. |

No acceptance criterion remains incomplete for the currently shipped runtime.
Deferred protocol features must continue to be represented by false capability
flags until their implementation and tests land.

## Testing and enforcement

Provider changes should keep the following layers covered:

- registry tests for route-to-protocol bindings, auth metadata, discovery, and
  support flags;
- protocol request, response, stream, tool-call, and error fixtures;
- runtime tests for `agent.provider.catalog.read`;
- Desktop service and view tests using runtime-catalog-shaped data;
- optional, environment-gated live provider smoke tests.

Review must reject:

- a TypeScript-only provider or protocol addition;
- a route marked runtime-supported without an executable registered protocol;
- provider-specific wire branches added to shared transport code when a route
  hook can own them;
- a native/local backend shown as supported before its execution path exists;
- persisted protocol or support fields that can drift from the registry.

## Consequences

Positive consequences:

- Runtime capability flags and execution use the same Rust-owned registry.
- Compatible vendors reuse protocol implementations without duplicating wire
  logic.
- Desktop can add labels, icons, and search aliases without becoming a second
  runtime catalog.
- Unsupported capabilities are visible and testable rather than implied.
- Route-specific quirks have a bounded home.

Costs and follow-up obligations:

- The runtime catalog is an internal Rust-to-Desktop contract; DTO changes must
  be coordinated across the IPC boundary.
- Stable route IDs are persistence identifiers. Renaming or removing one
  requires an explicit state migration.
- Central sync, async, and streaming dispatch still creates sizable
  orchestration files and should be watched for renewed responsibility mixing.
- Protocol capability claims require fixtures and tests; compatibility by
  branding or base URL alone is insufficient evidence.
- Native FFI local inference and Bedrock streaming remain separate future
  features and must not be advertised as implemented.

## Alternatives considered

- Keep provider catalog truth split between TypeScript and Rust. Rejected
  because it permits UI declarations to outrun runtime support.
- Create one full protocol implementation per vendor. Rejected because
  compatible providers would duplicate request, streaming, and tool-call logic.
- Persist protocol and backend fields in every profile. Rejected in the final
  implementation because registry derivation prevents duplicated state from
  drifting.
- Require a broad `ProtocolAdapter` trait before extracting real protocols.
  Rejected in favor of concrete modules and narrow route hooks proven by actual
  behavior.
- Move the stack into a new workspace crate immediately. Deferred; the current
  in-crate boundary is explicit and does not yet justify migration cost.
