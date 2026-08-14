# Changelog

## 0.1.0-preview.11

- Adds a standalone account page with local usage statistics, model activity,
  editable profile details, and a 52-week Token activity heatmap.
- Moves Simplified Chinese out of the desktop bundle and adds signed remote
  language-pack discovery, installation, validation, and release gates.
- Improves browser navigation labels and popovers, and fixes the native usage
  statistics route so packaged builds can read device activity.

## 0.1.0-preview.10

- Adds source-aware Skill and MCP import synchronization for Claude, Cursor,
  Codex, OpenCode, and Zed across user and project scopes.
- Adds OpenCode model-provider support and repairs custom provider discovery,
  branding, stream recovery, and model grouping behavior.
- Improves MCP connection metadata, secret handling, project isolation, and
  cross-platform installer/runtime behavior.

## 0.1.0-preview.9

- Repairs the desktop runtime installation path and keeps terminal and model
  capabilities available after components finish installing.
- Shows the Components section consistently and reports custom installer
  update support accurately instead of surfacing a missing metadata error.
- Uses the Lyra desktop callback for development OAuth sign-in and removes the
  homepage login disclosure copy.

## 0.1.0-preview.8

- Adds startup update checks, notification-center alerts, and user-controlled
  download, retry, and restart-to-install flows in Lyra Software.
- Improves Agent workspace interactions, credential/login surfaces, and
  cross-platform desktop behavior.

## 0.1.0-preview.2

- Fixes Supabase anon key missing from packaged Core build (login showed "not configured").
- Replaces developer-facing auth error messages with user-facing text.

## 0.1.0-preview.1

- Introduces the signed modular component runtime, version-pinned release BOM, and safe activation, repair, and rollback foundations.
- Adds small online and complete offline Preview installers for macOS, Windows, and Linux on x64 and ARM64.
- Moves Desktop and Runtime communication to the V2-only protocol with Host API, capability, lease, and data-schema validation.
- Adds independently built first-party application components while retaining compatibility surfaces for features still being migrated.
- Adds explicit startup consent and disclosures for Persona context, credential capture, precise location, trusted UIUX code, search, and external model transfers.
- Rebuilds public documentation, legal drafts, provider records, third-party notices, and release validation gates.

## 0.1.0

- Establishes Lyra desktop release packaging, update, and repository guardrails.
