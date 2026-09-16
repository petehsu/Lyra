# Workbench chrome contributions

Audience: Internal
Status: Active
Last verified: 2026-09-15

Lyra Workbench chrome (tab toolbar context, address band, AI composer meta row) follows a VS Code–like model: **Shell owns DOM**, app modules contribute **serializable descriptors** and **commands**, not arbitrary React trees.

## Contribution points

| Slot | DOM region | Scope |
|------|------------|--------|
| `toolbarContext` | `.lyra-browser-tabs-toolbar-context` | `workspaceTab` |
| `navigation` | Address / omnibox band | `workspaceTab` |
| `composerMeta` | `.lyra-agents-project-meta-row` | `aiSession` |

Global `AppShellTitlebar` window controls remain Core-owned in v1.

## Host API

- `lyra.core.chrome.set` — `{ scope, slot, ownerId, contribution }`
- `lyra.core.chrome.clear` — `{ scope, slot, ownerId }`
- `lyra.core.chrome.read` — `{ scope, slot }`
- `lyra.core.workspace.resolve-tab` — `{ instanceId }` → `{ tabId }`
- Event: `lyra.core.chrome-changed`

Types live in `@lyra/app-runtime` (`WorkbenchChromeScopeV1`, `WorkbenchChromeContributionV1`, …).

## Module SDK

First-party packages use `useFirstPartyWorkbenchChrome(ownerId, build, deps)` from `@lyra/first-party-app-kit`. Modules must **not** call `useWorkbenchTitlebarContribution` (separate React root).

Notifications (`lyra.notifications`) is a complete independent app.

- **Surface copy** ships in `@lyra/app-notifications` (`src/l10n`) and follows
  Host `presentation.locale`. It does not read Core language-pack keys such as
  `notification.center*`. Core chrome that is not the center page (topbar,
  clear-all confirm, publisher titles) still uses Core `t()`.
- **Inbox** stays a Core platform service. Publishers call `lyra.core.notify`
  (or Core `publishNotification`). Core persists at most 200 items under
  workbench-state key `notifications` and drives the topbar badge plus OS
  notifications. The center page only reads and mutates through
  `lyra.core.notifications.*`. A missing or damaged bundle shows the generic
  unavailable/repair empty state, not a second Core notification UI.
  Uninstalling `lyra.notifications` removes the center page and does not drop
  the inbox, badge, or OS notifications.

## Trust

Same boundary as `LyraHostBus`: activated installed modules, command IDs owned by `ownerId` prefix.

## Forbidden in v1

- Injecting React nodes into Shell chrome from app bundles
- Tab-strip DOM from modules (tabs stay on `workspace-tabs` model)

Navigation overrides for the active workspace tab are read via `useWorkspaceTabNavigationChrome` (`titlebar-navigation-chrome.ts`); when no module contributes `navigation`, Shell keeps the existing `useTitlebarNavigationModel` path unchanged.

See `apps/desktop/src/modules/workbench/shell/workbench-chrome-bus.ts` for merge/cleanup semantics.
