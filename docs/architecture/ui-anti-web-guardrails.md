# Lyra UI Anti-Web Guardrails

## Purpose
This document prevents Lyra from drifting into "web page feel" during iteration.
It defines hard UI rules and machine-enforced checks.

## Visual Intent
1. Immersive workspace-first UI, not card-first marketing layout.
2. Minimal visual noise.
3. State clarity through text/icon contrast and slim rails, not heavy shadows.

## Hard Rules
### Settings Surface
1. Left nav active state must use a slim vertical rail.
2. Settings options must be row-like selectors, not filled card blocks.
3. No box-shadow in settings blocks.
4. Hover state must not create floating card effects.

### Context Menu
1. Menu items must stay flat and clean.
2. No hover shadow blocks.
3. Hover must rely on content contrast only.

### General
1. New UI should prefer separators + spacing over thick borders.
2. Avoid hardcoded white backgrounds in workbench surfaces.
3. Keep reusable controls token-driven.

## Machine Guard
Guard script: `tools/verify-workbench-style.ts`

What it enforces:
1. Required selectors exist for settings active-rail behavior.
2. Settings choices remain borderless/transparent.
3. Context menu hover stays transparent and shadowless.
4. Global anti-pattern checks for settings card regression.

## Commands
1. Root: `pnpm lint:ui-style`
2. Desktop package: `npm --prefix apps/desktop run lint:ui-style`
3. Combined guard: `pnpm check`

## When Updating UI Rules
1. Update this file and `workbench-design-standards.md` in the same change.
2. Expand `verify-workbench-style.ts` with new selectors before shipping.
