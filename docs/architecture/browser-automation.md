# Browser and automation architecture

Audience: Internal
Status: Active
Last verified: 2026-07-28

Lyra's workbench browser is an Electron WebContentsView system managed by
`apps/desktop/src/main/workbench-browser`. It provides user-visible browsing and
Agent observation/action capabilities; it is not a general promise that every
site or operating-system control can be automated.

## Profiles

- The live profile uses the persistent `persist:lyra-live` Electron partition
  and contains user browser state.
- The isolated profile uses a separate persistent partition for Agent work.
- An isolated task can copy origin-scoped cookies from a live source after the
  relevant user-authorized flow. This is a deliberate transfer of login state,
  not cryptographic isolation.

Site data, history, downloads, cached workflow information, observations,
screenshots, target references, and follow-mode state have different storage
lifetimes. Callers must not treat an in-memory observation identifier as stable
across navigation.

## Observation and action

The main process combines semantic DOM/AX snapshots, visual captures, target
registries, focus/input state, and CDP diagnostics. The Agent reaches these
through host capabilities registered by Desktop and described internally by
Tool-FS.

Action paths include target-based click/type/press/scroll, visual coordinate
actions, navigation, page read/extract, and accessibility operations. Critical
live-profile input is coordinated with shared-control logic so user and Agent
input do not silently race.

## Security boundaries

- Website content and metadata are untrusted input.
- Page scripts must be isolated and narrowly scoped.
- Credentials, cookies, page text, screenshots, and downloaded content may be
  sensitive.
- Moving login state from live to isolated changes the effective trust boundary
  and must remain a user-visible, auditable operation.
- Computer Use can reach native applications through separate OS accessibility
  and capture capabilities; browser sandbox claims do not apply to it.

## Validation

Run focused browser tests for target invalidation, live/isolated selection,
shared control, cookie borrowing, navigation supersession, and rendered
snapshots after changes. Update [the data-flow document](security-data-flow.md)
when a new external request or captured data class is introduced.

