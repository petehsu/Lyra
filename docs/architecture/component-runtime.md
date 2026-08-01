# Component runtime and independent updates

Audience: Internal
Status: Active
Last verified: 2026-07-31

## Release topology

Lyra remains a private monorepo, but a Desktop release is assembled from 17
separately versioned and signed components:

- `lyra.core`;
- nine first-party applications: Browser, Files, Editor, Images/PDF, Terminal,
  Downloads, Agent Suite, Credentials, and Notifications;
- `lyra.runtime`;
- rust-analyzer, aria2, and Playwright resources;
- English and Simplified Chinese language resources; and
- the trusted Classic UIUX package.

The release catalog never asks clients to resolve a separate `latest` version
for each item. A signed release BOM pins one exact version and digest for every
component in a target release. Changing one item creates a new BOM and a higher
channel sequence.

All nine application packages currently produce real source-free ESM bundles.
Notifications is the only application surface marked `complete`. Browser,
Files, Editor, Images/PDF, Terminal, Downloads, Agent Suite, and Credentials
remain `preview`: those bundles contain independently testable product slices,
but Core deliberately keeps the complete static surface on the user-facing
route. Images/PDF stays in Preview until its native-tile path reaches parity
with the static renderer. This readiness policy is a functional parity gate,
not an installation or signature fallback. The package manifest cannot promote
itself from Preview, and the Preview release workflow rejects draft publication
while any first-party surface remains `preview`.

## Storage and activation

Component code is immutable under:

```text
<component-root>/components/<component-id>/<version>/<target>/
```

Per-user mutable data is kept separately under:

```text
~/.lyra/data/<component-id>/
```

The canonical activation registry is the Rust bootstrap registry below
`<state-root>/registry-v1/`. It records `active`, `previous`, and `pending` in a
new, synced revision file for every commit. Activation, rollback, and recovery
restore are serialized with `<state-root>/bootstrap.lock`. Each mutation must
name the expected registry revision and expected source pointer; restore may
only reverse the immediately preceding direct activation or rollback. This
prevents two Desktop/bootstrap processes from silently overwriting one another.

Packaged Desktop invokes the bootstrap helper's internal registry interface for
reads and pointer mutations. Its `<state-root>/registry.v1.json` file is a
verified metadata and anti-replay cache, not a second activation authority: it
tracks the canonical bootstrap revision and refuses a backwards projection.
The TypeScript store verifies every pointed-to installed manifest before
projecting the Rust state. Direct TypeScript pointer mutation is an explicit
development/test escape hatch (`allowLocalActivation`) and is disabled for a
packaged product.

The bootstrap installer may activate all components during a first
installation. On an existing installation it only stages new versions as
pending; the owning coordinator performs the switch at a safe point through
the same Rust authority.

Mutable component data has its own schema metadata and transaction journal.
Before an activation that changes data, Core copies the live module directory
to both a durable snapshot and an isolated staging directory, runs the
registered migrator only against staging, then prepares the staged directory
with rename-based replacement. Activation commits the journal; any activation
failure restores both the original data directory and the original
`active`/`previous`/`pending` pointers. Startup recovers an interrupted
`staging` or `prepared` journal before the component is used, while a
`committed` journal only needs cleanup. Future writer schemas and unmanaged
pre-v1 directories are rejected.

The current 17 manifests all declare data schema 1 and Core has no production
component migrators registered yet. The transaction machinery is active for
initialization and recovery, but a component that raises its writer schema must
add and test its migrator in the same change.

Core is also stored as a normal component. Download and signature verification
install its immutable version in the component repository, but an update to an
existing installation remains `pending`; staging Core never overwrites the
currently running program directory or marks the new version `active`.

After a successful Core stage, Desktop persists a versioned handoff request at
`<state-root>/core-projection/pending.v1.json`. It copies the packaged
`lyra-bootstrap` helper to the content-addressed
`<state-root>/core-projection/helpers/<sha256>/` directory, which is outside
the program directory that the helper will replace. Desktop accepts only a
bounded, executable, non-symlink regular file, verifies the source and copied
SHA-256, and verifies the copied helper again immediately before launch. The
request is also bound to the installation root, state root, program root,
target, pending Core version, and release version; a request for another
installation is rejected.

Core replacement is an explicit **Restart and apply** operation. Desktop
starts the external helper detached in manual projection mode, passes the
current Lyra PID and a bounded wait timeout, persists the spawned handoff, and
then requests a full application quit. It never passes
`--automatic-core-replacement` from this user action. The helper waits for the
observed Lyra process and relevant program-owned processes to exit before it
touches the program directory. No running Electron, preload, renderer, or
in-process native code is hot-replaced.

The helper revalidates the installed Core marker, installed manifest and
manifest-bound file inventory, target, `projection.json`, and `payload.zip`
digest. It expands into a staging directory, writes a projection transaction,
moves the old program directory to the one retained previous projection, and
renames the verified stage into place. Only after the projected inventory
verifies does it commit the
activation registry and append the projection commit. A failed switch restores
the previous program directory and leaves the new component pending; a later
helper invocation recovers a journaled interruption from the stage, program,
and previous directories before attempting another projection.

Unsigned Preview/Beta builds support this user-started manual handoff and
signed-release repair only. Automatic Core replacement is a separate
compile-time capability and fails closed unless a release job explicitly
enables it after the platform system-signing gate has passed.

The bootstrap installer does implement system-scope elevation after the user
selects that scope: macOS uses `osascript` administrator authorization, Linux
uses `pkexec`, and Windows uses PowerShell `Start-Process -Verb RunAs`. Proxy,
paths, root keys, and uninstall choices are transferred through a bounded,
content-digest-bound request file rather than exposed as privileged process
arguments; Unix request and cancellation files use mode `0600`. First install
then projects the verified Core payload into the selected program root.

That installer capability is distinct from Desktop's **Restart and apply**
flow. The Desktop projection coordinator never requests elevation. An update
to a system-owned program or state root therefore requires the installer or an
equivalent explicitly elevated repair flow. Apple Developer ID,
Authenticode, platform attestation, and real system-scope installation/update
tests must be complete before any release enables automatic replacement.

## Application runtime

First-party application bundles implement the private `LyraAppModule`
lifecycle and use a Core-owned Host API for commands, events, settings, status,
resource opening, navigation, and notifications. A running instance leases its
exact version. New instances of the same application stay on that version
until its final reference closes; pending activation then becomes eligible.

Core also owns the presentation target used by independently built surfaces.
`lyra.core.presentation.read`, `lyra.core.locale-changed`, and
`lyra.core.theme-changed` carry the current locale, theme ID, and light/dark
tone. They are explicitly registered with `null` access requirements, meaning
permissionless to a loaded private first-party Host client, not public to web
content or external developers. All privileged Host commands and events name a
required capability. A source-derived release test audits every
`lyra.core.*` target consumed by each first-party package against the
registration and the permissions bound into that package's signed manifest;
omitting the access declaration is itself a test failure.

First-party bundles share React and the renderer for performance and nested
Workbench composition. This is release isolation, not a security boundary.
Only an execution class authorized by the Lyra release trust chain may enter
the shared renderer. A manifest supplied by an untrusted publisher cannot
promote itself to first-party execution.

The private shared UI runtime also exposes a versioned high-level code-editor
service backed by Core's single Monaco installation. `lyra.editor` requests an
editor or diff surface through that facade; its release bundle does not import
Monaco or Desktop implementation files. Content, selection offsets, save,
completion, locale, and theme remain versioned app/Host data. A textarea/pre
fallback preserves function when the optional service is unavailable. Editor
still remains `preview` until the static surface's remaining autosave,
reveal/control, GPU, accessibility, and visual behaviors reach parity.

Core-owned nested slots pin a child application version, persist the complete
`WorkspaceTabV2` child descriptor inside the parent's opaque state, and close
children recursively with their parent. Agent Project Tree is the first
production-shaped consumer: it opens `file-editor` through the Host slot API
without importing Editor source. Editor can recreate its Core model from the
persisted file path when a nested descriptor is restored.

Migration is guarded by per-application surface readiness. A bundle can be
built, signed, activated, and exercised before it replaces the current static
surface. Until the full feature matrix for an application is complete, Core
continues to route users to the existing implementation. Missing, unknown, or
incompatible modules render a repair placeholder rather than silently falling
back to a different protocol.

## Runtime and resource safety points

`lyra.runtime` negotiates `RuntimeHelloV2` only. Protocol and Host API ranges
must overlap; otherwise the connection is rejected. Agent turns, terminals,
downloads, and language-server work hold activity leases. Runtime replacement
waits until those leases permit a restart, then requires a successful health
check before the pending version is committed.

After an unexpected daemon restart, Core reconnects with a new primary-host
lease, replays open LSP documents, refreshes the download list, and clears
stale update blockers. A running Agent turn or terminal process cannot be
reconstructed after the daemon that owned it has already crashed; the safe
point contract prevents an intentional update from causing that loss but does
not claim crash-transparent recovery.

Resources use the same active/previous/pending model. The resource manager
resolves an immutable version, counts leases by component and version, blocks
new requests once an exclusive switch begins, and waits for existing leases to
drain. rust-analyzer and aria2 are health-checked as executables; Playwright is
validated as a target-specific browser resource; language resources are parsed
before activation. A failed health check preserves or restores the previous
version.

Current production consumers are:

| Component | Consumer path |
|---|---|
| rust-analyzer | Core resolves the signed active executable and fixes `LYRA_LSP_RUST_ANALYZER` before starting the utility/runtime processes. Every Rust LSP open/change/save/close/completion dispatch re-resolves and short-leases that active version, and rejects a stale process binding. Packaged builds do not search `PATH`; development keeps the existing repository/PATH fallback. |
| aria2 | Core passes the absolute executable, component root, version, and manifest-bound SHA-256 to `lyrad`; `lyra-download-core` revalidates them before using aria2 for magnet, torrent, or Metalink work. Immediately before spawning aria2, Runtime requests a version-and-path-bound Core resource lease and keeps it until the process has stopped and the final task state has been persisted. A transport disconnect does not release that lease, because the native task may still be alive; an orphan therefore blocks activation until an explicit release or Core shutdown instead of permitting an unsafe switch. Development accepts only the repository bundle after a complete manifest verification and never falls back to `PATH`. Ordinary HTTP remains on the native HTTP transport. |
| Playwright | Core fixes `PLAYWRIGHT_BROWSERS_PATH` to the signed active component before starting Runtime. A missing packaged component resolves to a deliberately absent path instead of a user cache. Core now owns an idempotent first-use/repair service: it selects only `lyra.resource.playwright` from the immutable Catalog/BOM receipt for the active release, verifies the original trust, exact target, catalog sequence, and digests again, and installs or repairs it inside the resource and Runtime safe point before restarting and health-checking Runtime. Development retains only a non-empty repository fallback. |
| language packs | Core reads and validates every active bundle under a short resource lease, then reloads the Desktop language cache after an exclusive safe switch. |

The online installer defers the Playwright component because its BOM delivery
policy is `on-demand`. Every successful release install stores immutable
`catalog.json` and `bom.json` receipts under
`system/verified-releases-v1/<target>/<release>/<catalog-sequence>/`; packaged first-use fails
closed when that receipt, the settled active release, or the matching catalog
sequence is absent. It never asks a component-specific `latest` endpoint.

The current production Browser, isolated profile, browser automation, and
Computer Use implementations use Electron WebContents/CDP and native
accessibility, not Playwright. Therefore no existing production feature is a
truthful Playwright first-use caller yet. The Core acquisition/repair path is
implemented and tested locally, but release evidence still requires wiring the
first real Playwright-dependent feature to call it before opening a Runtime
activity, plus six-target online-install testing. The full offline installer
continues to include and activate Playwright.

## Current release gaps

The architecture and local test harness exist, but they are not evidence of a
shippable Stable release. The current blockers include:

- eight first-party application surfaces still marked `preview`;
- a real Playwright-dependent production caller and six-target first-use/repair evidence;
- six-target installer and system-scope evidence on real runners;
- Apple Developer ID, Authenticode, and the policy decision to enable automatic
  Core replacement;
- a populated public trust root and operational release-key ceremony; and
- the independent legal release checklist, which remains `pending`.

The public `petehsu/lyra-releases` repository exists as a minimal binary-release
shell. Its branch contains README and SECURITY only, and its pre-existing
mutable `preview-channel` prerelease contains zero assets. Immutable Releases
are enabled for future candidate publications, but no component, Catalog, BOM,
installer, public key, source, private key, or signed channel genesis marker
exists. None of those repository facts authorizes publication.

## Related contracts

- [Component, release, and activation contracts](../contracts/component-update-v1.md)
- [Runtime socket](../contracts/runtime-socket.md)
- [Third-party application isolation](third-party-apps.md)
- [Modular Preview release](../operations/modular-preview-release.md)
