# Reasoning replay diagnosis and contract

Audience: Internal
Status: Active
Last verified: 2026-09-25

## Observable failure

In an existing DeepSeek thinking session, let an assistant finish a tool round
and answer, then let a completed background task resume that session. The next
provider request must preserve the original assistant reasoning, including the
tool-free final answer. It must not fail with HTTP 400 asking for
`reasoning_content` to be passed back.

The incident investigation matched the reported request ID to the latest local
session. Four failures occurred on automatic continuation turns. Immediately
before the reported failure, the displayed message and provider transcript both
retained 1,306 characters of reasoning, while its version-2 native replay stored
`{"field":"reasoning_content","value":null}`. The original outgoing HTTP body
was not retained, so the incident record alone cannot distinguish an omitted
field from an explicitly null field on that request.

## Official requirement and reference implementations

[DeepSeek's thinking-mode documentation](https://api-docs.deepseek.com/guides/thinking_mode/)
requires full reasoning passback for previous assistant messages when the
request includes tools, including messages that did not invoke a tool. Its
example retains the complete response message across user turns. Without tools,
the API ignores replayed reasoning. Its streaming example accumulates actual
reasoning fragments; null deltas do not erase earlier fragments.

The local reference check used these snapshots:

| Reference | What it does | What it does not do on this path |
| --- | --- | --- |
| `參考/deepseek-harness`, `ddefc45fbc` | Accumulates nonempty string deltas into reasoning blocks; serializes those blocks for every reasoning-bearing assistant message. | Does not overwrite reasoning with null, limit passback to tool calls, or manufacture replacement thought text. Empty reasoning is omitted. |
| `參考/opencode`, `f69beceaff` | Its chat protocol keeps typed reasoning parts and ignores null deltas. Its application transform uses model interleaving metadata and emits reasoning for every assistant message. | Does not treat final text as a reason to discard thinking. Its application transform does add empty reasoning for DeepSeek model names, which cannot recover previously lost text. |

The reference projects are not proof of universal correctness. An author of a
[zero-reasoning report in the DeepSeek harness repository](https://github.com/deepseek-ai/deepseek-harness/discussions/7050)
observed the complementary failure when a completion contains no thought at
all. This is a user reproduction, not an official maintainer guarantee. Lyra
uses the existing required-field policy on the official DeepSeek chat route:
preserve real thought when available, otherwise serialize the required string
as `""`. An empty field does not reconstruct lost reasoning and is never used
to replace surviving reasoning. No nonempty stub is invented.

Relevant reference files:

- `參考/deepseek-harness/packages/llm/llm-deepseek/src/protocols/chat-completions/translate.ts`
- `參考/deepseek-harness/packages/llm/llm-deepseek/src/protocols/chat-completions/serialize.ts`
- `參考/opencode/packages/llm/src/protocols/openai-chat.ts`
- `參考/opencode/packages/opencode/src/provider/transform.ts`
- `參考/opencode/packages/opencode/src/provider/provider.ts`

The useful boundary is: **displaying or finishing an answer does not authorize
discarding the provider state needed to continue it.** Lyra keeps that state
separate from the UI text and selects wire fields using the destination route
and model contract. It does not infer a gateway's accepted fields from a model
name containing “deepseek”.

## Failure classes addressed

1. **Null stream deltas erased previous data.** A shared, typed accumulator now
   ignores null and invalid types, concatenates string fragments, and preserves
   structured reasoning arrays. Explicit empty strings and arrays remain valid.
2. **Only the first reasoning alias was retained.** Streaming and nonstreaming
   parsing retain all supported native fields independently. A null or empty
   display alias cannot hide another populated alias. Opaque details remain
   separate from display text.
3. **Automatic capability selection dropped DeepSeek reasoning.** The official
   DeepSeek chat route defaults to `reasoning_content`, including unlisted
   models, and requires that string field even on zero-reasoning history.
   Provider-scoped cached interleaving metadata also resolves `auto`.
   Explicit model settings and capability overrides still take precedence.
   Metadata for another provider does not enable fields on a strict gateway.
4. **Serialization selected null or a display projection over native data.**
   The request serializer prefers a valid native value and rejects wrong types.
   It cannot convert a display string into `reasoning_details`. The strict
   role/field allowlist remains in place.
5. **Already-saved sessions preferred damaged native replay.** Context assembly
   repairs old null entries from the exact response's surviving transcript or
   attributable UI reasoning. Provider, route, protocol, and model must match.
   Prior steps match a unique assistant by content and tool-call IDs; merged UI
   thought text is not borrowed across steps. This is an in-memory read repair,
   not a database rewrite.
6. **Length-limit continuation discarded intermediate reasoning.** Normal and
   progress-guard continuations now replay and persist each response segment
   with its own native data. Only the visible answer is concatenated; the
   protocol history preserves the original segments.
7. **Retention confused missing reasoning with an incomplete tool round.**
   Assistant tool calls and their results are retained together, after budget
   selection. A valid nonthinking tool round is not discarded just because it
   lacks `reasoning_content`.

Live tool calls, final answers, clarification recovery, and truncated tool-call
recovery share one assistant replay attachment helper. OpenAI Responses and
Anthropic native payloads keep their protocol ownership; foreign payloads are
not relabeled as Chat Completions reasoning.

## Verification and limits

Regression coverage includes string/null delta sequences, simultaneous text and
opaque details, nonstreaming replies, sync/async request serialization, explicit
opt-out, strict gateway isolation, old-session read repair, origin isolation,
tool-free answers, and both length-limit continuation paths.

A local HTTP integration test exercises an SSE tool call, an SSE final answer,
SQLite save/reload, context reconstruction, and a new request without a new user
message. It verifies the exact thought text on each assistant message. This
does not call the paid provider API or execute the user's real task.

Read-only replay of the incident session recovered all 116 messages with
surviving saved reasoning and emitted no null reasoning values, including
the 1,306-character response preceding the reported failure. Five messages had
no attributable saved thought text; their original thought cannot be recovered
from the available record. On the DeepSeek wire they receive an empty field,
not fabricated thought text. Equality was checked against the saved text; the
original network stream is unavailable, so historical whitespace lost before
storage cannot be recovered or verified. Original session files and provider
settings were left untouched.

Run the focused tests with:

```sh
cargo test -p lyra-agent-runtime --lib reasoning_replay
cargo test -p lyra-agent-runtime --lib model_loop_progress_guard_allows_structured_clarification_only
cargo test -p lyra-agent-runtime --lib cached_capability_parses_catalog_once_per_mtime
```

Verification recorded for this change:

| Check | Result |
| --- | --- |
| Reasoning replay filter | 12 passed, including local HTTP and SQLite replay |
| Context builder tests | 47 passed |
| Provider modules | 241 passed, including capability-cache isolation |
| Progress-guard clarification regression | Passed |
| Runtime library suite | 935 passed, 12 failed; all 12 also failed with the pre-change runtime source in an isolated copy (924 passed, 12 failed) |
| Formatting of the 22 touched Rust files | Passed |
| Workspace formatting | Blocked by existing formatting in unrelated files |
| Workspace Clippy | Blocked by existing denied lints in `lyra-bootstrap-installer`: two format arguments and two redundant clones |
| Structure guard | Blocked by existing size limits in `state.rs`, `tools/file.rs`, `tools/web.rs`, and existing desktop storage-root violations |
| `cargo build -p lyrad` and desktop native staging | Passed; staged runtime checksum matches the build output |

The full library run preceded the final zero-thought and foreign-payload boundary
refinements; the focused, context-builder, and provider checks above ran against
the final code. Counts overlap and must not be added together. The 12 baseline
failures concern tool-catalog expectations, permission flows, and output
truncation, rather than reasoning replay. They remain release-check blockers.

After loading the rebuilt runtime, repeat the original action in the existing
session: continue work, allow a tool round to finish, and let a background task
wake the assistant. Also reload the session and continue once. Local tests and
read-only replay establish the data contract; the actual provider/UI action is
still the acceptance check. A historical response whose original reasoning was
never saved remains a separate recovery limitation.
