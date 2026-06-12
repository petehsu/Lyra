# Lyra Visual Conformance Rubric (Settings / Cursor-like baseline)

The Settings surface is the calibrated baseline. Every other surface must read as the same product. Audit each surface against these concrete checks. Cite `file:line` for every divergence.

## The canonical "ruler" (source of truth)
All visual values must resolve from these tokens (defined in `apps/desktop/src/renderer/styles/material.scss`), never bespoke literals:

- Backgrounds: `--lyra-app-bg` `--lyra-app-sidebar-bg` `--lyra-app-panel-bg` `--lyra-app-surface-bg` `--lyra-app-muted-bg`
- Rows: `--lyra-app-row-bg` (transparent) / hover `--lyra-app-row-hover-bg` (#dfdfe0) / active `--lyra-app-row-active-bg` (#d9d9da) / active border `--lyra-app-row-active-border`
- Inputs: `--lyra-app-input-bg/-hover-bg/-focus-bg/-border/-focus-border/-placeholder`
- Borders: `--lyra-app-border` (#d7d7d9) / `--lyra-app-border-strong` (#c4c4c7)
- Focus ring: `box-shadow: 0 0 0 var(--lyra-stroke-strong) var(--lyra-app-focus)`
- Primary: `--lyra-app-primary-button` (#2f3033, neutral-dark, NOT blue) / fg `--lyra-app-primary-button-fg`
- Switch on: `--lyra-app-switch-on` (#52a66f)
- Radii: card `--lyra-radius-10`, control `--lyra-radius-8`
- Control heights: compact 28 / default 32 / prominent 40 (`--lyra-control-h-*`)
- List rows: compact 28 / default 36-40 (`--lyra-list-row-*`, AppObjectRow min 40)
- Icon sizes: toolbar 14 / button 16 (`--lyra-icon-size-*`)

## Per-surface checks (PASS / FLAG each)

1. **Component usage** — interactive controls are App components (`AppButton`/`AppIconButton`/`AppInput`/`AppSelect`/`AppSwitch`/`AppObjectRow`/`AppBadge`/`AppStatusMessage`/`AppTabs`), not bare `<button>/<input>/<select>/<textarea>` (except approved titlebar `lyra-titlebar-context-*` chrome and Monaco/xterm/canvas internals).

2. **Color discipline** — no bespoke hex/rgb/hsl in the surface's SCSS; all colors resolve from `--lyra-app-*` / `--lyra-*` tokens. No leftover demo palette (`--bg`/`--text`/`--color-*` private systems). No raw `accentColor`/blue decorative tints.

3. **Neutral-first accent** — hover/selected use neutral `--lyra-app-row-hover-bg`/`-active-bg`, NOT a saturated brand/blue fill. Primary color appears only on the single primary action / focus, not splattered on hover.

4. **State completeness** — interactive elements show default/hover/active(selected)/focus-visible/disabled. Focus uses the canonical ring token. Selected ≠ merely hover.

5. **Density & dimensions** — row heights, control heights, paddings, icon sizes pull from the scale tokens (28/32/36/40; icon 14/16; spacing 4/6/8/12/16). No off-scale magic numbers; no IDE-cramped or web-airy spacing.

6. **Radii & borders** — controls `--lyra-radius-8`, cards `--lyra-radius-10`, 1px hairline borders via `--lyra-app-border`. No oversized pill/rounded demo cards, no heavy shadows on content (shadows only on overlays/popovers).

7. **Hierarchy & layout** — surface background layering (app < sidebar/panel < card), section headers via `AppSurfaceHeader`, list main text vs meta vs description have fixed hierarchy; long text ellipsizes and does not shift affordances.

8. **No card-in-card / demo residue** — settings-style section + row-group, not nested cards; no embedded-demo look (esp. AI Panel).

## Output format per surface
- Verdict: CONFORMS / MINOR GAPS / NEEDS WORK
- Findings table: `#, severity(high/med/low), file:line, check#, what diverges, concrete fix`
- Only real, fixable divergences — not stylistic opinion. If it resolves from the right token and uses App components, it PASSES.
