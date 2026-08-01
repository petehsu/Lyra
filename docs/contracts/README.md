# Internal contracts

Audience: Internal
Status: Active
Last verified: 2026-07-31

These documents describe private implementation boundaries. They are not public
SDKs, are not covered by the external compatibility policy, and may change in
the same release when all in-repository callers and migrations are updated.

- [Desktop IPC and preload](desktop-ipc-preload.md)
- [Runtime socket](runtime-socket.md)
- [Tool-FS](tool-fs.md)
- [Persistence formats](persistence.md)
- [Crate and package boundaries](package-boundaries.md)
- [Component, release, and activation contracts](component-update-v1.md)

## Change rule

An internal contract change must include:

1. producer and consumer updates;
2. DTO/parser tests at the boundary;
3. migration or explicit reset behavior for persisted data;
4. security/privacy review when data classes or privileges change;
5. regenerated [inventories](../generated/README.md);
6. public documentation changes only if the externally supported behavior
   changes.

Do not expose these files from the public docs application. Public MCP, Skill,
language-pack, UIUX Preview, and Software Capability Preview schemas are
separate documentation contracts.
