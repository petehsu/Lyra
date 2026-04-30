# Performance Engineering Strategy

Status: Active
Applies to: desktop UI, native runtimes, agent event pipelines, search/indexing, editor/terminal surfaces

## Goal
Lyra should optimize for measured responsiveness under agent-scale workloads:

- long-running AI sessions
- high-frequency streaming events
- large tool-call timelines
- large files, diffs, search results, and code indexes
- terminal, editor, browser automation, and runtime observation surfaces running together

The goal is extreme product performance without turning the codebase into an uncontrolled mix of languages and rendering stacks.

## Core Policy
Lyra's primary stack remains:

- TypeScript/React/Electron for UI composition, desktop shell glue, IPC registration, and user interaction.
- Native core code for stateful, OS-facing, security-sensitive, performance-sensitive, long-lived, or compute-heavy product behavior.

The native core is primarily Rust, C, and C++:

- Rust is the default safety, orchestration, lifecycle, permissions, concurrency, and product API boundary.
- C and C++ are accepted core implementation languages for high-performance engines, mature library integration, platform SDKs, parsing/indexing/search kernels, media/rendering subsystems, and other measured hot paths.
- Rust should normally own the safe external boundary even when C/C++ owns the inner engine.

Hand-written assembly is not a normal Lyra implementation strategy, but it may be introduced for exceptional isolated kernels after profiling proves that Rust/C/C++, compiler optimization, and SIMD intrinsics are insufficient. Prefer established libraries and portable SIMD before assembly.

## Performance Decision Ladder
When a performance issue appears, use this order:

1. Measure the bottleneck with profiling, traces, render timing, memory growth, or targeted benchmarks.
2. Reduce work at the source: batch events, coalesce updates, avoid redundant IPC, cache stable data, and stop unbounded scans.
3. Optimize the existing UI path: selectors, memoization, virtualization, incremental rendering, lazy rich rendering, CSS containment, and off-main-thread parsing.
4. Move heavy computation and long-lived state into the native core, returning stable view models to TypeScript.
5. Use specialized rendering islands only for dense, high-frequency surfaces such as timelines, graphs, minimaps, traces, or very large visualizations.
6. Use Rust, C, or C++ according to the domain boundary: Rust for safety/orchestration, C/C++ for proven engines, platform APIs, and measured kernels.
7. Consider SIMD or assembly-level optimization only for isolated kernels with benchmarks, tests, and a safe Rust, C, or C++ boundary.

Skipping directly to a lower-level language is not acceptable without evidence from the earlier steps.

## UI Performance Guardrails
React remains the default UI framework, but high-volume surfaces must stay thin and predictable:

1. No unbounded render lists. Large threads, search results, histories, traces, tool calls, and timelines must be virtualized, paginated, windowed, or summarized.
2. No per-token or per-event full-tree updates. Streaming AI events must be batched or reduced into stable render state.
3. No synchronous heavy parsing in render paths. Markdown, diff analysis, syntax highlighting, search aggregation, and trace processing must run outside render or move downward.
4. No O(history) work for every stream event. Maintain indexes, maps, and incremental aggregates for long sessions.
5. No chatty cross-process loops for hot paths. Prefer coarse-grained requests, streaming batches, and stable protocol payloads.
6. Presentational views stay stateless. Runtime behavior belongs in model, runtime, or task hooks with focused tests.
7. Rich rendering must degrade gracefully. Expensive diagrams, code blocks, diffs, and previews should be lazy, collapsible, or budgeted.

## Native Ownership
The native core is the default destination for:

- AI runtime orchestration
- provider protocol behavior
- agent event normalization
- command execution and sandbox policy
- filesystem, terminal, LSP, MCP, skills, and search/indexing cores
- large-history summarization and view-model preparation
- data structures that must scale beyond interactive UI sizes

TypeScript may own UI state and lightweight request shaping, but it should not accumulate the long-lived source of truth for performance-sensitive native domains.

## C/C++ and Assembly Policy
C/C++ may be introduced as core implementation code when one of these is true:

- Lyra needs a mature native library with no comparable Rust option.
- A platform API requires C/C++ interop.
- A measured hot path is better served by C/C++ than by Rust alone.
- A parser, tokenizer, indexer, scorer, media engine, or rendering subsystem benefits from a C/C++ implementation with a stable boundary.
- A rendering or media subsystem requires a native engine that is already maintained outside Lyra.

Requirements for C/C++ integration:

1. The boundary must be narrow and owned by a Rust or Electron native bridge.
2. Memory ownership, threading, cancellation, and error handling must be explicit.
3. The native component must have focused tests or benchmarks.
4. The integration must not duplicate an existing native-owned implementation.
5. Unsafe or platform-specific behavior must be isolated behind a documented API and portable fallback where feasible.

Assembly-level code is allowed only when all of these are true:

1. A benchmark proves the exact kernel is the bottleneck.
2. Rust/C/C++ compiler optimization and SIMD intrinsics are insufficient.
3. The assembly is isolated behind a safe Rust, C, or C++ API.
4. A portable fallback exists.
5. Tests cover correctness across supported architectures.

## Hot Surfaces
These areas require extra care before large feature additions:

- AI panel thread rendering, streaming state, tool-call feed, plan approval, and rich output.
- Runtime timelines, trace viewers, and observation streams.
- File editor, diff views, markdown rendering, and Monaco integration.
- Terminal output, scrollback, and process event handling.
- Browser automation scanning, candidate ranking, verification, and replay.
- Search, code intelligence, symbol/text indexes, and large result sets.

## Validation
Performance-sensitive changes should include at least one of:

- targeted unit tests for incremental update behavior
- benchmarks for Rust or native kernels
- render profiling notes for UI hot paths
- memory growth checks for large histories or large files
- before/after timing for agent loops, streaming updates, or automation steps

Performance work is complete only when the measured bottleneck is reduced or the new architecture prevents the bottleneck from scaling with session size.
