# HarmonyOS Workbench shell

Audience: Internal
Status: Experimental
Last verified: 2026-07-28

`apps/harmony_pc` is a HarmonyOS API 23 project containing an ArkUI Workbench
shell for tablet/2-in-1 experimentation. It consumes a repository-generated
visual contract derived from selected Desktop Workbench sources.

## Current boundary

- The `entry` module can be built with the DevEco/Hvigor toolchain.
- The UI contract tracks brand assets, tokens, shell dimensions, and selected
  Desktop source hashes.
- The ArkTS shell is an implementation experiment and compatibility target.
- The full Desktop Agent host bridge, runtime socket integration, browser
  automation surface, auth/storage parity, packaging, update, and release
  operations are incomplete.

Therefore HarmonyOS is not a released Lyra product, must not appear in public
feature/platform lists, and must not be used as evidence that Agent capabilities
are available on HarmonyOS.

## Maintenance

Use the mandatory `devecocli` workflow for HarmonyOS builds. The repository
contract guard is:

```sh
pnpm lint:harmony-ui
```

After a Desktop shell/token change, regenerate the Harmony UI contract through
the repository tool, review the ArkTS impact, then build from
`apps/harmony_pc`:

```sh
devecocli build
```

Do not hand-edit source hashes to make the guard pass. A future public release
requires a separate ADR covering runtime transport, security, account/data
parity, supported devices, distribution, and release ownership.

