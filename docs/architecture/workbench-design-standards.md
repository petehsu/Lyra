# Lyra Workbench Design Standards

## Purpose
This document defines the **visual language** and **implementation rules** for Lyra Workbench UI.
It is a normative reference for design and frontend implementation.

Goals:
1. Keep Lyra immersive and space-efficient.
2. Keep interactions familiar (browser + IDE mental model).
3. Eliminate hardcoded UI behavior through tokens/config/services.

## Core Design Language
1. **Immersive**: avoid heavy framing, avoid excessive segmentation lines and shadows.
2. **Less Is More**: remove duplicated UI elements, prioritize content area.
3. **Familiar First**: innovation must not increase user learning cost.
4. **Consistent Density**: top bar, workspace tabs, and terminal tabs use aligned density.
5. **Fusion Over Separation**: active tab should visually merge with its content surface.

## Standard Density Tokens (Single Source of Truth)
All baseline sizes must come from `apps/desktop/src/renderer/styles/tokens.css`.

| Token | Default | Meaning |
| --- | --- | --- |
| `--lyra-size-titlebar-h` | `34px` | Titlebar height |
| `--lyra-size-browser-tab-h` | `34px` | Workspace browser-tab strip height |
| `--lyra-size-terminal-tab-h` | `34px` | Terminal tab height |
| `--lyra-size-icon-button-w` | `26px` | Icon button width |
| `--lyra-size-icon-button-h` | `22px` | Icon button height |
| `--lyra-size-browser-nav-slot` | `32px` | Browser back/forward/new-tab slot width |
| `--lyra-size-browser-pill-h` | `52px` | Search pill height |
| `--lyra-size-browser-pill-compact-h` | `40px` | Compact search pill height |
| `--lyra-size-browser-circle` | `28px` | Search/logo circle size |

Rule:
1. New global sizes MUST be added to token definitions first.
2. Components SHOULD NOT introduce ad-hoc numeric dimensions for shared UI patterns.

## Interaction State Protocol
Every clickable control must define clear states:
1. `default`: lower visual weight (`opacity`/muted color).
2. `hover`: stronger readability (same hue family, not arbitrary new highlight color).
3. `active`: explicit semantic emphasis.
4. `disabled`: no hover-selected color and no interaction.

Mandatory rule:
1. Disabled navigation controls (like back/forward with no history) MUST NOT show selected hover color.

## Segmentation and Fusion Rules
1. Prefer soft separation by surface contrast and spacing over hard lines.
2. Resizer hover must use **line deepening**, not a new accent color.
3. Active tabs must fuse with their surface (workspace tabs and terminal tabs follow the same concept).
4. Close buttons use hover reveal; destructive hover uses danger semantic color.

## Anti-Hardcoding Rules
### Visual
1. No hardcoded theme colors in feature components.
2. Theme values must flow from theme resolver:
   `resolveThemeVars` / `resolveTerminalThemeVars`.
3. Shared dimensions must come from tokens.

### Text / Locale
1. UI strings must come from i18n keys.
2. Dictionaries are split per locale file under:
   `apps/desktop/src/modules/workbench/i18n/locales/`.

### Feature Options
1. Theme lists must come from `WORKBENCH_THEME_IDS`.
2. Locale lists must come from `WORKBENCH_LOCALES`.
3. Terminal preset lists must come from `WORKBENCH_TERMINAL_THEME_PRESET_IDS`.
4. Search engines and core defaults must come from `WORKBENCH_CONFIG`.

### Runtime Access
1. Renderer must access desktop capabilities via `getDesktopApi` and typed bridge contracts.
2. UI modules must call typed module APIs (`useBrowserTabsModel`, `useTerminalDockModel`, etc.), not internal deep state hacks.

## Standardized Entry Points
Use these stable entry points first:
1. Theme resolution: `modules/workbench/theme/*`
2. Terminal theme resolution: `modules/workbench/terminal-theme/*`
3. i18n translation: `modules/workbench/i18n/*`
4. Workbench preferences/persistence: `modules/workbench/preferences/*`
5. Browser tab lifecycle: `modules/workbench/browser-tabs/*`
6. Terminal dock lifecycle: `modules/workbench/terminal-dock/*`
7. Desktop bridge: `src/shared/desktop-bridge.ts` + preload/main adapters

## Module Structure and Boundary Rules
All new workbench modules must follow:
1. `types.*`
2. `service.*`
3. `index.*`
4. `tests/*`

Do not:
1. Create god files.
2. Bypass public module exports.
3. Break boundary rules enforced by `tools/verify-boundaries.ts`.

## PR Checklist (UI/UX + Engineering)
- [ ] No hardcoded theme colors in components.
- [ ] No hardcoded copy strings (i18n keys used).
- [ ] Shared dimensions use design tokens.
- [ ] Disabled/hover/active states are complete and correct.
- [ ] Active-tab fusion behavior preserved.
- [ ] Module shape is `types/service/index/tests`.
- [ ] `npm --prefix apps/desktop run typecheck` passes.
- [ ] Related tests pass.

## Change Management
If a change modifies visual language, update this document in the same PR.

## Anti-Web Guard
To prevent "web card feel" regression, Lyra keeps a machine guard:
1. Script: `tools/verify-workbench-style.ts`
2. Command: `pnpm lint:ui-style`
3. Scope: settings interaction affordances + context menu flat behavior + anti-card regression patterns.

Detailed policy: `docs/architecture/ui-anti-web-guardrails.md`.
