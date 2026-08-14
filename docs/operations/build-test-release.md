# Build, test, and release

Audience: Internal
Status: Active
Last verified: 2026-07-31

## Change validation

Choose checks proportional to the changed ownership boundary, then run the root
guard before a release candidate:

```sh
pnpm check
pnpm build:ts
cargo test --workspace
```

For modular component changes, run the smaller ownership checks while
iterating, then the root guard:

```sh
pnpm components:test
pnpm apps:test
pnpm apps:release:check
pnpm --filter @lyra/desktop typecheck
pnpm --filter @lyra/desktop exec vitest run \
  src/main/components \
  src/main/component-update \
  src/main/runtime-update \
  src/main/third-party-apps \
  src/modules/workbench/workspace-apps
cargo test -p lyra-bootstrap-core -p lyra-bootstrap-installer
cargo test -p lyra-runtime-protocol -p lyra-wasi-host
```

The application tests include a source-derived Host permission audit. Every
Core command/event registration must explicitly declare either a capability or
`null`; every `lyra.core.*` target consumed by a first-party source bundle must
be registered and covered by that bundle's signed manifest permissions. The
three presentation targets are deliberately `null` because they expose only
Core locale/theme state to private first-party clients.

Packaged activation tests must use the Rust bootstrap registry authority.
Direct local TypeScript activation is acceptable only in development/test
fixtures that explicitly enable it. Resource changes additionally exercise
request leases, exclusive drain, health checks, Runtime safe points, and
rollback.

Documentation/legal changes additionally run their package typecheck/build,
public schema fixtures and MCP smoke tests, internal documentation checks,
legal structural checks, and third-party notice consistency checks. The exact
package scripts are maintained by `web/docs` and `web/site`.

HarmonyOS is not part of the public release matrix. When its source or shared UI
contract changes, run:

```sh
pnpm lint:harmony-ui
cd apps/harmony_pc
devecocli build
```

## Release candidate gate

1. Freeze the intended commit and version.
2. Confirm the worktree contains no unrelated generated or secret material.
3. Require a non-empty reviewed offline trust root, a valid root-signed release
   keyring, protected release key material, and monotonically increasing
   keyring/catalog sequences. Private keys must never enter the repository or
   release assets.
4. Run architecture, Agent-boundary, native-core, UI, prompt, i18n, repository
   hygiene, release-version, TypeScript, Rust, component, Host-permission, and
   focused product tests.
5. For publication, require all nine trusted application surfaces to be marked
   `complete`. A signed/installed Preview bundle does not satisfy functional
   parity and must continue using the static route.
6. Regenerate internal inventories and third-party notices; fail on drift.
7. Stage exactly 16 real components, then generate and verify the signed
   keyring/catalog/BOM/component chain, component SBOMs, size reports,
   per-target manifests, and SHA-256 sums.
8. Build all six target sets and both installer modes. Smoke-test current-user
   and system-scope install, Core projection, launch, update safe points,
   rollback/repair, cancellation/resume, uninstall, and retained-data behavior.
   A CI matrix definition is not evidence that these real runner tests passed.
9. Verify the online bootstrap is below 25 MiB. Verify the offline installer
   contains all 16 components including Playwright. Exercise online first-use
   and repair through the active release's immutable Catalog/BOM receipt on
   every target; missing receipts and sequence/release mismatches must fail
   closed. A local Core service without a real Playwright-dependent production
   caller is not feature-complete evidence.
10. Smoke-test local mode, login, provider setup, browsing, Agent, files,
   editor dirty state, image/PDF, terminal, downloads, credentials, UIUX,
   Skills, MCP, and language resources.
11. Build public docs and the site; verify representative English/Chinese pages
   without JavaScript, on narrow viewport, print, and keyboard navigation.
12. Run `legal:check`. Run `legal:release-check` only when publication is
   intended; it must reject pending legal content.
13. Review the provider register, privacy data-flow audit, licenses/source
   offers, release notes, security issues, and rollback plan.
14. Obtain named release and security approvals plus the operator's recorded
    legal-risk review. Record any independent legal advice actually obtained;
    never imply that counsel reviewed the release when that did not occur.

## Current modular release status

The public `petehsu/lyra-releases` repository has been created as a
binary-distribution shell. Its branch contains README and SECURITY only;
issues, projects, and wiki are disabled, and private vulnerability reporting is
enabled. One published `preview-channel` prerelease exists with zero assets and
remains mutable. Repository immutable releases are enabled, so future
published candidate releases are protected while this pre-existing rolling
pointer remains updateable by the audited promotion workflow. The repository
contains no source, catalog, BOM, component, installer, public key, or private
key, and the channel has not received its one-time signed genesis marker.

Current trust roots are intentionally empty, legal content remains `pending`,
and system code signing is unavailable. Therefore a local green build is not
authorization to create a Preview candidate, initialize or promote the empty
channel, enable automatic Core replacement, publish Stable, or deploy legal
content. See the
[Modular Preview release](modular-preview-release.md) runbook for the detailed
artifact flow.

## Artifact integrity

- Build from the frozen commit and record the commit, toolchain, target, and
  checksums.
- Sign/notarize only final artifacts using protected credentials.
- Treat the Rust append-only activation registry as the packaged pointer
  authority; the Desktop `registry.v1.json` cache must never be manufactured as
  a substitute during packaging or repair.
- Keep Core automatic replacement disabled until Apple Developer ID /
  Authenticode and the associated system-scope tests pass. Manual
  **Restart and apply** does not elevate; system-owned updates return to the
  explicitly elevated installer/repair path.
- Verify bundled native binaries and third-party license/source-offer payloads
  match the notices.
- Do not publish a platform merely because its source can compile. A platform
  requires packaging, installation, update, security, test, and support
  evidence.

## Rollback

A rollback plan identifies:

- which application version can safely read the current persistence formats;
- whether database/storage migrations are reversible;
- which update channel and website version are restored;
- how users are notified;
- which provider, secret, or artifact must be revoked.

Never roll back legal content by deleting history. Publish a new version and
retain the previous version in the legal history route.
