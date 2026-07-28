# ADR-0001: Native-core ownership

Audience: Internal
Date: 2026-05-29
Status: Accepted
Last verified: 2026-07-28

## Context

Long-lived execution and hot local I/O had accumulated across Electron and
native modules, creating duplicate ownership and fallback paths.

## Decision

Lyra keeps long-lived runtime state, protocol execution, indexing, parsing,
download orchestration, process orchestration, and hot local I/O in native-core
modules. Native core includes Rust, C, C++, assembly, OS-specific APIs, and
wrapped system libraries. Rust remains useful for ownership, async boundaries,
and safe orchestration, but it is not a policy ceiling.

For local search, filesystem traversal, media decoding, terminal/process work,
hardware access, and platform integration, C/C++/OS APIs may be the primary
implementation when they give lower latency, lower memory use, better platform
coverage, or simpler integration with mature native libraries.

Electron main-process code should stay a platform bridge: IPC registration,
shell-only integration, resource discovery, and event forwarding. Runtime-backed
desktop modules should call the shared `lyrad` transport through
`apps/desktop/src/main/runtime-client.ts`. They must not reintroduce independent
TypeScript process managers, storage backends, or fallback implementations for
native-owned behavior.

Native modules should keep their FFI/protocol boundary explicit, isolate unsafe
code, and expose diagnostics for performance-sensitive work such as indexing,
caching, scanning, and OS watcher handling.

## Alternatives considered

- Keep every local subsystem in TypeScript. Rejected for performance-sensitive
  work and because it would duplicate native libraries already in use.
- Require Rust for all native implementation. Rejected: C, C++, assembly and
  operating-system APIs remain valid when they provide the clearest boundary.
- Permit TypeScript fallbacks for each native service. Rejected for
  runtime-owned behavior because fallbacks create two sources of truth.
