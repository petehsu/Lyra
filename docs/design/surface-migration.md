# Lyra surface migration specification

Audience: Internal
Status: Active
Last verified: 2026-07-28

This is the operational checklist for migrating one Workbench surface in
`apps/desktop` to the established Lyra App-component design language. The
foundation (Tailwind v4, token bridge, `renderer/ui` component layer, and UI
style guard) is already in place; Settings, Software Store, and Notification
Center are calibrated baselines. Read `Lyra-桌面端软件设计原则.md` and
`apps/desktop/src/renderer/styles/README.md` for the design language.

## Golden rule
Business surfaces must consume Lyra App components from `@renderer/ui/components` (and `@renderer/ui/app`, `@renderer/ui/layout`). Do NOT import `@renderer/ui/primitives` or `@radix-ui/*` directly. Do NOT add bare `<button>/<input>/<select>/<textarea>` anywhere in Workbench business TSX — replace them with App components. The guard is Workbench-wide strict by default; only renderer UI implementation layers and tests may own intrinsic controls.

## Component mapping (replace legacy → App component)
- bare `<button>` text action → `<AppButton variant size>`; lucide icon inside needs explicit `size={14}` and `aria-hidden="true"`.
  - variants: `default` (primary filled), `secondary`, `outline`, `ghost` (transparent, hover bg), `destructive`. sizes: `sm`(28) `md`(32) `lg`(40) `icon`.
- icon-only `<button>` → `<AppIconButton aria-label tone={"default"|"danger"|"muted"} active?>`. svg auto-sized; still pass `size={14}`.
- `<input>` → `<AppInput>` (drop-in, same props: value, onChange, placeholder, type, inputMode, aria-label).
- `<textarea>` → `<AppTextarea>` (drop-in).
- `<select>...<option>` → `<AppSelect ariaLabel value onValueChange options />` where `options: {value, label, icon?, description?, disabled?}[]`. `onValueChange` gives the value string directly (not an event).
- boolean checkbox / on-off → `<AppSwitch checked onCheckedChange aria-label />` (NOT two buttons, NOT checkbox).
- selectable object/list row → `<AppObjectRow icon title description meta badges active onClick />` (button by default; `as="div"` for non-interactive).
- status label/pill → `<AppBadge tone={"neutral"|"success"|"warning"|"error"|"info"}>`.
- page-level success/error/progress message → `<AppStatusMessage tone icon>`.
- section header with title/description/actions → `<AppSurfaceHeader title description eyebrow actions />`.
- tab switcher → `<AppTabs options value onChange />` (check its prop shape in app-tabs.tsx).
- search box → `<AppSearchField>`.
- command palette / command picker → `<AppCommandMenu open items onSelectItem />`.
- modal dialog surface → `<AppDialog open onOpenChange title description footer />`; existing Global Dialog service can keep its service API but should use the same App visual language.
- toast row / notification preview primitive → `<AppToast>` with `<AppToastProvider>` / `<AppToastViewport>` when a component-level toast is needed. Product-level operation feedback should still prefer the notification service or inline `<AppStatusMessage>`.

## DO NOT TOUCH (approved chrome patterns, guard-protected)
- Titlebar contributions using `lyra-titlebar-context-*` classes must still consume `AppToolbarButton` / `AppIconButton` / `AppButton`; keep the existing class names only as layout hooks.
- Guard-protected selectors keep their required declarations. If your surface has a selector listed in `tools/verify-workbench-style.ts` `selectorRules`/`iconOnlyHoverRules` (e.g. `.lyra-context-menu-item`, `.lyra-global-dialog-action-primary`, `.lyra-file-manager-chooser-confirm`, `.lyra-file-manager-disk-*`), do not remove/alter the properties the guard requires.

## CSS rules (hard guard constraints)
- `renderer/styles/workbench/*.css` has been physically deleted. Put layout-only surface rules in `surfaces.scss`, shell rules in `shell.scss`, agent rules in `agents.scss`, and reusable effects in `effects.scss`.
- NEVER write raw color literals (`#hex`, `rgb()`, `hsl()`, `oklch()`) outside `tokens.css` and `material.scss`. Brand/effect/code/diff/skeleton colors must become `material.scss` tokens first.
- NEVER write raw length literals (`12px`) in non-token style layers. Use tokens: `var(--lyra-...)`, `var(--lyra-unit-N)`, `var(--lyra-space-N)`. Breakpoints `360/720/860/980/1080/1180/1200px` are allowed only in `@media`/`@container`.
- Keep surface styles to layout/structure (grid, scroll, spacing, surface hierarchy). REMOVE only rules that are fully replaced by the App component (e.g. a custom button's color/hover/disabled states). When in doubt, keep layout, drop control-skin.
- App components already provide hover/active/focus/disabled/selected states. Don't re-skin them in page CSS; only position/size via the wrapper class if needed.

## Inline style guard
- No raw numeric/px inline `style={{...}}` for visual props (fontSize,width,height,padding,margin,gap,borderRadius,top/right/bottom/left,lineHeight,min/max...). Dynamic values must come from tokens or be computed transforms (e.g. `transform: scaleX(ratio)` is fine).

## Architecture constraints (guard-enforced)
- Files named `*surface-view.tsx`, `*-view.tsx` presentational views must NOT own React state/effect hooks or call the desktop bridge — keep runtime in models/runtime hooks. If a `view.tsx` already has hooks (a container), that's its existing role; preserve the split.
- Don't change business logic, data flow, or bridge calls. This is a UI/visual migration only.

## Shared layer rule
Ordinary one-surface migrations should not edit shared design-system files. If an App component is missing, report the gap. Design-system batches may edit the shared layer directly and must update tests/guard/docs in the same change.

Shared files:

- `apps/desktop/src/renderer/styles/app-ui.scss`
- `apps/desktop/src/renderer/styles/tailwind.css`, `tokens.css`, `base.css`, `index.scss`, `material.scss`
- `apps/desktop/src/renderer/ui/**` (the component layer)
- `tools/verify-workbench-style.ts`

## Verify before finishing
Run from `apps/desktop`:
- `npm run lint:ui-style`  (must print `[Lyra UI Guard] OK`)
- `npm run typecheck`  (must pass)
- If the module has tests: `npx vitest run <module test path>`
Report exactly which files you changed, what controls you migrated (counts), any CSS rules you removed, and any App-component gaps you hit. Any Workbench business TSX that reintroduces bare form/action controls will fail the guard.
