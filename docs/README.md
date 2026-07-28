# Lyra internal engineering documentation

Audience: Internal
Status: Active
Last verified: 2026-07-28

This tree is the engineering source of truth for Lyra's private implementation.
It is not the public user or external developer documentation and must not be
copied into the public docs build. Public contracts live under `web/docs`;
legal content lives under `web/site`.

English documents in this tree are canonical. The
[Chinese overview](README.zh-CN.md) is a maintained map and risk summary, not a
second implementation specification.

## Start here

- [Architecture overview](architecture/overview.md)
- [Security and data flow](architecture/security-data-flow.md)
- [Internal contracts](contracts/README.md)
- [Operations](operations/README.md)
- [Architecture decisions](decisions/README.md)
- [Design rules](design/README.md)
- [Generated inventories](generated/README.md)

## Taxonomy

| Area | Purpose |
| --- | --- |
| `architecture/` | Current process, runtime, storage, auth, extension, browser, and data-flow design |
| `contracts/` | Private IPC, Tool-FS, daemon, persistence, and package contracts |
| `operations/` | Build, release, licensing, privacy, provider, and incident procedures |
| `decisions/` | Accepted, proposed, or superseded architectural decisions and their alternatives |
| `design/` | Product visual-system and surface migration rules |
| `generated/` | Source-derived module, IPC, and Tool-FS indexes |
| `scripts/` | Inventory generation and documentation checks |

## Status vocabulary

- `Active`: describes the current implementation or required procedure.
- `Accepted`: an adopted architectural decision.
- `Proposed`: a target decision that is not yet fully implemented.
- `Draft`: incomplete analysis; it must not be treated as an implementation
  contract.
- `Superseded`: retained for history with a link to its replacement.

## Source-of-truth order

When documentation and code disagree:

1. production parsers, registries, and runtime tests describe current behavior;
2. accepted ADRs describe intended boundaries;
3. architecture pages explain the current composition;
4. generated indexes are snapshots and must be regenerated;
5. proposed ADRs describe target state only.

Update the relevant page in the same change as an internal contract or data-flow
change. Do not turn private paths, IPC names, database layouts, or Agent ABI
types into public compatibility promises.

## Maintenance

From the repository root:

```sh
node docs/scripts/generate-inventories.mjs
node docs/scripts/generate-inventories.mjs --check
node docs/scripts/check-docs.mjs
```

The first command rewrites only `docs/generated/*.md`. The `--check` form and
the documentation checker are suitable for CI.

