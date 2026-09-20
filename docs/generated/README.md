# Generated inventories

Audience: Internal
Status: Generated
Last verified: 2026-07-28

> Generated file. Do not edit by hand.
>
> Sources: `docs/scripts/generate-inventories.mjs`.
> Regenerate with `node docs/scripts/generate-inventories.mjs`.

- [Module index](modules.md)
- [Desktop IPC index](ipc.md)
- [Runtime method index](runtime-methods.md)
- [Host command index](host-commands.md)
- [Tool-FS index](tools.md)

These files prevent hand-maintained lists from becoming architectural
folklore. They are private snapshots, not public compatibility contracts.

Regenerate after workspace/package, `LYRA_CHANNELS`, Host commands,
runtime families, Tool-FS catalog, or runtime adapter changes. CI should use:

```sh
node docs/scripts/generate-inventories.mjs --check
```
