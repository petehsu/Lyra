# ADR-0005: Signed modular component runtime

Audience: Internal
Date: 2026-07-30
Status: Accepted
Last verified: 2026-07-31

## Context

The Desktop product had been delivered as one large package even though
Workbench applications, the native runtime, language data, and platform tools
have different update cadence and safe points. Resolving each component's
`latest` independently would reduce download size but create untested version
combinations. Loading every first-party application in a separate renderer
would provide process separation but would regress Monaco reuse, nested
surfaces, layout performance, and current Workbench behavior.

## Decision

Keep one private monorepo and publish independently versioned component
artifacts under an exact signed release BOM. Core and Runtime remain atomic
units. Nine first-party applications and resources may update independently,
but a release always defines one tested combination.

Use an offline root to authorize short-lived channel release keys. Bind the
component identity, target, API ranges, data schema, permissions, execution
class, and complete file inventory into the signed manifest. Persist monotonic
keyring and catalog sequences to prevent replay and downgrade.

Make the Rust bootstrap registry the sole packaged authority for
`active`/`previous`/`pending` pointer mutations. Store each revision as a
durable append-only commit and require a lock, expected revision, and expected
source pointer. Desktop may maintain verified metadata and anti-replay caches,
but it cannot write canonical activation state directly. A direct TypeScript
mutation path is permitted only as an explicit development/test escape hatch.

Keep first-party applications in the shared renderer as a private release ABI,
with Core-owned Host APIs and version leases. Treat that as release isolation,
not a sandbox. Run third-party UI in sandboxed WebContents and optional backend
code in a constrained WASI component.

Make locale and theme a Core-owned presentation contract rather than allowing
each independently built application to infer them. Presentation read/change
targets are explicitly permissionless within the private first-party Host API;
all privileged targets name a capability. Enforce the distinction with a
source-derived audit between consumed Host targets, registration access
declarations, and signed application permissions.

Stage updates while code is in use and switch only at owner-specific safe
points. Never hot-replace running JavaScript or native code. Core projection
occurs after full application exit and preserves one last-known-good
projection.

Use version-specific request leases and an exclusive drain lock for resource
components. Runtime-owned resources additionally pass through Runtime activity
safe points before environment rebinding and restart. The bootstrap installer
may request platform elevation after an explicit system-scope choice, but the
Desktop **Restart and apply** coordinator remains non-elevating. Automatic Core
replacement stays disabled until system code signing and release policy are in
place.

## Alternatives considered

- Split the source into multiple repositories. Rejected because independent
  source history is not required for independent artifacts and would make
  atomic contract changes harder.
- Let each client select every component's newest version. Rejected because it
  creates an unbounded and untested compatibility matrix.
- Make all first-party applications isolated WebContents. Rejected for the
  initial architecture because it would regress shared Monaco/UI state and
  nested Workbench composition.
- Treat signed third-party JavaScript as equivalent to first-party renderer
  code. Rejected because a publisher signature proves origin, not Lyra-level
  trust or safety.
- Hot-patch running modules. Rejected because live closures, native resources,
  and persistent schema make a safe universal hot-reload contract impractical.
- Let Electron/TypeScript update activation pointers independently from the
  installer. Rejected because two writable authorities would make crash
  recovery, revision races, and rollback state ambiguous.
- Let each application infer presentation from `navigator` and DOM state.
  Rejected as the primary contract because independently updated bundles need
  one explicit Core locale/theme source and deterministic change events.

## Consequences

Release engineering must build and test six target-specific component sets,
maintain signing-key operations, and exercise failure recovery. Application
teams must communicate through versioned Host capabilities instead of private
cross-imports. Updates download less data and can roll back at component
granularity, while the signed BOM retains a coherent release identity.

The accepted architecture does not imply that migration or release approval is
complete. At this verification date only Notifications is marked as a complete
first-party surface; the other eight routes retain the static implementation.
The Playwright acquisition/repair foundation is pinned to the active signed BOM
and runs at resource/Runtime safe points. A real Playwright-dependent production
caller, real six-target/system-scope evidence, platform signing, public trust
material, Stable enablement, and legal release approval remain separate gates.

## Enforcement evidence

- Rust registry tests cover revision races, pointer binding, rollback, restore,
  durability, and invalid targets; Desktop tests cover helper invocation,
  projection into the metadata cache, and fail-closed packaged behavior.
- First-party release tests verify nine private source-free ESM bundles and
  audit every consumed Host command/event against its explicit access
  declaration and signed manifest permissions.
- Resource tests cover version leases, exclusive-switch rejection, health
  checks, Runtime safe points, and rollback. Rust LSP requests and language
  loads exercise direct short leases.
- Core projection and installer tests cover signed inventories, interrupted
  projection recovery, current-user/system roots, elevation request integrity,
  cancellation, uninstall retention, and the automatic-replacement gate.
