# Modular Preview release

Audience: Internal
Status: Draft
Last verified: 2026-08-04

This runbook prepares an unsigned-system Preview candidate. It does not
authorize Stable publication, website deployment, or a legal effective date.

## Required release inputs

- an offline-root-signed `SignedReleaseKeyringV1` whose release key explicitly
  lists its allowed component kinds, component ID prefixes, and execution
  classes;
- the active release key ID and private key;
- a strictly increasing Preview catalog sequence;
- a SemVer release version and immutable tag;
- the committed public root trust store;
- access to the public binary-only `petehsu/lyra-releases` repository; and
- all documentation, notice, security, and pending-legal structure gates.

The offline root private key and release private key must never be committed.
The CI token must be fine-grained and writable only to the binary repository.
After the release-key scope changes, an older keyring is intentionally invalid;
regenerate the signed keyring and replace the CI secret rather than adding a
compatibility fallback. The first-party Preview key must cover all five
component kinds, the `lyra.` namespace, and
`first-party-shared-renderer`. A third-party key should cover only `app`, the
publisher's own namespace, and its approved sandbox execution classes.

## Active Preview trust material

- offline root key ID: `lyra-root-2026-01`;
- Preview release key ID: `lyra-preview-2026-01`;
- root-signed keyring sequence: `1`;
- release-key authorization expiry: `2027-08-01T00:00:00Z`;
- committed Desktop trust store:
  `apps/desktop/resources/component-trust/trusted-keys.json`;
- public trust store:
  `petehsu/lyra-releases/trusted-roots.v1.json`; and
- public signed keyring:
  `petehsu/lyra-releases/preview-release-keyring.v1.json`.

The private repository Actions configuration contains only the Preview release
private key, the signed public keyring, the public roots map, and the release
key ID. The offline root private key remains operator-controlled and must have
at least two encrypted offline backups before the first candidate is signed.
Rotate the release key before its authorization expiry; rotation publishes a
strictly higher keyring sequence signed by the offline root.

### Create the two offline root backups

Use two separate removable drives. A second file on the same Mac, an ordinary
cloud-synced folder, or two partitions of one drive do not count as two offline
backups. Insert the first drive and run:

```sh
node tools/components/backup-offline-root.mjs create \
  /Users/petehsu/.lyra-release-keys/root-2026-01-private.pem \
  /Volumes/FIRST_DRIVE/lyra-root-2026-01.lyra-root
```

Repeat with a physically separate second drive. Enter a strong passphrase in
the interactive prompt; it is deliberately not accepted as a command-line
argument, environment variable, or chat message. The tool validates the input
as an Ed25519 private key, encrypts it with scrypt and AES-256-GCM, writes with
owner-only permissions, immediately decrypts and compares it, and emits a
SHA-256 transport checksum.

Keep the drives powered off and in separate secure locations. Store the
passphrase in a password manager plus one separate recovery record. Do not
store the passphrase on either backup drive. Record only the backup date,
physical custodian/location, and checksum in the release evidence; never copy
the private key or passphrase into the repository, GitHub, a ticket, or chat.

Test recovery from one copy to a temporary destination before publication:

```sh
node tools/components/backup-offline-root.mjs restore \
  /Volumes/FIRST_DRIVE/lyra-root-2026-01.lyra-root \
  /tmp/lyra-root-restore-test.pem
openssl pkey -in /tmp/lyra-root-restore-test.pem -noout
```

After verification, delete that explicit temporary file and empty Trash. Do
not replace the live root key during a recovery drill. Repeat the recovery
drill periodically and whenever backup media is replaced.

## Current blockers

As of the last verification date, the repository has a public offline root,
an offline-root-signed Preview release keyring, and a configured private-repo
release key. `components:trust:check`, component signing tests, and all nine
source-free application bundle checks pass. The offline root private key is
kept outside the repository and is not an Actions secret.

Publication is still blocked by the following operator and release evidence:

- `LYRA_RELEASES_TOKEN` is configured as a fine-grained repository secret and
  must remain writable only to `petehsu/lyra-releases`; review that scope
  before each release and do not reuse the developer's broad interactive
  GitHub token;
- online installation defers Playwright; the signed, active-BOM-pinned Core
  acquisition/repair service exists, but no current production feature uses
  Playwright, so a truthful first-use caller and six-target evidence are still
  missing;
- the public release repository and empty mutable `preview-channel` exist, but
  no Catalog, BOM, component, installer, or channel genesis marker has been
  published;
- Apple Developer ID and Authenticode signing identities are not configured;
  and
- the legal source remains `pending`. `legal:check` validates its bilingual
  structure, but `legal:release-check` is expected to remain blocked and must
  not be represented as passing.

Local smoke artifacts are development evidence only. They do not satisfy
code-signing, clean-device experience, legal, or release-repository gates.

## Zero-billed local macOS path

The repository-scoped self-hosted runner label `lyra-local` identifies the
operator's Intel Mac. `local-ci.yml` is the only automatic pull-request and
main-branch gate. It consolidates the former hosted Agent, Clippy, Guardrails,
Runtime Security, and Terminal jobs into one workspace so pnpm and Cargo
outputs can be reused. The former hosted workflows remain available only by
manual dispatch for later cross-platform verification. Superseded local runs
are cancelled by concurrency control.

`modular-release.yml` defaults to `release_scope=local-darwin-x64`. In that
mode, release gates, the Intel macOS package, and Draft upload all run on
`lyra-local`; no GitHub-hosted runner is scheduled. The verified assets are
uploaded directly to the public binary repository Draft instead of passing
through Actions artifact storage. `release_scope=all-hosted` preserves the
six-target matrix for later use when hosted capacity or native self-hosted
machines are available.

The local path produces only `darwin-x64`. It must not claim native Apple
Silicon, Windows, or Linux verification. Apple Silicon users may test the x64
Preview through Rosetta 2, and native packages can be added later without
changing the component contracts. Keep the Mac connected to power with the
runner service online, and maintain enough free disk for the Core payload,
component archives, offline bundle, and installer smoke test.

## Six-target pipeline

The manual `modular-release.yml` workflow builds:

- macOS Intel and Apple Silicon;
- Windows x64 and ARM64; and
- Linux x64 and ARM64.

For each target it builds the 17 component sources, signs component archives,
creates the exact BOM and channel catalog, emits SPDX SBOMs, a component size
report, release manifest, SHA-256 checksums, an online installer, and a complete
offline installer. The online installer must remain below 25 MiB. The offline
installer includes Playwright; the online installer leaves it on demand.
Release tag input is restricted to one URL-safe immutable path segment, and
the catalog sequence must be a positive safe integer.

GitHub Release assets have a flat namespace. After installer packaging, CI
regenerates one `SHA256SUMS-<target>` file using asset basenames and covers the
catalog, BOM, component archives, SBOMs, reports, third-party notices, Core
payload report, and both installers. Before creating a draft, the publish job
rejects duplicate basenames, missing checksum entries, path-bearing checksum
entries, and digest mismatches across all six downloaded artifacts.

Before staging, increment only the components that changed. Application
versions live in their private `apps/lyra-*/package.json` files, Classic UIUX
uses its own manifest, Core uses the private Desktop package version, and the
Runtime plus language/platform resource versions live in
`components/first-party/resource-versions.v1.json`. The staging command rejects
missing, unexpected, or non-SemVer entries.

The candidate is installed from its embedded offline bundle in a clean
directory. The smoke check requires all 17 component directories, a non-empty
Core projection, and one append-only projection commit. The embedded catalog
takes precedence over the online build default, so this smoke test cannot
silently fall back to GitHub. The same smoke then uninstalls the candidate and
checks that every owned program/component/state path is gone while per-user
data remains. The x64 jobs exercise current-user scope and the ARM64 jobs
exercise the managed-path system-scope state machine; interactive operating
system elevation still requires manual platform testing. A draft binary
release is created only after all six target jobs pass and the operator
explicitly sets the publish input. The publish job also refuses to create the
draft unless repository immutable releases remain enabled and the established
`preview-channel` still exists as a public mutable Release.

Preview may be published while a first-party application surface still uses
Core's compatibility implementation, provided that its independently signed
bundle builds, the final WorkspaceTabV2 plus workspace-session schema v1 are
the only persisted contracts, and the feature smoke matrix passes. Preview
users can therefore receive later application-only updates without creating a
legacy tab or storage format. Stable remains separately gated on complete
surface migration and is not published by this workflow.

## One-time public repository and Preview channel bootstrap

Steps 1 through 4 below were completed on 2026-07-31. The public repository
contains README/SECURITY, the published `preview-channel` is a prerelease with
zero assets and still reports `immutable: false`, and repository immutable
releases are enabled for all future publications. The public root trust store
and root-signed Preview release keyring are published as repository files; no
Catalog, BOM, component, installer, private signing key, or channel genesis
marker was uploaded. Step 6 remains blocked until a fully gated signed
candidate exists.

The required initialization order is:

1. create the public binary-only repository and its initial README and security
   files;
2. while immutable releases are still disabled, publish exactly one empty
   `preview-channel` Release;
3. verify that Release reports `immutable: false` and zero assets;
4. enable immutable releases for all future repository releases;
5. upload every candidate asset to a draft, then publish the candidate so it
   becomes immutable; and
6. run the promotion workflow with operation `initialize-empty` once. It copies
   the six authenticated candidate Catalogs into the empty rolling Release.

Use GitHub's 2026-03-10 API explicitly. Before step 2, the immutable-release
endpoint must not report `enabled: true`. GitHub's REST documentation describes
`404` when the setting is disabled, while the live endpoint may instead return
`200` with `enabled: false`; either response is acceptable only before the
rolling Release is created:

```bash
gh api \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/petehsu/lyra-releases/immutable-releases
```

The completed operator commands were equivalent to the following. Create and
verify the empty rolling Release before changing the setting:

```bash
gh release create preview-channel \
  --repo petehsu/lyra-releases \
  --title "Lyra Preview channel" \
  --notes "Mutable signed Catalog endpoints; changed only by the audited promotion workflow." \
  --prerelease \
  --latest=false

test "$(gh api \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/petehsu/lyra-releases/releases/tags/preview-channel \
  --jq .immutable)" = false
test "$(gh api \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/petehsu/lyra-releases/releases/tags/preview-channel \
  --jq '.assets | length')" = 0
```

Then enable and verify immutability for future published releases:

```bash
gh api --method PUT \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/petehsu/lyra-releases/immutable-releases
test "$(gh api \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/petehsu/lyra-releases/immutable-releases \
  --jq .enabled)" = true
```

These are operator instructions, not commands run by this repository. The
promotion CLI requires the source Release API field `immutable` to be `true`
and the rolling channel field to remain `false`. Initialization additionally
requires the channel to have exactly zero assets, uses the confirmation
`INITIALIZE EMPTY preview <release_tag> <release_version>`, stages and verifies
all six Catalogs plus a `channel-initialized-v1.json` genesis marker, rechecks
that no concurrent asset appeared, and removes all staging assets on failure.
The retained marker prevents accidental reinitialization even if the six
Catalogs later need manual repair. After initialization, normal sequence floors
apply; deleting both the Catalogs and marker is a destructive external repair
that requires a separate audit.

Do not create an empty `stable-channel`. Stable remains unpublished and is
rejected by both workflow and CLI. A future Stable release must use a new
immutable discovery contract or a separately audited migration after every
Stable gate is machine-enforced; it must not inherit today's Preview bootstrap
as an unaudited mutable endpoint.

This ordering follows GitHub's documented rule that immutability applies only
to future releases: [Preventing changes to your releases](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/establish-provenance-and-integrity/prevent-release-changes).

## Channel promotion is a separate release action

Creating or publishing an immutable GitHub Release does not update a client
channel. Once the one-time initialization runs, Desktop and the online
bootstrap read these six mutable Preview endpoints:

```text
https://github.com/petehsu/lyra-releases/releases/download/preview-channel/catalog-preview-{target}.json
```

Only the separately dispatched `promote-component-channel.yml` workflow may
replace those assets. This Preview runbook exposes only the `preview` choice.
The operator must identify an already-public immutable release tag and exact
SemVer, and type the literal confirmation
`PROMOTE preview <release_tag> <release_version>`. Draft creation never invokes
promotion, and making a draft public does not invoke it either. The CLI also
rejects `stable` before reading credentials or contacting GitHub. Stable
promotion remains fail-closed until its legal, system-signing, and complete
application-readiness gates are machine-enforced in a separate release path.

The channel workflow fails closed unless all of the following are true:

- the fine-grained binary-repository token exists and
  `petehsu/lyra-releases` exists as a public repository;
- the source release is already public with API field `immutable: true`, while
  the rolling Preview release is public with `immutable: false`;
- normal promotion sees exactly the six canonical current Catalog assets;
  one-time initialization instead requires exactly zero current assets and the
  separate initialization operation and confirmation;
- all six candidates use one channel, release version, catalog sequence, and
  byte-identical root-signed keyring;
- every Catalog, embedded Keyring, referenced BOM, BOM descriptor, and
  component descriptor has a valid Ed25519 signature under a configured public
  trust root and authorized release key;
- every candidate Catalog, Keyring, and release-key validity window contains
  the verification time;
- every BOM Core satisfies the signed `minimumSafeCoreVersion`, and no BOM
  component/version pair appears in the candidate Catalog's revocation list;
- every BOM contains exactly the 17 known component IDs with their fixed kind,
  activation, delivery, and platform-specific entry contract, and all nine
  application entries use `first-party-shared-renderer`;
- BOM targets cover exactly macOS, Windows, and Linux on x64 and ARM64, and
  their component assets exist in the same immutable release with the signed
  byte sizes and GitHub-reported SHA-256 digests; and
- the candidate Catalog sequence is strictly greater than the maximum
  authenticated value in the current six channel assets; and
- the embedded Keyring sequence is either greater than the authenticated
  current floor, or equal only when its complete root-signed document is
  canonical-equivalent to the unique current Keyring at that
  sequence. Lower sequences and same-sequence ambiguity are rejected.

The trusted-root secret is mandatory. If
`LYRA_SIGNED_RELEASE_KEYRING_JSON` is configured, every candidate must embed
that exact signed public Keyring. Promotion uses no signing operation and the
workflow neither requests nor receives the offline-root or release private
key. An unchanged, still-valid Keyring may be reused across releases at the
same sequence. A changed Keyring must have a greater sequence and a new offline
root signature; reusing a sequence for different Keyring contents is forbidden.

After validation, the tool re-downloads the current channel assets to detect a
concurrent change. It uploads all candidates under transaction-specific
staging names and verifies their bytes before renaming the old assets to backup
names and the staged assets to the canonical names. A failed swap removes the
new assets and restores all authenticated old assets. Any unfinished
`promotion-pending-*` or `promotion-backup-*` asset blocks a later run so that
an operator must inspect and repair the channel instead of silently building
on an uncertain state. GitHub cannot atomically rename six assets in one API
operation, so no other actor may edit the channel release during this bounded
workflow; the workflow concurrency group serializes normal promotions for a
channel.

The workflow intentionally cannot create a missing channel Release. Repository
creation, publishing the empty mutable rolling Release, enabling immutable
future releases, environment approval rules, token provisioning, publishing an
immutable candidate, and manual repair remain explicit external release
operations. The one-time `initialize-empty` operation only fills a verified,
already-existing empty rolling Release; it cannot reset or replace a channel.

## Installation scope

Current-user installation writes components and bootstrap state below
`~/.lyra`, and projects Core to the platform's user program directory. System
scope uses:

- `/Library/Application Support/Lyra` and `/Applications/Lyra.app` on macOS;
- `%ProgramData%\Lyra` and `%ProgramFiles%\Lyra` on Windows; and
- `/var/lib/lyra` and `/opt/lyra` on Linux.

User data always remains under the user's `~/.lyra/data`. The installer asks
for operating-system elevation only after the user confirms system scope.
Proxy credentials are transferred to the elevated child in a one-use,
size-limited request file whose content is bound to a SHA-256 passed to the
child; they are not placed in the elevated command line. The invoking user's
data path is carried in the same content-bound request because a privileged
child may otherwise observe the administrator account's home directory.

## Failure and repair

Downloads are content-addressed and resumable. Hash or signature failure never
reaches activation. Existing installations receive pending components; an
owner-specific safe-point coordinator activates them. A staged `lyra.core`
update remains pending until the user explicitly chooses **Restart and apply**;
ordinary application exit does not opt the user into an automatic Core
replacement.

For that explicit operation, Desktop writes
`<state-root>/core-projection/pending.v1.json` and copies the packaged
`lyra-bootstrap` executable into the digest-addressed
`<state-root>/core-projection/helpers/<sha256>/` directory outside the program
directory. It rejects links, non-regular or oversized files and a helper whose
SHA-256 changes during the copy or before launch. The detached helper is given
the exact installation, state, target, and program roots plus the current Lyra
PID and a finite wait timeout. Desktop then requests a full quit. The
user-started handoff uses manual projection mode and must not include
`--automatic-core-replacement`.

The helper waits for Lyra to exit, revalidates the installed Core payload, and
performs a journaled directory swap. The old program projection is retained
until the new inventory and activation commit succeed. On a switch or commit
failure it restores the previous projection and keeps the candidate pending;
on a later invocation it first recovers an interrupted transaction. Operators
must diagnose a failed or timed-out handoff and retry the same signed candidate
or run repair. They must not edit the activation registry or copy files into
the program directory by hand.

For each target candidate, exercise the handoff as an update to an existing
installation, not only as a clean install:

1. stage a signed BOM whose Core version changed and confirm that the registry
   keeps the old version `active` and records the candidate as `pending`;
2. confirm that an ordinary quit leaves the current projection unchanged;
3. invoke **Restart and apply**, confirm the observed Lyra process exits, and
   do not launch another Lyra instance into the same program root during the
   handoff;
4. relaunch only after the helper completes, then verify the projected file
   inventory, append-only projection commit, `active`/`previous` registry
   values, and cleared Core `pending` value; and
5. separately inject timeout, invalid payload, interrupted rename, and commit
   failure cases, then verify that the last-known-good program remains
   launchable and the signed candidate can be retried or repaired.

Re-running the same installer repairs the exact signed release. The bootstrap
binary also provides a whole-product uninstall operation. It waits for the
projected Core, installed Runtime/resource processes, and observed child
processes to exit, takes the bootstrap lock, and removes only the known program,
component, registry, trust, cache, offline bundle, and projection paths. Before
deleting anything it verifies a committed activation registry, the installed
Core inventory, and any projected Core commit. A damaged or unrecognized
program directory is refused; repair the signed release before uninstalling it.
`~/.lyra/data` is retained by default; deleting it requires both
`--remove-user-data` and the literal
`--confirm-remove-user-data DELETE-LYRA-DATA`. System-scope uninstall uses the
same one-use elevation request as installation.

Without Apple Developer ID and Authenticode identities, Preview publication is
manual and must describe operating-system warnings. The Preview build permits
the explicit manual **Restart and apply** handoff, but automatic Core
replacement remains compile-time disabled and cannot be enabled by a command
line or renderer request. The Desktop handoff does not elevate itself, so a
system-scope projection that needs administrator access remains an
installer-driven or separately elevated manual operation and requires real
platform testing.

Do not set `LYRA_SYSTEM_SIGNED_CORE_REPLACEMENT=1` merely because a signing
identity exists. A future signed release job may set it only after it verifies
the platform signature/notarization result, the helper provenance, current-user
and system-scope replacement, rollback, interrupted-swap recovery, and
operating-system elevation behavior on the target. Component signature
verification is never disabled.

The public shell repository, empty mutable Preview pointer, future-release
immutability policy, and private vulnerability reporting were provisioned
separately on 2026-07-31. Key provisioning, signed channel initialization,
candidate/draft upload, promotion, and any product publication remain distinct
external release actions and require their own intentional gated run.
