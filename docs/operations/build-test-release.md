# Build, test, and release

Audience: Internal
Status: Active
Last verified: 2026-07-28

## Change validation

Choose checks proportional to the changed ownership boundary, then run the root
guard before a release candidate:

```sh
pnpm check
pnpm build:ts
cargo test --workspace
```

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
3. Run architecture, Agent-boundary, native-core, UI, prompt, i18n, repository
   hygiene, release-version, TypeScript, Rust, and focused product tests.
4. Regenerate internal inventories and third-party notices; fail on drift.
5. Build Desktop targets in the supported release matrix and smoke-test install,
   launch, local mode, login, provider setup, browsing, Agent, files, terminal,
   update, and uninstall/retained-data behavior.
6. Build public docs and the site; verify representative English/Chinese pages
   without JavaScript, on narrow viewport, print, and keyboard navigation.
7. Run `legal:check`. Run `legal:release-check` only when publication is
   intended; it must reject pending legal content.
8. Review the provider register, privacy data-flow audit, licenses/source
   offers, release notes, security issues, and rollback plan.
9. Obtain named release and legal approvals.

## Artifact integrity

- Build from the frozen commit and record the commit, toolchain, target, and
  checksums.
- Sign/notarize only final artifacts using protected credentials.
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

