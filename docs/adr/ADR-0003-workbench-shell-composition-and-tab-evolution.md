# ADR-0003: Workbench Shell Composition and Tab Evolution Readiness

## Status
Accepted

## Context
Lyra workbench will keep growing: more software surfaces in workspace tabs, richer tab operations (reorder/split/merge/detach), and likely multi-window orchestration.

If core shell logic stays coupled in one file, every UI change will risk breaking terminal, browser, and layout behavior together.

## Decision
1. Keep `WorkbenchShell` as a composition layer only.
2. Move volatile domain logic into focused modules:
   - workspace tab lifecycle (create/activate/move/close): `workspace-tabs/service.ts`
   - panel resize and css vars: `shell/use-panel-layout.ts`
   - search result lifecycle and shared-element state: `shell/use-browser-search-model.ts`
   - terminal close/move/context actions: `shell/use-terminal-workspace-actions.tsx`
   - workspace content dispatching by tab kind: `shell/workspace-surface-router.tsx`
3. Keep terminal placement explicit in state (`dock | workspace`) so migration does not destroy sessions.
4. Keep right-click menu infra global and reusable (`context-menu` module), not scene-local.

## Consequences
1. Future features (tab detach, merge, split, independent windows) can be added by extending state/actions modules first, then wiring in shell composition.
2. UI redesigns can replace surfaces without rewriting terminal session lifecycle.
3. Regression risk is reduced because domain tests remain isolated and shell tests only verify composition.

## Guardrails
1. New workbench features should not add long-lived business logic directly into `shell/index.tsx`.
2. Terminal session close must stay explicit (close action), never be coupled to React unmount.
3. New tab page kinds must be routed through `workspace-surface-router.tsx` with typed contracts.
4. Cross-domain actions (browser tab close affecting terminal sessions, etc.) must stay in dedicated action hooks/services.
5. `browser-tabs` is UI-only; tab lifecycle state/actions are only allowed in `workspace-tabs`.
