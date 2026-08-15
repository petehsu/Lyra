# Lyra UI Studio

This browser studio mounts the real Lyra desktop renderer source. It does not
redraw the product UI. The workbench shell, screens, UI components, design
tokens, fonts, icons and styles are imported from `apps/desktop`.

## Preview

From the repository root:

```bash
pnpm --dir "Lyra宣传视频/ui-studio" dev
```

Open <http://127.0.0.1:5190>.

## Build

```bash
pnpm --dir "Lyra宣传视频/ui-studio" build
```

Shot-specific state and animation live under `shots/`. Shared product UI must
remain sourced from the real renderer so that a product UI change can be
synced without manually redrawing every shot.

## Shot folders and video export

Every clip is a self-contained folder under `shots/`. Its `scene.ts` controls
the browser scene and `shot.json` defines duration, frame rate, and resolution.

```bash
pnpm --dir "Lyra宣传视频/ui-studio" render:shot -- 000-master
```

The command renders deterministic PNG frames and an editing-friendly high
quality H.264 MP4 under `rendered/000-master/<timestamp>/`. Rendered media is
ignored by Git; the master and shot source remain intact.

Current shots:

- `000-master`: the reusable real Lyra Workbench UI.
- `001-logo-reveal`: a black-screen character field that assembles into the
  real website ASCII Lyra mark.
- `002-logo-to-workbench`: the ASCII mark deconstructs into interface lines,
  revealing the real shared Lyra Workbench underneath.
- `003-opening-sequence`: one continuous light-directed timeline combining the
  star field, logo formation, real Workbench reveal, and exploded workspace.
