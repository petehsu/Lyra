# Component, release, and activation contracts

Audience: Internal
Status: Active
Last verified: 2026-07-31

## Trust chain

The offline Ed25519 root key signs `SignedReleaseKeyringV1`. The keyring binds
each release key to its key ID, publisher authorization, allowed
component kinds, component ID prefixes, `executionClasses`, channel, validity
window, sequence, and revocation state. All three component scopes are
mandatory: a sandbox-only publisher key can be limited to `app`, its own
namespace, and the sandbox execution classes, while the Lyra release key is
explicitly authorized for the `lyra.` namespace and non-app component kinds.
The offline private root must never be present in CI or a client build.

An authorized release key signs:

1. `SignedChannelCatalogV1`;
2. the exact `ReleaseBomV1` referenced by that catalog; and
3. every component archive and its `ComponentManifestV1`.

The signed catalog embeds the root-signed keyring used to authorize its release
signature. Online and offline clients therefore receive the keyring with the
catalog and persist its sequence after verification; a separate mutable
`latest-keyring` endpoint is not part of V1.

The reserved public client endpoints are the six
`catalog-preview-{target}.json` assets on the `preview-channel` GitHub Release.
The Release currently exists with zero assets; those endpoints do not become
usable until the one-time authenticated genesis promotion succeeds.
The V1 data contract reserves a `stable` channel value, but no mutable
`stable-channel` endpoint is published by this Preview workflow. Mutable
Preview names may only be promoted from six already-public catalogs on one
immutable release tag. The Release API must report the source as immutable and
the rolling channel as mutable. Preview has one explicit genesis exception:
an already-published mutable `preview-channel` with zero assets may be filled
once from an authenticated immutable candidate. Initialization retains a
`channel-initialized-v1.json` genesis marker, cannot create, clear, or reset a
Release, and normal anti-rollback rules apply immediately afterward. Promotion
authenticates both the candidate documents
and the current channel documents, requires a strictly increasing Catalog
sequence, and prevents Keyring rollback or same-sequence equivocation. An exact
unchanged Keyring may be reused at its current sequence; changed Keyring
contents require a greater sequence and a new root signature. Promotion also
verifies each candidate's content-addressed BOM before changing the channel
assets. Producing a draft or publishing an immutable release is deliberately
separate from channel promotion.

Verification rejects unknown roots, invalid or expired keys, revoked keys,
wrong channels or targets, stale sequences, digest changes, path traversal,
and downgrade attempts. A previously accepted keyring or catalog sequence is
persisted so deleting a newer cached file cannot restore an older trust state.

## Component manifest

`ComponentManifestV1` binds at least:

- component ID, kind, SemVer, and target;
- entry point and activation policy;
- Host API and Runtime Protocol ranges where applicable;
- data reader/writer schema range;
- permissions;
- publisher and release key ID;
- execution class; and
- a sorted file inventory with sizes and SHA-256 digests.

Execution class is security-sensitive. `first-party-shared-renderer` is valid
only when the verified release-key authorization permits Lyra first-party
code. Third-party UI uses `sandboxed-web`; third-party applications with a
WASI backend use `sandboxed-web-wasi`. No manifest can select a kind, ID
namespace, or execution class above the authority of its signing key.

## Catalog and BOM

The catalog has a monotonically increasing sequence, issued and expiry times,
channel, revocations, and one or more signed release descriptors. Each
descriptor points to a content-addressed BOM.

The BOM pins Core, Runtime, all nine applications, and required resources. A
component record includes its archive URL, byte size, SHA-256, signature,
activation policy, and delivery policy. Release assets use flat GitHub Release
URLs while archives and offline bundles remain content-addressed.

`delivery: "on-demand"` means the online bootstrap may defer the component.
For Playwright, Core later supplies the active release version, installed
catalog sequence, and immutable local Catalog receipt to bootstrap, which
selects exactly `lyra.resource.playwright` from the receipt's pinned BOM. A
missing receipt, different sequence, pending release, non-`on-demand` record,
target mismatch, signature failure, or digest failure is a hard error. The
bootstrap never resolves an independent per-component `latest`.

Normal signed installation persists the byte-identical verified Catalog and
BOM at `system/verified-releases-v1/<target>/<release>/<catalog-sequence>/`. Existing content at
that identity must match exactly; same-identity equivocation is rejected.

The release version is not a substitute for component versions. Core reads the
private Desktop package version, Runtime reads its explicit component version,
each first-party application reads its private package version, Classic UIUX
reads its manifest version, and language/platform resources read
`components/first-party/resource-versions.v1.json`. Therefore changing one
Core, Runtime, application, or resource can create a new BOM without falsely
revving every other component.

## Activation registry

The authoritative registry is implemented by `lyra-bootstrap-core`, not the
Desktop TypeScript cache. It is an append-only sequence of JSON commits below
`<state-root>/registry-v1/`. A new commit is written to a unique temporary file,
synced, renamed to a revision-bearing final name, and followed by a directory
sync before it becomes the highest valid revision. Component state is:

```text
active   currently leased or started version
previous last known-good rollback version
pending  verified version awaiting its safe point
```

Future schema writers are rejected. A data migration takes a module-level
snapshot, runs transactionally before activation, and restores both data and
component state on failure.

The Rust mutation contract supports `activate`, `rollback`, and `restore`.
Every mutation is serialized with `<state-root>/bootstrap.lock` and includes
the caller's expected revision. Activate additionally binds the expected
pending version; rollback binds the expected previous version. Restore accepts
only the immediately preceding revision and only when the current pointers are
the direct result of activating or rolling back that revision. Caller-supplied
arbitrary pointers are never accepted by the Rust authority.

Packaged Desktop calls the helper with a hidden internal registry operation,
parses a bounded JSON response, and verifies its target and schema. Its
`<state-root>/registry.v1.json` records installed metadata, replay sequences,
and the last projected bootstrap revision. It must not advance activation
pointers independently. A lower Rust revision than that cached revision is a
fatal rollback condition. Direct local pointer mutation exists only behind an
explicit development/test option and is disabled when Desktop is packaged.

The data transaction journal uses `staging`, `prepared`, and `committed`
phases. A migrator receives only an isolated staged data root. The prepared
directory is installed with rename operations before the version pointer is
committed; rollback restores its backup and the captured activation pointers.
Startup must recover every non-committed journal before serving that component.
Unmanaged pre-v1 data is left untouched and blocks automatic initialization.
The initial 17-component BOM uses writer schema 1 throughout and currently
registers no production data migrators.

Core projection has a separate append-only journal and inventory commit outside
the projected program directory. This avoids mutating a signed macOS app bundle
with update metadata.

The bootstrap installer can project Core immediately on a first installation.
For a confirmed system-scope install/uninstall it relaunches through the
platform authorization mechanism using a bounded, SHA-256-bound request file.
Desktop's later **Restart and apply** helper is deliberately non-elevating and
manual; a system-owned projection must return to an explicitly elevated
installer/repair flow. Automatic Core replacement remains compile-time gated
and disabled until platform code signing and release policy permit it.

## Private application and runtime contracts

`WorkspaceTabV2` stores `appId`, `appVersion`, `instanceId`, `route`, and
opaque module state. Core, not an application, owns the version lease.

`LyraHostApiV1` is a permission-checked command and JSON event boundary.
Application registrations are scoped to the declaring module and are disposed
on deactivation. Cross-application imports are not a supported contract.
Core separately marks an application surface `preview` or `complete`; a valid
signed bundle cannot bypass that local functional-readiness decision.

The private shared UI runtime may advertise an optional versioned
`codeEditor` service. It is a high-level mount/update/dispose contract for
editor and diff surfaces, not a Monaco object ABI. First-party application
bundles must not import `monaco-editor` or Desktop editor sources; Core owns the
single Monaco implementation and the application retains a functional
fallback when the optional service is absent.

The private presentation targets are:

```text
lyra.core.presentation.read
lyra.core.locale-changed
lyra.core.theme-changed
```

They expose only locale, theme ID, and light/dark tone and use an explicit
`null` access declaration, which means available to a loaded first-party Host
client without an extra capability. It does not make them a public web or
external developer API. Every other Core command/event registration must name
its capability. The first-party permission audit fails when a registration
omits an access declaration, an application consumes an unregistered target,
or the signed manifest lacks the required capability.

Resource consumers acquire version-specific leases. An exclusive
`resource-idle` switch rejects new leases and waits for existing references to
reach zero before changing the canonical pointers. Rust LSP dispatch and active
language-bundle loading use direct short leases. Runtime-owned aria2 and
Playwright bindings are changed only through the Runtime activity safe point.
Each native aria2 task also acquires a Core resource lease bound to the absolute
binary path and component version immediately before process creation. Runtime
releases it only after process shutdown and persistence of the terminal task
state. A Runtime transport disconnect is not release evidence; Core retains the
lease and consequently fails closed on an attempted resource switch.
Playwright installation/repair is also executed inside that safe point, under
the resource-exclusive lock, then followed by environment rebinding, Runtime
restart, package and Runtime health validation, and restartable-state replay.

`RuntimeHelloV2` carries protocol ranges, component/build identity, Host API
range, capabilities, role, lease identity, and data schema. Runtime V1 and
range-free fallback are intentionally unsupported.

The TypeScript definitions live in the private
`packages/app-runtime` package. They are not an npm SDK or a public
compatibility promise.
