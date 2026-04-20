# Lyra Agent -> Codex Engine Migration Execution Plan

## 1. Goal

This document defines what must be done to migrate Lyra's current Agent runtime to a Codex-powered core while preserving Lyra Desktop UI contracts and product-specific capabilities.

This is an execution-oriented plan, not a design brainstorm.

## 2. Decision and Strategy

Adopt a staged migration with a compatibility adapter, not a one-shot replacement.

- Keep Lyra Desktop UI IPC contract stable.
- Keep Lyra runtime envelope and handshake stable at first.
- Replace the agent execution core behind the runtime boundary.
- Decommission old Lyra agent core only after parity and soak.

Reason:
- Fastest path to production-level capability without breaking current UI flows.
- Lower outage risk than hard switch.
- Allows phased verification and rollback.

## 3. Constraints

- No destructive migration of existing user data.
- Existing UI IPC channels must continue to work.
- Existing `agent.runtime` event subscription model must continue to work.
- Existing `~/.lyra/modules/ai` storage must remain readable during migration.
- Migration must allow rollback to current Lyra core.

## 4. Must-Preserve Product Contracts

### 4.1 Desktop Agent API surface (must remain callable)

Current Lyra desktop uses these operations and expects current response shapes:

- session lifecycle:
  - `agentListSessions`
  - `agentCreateSession`
  - `agentGetSession`
  - `agentBindSessionProject`
  - `agentDeleteSession`
- turn and plan:
  - `agentSendTurn`
  - `agentEnterPlanMode`
  - `agentGetPlan`
- interactions and approvals:
  - `agentGetPendingInteractions`
  - `agentAnswerQuestion`
  - `agentAnswerPlanQuestion`
  - `agentResolvePlanApproval`
  - `agentSubmitCommandApproval`
  - `agentResumeExecution`
- memory settings:
  - `agentGetMemoryConfig`
  - `agentUpdateMemoryConfig`
- events:
  - `agentEvent`

### 4.2 Runtime-level methods currently exposed by `lyrad`

The runtime currently exposes a fixed method family:

- `agent.sessions.*`
- `agent.threads.*`
- `agent.turns.send`
- `agent.plan.*`
- `agent.interactions.get_pending`
- `agent.questions.answer`
- `agent.command_approval.submit`
- `agent.execution.resume`
- `agent.memory.*`
- `agent.persona_context.sync`
- `agent.mcp_bridge.*`
- `agent.host_tools.*`
- `agent.browser_strategy.sync`
- `agent.skills.set_prompts`

### 4.3 Data shape compatibility expected by UI

The following domain models must remain representable to UI:

- `AgentSession`
- `AgentSessionDetail`
- `AgentTurn`
- `AgentMessage`
- `AgentToolCall`
- `AgentPendingInteraction`
- `AgentExecutionState`
- `AgentExecutionCheckpointSummary`
- `AgentRuntimeEvent`

## 5. Target Architecture

## 5.1 Transitional architecture (Phase A/B)

- Keep `Lyra Desktop -> runtime-client -> lyrad` unchanged at the transport level.
- Introduce a Codex adapter layer inside runtime side:
  - input: current Lyra runtime request payloads
  - output: current Lyra response payloads
  - engine backend: Codex app-server/core
- Keep Lyra-specific overlays in runtime boundary:
  - persona context sync
  - host tools sync
  - MCP bridge sync
  - browser strategy sync

## 5.2 Final architecture (Phase C/D)

- Agent execution handled by Codex core path.
- Lyra runtime keeps only:
  - transport protocol
  - UI contract transformation
  - Lyra product-specific composition logic
- Old Lyra agent implementation paths removed after parity window.

## 6. Work Breakdown Structure (WBS)

## 6.1 Phase 0 - Baseline and Freeze

Deliverables:
- baseline matrix of current flows and expected outputs
- golden traces for representative sessions
- migration risk register

Tasks:
1. Lock current UI contract snapshots (types + sample payloads).
2. Capture golden event streams for:
   - normal turn completion
   - user-question pause/resume
   - command approval pause/resume
   - plan approval flow
   - execution conflict flow
3. Capture baseline performance metrics:
   - first token latency
   - turn completion latency
   - pause/resume latency
4. Define go/no-go parity criteria.

Exit criteria:
- reproducible baseline fixtures committed.
- parity checklist approved.

## 6.2 Phase 1 - Runtime Transport and Protocol Bridge

Deliverables:
- adapter that translates Lyra runtime calls to Codex app-server calls
- adapter that translates Codex notifications to Lyra runtime events

Tasks:
1. Build request mapping layer:
   - Lyra method -> Codex method(s)
2. Build response mapping layer:
   - Codex thread/turn/item model -> Lyra session/turn/message/toolCall model
3. Build event mapping layer:
   - Codex notifications -> Lyra `AgentRuntimePhase`
4. Preserve current handshake and envelope format.
5. Implement feature flag to switch backend engine:
   - `lyra-core` (old)
   - `codex-core` (new)

Exit criteria:
- desktop can call existing agent APIs with codex backend enabled for basic send-turn flow.

## 6.3 Phase 2 - State and Storage Migration

Deliverables:
- state interoperability model
- reversible migration strategy

Tasks:
1. Choose storage mode:
   - Option A: Lyra DB as source of truth, Codex data projected into it.
   - Option B: Codex rollout/state as source of truth, Lyra DB as compatibility cache.
2. Implement thread/session id mapping table.
3. Implement history projection pipeline:
   - Codex conversation state -> Lyra `agent_*` tables required by UI.
4. Implement execution checkpoint projection:
   - map Codex lifecycle to Lyra `execution_state` and `execution_checkpoints`.
5. Implement migration/rollback scripts:
   - dry-run support
   - integrity checks

Exit criteria:
- existing sessions remain readable.
- newly created sessions are queryable through current UI APIs.

## 6.4 Phase 3 - Interaction and Approval Parity

Deliverables:
- interaction behavior parity in UI

Tasks:
1. Map request-user-input flow to Lyra pending interaction model.
2. Map command approval flow to Lyra `submitCommandApproval` contract.
3. Map plan-approval flow to Lyra plan contracts.
4. Ensure pause-resume semantics preserved:
   - paused turn visible
   - resume turn auditable
5. Ensure conflict policy preserved:
   - continue previous execution
   - abandon and start new

Exit criteria:
- all interaction flows pass contract tests and e2e tests.

## 6.5 Phase 4 - Lyra-specific Capability Reattachment

Deliverables:
- codex backend works with Lyra product differentiators

Tasks:
1. Reattach persona context sync (`agent.persona_context.sync`).
2. Reattach host tools sync (`agent.host_tools.sync/remove`).
3. Reattach MCP bridge sync/remove.
4. Reattach browser strategy sync.
5. Reattach skill prompt injection behavior.

Exit criteria:
- Lyra-specific features available and observable in runtime events.

## 6.6 Phase 5 - Memory and Optimization Rebuild

Deliverables:
- memory features exposed through current Lyra settings UI

Tasks:
1. Define which memory controls remain Lyra-owned vs delegated to Codex.
2. Implement compatibility facade for:
   - `agent.memory.getConfig`
   - `agent.memory.updateConfig`
3. Rebuild optimization-state persistence hooks required by Lyra UI behavior.
4. Validate round-trip behavior for pause/resume memory optimization state.

Exit criteria:
- memory settings panel fully functional.
- no regression in pause/resume optimization-state behavior.

## 6.7 Phase 6 - Decommission Old Core

Deliverables:
- old Lyra agent core removed or archived behind disabled flag

Tasks:
1. Run canary with codex backend as default.
2. Burn-in period with telemetry alarms.
3. Remove dead code paths and schema branches that are no longer used.
4. Finalize docs/runbooks.

Exit criteria:
- codex backend default for all target platforms.
- rollback path still available for one release window.

## 7. API/Model Mapping Work Items (Detailed)

## 7.1 Method mapping matrix (to implement)

1. Session and thread
- `agent.sessions.list` -> `thread/list` (+ transform)
- `agent.sessions.create` -> `thread/start` with empty seed or adapter-created session bootstrap
- `agent.sessions.get` -> `thread/read` + turn/item projection

2. Turn execution
- `agent.turns.send` -> `turn/start`
- `agent.threads.turns.send` -> `turn/start` with explicit thread id

3. Interactions
- `agent.questions.answer` -> response to `item/tool/requestUserInput`
- `agent.command_approval.submit` -> response to command approval requests
- `agent.execution.resume` -> `thread/resume`/`turn/steer` depending on state

4. Planning
- map Lyra plan mode to Codex collaboration mode and plan item stream

5. Events
- Codex `thread/*`, `turn/*`, `item/*`, `command/exec/outputDelta` -> Lyra runtime phases

## 7.2 Data model mapping (to implement)

- Codex `Thread` -> Lyra `AgentSession` (+ compatibility metadata)
- Codex `Turn` -> Lyra `AgentTurn`
- Codex `Item` -> Lyra `AgentMessage` and/or `AgentToolCall`
- Codex approvals/input requests -> Lyra `AgentPendingInteraction`
- Codex lifecycle -> Lyra `AgentExecutionState`/`Checkpoint`

## 8. Testing Plan

## 8.1 Contract tests

- validate all desktop-facing agent IPC contracts still parse and render.
- strict snapshot tests for `AgentSessionDetail` shape.

## 8.2 Runtime integration tests

- send-turn happy path
- question pause/resume
- command approval pause/resume
- plan approval loop
- execution conflict branch

## 8.3 Migration tests

- existing Lyra sessions readable after migration
- dual-write consistency checks
- rollback compatibility tests

## 8.4 Soak tests

- long-running sessions
- high tool-call density
- reconnect/restart resilience

## 9. Observability and Operations

Tasks:
1. Add backend selection markers in runtime logs and events.
2. Add phase-level latency and failure metrics.
3. Add migration-specific error codes and dashboards.
4. Add on-call runbook:
   - flip feature flag
   - rollback procedure
   - data repair playbook

## 10. Risk Register (Top)

1. Semantic mismatch in pause/resume state machine.
- Mitigation: adapter state layer + exhaustive transition tests.

2. Event model mismatch causing UI regressions.
- Mitigation: event mapping contract tests + golden traces.

3. Storage divergence between Lyra and Codex state.
- Mitigation: single source of truth decision before Phase 2 exit.

4. Approval/request-user-input loop inconsistencies.
- Mitigation: explicit interaction id mapping and audit chain tests.

5. Migration timeline slip due to hidden capability coupling.
- Mitigation: phase gates with hard exit criteria.

## 11. Legal and Compliance Checklist (Apache-2.0)

Tasks:
1. Keep upstream copyright/license headers where required.
2. Include Apache-2.0 NOTICE propagation where applicable.
3. Mark modified upstream files clearly.
4. Maintain third-party attribution manifest.

## 12. Rollout Plan

1. Internal dev flag only.
2. Dogfood canary (single-machine, controlled sessions).
3. Partial rollout by profile/project.
4. Full rollout after parity and soak pass.

## 13. Definition of Done

Migration is considered done only when all are true:

1. Desktop UI contract unchanged for consumers.
2. All interaction flows stable and test-covered.
3. Existing sessions readable; new sessions stable.
4. Lyra-specific capabilities are functional.
5. Old core can be disabled without user-facing regressions.
6. Rollback is validated for at least one release window.

## 14. Immediate Next Actions (Execution Queue)

1. Create `migration/baseline` fixtures and golden event traces.
2. Create adapter interface spec doc (method-by-method mapping).
3. Implement backend feature flag in runtime boundary.
4. Deliver Phase 1 PoC: `list/create/send/event` round-trip via Codex backend.
5. Run parity review against this document before Phase 2.

