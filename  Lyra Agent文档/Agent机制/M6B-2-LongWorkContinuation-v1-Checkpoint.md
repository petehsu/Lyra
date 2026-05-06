# M6B-2 LongWork Continuation v1 Checkpoint

## objective

M6B-2 upgrades the M6B-1 `LongWorkRun` ledger into the smallest runtime controller that can account for stopped `WorkSlice`s, detect unfinished completion candidates, suppress premature user-visible output, persist `ContinuationPacket` state, expose reload-safe continuation summaries, and stop bounded resume loops as blocked or stuck.

This checkpoint is intentionally M6B-2a: the current runtime has no verified safe same-request model re-entry boundary for a second model loop after output suppression, so this slice implements continuation queue plus explicit resume state and events. It must not claim full automatic model re-entry. M6B-2b can add safe model re-entry later.

Out of scope: Follow live edit, message-level rollback UI, budget panel, daemon multi-process background model loop, Oma continuation, and unrelated desktop/browser/settings/download work.

## module_ownership

- Ledger owner: `crates/lyra-ai-core/src/storage/long_work_ledger.rs` owns creating, reading, and updating `LongWorkRun` and `WorkSlice` ledger rows.
- Status decision owner: `crates/lyra-ai-core/src/storage/long_work_status.rs` owns Todo / Verification / CompletionAudit / blocker status derivation.
- Continuation storage owner: `crates/lyra-ai-core/src/storage/long_work_continuation.rs` owns `ContinuationPacket`, `PrematureStopReport`, `StuckReport`, queue state, and reload-safe reads. It does not execute resume.
- Schema owner: `crates/lyra-ai-core/src/storage/long_work_schema.rs` stays DDL-only.
- Runtime glue owner: `crates/lyra-ai-core/src/agent_runtime/long_work_controller.rs` owns stop accounting, premature-stop decision orchestration, queue events, bounded resume state, and stuck events. SQL stays in storage modules.
- Projection owner: `crates/lyra-ai-core/src/agent_runtime/long_work_projection.rs` stays the bridge from tool/completion projections to the controller and runtime events.
- Prompt owner: `crates/lyra-ai-core/src/prompt.rs` renders existing LongWork summaries, continuation summaries, suppression summaries, and stuck summaries only from already-built structured state.
- UI owner: `apps/desktop/src/modules/workbench/ai-panel/long-work-status-row.tsx` remains the compact row. If more formatting is needed, use a local pure helper/model beside it, not thread/todo/approval/patch views.
- Tests owner: focused long-work Rust tests remain in `crates/lyra-ai-core/src/agent_runtime/long_work_tests.rs`; focused UI tests remain beside `LongWorkStatusRow`.

## state_contract

- `LongWorkRun.long_work_run_id` binds `session_id`, `runtime_turn_id`, `user_message_id`, `todo_list_id`, `execution_run_id`, and `goal_id`.
- `WorkSlice.work_slice_id` binds one `long_work_run_id`, the active `todo_list_id`, the active `execution_run_id`, sequence, stop cause, refs, and progress delta.
- `PrematureStopReport.report_id` binds `session_id`, `long_work_run_id`, `work_slice_id`, `runtime_turn_id`, structured signals, open Todo ids, missing evidence ids, recommended action, and the suppressed output ref when present.
- `ContinuationPacket.continuation_id` binds the same `session_id`, `long_work_run_id`, previous `work_slice_id`, next slice sequence, runtime turn, status, recommended action, and compact packet JSON. It references Todo, Execution, Verification, Evidence, Artifact, and CompletionAudit by ids or summaries, not by copying full chat history.
- `StuckReport.stuck_report_id` binds `session_id`, `long_work_run_id`, `work_slice_id`, `runtime_turn_id`, repeated failure count, no-progress count, suspected cause, recommended action, and evidence refs.
- `AgentSessionDetail.longWorkSummary` is the only desktop read path for active LongWork state and includes latest continuation, premature stop, stuck, slice sequence, stop cause, and progress delta summaries.

## decision_refs

- Primary references: `M6B-2-LongWorkContinuation-v1-Todo.md`, `Agent-Native-Long-Work-Protocol.md`, `Agent-Runtime-Loop-Protocol.md`, `Tool-Required-Tools.md`, and `Agent-Follow-Protocol.md`.
- Prompt decision reference: `提示词系统/06-长工作Follow提示词.md` for relying on `ContinuationPacket` after compaction and changing strategy after repeated tool failure.
- Model boundary reference: `模型协议/Model-Protocol-Support.md` for treating `long_work_run_id`, `work_slice_id`, and `continuation_id` as internal control ids, not user-message history.
- UI decision is covered by the M6B-2 Todo and Agent docs: compact Zed-like status row, no modal, no manual resume button. No additional Zed file reference is required for this slice.
- Conservative assumption: because safe same-request model re-entry is not established, M6B-2a uses persisted queue and explicit resume status while still suppressing premature final output.

## resume_policy

- `queued` continuation can be resumed explicitly by the runtime API and shown as recoverable after reload.
- `resuming` continuation with no started side-effect evidence can be reset to `queued` during recovery.
- `resuming` or `queued` continuation with started tool execution, write side effects, pending approval, denied approval, safety blocker, clarification blocker, budget blocker, or unclear side-effect state must become `blocked` and must not be replayed automatically.
- The default maximum is three continuation slices per `LongWorkRun`.
- A next slice requires progress delta from Todo, tool operations, evidence, artifacts, diagnostics, or completion audit movement. No progress across repeated slices enters stuck.
- Repeated same tool failure two times enters stuck instead of another resume attempt.

## suppression_policy

- A model final-answer candidate is suppressible only when structured state says the LongWork is not complete and no real user-visible blocker exists.
- Suppressed output is not appended as a normal assistant message. It is recorded through `PrematureStopReport` plus runtime events for audit.
- Runtime emits `long_work.premature_stop_detected`, `long_work.output_suppressed`, and `long_work.continuation_queued`.
- The following prompt slice receives a summary that the previous output was system-rejected as non-final and must not claim completion.
- Real blockers remain user visible through blocked/stuck summaries, not through a generic "continue?" chat question.

## stuck_policy

- Repeated same tool failure count >= 2 creates a stuck report with suspected cause `same_tool_failure`.
- No Todo/tool/evidence/artifact/diagnosis/completion-audit movement across repeated slices creates a stuck report with suspected cause `model_looping` or `unknown`.
- Reaching the max continuation slice count creates a stuck or blocked report with a compact reason.
- Stuck output is one compact row reason plus structured event details. It must not ask whether to continue.
- If signals are insufficient, choose conservative blocked over unbounded retry.

## verification_first

Targeted Rust tests come before broad checks:

- open Todo plus model final answer suppresses output and queues continuation.
- missing verification after code change queues continuation.
- pending approval blocks and does not auto resume.
- completion audit passed plus Todo done completes with no continuation.
- repeated no-progress slices creates stuck.
- repeated same tool failure creates stuck.
- queued continuation survives `read_session_detail`.
- reload-safe recovery does not replay started write side effects.

Targeted UI tests cover auto-resuming/queued continuation, compact approval-blocked reason, compact stuck reason, and reload/detail refresh from `longWorkSummary`.

## no_bulk_generation

Do not generate ownerless scaffolding, one-function-per-file splits, broad UI panels, settings, Follow live draft components, rollback surfaces, or budget panels. Split only the M6B-1 long-work storage responsibilities needed for ledger/status/continuation boundaries, and keep existing public surfaces narrow.
