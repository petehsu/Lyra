# Agent Provider and Protocol Rust Refactor

Date: 2026-06-13
Status: Draft
Scope: Lyra desktop agent provider and protocol stack

## Summary

Lyra should move provider and protocol ownership fully into Rust native runtime.
TypeScript should become a thin bridge and rendering layer, not a second source
of truth for protocol support. Protocol code should be split first by protocol
family, then by provider route or local backend, so each protocol can be
implemented and optimized against official vendor documentation without growing
new god modules.

This document defines the target architecture, module layout, migration plan,
TypeScript boundary, testing strategy, and acceptance criteria for that
refactor.

## Why This Refactor Is Needed

The current state has three structural problems:

1. Protocol support is declared broadly in TypeScript, but runtime support is
   narrower in practice.
2. Runtime provider execution is concentrated in a large Rust module.
3. Provider configuration, protocol catalog, and transport behavior are split
   across TypeScript declarations and Rust execution paths.

Concrete examples from the current workspace:

- `apps/desktop/src/shared/ai.ts` declares many provider IDs and protocol IDs.
- `apps/desktop/src/shared/agent.ts` persists provider profile writes through a
  narrow `providerType` contract.
- `crates/lyra-agent-runtime/src/native_backend/provider.rs` is a large runtime
  module that owns provider loop behavior, request dispatch, streaming fallback,
  reply normalization, tool-call repair, and progress-guard behavior.
- `crates/lyra-agent-runtime/src/native_backend/state.rs` currently installs a
  small set of default providers, which means the declared TypeScript catalog
  is ahead of the runtime truth.

That drift makes the system harder to reason about:

- UI can imply protocol support that runtime does not fully implement.
- adding one provider can require touching large mixed-responsibility files
- vendor-specific quirks accumulate in the same execution path
- future protocol optimizations become risky because protocol and provider logic
  are not isolated cleanly

## Decision

Lyra will adopt these rules:

1. Rust native runtime owns provider and protocol truth.
2. TypeScript owns presentation, form rendering, and bridge DTOs only.
3. Protocol execution is split by protocol family, not by marketing brand.
4. Provider-specific routing, auth defaults, discovery, and quirks are split
   into separate Rust files.
5. New protocol support may not land as TypeScript-only catalog additions.
6. No new god file is allowed in the provider stack.

## Goals

- Make Rust the single source of truth for supported providers and protocols.
- Keep TypeScript extremely light for AI provider support.
- Split execution code into protocol-focused and provider-focused modules.
- Make it easy to implement each protocol from official docs in isolation.
- Make it easy to tune transport, streaming, tool calling, and model discovery
  per protocol family.
- Stop protocol declarations from drifting ahead of runtime execution.
- Support staged migration without breaking existing OpenAI-compatible and
  OpenRouter flows.

## Non-Goals

- Rewriting the full Lyra agent runtime in one pass.
- Replacing the entire desktop settings UI in the first phase.
- Enabling every declared provider immediately.
- Creating a separate workspace crate on day one unless the first extraction
  proves a crate boundary is needed.

## Core Design Principle

Protocol family and provider route are not the same thing.

Example:

- OpenAI hosted chat completions
- DeepSeek hosted chat completions
- xAI hosted chat completions
- Groq hosted chat completions
- LM Studio local server
- vLLM local server
- custom OpenAI-compatible endpoint

These should not become six or seven unrelated protocol implementations if they
share the same wire contract family. They should share one protocol adapter and
have separate provider route files for defaults and quirks.

This distinction is the main protection against future code bloat.

## Target Conceptual Model

Lyra should model the stack with four layers:

1. Catalog layer
   Rust-owned manifest of supported protocols, providers, auth schemes, fields,
   discovery capabilities, and runtime support state.
2. Provider route layer
   Vendor or backend-specific defaults, auth behavior, model discovery, and
   compatibility quirks.
3. Protocol adapter layer
   Wire-level request building, response parsing, streaming parsing, tool-call
   normalization, multimodal mapping, and error normalization.
4. Transport or execution backend layer
   HTTP JSON, SSE, signed HTTP, or local FFI execution.

TypeScript should only consume layer 1 through a native bridge.

## Protocol Families

Lyra should organize protocols by families like these:

| Protocol family | Typical routes or brands | Backend kind |
| --- | --- | --- |
| `openai_chat_completions` | OpenAI, DeepSeek, xAI, Groq, Together, Fireworks, LM Studio, vLLM, llama.cpp server, custom compatible, MiMo OpenAI mode | HTTP JSON + streaming |
| `openai_responses` | OpenAI Responses API | HTTP JSON + streaming |
| `anthropic_messages` | Anthropic, MiMo Anthropic mode | HTTP JSON + streaming |
| `gemini_generate_content` | Google AI Gemini | HTTP JSON + streaming |
| `ollama_chat` | Ollama | HTTP JSON + streaming |
| `aws_bedrock_converse` | AWS Bedrock | signed HTTP |
| `local_inference` | llama.cpp FFI, MLX FFI | native local execution |

This table defines the architectural split. It does not mean every row is
implemented in phase one.

## Target On-Disk Layout

The first extraction should stay inside `lyra-agent-runtime` to reduce churn.

```text
crates/lyra-agent-runtime/src/native_backend/providers/
  mod.rs
  catalog.rs
  registry.rs
  profile_store.rs
  migration.rs
  types.rs
  errors.rs
  capabilities.rs

  transport/
    mod.rs
    http.rs
    sse.rs
    auth.rs
    retry.rs
    rate_limit.rs

  protocol/
    mod.rs
    openai_chat_completions/
      mod.rs
      request.rs
      response.rs
      stream.rs
      tools.rs
      images.rs
      discovery.rs
    openai_responses/
      mod.rs
      request.rs
      response.rs
      stream.rs
      tools.rs
      images.rs
      discovery.rs
    anthropic_messages/
      mod.rs
      request.rs
      response.rs
      stream.rs
      tools.rs
      images.rs
      discovery.rs
    gemini_generate_content/
      mod.rs
      request.rs
      response.rs
      stream.rs
      tools.rs
      images.rs
      discovery.rs
    ollama_chat/
      mod.rs
      request.rs
      response.rs
      stream.rs
      tools.rs
      discovery.rs
    aws_bedrock_converse/
      mod.rs
      request.rs
      response.rs
      stream.rs
      tools.rs
      discovery.rs
    local_inference/
      mod.rs
      llama_cpp_ffi.rs
      mlx_ffi.rs

  routes/
    mod.rs
    openai.rs
    openrouter.rs
    deepseek.rs
    xai.rs
    groq.rs
    together.rs
    fireworks.rs
    anthropic.rs
    google_ai.rs
    ollama.rs
    lmstudio.rs
    llama_cpp_server.rs
    vllm.rs
    custom_openai_compatible.rs
    mimo.rs
    aws_bedrock.rs
```

## File Ownership Rules

To prevent the refactor from recreating the same problem under a different
folder tree, each file or folder should own one responsibility.

Rules:

- `catalog.rs` owns provider and protocol manifest assembly only.
- `registry.rs` owns adapter registration and lookup only.
- `profile_store.rs` owns persisted profile schema and CRUD only.
- `migration.rs` owns legacy-to-new config migration only.
- `transport/*` owns transport primitives only.
- `protocol/<family>/request.rs` owns request body shaping only.
- `protocol/<family>/response.rs` owns non-streaming response parsing only.
- `protocol/<family>/stream.rs` owns stream chunk parsing only.
- `protocol/<family>/tools.rs` owns tool-call normalization only.
- `routes/<provider>.rs` owns one provider or backend route only.

No protocol-specific `if provider == ...` branches should live in shared
transport modules.

## Rust Traits and Data Contracts

The provider stack should be built around explicit traits instead of ad hoc
branching.

### Protocol adapter

```rust
pub trait ProtocolAdapter: Send + Sync {
    fn protocol_id(&self) -> &'static str;
    fn backend_kind(&self) -> BackendKind;
    fn supports_model_discovery(&self) -> bool;

    fn build_request(
        &self,
        route: &ProviderRouteConfig,
        request: &NormalizedModelRequest,
    ) -> Result<TransportRequest, ProviderError>;

    fn parse_response(
        &self,
        route: &ProviderRouteConfig,
        response: TransportResponse,
    ) -> Result<ModelReply, ProviderError>;

    fn parse_stream_event(
        &self,
        route: &ProviderRouteConfig,
        event: StreamEvent,
        state: &mut StreamAccumulator,
    ) -> Result<StreamParseAction, ProviderError>;

    fn discover_models(
        &self,
        route: &ProviderRouteConfig,
    ) -> Result<Vec<ModelDescriptor>, ProviderError>;
}
```

### Provider route

```rust
pub trait ProviderRoute: Send + Sync {
    fn provider_id(&self) -> &'static str;
    fn label(&self) -> &'static str;
    fn protocol_family(&self) -> &'static str;
    fn default_base_url(&self) -> Option<&'static str>;
    fn auth_strategy(&self) -> AuthStrategy;
    fn runtime_support(&self) -> RuntimeSupport;

    fn normalize_profile(
        &self,
        profile: ProviderProfileInput,
    ) -> Result<ProviderRouteConfig, ProviderError>;

    fn mutate_request(
        &self,
        request: &mut TransportRequest,
        config: &ProviderRouteConfig,
    ) -> Result<(), ProviderError>;

    fn discover_models(
        &self,
        adapter: &dyn ProtocolAdapter,
        config: &ProviderRouteConfig,
    ) -> Result<Vec<ModelDescriptor>, ProviderError>;
}
```

### Execution backend

```rust
pub enum BackendKind {
    HttpJson,
    HttpJsonSse,
    SignedHttp,
    LocalFfi,
}
```

The runtime call path should become:

1. load profile
2. resolve provider route
3. resolve protocol adapter
4. build normalized request
5. execute transport
6. parse response through adapter
7. return normalized reply to the model loop

## Config Ownership and Persistence

Current config should evolve from loose provider records into protocol-aware
profiles.

### Current shape

The current runtime stores a provider profile concept with fields such as:

- `provider_type`
- `base_url`
- `default_model`
- `api_key`
- `api_key_env`
- `auth_header`
- `models`

### Target shape

The new persisted shape should become explicit:

```json
{
  "schemaVersion": 2,
  "defaultProfileId": "openai-default",
  "profiles": [
    {
      "id": "openai-default",
      "label": "OpenAI",
      "providerId": "openai",
      "routeId": "openai",
      "protocolId": "openai_chat_completions",
      "backendKind": "http_json_sse",
      "runtimeSupported": true,
      "connection": {
        "baseUrl": "https://api.openai.com/v1"
      },
      "auth": {
        "scheme": "bearer",
        "apiKeyEnv": "OPENAI_API_KEY"
      },
      "modelSelection": {
        "defaultModel": "gpt-4.1-mini",
        "models": []
      },
      "featureOverrides": {}
    }
  ]
}
```

This schema makes protocol ownership explicit and removes the need for
TypeScript to infer runtime meaning from partial config fields.

## Catalog Ownership

Rust should expose a catalog API that TypeScript renders directly.

Suggested runtime methods:

- `agent.provider.catalog.read`
- `agent.provider.profile.list`
- `agent.provider.profile.read`
- `agent.provider.profile.upsert`
- `agent.provider.profile.delete`
- `agent.provider.models.discover`
- `agent.provider.health.check`

Catalog payload should include:

- provider ID
- route ID
- protocol family
- runtime support state
- label and description
- official docs URL
- auth field schema
- connection field schema
- model discovery support
- local or remote backend kind
- supported capabilities such as images, tools, streaming, reasoning controls

TypeScript should not hardcode these values as operational truth anymore.

## TypeScript End State

TypeScript should stay, but only as a thin shell.

### TypeScript should keep

- bridge DTO types
- generic form rendering
- generic list and selection UI
- local draft state for editing unsaved forms
- presentation-only labels and icons where needed

### TypeScript should stop owning

- hardcoded provider catalog truth
- hardcoded protocol catalog truth
- runtime support flags as source of truth
- protocol-specific save logic
- protocol-specific field logic outside generic rendering
- vendor-specific request behavior

### Files that should shrink or disappear

- `apps/desktop/src/shared/ai.ts`
  - keep bridge DTO shapes only
  - remove hardcoded protocol truth over time
- `apps/desktop/src/modules/workbench/settings-ai/providers/*`
  - replace with native catalog rendering
- TypeScript tests that assert static preset lists
  - replace with catalog-driven expectations

## Official Documentation Workflow

Each protocol family should be implemented from official docs with an explicit
checklist. This is the main reason to isolate protocol folders.

For every protocol family, capture:

- official docs URL
- auth method
- model discovery endpoint
- sync completion endpoint
- streaming endpoint or event format
- request body schema
- tool-call request format
- tool-call response format
- multimodal input format
- reasoning or chain-of-thought related fields
- error response schema
- rate limit headers
- retry guidance
- known incompatibilities or vendor quirks

For every provider route, capture:

- official route docs URL
- default base URL
- required headers
- auth differences from the base protocol
- route-specific body fields
- model discovery differences
- capability caveats

Every new provider route should land with a short route note and tests. No
silent "compatible" route should be added without evidence.

## Migration Strategy

The migration should be staged. A one-shot rewrite is unnecessary risk.

### Phase 0: freeze and scaffold

- create the new Rust provider tree
- define traits, shared types, errors, and transport helpers
- add a new native catalog read method
- keep existing runtime path working

Exit criteria:

- new folder tree exists
- zero behavior change
- no TypeScript logic removed yet

### Phase 1: extract current OpenAI-compatible path

- move existing OpenAI-compatible request and response behavior out of
  `native_backend/provider.rs`
- create `protocol/openai_chat_completions/*`
- create `routes/openai.rs`, `routes/custom_openai_compatible.rs`,
  `routes/lmstudio.rs`, `routes/vllm.rs`, `routes/llama_cpp_server.rs`
- keep existing public runtime behavior stable

Exit criteria:

- OpenAI-compatible flows use the new adapter path
- the old giant provider file shrinks materially
- legacy tests still pass

### Phase 2: extract OpenRouter and MiMo route logic

- isolate OpenRouter route-specific logic under `routes/openrouter.rs`
- isolate MiMo route logic under `routes/mimo.rs`
- formalize route-specific headers and discovery behavior

Exit criteria:

- provider loop no longer branches ad hoc for OpenRouter or MiMo
- route metadata is catalog-driven

### Phase 3: move catalog truth to Rust

- implement `agent.provider.catalog.read`
- refactor desktop settings UI to render Rust catalog results
- remove TypeScript hardcoded preset truth

Exit criteria:

- adding a new provider route does not require a TypeScript catalog change
- TypeScript becomes a generic renderer

### Phase 4: add protocol families one by one

Recommended order:

1. `openai_responses`
2. `anthropic_messages`
3. `gemini_generate_content`
4. `ollama_chat`
5. `aws_bedrock_converse`
6. `local_inference`

Exit criteria:

- each family lands with official docs notes, fixtures, and route tests

### Phase 5: remove obsolete glue

- delete old TypeScript preset ownership
- delete legacy provider branches from `native_backend/provider.rs`
- tighten architecture guard thresholds

## Legacy Migration Mapping

Initial migration rules should be explicit:

- legacy `provider_type = "openai-compatible"` plus base URL
  - map to route by known host when possible
  - otherwise map to `custom_openai_compatible`
- legacy `provider_type = "openrouter"`
  - map to `providerId = openrouter`
  - map to `protocolId = openai_chat_completions` or dedicated
    `openrouter_chat_completions` route binding, depending final naming
- legacy default `openai`
  - map to `providerId = openai`
- legacy `mimo-token-plan`
  - map to `providerId = mimo`
  - map to MiMo route metadata
- embedded local model profiles
  - do not appear as runtime-supported until native backend support is complete

No migration should rely on TypeScript-only preset IDs as runtime truth.

## Testing Strategy

Testing should be split by layer.

### Unit tests

- request body shaping
- response parsing
- stream chunk parsing
- tool-call normalization
- route-specific header injection
- config normalization and migration

### Fixture tests

- golden JSON request snapshots
- golden non-streaming responses
- golden SSE chunk sequences
- golden error payload normalization

### Integration tests

- mocked HTTP server per protocol family
- mocked model discovery endpoint
- local FFI inspection path tests
- catalog read bridge tests

### Live smoke tests

Optional and environment-gated:

- OpenAI smoke test
- OpenRouter smoke test
- Anthropic smoke test
- Gemini smoke test
- Ollama smoke test

Live smoke tests should never be required for normal CI, but the harness should
exist for manual verification.

## Architecture Guard Rules for the New Stack

The new provider stack should adopt explicit guard rules from the start.

Recommended guard policy:

- `mod.rs` files stay wiring-only
- protocol family directories must split request, response, and stream parsing
- no file in `providers/` should exceed a reasonable hot-spot threshold without
  review
- new provider support must include tests
- TypeScript may not reintroduce hardcoded provider truth after catalog
  migration

If the architecture guard needs baseline entries for the new provider stack, the
refactor has already missed its goal.

## Risks

### Risk: too much abstraction too early

Mitigation:

- extract current OpenAI-compatible path first
- do not build traits that no real protocol uses
- keep trait surface minimal until phase 2 proves the shape

### Risk: protocol family and provider route boundaries get confused

Mitigation:

- document both separately
- require every route to name its protocol family explicitly
- reject new vendor-specific protocol folders unless the wire contract differs

### Risk: TypeScript remains a second catalog

Mitigation:

- add Rust catalog endpoint before broad provider expansion
- ban TypeScript-only provider additions

### Risk: migration breaks existing sessions

Mitigation:

- keep legacy read compatibility during migration
- add migration tests for real saved state snapshots

## Recommended First Deliverable

The first real implementation step after this document should be:

1. create `native_backend/providers/`
2. move OpenAI-compatible wire logic into
   `protocol/openai_chat_completions/`
3. add route files for `openai`, `openrouter`, and `custom_openai_compatible`
4. keep current public runtime methods unchanged
5. leave TypeScript behavior unchanged for that phase

This gives the project immediate structure without forcing a risky UI rewrite at
the same time.

## Acceptance Criteria

This refactor is successful when all of these are true:

- Rust is the only operational source of truth for protocol support.
- TypeScript can render provider settings without embedding protocol behavior.
- provider execution no longer depends on one large mixed-responsibility file.
- adding a new provider route does not require touching unrelated protocol code.
- each protocol family can be improved against official docs in isolation.
- local and hosted backends share only the abstractions they truly need.

## Final Recommendation

Proceed with the refactor, but do it as a staged Rust-first extraction rather
than a one-shot rewrite.

The correct split is:

- by protocol family for wire behavior
- by provider route for vendor defaults and quirks
- by backend kind for transport or local execution

TypeScript should become a thin consumer of the native catalog and profile
bridge. That design gives Lyra the strongest chance of staying maintainable
while expanding protocol support aggressively.
