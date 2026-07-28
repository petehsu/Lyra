# Architecture Health Guard

Audience: Internal
Status: Active
Last verified: 2026-07-28

Lyra has boundary guards for dependency direction, native ownership, and UI
style. Those guards are necessary, but they do not catch every architectural
regression. A file can obey every import boundary and still become a god module
by accumulating runtime state, host dependencies, policy decisions, parsing,
I/O, rendering, and dispatch logic in one place.

`pnpm lint:architecture-health` closes that gap. It scans source files for a
combination of architectural signals:

- source size
- dependency breadth
- state and effect ownership
- host or bridge coupling
- control-flow density
- public runtime surface area
- root-module implementation weight
- responsibility clusters such as browser observation, input targeting,
  tool dispatch, transport, persistence, state runtime, UI surface, file
  workspace, terminal process, search, and identity/login

The guard intentionally does not fail on line count alone. Large contract or
DTO files are allowed when they are mostly type declarations and do not own
runtime state, host coupling, or broad control flow. A runtime file only fails
when it trips multiple independent signals.

## Ratchet Policy

Existing hot spots are registered in the guard as temporary no-growth budgets.
They are not architectural endorsements. A baseline entry means:

- the file already existed as debt when the guard was introduced
- the file may shrink or split without ceremony
- the file must not grow past its registered budget
- new responsibilities must move into focused modules instead of raising the
  budget
- once the file no longer qualifies as a hot spot, the baseline entry must be
  removed

New hot spots fail without a baseline. Adding a baseline for a new file should
be treated as an architecture review decision, not as routine lint maintenance.

## Practical Split Rules

When the guard fails, split by ownership rather than by arbitrary line chunks.
Good extraction boundaries usually have one of these shapes:

- `*-model.ts` or Rust model modules for DTOs and pure state transitions
- `*-persistence.*` for disk/database storage
- `*-transport.*` for protocol and wire concerns
- `*-executor.*` or `*-dispatcher.*` for command execution
- `*-controller.*` for focused orchestration around one workflow
- `*-view.tsx` for presentational rendering fed by props
- `use-*-runtime.ts` hooks for React runtime coordination

Avoid over-modularizing tiny cohesive flows. A file that is moderately sized,
has one clear owner, and does not mix unrelated state, host dependencies, and
policy decisions should stay whole.
